// Server-side job runner: her dil için arka planda chunk loop'unu çalıştırır.
// Browser/HTTP isteğinden bağımsız çalışır — client kapatılsa bile worker'lar
// devam eder. Server restart olduğunda diskten yarım kalan jobları otomatik
// yeniden başlatır.
//
// Memory:
//   activeJobs: Map<jobId, JobRunner>
//   Her JobRunner içinde:
//     - source (in-memory; ilk run'da diskten okunur)
//     - leaves (collectStringLeaves)
//     - chunks (chunkLeaves)
//     - workers: Map<lang, LangWorker>
//
// Her chunk başarılı olunca disk'e atomic yazım yapılır → kayıp olmaz.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { translateChunk } from './deepseek.js'
import {
  buildEmptyTemplate,
  chunkLeaves,
  collectStringLeaves,
  leavesToPayload,
  parseKeyToPath,
  setAtPath,
} from './jsonChunk.js'
import {
  ensureJobDir,
  getJobDir,
  getJobsRoot,
  loadMeta,
  saveLangProgress,
  saveLangSnapshot,
  saveMeta,
  writeJsonAtomic,
} from './storage.js'

const MAX_RETRIES = 3
const MAX_CONCURRENT_REQUESTS = 10 // DeepSeek rate limit korumacı global semaphore
const POLL_DELAY_MS = 50

// === Global concurrency semaphore (DeepSeek koruyucusu) ===
let activeRequests = 0
const pendingResolvers = []

async function acquireSlot() {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++
    return
  }
  await new Promise((resolve) => pendingResolvers.push(resolve))
  activeRequests++
}

function releaseSlot() {
  activeRequests--
  const next = pendingResolvers.shift()
  if (next) next()
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// === In-memory job registry ===
const activeJobs = new Map() // jobId → JobRunner

export function getActiveJob(jobId) {
  return activeJobs.get(jobId)
}

export function listActiveJobs() {
  return [...activeJobs.keys()]
}

// === Worker lifecycle per (job, lang) ===

class LangWorker {
  constructor(job, lang) {
    this.job = job
    this.lang = lang
    this.status = 'queued'
    this.chunksDone = 0
    this.stringsDone = 0
    this.error = null
    this.startedAt = null
    this.finishedAt = null
    this.aborted = false
    this.promise = null
  }

  cancel() {
    this.aborted = true
  }

  async run() {
    const { jobId, chunks, leaves, target, jobsDir } = this.job
    this.status = 'running'
    this.startedAt = Date.now()

    // Diskten progress'i oku (varsa)
    const progressPath = path.join(
      jobsDir,
      jobId,
      `${this.lang.outputCode}.progress.json`,
    )
    let chunksDone = 0
    let stringsDone = 0
    try {
      const prev = JSON.parse(await fs.readFile(progressPath, 'utf8'))
      if (typeof prev.chunksDone === 'number') chunksDone = prev.chunksDone
      if (typeof prev.stringsDone === 'number') stringsDone = prev.stringsDone
    } catch {
      // dosya yok → 0'dan başla
    }
    this.chunksDone = chunksDone
    this.stringsDone = stringsDone

    // Snapshot'ı diskten oku, yoksa boş template'i tohumla
    const snapPath = path.join(jobsDir, jobId, `${this.lang.outputCode}.json`)
    let snapshot
    try {
      snapshot = JSON.parse(await fs.readFile(snapPath, 'utf8'))
    } catch {
      snapshot = buildEmptyTemplate(this.job.source)
      await writeJsonAtomic(snapPath, snapshot)
    }

    for (let i = chunksDone; i < chunks.length; i++) {
      if (this.aborted) {
        this.status = 'cancelled'
        this.finishedAt = Date.now()
        await this._persistProgress('cancelled')
        return
      }

      const chunk = chunks[i]
      const payload = leavesToPayload(chunk)

      let attempt = 0
      while (true) {
        if (this.aborted) {
          this.status = 'cancelled'
          this.finishedAt = Date.now()
          await this._persistProgress('cancelled')
          return
        }
        attempt++
        await acquireSlot()
        try {
          const { translations } = await translateChunk({
            payload,
            target: this.lang.target,
            model: this.job.model,
          })
          // Snapshot'a uygula
          let stringsApplied = 0
          for (const [key, val] of Object.entries(translations)) {
            if (typeof val !== 'string') continue
            try {
              snapshot = setAtPath(snapshot, parseKeyToPath(key), val)
              stringsApplied++
            } catch {
              // ignore single key error
            }
          }
          await saveLangSnapshot(jobId, this.lang.outputCode, snapshot)
          this.chunksDone = i + 1
          this.stringsDone += stringsApplied
          await this._persistProgress('running')
          break
        } catch (err) {
          if (attempt > MAX_RETRIES) {
            this.error = err.message || String(err)
            this.status = 'error'
            this.finishedAt = Date.now()
            await this._persistProgress('error')
            return
          }
          const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000)
          await sleep(backoff)
        } finally {
          releaseSlot()
        }
      }
    }

    this.status = 'done'
    this.finishedAt = Date.now()
    await this._persistProgress('done')
  }

  async _persistProgress(status) {
    await saveLangProgress(this.job.jobId, this.lang.outputCode, {
      chunksDone: this.chunksDone,
      chunksTotal: this.job.chunks.length,
      stringsDone: this.stringsDone,
      stringsTotal: this.job.leaves.length,
      status,
      error: this.error,
    }).catch(() => {})
  }
}

