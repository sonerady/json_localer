// Atomik disk yazma + job dizini yönetimi.
// "Atomik" = aynı dosyaya tmp dosya yazıp rename yap → yarıda kesilen yazım sonucu
// bozuk JSON oluşmasını engeller (POSIX rename atomic).

import { promises as fs } from 'node:fs'
import path from 'node:path'

const JOB_ID_RE = /^[A-Za-z0-9_-]{6,64}$/
const LANG_RE = /^[A-Za-z0-9_-]{1,16}$/

function getJobsRoot() {
  return process.env.JOBS_DIR && process.env.JOBS_DIR.trim()
    ? path.resolve(process.env.JOBS_DIR.trim())
    : path.resolve(process.cwd(), 'jobs')
}

export function validateJobId(jobId) {
  if (!jobId || !JOB_ID_RE.test(jobId)) {
    throw new Error(`Invalid jobId: ${jobId}`)
  }
}

export function validateLang(lang) {
  if (!lang || !LANG_RE.test(lang)) {
    throw new Error(`Invalid lang: ${lang}`)
  }
}

export async function ensureJobDir(jobId) {
  validateJobId(jobId)
  const dir = path.join(getJobsRoot(), jobId)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export function getJobDir(jobId) {
  validateJobId(jobId)
  return path.join(getJobsRoot(), jobId)
}

export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const payload = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  await fs.writeFile(tmp, payload, 'utf8')
  await fs.rename(tmp, filePath)
}

export async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8')
  return JSON.parse(text)
}

export async function saveMeta(jobId, meta) {
  const dir = await ensureJobDir(jobId)
  await writeJsonAtomic(path.join(dir, 'meta.json'), {
    ...meta,
    updatedAt: new Date().toISOString(),
  })
}

export async function loadMeta(jobId) {
  try {
    return await readJson(path.join(getJobDir(jobId), 'meta.json'))
  } catch {
    return null
  }
}

export async function saveLangSnapshot(jobId, lang, result) {
  validateLang(lang)
  const dir = await ensureJobDir(jobId)
  await writeJsonAtomic(path.join(dir, `${lang}.json`), result)
}

export async function saveLangProgress(jobId, lang, progress) {
  validateLang(lang)
  const dir = await ensureJobDir(jobId)
  await writeJsonAtomic(path.join(dir, `${lang}.progress.json`), {
    ...progress,
    updatedAt: new Date().toISOString(),
  })
}

export async function readLangSnapshot(jobId, lang) {
  validateLang(lang)
  return readJson(path.join(getJobDir(jobId), `${lang}.json`))
}

export async function listJobs() {
  const root = getJobsRoot()
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const jobs = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (!JOB_ID_RE.test(e.name)) continue
      const meta = await loadMeta(e.name).catch(() => null)
      const files = await fs.readdir(path.join(root, e.name)).catch(() => [])
      const langs = files
        .filter((f) => f.endsWith('.json') && !f.endsWith('.progress.json') && f !== 'meta.json')
        .map((f) => f.replace(/\.json$/, ''))
      jobs.push({ jobId: e.name, meta, langs })
    }
    jobs.sort((a, b) => (b.meta?.updatedAt ?? '').localeCompare(a.meta?.updatedAt ?? ''))
    return jobs
  } catch {
    return []
  }
}

export async function listJobFiles(jobId) {
  const dir = getJobDir(jobId)
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

export async function deleteJob(jobId) {
  const dir = getJobDir(jobId)
  await fs.rm(dir, { recursive: true, force: true })
}

export { getJobsRoot }
