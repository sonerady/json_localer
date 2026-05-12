// Backend ile konuşma — küçük helper'lar.
// Çevirinin kendisi server-driven; bu dosya sadece HTTP utility'leri sağlar.

export interface ServerHealth {
  ok: boolean
  hasEnvKey?: boolean
  jobsDir?: string
  version?: string
}

export async function fetchServerHealth(): Promise<ServerHealth | null> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return null
    return (await res.json()) as ServerHealth
  } catch {
    return null
  }
}

/** Disk'te chunksDone === chunksTotal olan dillerin outputCode listesi. */
export async function fetchCompletedLangs(): Promise<string[]> {
  try {
    const res = await fetch('/api/jobs/completed-langs')
    if (!res.ok) return []
    const data = (await res.json()) as { langs?: string[] }
    return Array.isArray(data.langs) ? data.langs : []
  } catch {
    return []
  }
}

/** Bir dilin diskteki son snapshot'ını ham JSON olarak indirir. */
export async function fetchLangSnapshot(
  jobId: string,
  lang: string,
): Promise<unknown | null> {
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