// === JobRunner: tüm dilleri yöneten obje ===

class JobRunner {
  constructor({ jobId, source, sourceFileName, model, chunkSize, langs }) {
    this.jobId = jobId
    this.source = source
    this.sourceFileName = sourceFileName
    this.model = model
    this.chunkSize = chunkSize
    this.leaves = collectStringLeaves(source)
    this.chunks = chunkLeaves(this.leaves, chunkSize)
    this.jobsDir = getJobsRoot()
    this.workers = new Map() // lang.outputCode → LangWorker
    this.langs = langs // [{ code, outputCode, target }]
    this.createdAt = new Date().toISOString()
  }

  async ensureSourceSaved() {
    await ensureJobDir(this.jobId)
    const srcPath = path.join(this.jobsDir, this.jobId, 'source.json')
    try {
      await fs.access(srcPath)
    } catch {
      await writeJsonAtomic(srcPath, this.source)
    }
  }

  async saveMeta() {
    await saveMeta(this.jobId, {
      jobId: this.jobId,
      sourceFileName: this.sourceFileName,
      model: this.model,
      chunkSize: this.chunkSize,
      stringsTotal: this.leaves.length,
      chunksTotal: this.chunks.length,
      targetCodes: this.langs.map((l) => l.code),
      langOutputCodes: Object.fromEntries(
        this.langs.map((l) => [l.code, l.outputCode]),
      ),
      langTargets: Object.fromEntries(this.langs.map((l) => [l.code, l.target])),
      createdAt: this.createdAt,
    })
  }

  startAllWorkers() {
    for (const lang of this.langs) {
      this.startLangWorker(lang)
    }
  }

  startLangWorker(lang) {
    const existing = this.workers.get(lang.outputCode)
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
      return existing
    }
    const w = new LangWorker(this, lang)
    this.workers.set(lang.outputCode, w)
    // Background promise — start() yanıtı verdikten sonra da çalışmaya devam eder
    w.promise = w.run().catch((err) => {
      w.error = err?.message || String(err)
      w.status = 'error'
      w.finishedAt = Date.now()
    })
    return w
  }

  cancel(langOutputCode) {
    if (langOutputCode) {
      const w = this.workers.get(langOutputCode)
      if (w) w.cancel()
    } else {
      for (const w of this.workers.values()) w.cancel()
    }
  }

  isAllFinished() {
    for (const w of this.workers.values()) {
      if (w.status === 'queued' || w.status === 'running') return false
    }
    return true
  }

  getState() {
    const langs = {}
    for (const w of this.workers.values()) {
      langs[w.lang.outputCode] = {
        code: w.lang.code,
        outputCode: w.lang.outputCode,
        status: w.status,
        chunksDone: w.chunksDone,
        chunksTotal: this.chunks.length,
        stringsDone: w.stringsDone,
        stringsTotal: this.leaves.length,
        error: w.error,
        startedAt: w.startedAt,
        finishedAt: w.finishedAt,
      }
    }
    return {
      jobId: this.jobId,
      sourceFileName: this.sourceFileName,
      stringsTotal: this.leaves.length,
      chunksTotal: this.chunks.length,
      chunkSize: this.chunkSize,
      langs,
    }
  }
}

