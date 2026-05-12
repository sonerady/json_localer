// Job CRUD endpoints — disk üzerindeki kalıcı state ile etkileşim.
//
// GET    /api/jobs                        — Tüm job'ları listele
// GET    /api/jobs/:jobId                 — Job meta + diller
// GET    /api/jobs/:jobId/snapshot/:lang  — Diskteki son snapshot'ı indir (download header'ı ile)
// GET    /api/jobs/:jobId/snapshot/:lang/raw — JSON olarak inline döner
// POST   /api/jobs/:jobId/snapshot/:lang  — Snapshot'ı manuel kaydet (acil kaydetme)
// DELETE /api/jobs/:jobId                 — Job klasörünü tamamen sil

import { Router } from 'express'
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

const router = Router()

router.get('/', async (_req, res) => {
  try {
    const jobs = await listJobs()
    res.json({ jobs, jobsDir: getJobsRoot() })
  } catch (e) {
    res.status(500).json({ error: e.message })
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
