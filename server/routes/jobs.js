// Job CRUD endpoints — disk üzerindeki kalıcı state ile etkileşim.
//
// GET    /api/jobs                        — Tüm job'ları listele
// GET    /api/jobs/:jobId                 — Job meta + diller
// GET    /api/jobs/:jobId/snapshot/:lang  — Diskteki son snapshot'ı indir (download header'ı ile)
// GET    /api/jobs/:jobId/snapshot/:lang/raw — JSON olarak inline döner
// POST   /api/jobs/:jobId/snapshot/:lang  — Snapshot'ı manuel kaydet (acil kaydetme)
// DELETE /api/jobs/:jobId                 — Job klasörünü tamamen sil

import { Router } from 'express'
import crypto from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  deleteJob,
  getJobDir,
  getJobsRoot,
  listJobFiles,
  listJobs,
  loadMeta,
  readLangSnapshot,
  saveLangProgress,
  saveLangSnapshot,
  validateJobId,
  validateLang,
} from '../lib/storage.js'
import {
  cancelAndDeleteJob,
  cancelJob,
  getJobState,
  startJob,
} from '../lib/jobRunner.js'

const router = Router()

function makeJobId() {
  return crypto.randomBytes(16).toString('base64url')
}

router.get('/', async (_req, res) => {
  try {
    const jobs = await listJobs()
    res.json({ jobs, jobsDir: getJobsRoot() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === Server-driven mod ===
// Browser kapatılsa bile çalışmaya devam eden background worker'ları başlatır.
// Body: { jobId?, source, sourceFileName?, model?, chunkSize?, langs: [{code, outputCode, target:{language, nativeName, code}}] }
// jobId verilirse mevcut joba dil eklemek için kullanılır (resume / append).
router.post('/start', async (req, res) => {
  try {
    const {
      jobId: incomingJobId,
      source,
      sourceFileName,
      model,
      chunkSize,
      langs,
    } = req.body || {}

    if (!source || typeof source !== 'object') {
      return res.status(400).json({ error: 'source (object) required' })
    }
    if (!Array.isArray(langs) || langs.length === 0) {
      return res.status(400).json({ error: 'langs (non-empty array) required' })
    }
    for (const l of langs) {
      if (!l || !l.code || !l.outputCode || !l.target) {
        return res
          .status(400)
          .json({ error: 'each lang must have { code, outputCode, target }' })
      }
    }

    let jobId = incomingJobId
    if (jobId) {
      try {
        validateJobId(jobId)
      } catch (e) {
        return res.status(400).json({ error: e.message })
      }
    } else {
      jobId = makeJobId()
    }

    const job = await startJob({
      jobId,
      source,
      sourceFileName: sourceFileName || null,
      model: model || 'deepseek-v4-flash',
      chunkSize: Number(chunkSize) || 60,
      langs,
    })

    res.json({ jobId: job.jobId, state: job.getState() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Live state — in-memory worker durumları + disk progress karışımı.
// Client her ~2 saniyede bu endpoint'i çağırır.
router.get('/:jobId/live', async (req, res) => {
  try {
    validateJobId(req.params.jobId)
    const inMem = getJobState(req.params.jobId)
    if (inMem) return res.json(inMem)
    // In-memory yoksa (ör. server restart, henüz auto-resume olmadı) → disk fallback
    const meta = await loadMeta(req.params.jobId)
    if (!meta) return res.status(404).json({ error: 'Job not found' })
    const dir = getJobDir(req.params.jobId)
    const files = await fs.readdir(dir).catch(() => [])
    const langs = {}
    for (const f of files) {
      if (!f.endsWith('.progress.json')) continue
      const outputCode = f.replace(/\.progress\.json$/, '')
      try {
        const p = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'))
        langs[outputCode] = {
          outputCode,
          status: p.status || 'queued',
          chunksDone: p.chunksDone || 0,
          chunksTotal: p.chunksTotal || meta.chunksTotal || 0,
          stringsDone: p.stringsDone || 0,
          stringsTotal: p.stringsTotal || meta.stringsTotal || 0,
          error: p.error || null,
        }
      } catch {
        // ignore corrupt
      }
    }
    res.json({
      jobId: req.params.jobId,
      sourceFileName: meta.sourceFileName,
      stringsTotal: meta.stringsTotal,
      chunksTotal: meta.chunksTotal,
      chunkSize: meta.chunkSize,
      langs,
    })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.post('/:jobId/cancel', async (req, res) => {
  try {
    validateJobId(req.params.jobId)
    const lang = req.body?.lang || req.query?.lang
    // `delete=true` → worker'ları durdur + job klasörünü tamamen sil.
    // (Kullanıcı sıfırdan başlatmak istediğinde.)
    const shouldDelete =
      req.body?.delete === true ||
      req.query?.delete === 'true' ||
      req.query?.delete === '1'
    if (shouldDelete) {
      await cancelAndDeleteJob(req.params.jobId)
      return res.json({ ok: true, deleted: true })
    }
    const ok = cancelJob(req.params.jobId, lang)
    if (!ok) {
      return res.status(404).json({ error: 'Job not active' })
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// Tüm job klasörlerini tarar, `<lang>.progress.json` dosyalarında
// chunksDone === chunksTotal olanları "tamamlanmış" sayar.
// NOT: /:jobId route'undan ÖNCE tanımlanmalı — yoksa Express bunu jobId zanneder.
router.get('/completed-langs', async (_req, res) => {
  try {
    const root = getJobsRoot()
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const completed = new Set()
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const dir = path.join(root, e.name)
      const files = await fs.readdir(dir).catch(() => [])
      for (const f of files) {
        if (!f.endsWith('.progress.json')) continue
        try {
          const raw = await fs.readFile(path.join(dir, f), 'utf8')
          const p = JSON.parse(raw)
          if (
            typeof p.chunksDone === 'number' &&
            typeof p.chunksTotal === 'number' &&
            p.chunksTotal > 0 &&
            p.chunksDone >= p.chunksTotal
          ) {
            completed.add(f.replace(/\.progress\.json$/, ''))
          }
        } catch {
          // bozuk progress dosyasını atla
        }
      }
    }
    res.json({ langs: [...completed] })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:jobId', async (req, res) => {
  try {
    validateJobId(req.params.jobId)
    const meta = await loadMeta(req.params.jobId)
    if (!meta) return res.status(404).json({ error: 'Job not found' })
    const files = await listJobFiles(req.params.jobId)
    const langs = files
      .filter((f) => f.endsWith('.json') && !f.endsWith('.progress.json') && f !== 'meta.json')
      .map((f) => f.replace(/\.json$/, ''))
    res.json({ jobId: req.params.jobId, meta, langs, files })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// Job'ın TÜM durumu: meta + her dil için progress (chunksDone vs).
// Cross-session resume için kullanılır — client browser kapansa bile bu
// endpoint'i çağırarak nereden devam edeceğini öğrenir.
router.get('/:jobId/state', async (req, res) => {
  try {
    const { jobId } = req.params
    validateJobId(jobId)
    const meta = await loadMeta(jobId)
    if (!meta) return res.status(404).json({ error: 'Job not found' })
    const dir = getJobDir(jobId)
    const files = await fs.readdir(dir).catch(() => [])
    const langs = {}
    for (const f of files) {
      if (!f.endsWith('.progress.json')) continue
      const lang = f.replace(/\.progress\.json$/, '')
      try {
        const raw = await fs.readFile(path.join(dir, f), 'utf8')
        langs[lang] = { progress: JSON.parse(raw) }
      } catch {
        // bozuk dosya — atla
      }
    }
    res.json({ jobId, meta, langs })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.get('/:jobId/snapshot/:lang', async (req, res) => {
  try {
    const { jobId, lang } = req.params
    validateJobId(jobId)
    validateLang(lang)
    const data = await readLangSnapshot(jobId, lang)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${lang}.json"`)
    res.send(JSON.stringify(data, null, 2))
  } catch (e) {
    res.status(404).json({ error: 'Snapshot not found' })
  }
})

router.get('/:jobId/snapshot/:lang/raw', async (req, res) => {
  try {
    const { jobId, lang } = req.params
    validateJobId(jobId)
    validateLang(lang)
    const data = await readLangSnapshot(jobId, lang)
    res.json(data)
  } catch (e) {
    res.status(404).json({ error: 'Snapshot not found' })
  }
})

router.post('/:jobId/snapshot/:lang', async (req, res) => {
  try {
    const { jobId, lang } = req.params
    validateJobId(jobId)
    validateLang(lang)
    const { result, progress } = req.body || {}
    if (!result || typeof result !== 'object') {
      return res.status(400).json({ error: 'body.result (object) required' })
    }
    await saveLangSnapshot(jobId, lang, result)
    if (progress) await saveLangProgress(jobId, lang, progress)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.delete('/:jobId', async (req, res) => {
  try {
    validateJobId(req.params.jobId)
    await deleteJob(req.params.jobId)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// Bonus: ham klasör yolunu açma talimatı (Finder'da gösterilebilir).
router.get('/:jobId/path', async (req, res) => {
  try {
    validateJobId(req.params.jobId)
    const dir = getJobDir(req.params.jobId)
    res.json({ path: dir })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

export default router