// === Public API ===

export async function startJob({
  jobId,
  source,
  sourceFileName,
  model,
  chunkSize,
  langs, // [{ code, outputCode, target }]
}) {
  if (activeJobs.has(jobId)) {
    const existing = activeJobs.get(jobId)
    // Yeni gelen dilleri ekle (resume / append)
    for (const lang of langs) {
      if (!existing.workers.has(lang.outputCode)) {
        existing.langs.push(lang)
      }
    }
    existing.startAllWorkers()
    return existing
  }
  const job = new JobRunner({
    jobId,
    source,
    sourceFileName,
    model,
    chunkSize,
    langs,
  })
  activeJobs.set(jobId, job)
  await job.ensureSourceSaved()
  await job.saveMeta()
  job.startAllWorkers()
  return job
}

export function cancelJob(jobId, langOutputCode) {
  const job = activeJobs.get(jobId)
  if (!job) return false
  job.cancel(langOutputCode)
  return true
}

export function getJobState(jobId) {
  return activeJobs.get(jobId)?.getState() || null
}

// === Startup auto-resume: server restart sonrası yarım jobları yeniden çalıştır ===
//
// Mantık:
//   - jobs/ klasöründeki her job için meta.json oku
//   - source.json varsa (yeni mimari) → meta.targetCodes içindeki her dil için
//     progress.json'a bak; chunksDone < chunksTotal veya progress yoksa worker spawn
//   - Eski jobların (source.json'u olmayanlar) auto-resume edilemez — meta'da
//     source yok çünkü
export async function autoResumeIncompleteJobs() {
  const root = getJobsRoot()
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return { resumed: [], skipped: [] }
  }

  const resumed = []
  const skipped = []

  for (const e of entries) {
    if (!e.isDirectory()) continue
    const jobId = e.name
    const meta = await loadMeta(jobId).catch(() => null)
    if (!meta) {
      skipped.push({ jobId, reason: 'no meta' })
      continue
    }
    const srcPath = path.join(root, jobId, 'source.json')
    let source
    try {
      source = JSON.parse(await fs.readFile(srcPath, 'utf8'))
    } catch {
      skipped.push({ jobId, reason: 'no source.json (legacy job)' })
      continue
    }
    if (!Array.isArray(meta.targetCodes) || meta.targetCodes.length === 0) {
      skipped.push({ jobId, reason: 'no targetCodes in meta' })
      continue
    }

    // Yarım kalan dilleri belirle
    const langsToResume = []
    for (const code of meta.targetCodes) {
      const outputCode = meta.langOutputCodes?.[code] || code
      const target = meta.langTargets?.[code]
      if (!target) continue
      const progressPath = path.join(root, jobId, `${outputCode}.progress.json`)
      let progress = null
      try {
        progress = JSON.parse(await fs.readFile(progressPath, 'utf8'))
      } catch {
        // yok demek hiç başlanmamış → resume et
      }
      if (progress) {
        if (progress.status === 'cancelled') continue
        if (
          typeof progress.chunksDone === 'number' &&
          typeof progress.chunksTotal === 'number' &&
          progress.chunksDone >= progress.chunksTotal
        ) {
          continue // done → atla
        }
      }
      langsToResume.push({ code, outputCode, target })
    }

    if (langsToResume.length === 0) {
      skipped.push({ jobId, reason: 'all langs already done/cancelled' })
      continue
    }

    await startJob({
      jobId,
      source,
      sourceFileName: meta.sourceFileName,
      model: meta.model,
      chunkSize: meta.chunkSize,
      langs: langsToResume,
    })
    resumed.push({ jobId, langCount: langsToResume.length })
  }

  return { resumed, skipped }
}
