// DeepSeek çevirisi — backend (Express) üzerinden.
// Backend her chunk'ı diske atomic yazar; yani client'a yanıt dönmeden ÖNCE
// veri persist edilmiştir.

import type { AppStoreLocale } from './appStoreLocales'

export interface DeepSeekRequestOptions {
  apiKey: string
  model: string
  signal?: AbortSignal
  jobId: string
  lang: string
  templateInit?: unknown
  progress?: {
    chunksDone: number
    chunksTotal: number
    stringsDone: number
    stringsTotal: number
    status: string
  }
  meta?: Record<string, unknown>
}

export interface TranslateChunkResult {
  translations: Record<string, string>
  snapshot: unknown
  stringsApplied: number
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export async function translateChunk(
  payload: Record<string, string>,
  target: AppStoreLocale,
  opts: DeepSeekRequestOptions,
): Promise<TranslateChunkResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`
  }

  const body = {
    payload,
    target: { language: target.language, nativeName: target.nativeName, code: target.code },
    model: opts.model,
    jobId: opts.jobId,
    lang: opts.lang,
    templateInit: opts.templateInit,
    progress: opts.progress,
    meta: opts.meta,
  }

  const res = await fetch('/api/translate/chunk', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Backend HTTP ${res.status}: ${text.slice(0, 400)}`)
  }

  const data = (await res.json()) as TranslateChunkResult
  if (!data?.translations || typeof data.translations !== 'object') {
    throw new Error('Backend returned no translations')
  }
  return data
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export interface ServerHealth {
  ok: boolean
  hasEnvKey?: boolean
  jobsDir?: string
  version?: string
}

export async function fetchServerHealth(): Promise<ServerHealth | null> {
  try {
    const res = await fetch('/api/health', { method: 'GET' })
    if (!res.ok) return null
    return (await res.json()) as ServerHealth
  } catch {
    return null
  }
}

/** Disk'te chunksDone === chunksTotal olan dillerin outputCode set'i. */
export async function fetchCompletedLangs(): Promise<string[]> {
  try {
    const res = await fetch('/api/jobs/completed-langs', { method: 'GET' })
    if (!res.ok) return []
    const data = (await res.json()) as { langs?: string[] }
    return Array.isArray(data.langs) ? data.langs : []
  } catch {
    return []
  }
}

export interface JobStateLangProgress {
  chunksDone: number
  chunksTotal: number
  stringsDone: number
  stringsTotal: number
  status?: string
  updatedAt?: string
}

export interface JobState {
  jobId: string
  meta: {
    jobId: string
    sourceFileName?: string | null
    model?: string
    chunkSize?: number
    targetCodes?: string[]
    stringsTotal?: number
    chunksTotal?: number
    createdAt?: string
    updatedAt?: string
  }
  langs: Record<string, { progress: JobStateLangProgress }>
}

/** Disk'teki job state'ini çek — cross-session resume için. */
export async function fetchJobState(jobId: string): Promise<JobState | null> {
  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/state`)
    if (!res.ok) return null
    return (await res.json()) as JobState
  } catch {
    return null
  }
}

interface JobsListItem {
  jobId: string
  meta?: {
    sourceFileName?: string | null
    chunkSize?: number
    stringsTotal?: number
    chunksTotal?: number
    updatedAt?: string
    createdAt?: string
  } | null
}

/**
 * server/jobs klasöründeki TÜM job'ları tara, parametreleri (stringsTotal +
 * chunkSize) eşleşeni bul. Birden fazla varsa updatedAt'e göre en son
 * dokunulanı, eşit ise sourceFileName eşleşmesini tercih et.
 * Bulunan job için tam state'i fetch edip döner.
 */
export async function findMatchingJob(
  stringsTotal: number,
  chunkSize: number,
  sourceFileName?: string | null,
): Promise<JobState | null> {
  try {
    const res = await fetch('/api/jobs')
    if (!res.ok) return null
    const data = (await res.json()) as { jobs?: JobsListItem[] }
    const candidates = (data.jobs || []).filter(
      (j) =>
        j.meta?.stringsTotal === stringsTotal &&
        j.meta?.chunkSize === chunkSize,
    )
    if (candidates.length === 0) return null
    // En son dokunulan en başta. Aynı zamanlı ise dosya adı eşleşmesi öne çıkar.
    candidates.sort((a, b) => {
      const aMatch = a.meta?.sourceFileName === sourceFileName ? 1 : 0
      const bMatch = b.meta?.sourceFileName === sourceFileName ? 1 : 0
      if (aMatch !== bMatch) return bMatch - aMatch
      return (b.meta?.updatedAt ?? '').localeCompare(a.meta?.updatedAt ?? '')
    })
    return await fetchJobState(candidates[0].jobId)
  } catch {
    return null
  }
}

/** Diskteki bir dil snapshot'ını ham JSON olarak çek. */
export async function fetchLangSnapshot(jobId: string, lang: string): Promise<unknown | null> {
  try {
    const res = await fetch(
      `/api/jobs/${encodeURIComponent(jobId)}/snapshot/${encodeURIComponent(lang)}/raw`,
    )
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
