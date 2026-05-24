// Server-driven çeviri akışı.
//
// Browser sadece "start" requesti atar; backend her dil için arka planda
// worker çalıştırır. Browser ~2 saniyede /live endpoint'inden state'i çeker.
// Tarayıcı kapansa bile worker'lar Render'da çalışmaya devam eder. Tekrar
// açılınca localStorage'daki jobId ile yarım kalan job otomatik olarak izlenir.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  APP_STORE_LOCALES,
  getLocaleByCode,
  getOutputCode,
} from '@/lib/appStoreLocales'
import { collectStringLeaves } from '@/lib/jsonChunk'

export type LangStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface LangProgress {
  code: string
  name: string
  nativeName: string
  status: LangStatus
  chunksTotal: number
  chunksDone: number
  stringsTotal: number
  stringsDone: number
  error?: string
  result?: unknown
  startedAt?: number
  finishedAt?: number
}

export interface LogEntry {
  ts: number
  level: 'info' | 'warn' | 'error' | 'success'
  lang?: string
  message: string
}

interface StartArgs {
  source: unknown
  sourceFileName?: string | null
  targetCodes: string[]
  model: string
  chunkSize: number
}

interface ServerLangState {
  code?: string
  outputCode: string
  status: LangStatus
  chunksDone: number
  chunksTotal: number
  stringsDone: number
  stringsTotal: number
  error?: string | null
  startedAt?: number
  finishedAt?: number
}

interface ServerJobState {
  jobId: string
  sourceFileName?: string | null
  stringsTotal: number
  chunksTotal: number
  chunkSize: number
  langs: Record<string, ServerLangState>
}

const MAX_LOG_ENTRIES = 400
const LS_JOB_ID = 'dlt.lastJobId'
const POLL_INTERVAL_MS = 2000

function findLocaleByOutputCode(outputCode: string) {
  return APP_STORE_LOCALES.find((l) => getOutputCode(l) === outputCode)
}

function serverStateToProgress(
  state: ServerJobState,
): Record<string, LangProgress> {
  const out: Record<string, LangProgress> = {}
  for (const [outputCode, s] of Object.entries(state.langs)) {
    const loc = s.code
      ? getLocaleByCode(s.code)
      : findLocaleByOutputCode(outputCode)
    if (!loc) continue
    out[loc.code] = {
      code: loc.code,
      name: loc.name,
      nativeName: loc.nativeName,
      status: s.status,
      chunksTotal: s.chunksTotal,
      chunksDone: s.chunksDone,
      stringsTotal: s.stringsTotal,
      stringsDone: s.stringsDone,
      error: s.error || undefined,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
    }
  }
  return out
}

function anyActive(state: ServerJobState): boolean {
  for (const s of Object.values(state.langs)) {
    if (s.status === 'queued' || s.status === 'running') return true
  }
  return false
}

export function useTranslator() {
  const [progress, setProgress] = useState<Record<string, LangProgress>>({})
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const [currentLang, setCurrentLang] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(LS_JOB_ID)
  })
  const pollIntervalRef = useRef<number | null>(null)
  const lastRunningLangsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (jobId) localStorage.setItem(LS_JOB_ID, jobId)
    else localStorage.removeItem(LS_JOB_ID)
  }, [jobId])

  const log = useCallback((entry: Omit<LogEntry, 'ts'>) => {
    setLogs((prev) => {
      const next = [...prev, { ts: Date.now(), ...entry }]
      return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next
    })
  }, [])

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current != null) {
      window.clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [])

  const applyState = useCallback(
    (state: ServerJobState) => {
      const newProgress = serverStateToProgress(state)
      setProgress(newProgress)

      // Hangi diller şu an running, log üret
      const nowRunning = new Set<string>()
      for (const p of Object.values(newProgress)) {
        if (p.status === 'running') nowRunning.add(p.code)
      }

      const prevRunning = lastRunningLangsRef.current
      for (const code of nowRunning) {
        if (!prevRunning.has(code)) {
          const p = newProgress[code]
          log({
            level: 'info',
            lang: code,
            message: `${p.name} çevirisi başladı (parça ${p.chunksDone}/${p.chunksTotal}'den).`,
          })
        }
      }
      for (const code of prevRunning) {
        if (!nowRunning.has(code) && newProgress[code]) {
          const p = newProgress[code]
          if (p.status === 'done') {
            log({ level: 'success', lang: code, message: `${p.name} tamamlandı.` })
          } else if (p.status === 'error') {
            log({ level: 'error', lang: code, message: `${p.name} hata: ${p.error}` })
          } else if (p.status === 'cancelled') {
            log({ level: 'warn', lang: code, message: `${p.name} iptal edildi.` })
          }
        }
      }
      lastRunningLangsRef.current = nowRunning

      // Sonuncu running olanı currentLang yap
      const runningList = [...nowRunning]
      if (runningList.length > 0) setCurrentLang(runningList[runningList.length - 1])
      else setCurrentLang(null)

      const stillActive = anyActive(state)
      setRunning(stillActive)
      return stillActive
    },
    [log],
  )

  const pollOnce = useCallback(
    async (jobIdToFetch: string): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(jobIdToFetch)}/live`,
        )
        if (res.status === 404) {
          // Server'da yok — temizle
          setJobId(null)
          stopPolling()
          return false
        }
        if (!res.ok) return true // hata, tekrar dene
        const state = (await res.json()) as ServerJobState
        const stillActive = applyState(state)
        if (!stillActive) {
          stopPolling()
          log({ level: 'success', message: 'Tüm diller işlendi.' })
        }
        return stillActive
      } catch {
        return true // network hatası, polling devam
      }
    },
    [applyState, log, stopPolling],
  )

  const startPolling = useCallback(
    (jobIdToPoll: string) => {
      stopPolling()
      // İlk anlık fetch
      void pollOnce(jobIdToPoll)
      pollIntervalRef.current = window.setInterval(() => {
        void pollOnce(jobIdToPoll)
      }, POLL_INTERVAL_MS)
    },
    [pollOnce, stopPolling],
  )

  // Mount'ta localStorage'da jobId varsa otomatik olarak izlemeye başla.
  useEffect(() => {
    if (!jobId) return
    log({
      level: 'info',
      message: `Önceki job izleniyor: ${jobId}…`,
    })
    startPolling(jobId)
    return () => {
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cancel = useCallback(async () => {
    if (!jobId) return
    log({ level: 'warn', message: 'Durduruluyor — diskteki tüm JSON\'lar siliniyor…' })
    stopPolling()
    try {
      await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel?delete=true`, {
        method: 'POST',
      })
    } catch {
      // ignore — yine de local state'i sıfırla
    }
    // Local state'i tamamen temizle ki kullanıcı taze başlangıç hissetsin
    setProgress({})
    setCurrentLang(null)
    setRunning(false)
    setJobId(null)
    lastRunningLangsRef.current = new Set()
    log({ level: 'success', message: 'Durduruldu. Diskte temiz — yeniden başlatabilirsin.' })
  }, [jobId, log, stopPolling])

  const reset = useCallback(async () => {
    if (running) return
    stopPolling()
    // Server'daki job klasörünü de sil (varsa) ki disk birikmesin
    if (jobId) {
      try {
        await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel?delete=true`, {
          method: 'POST',
        })
      } catch {
        // server unreachable → en azından local state'i temizliyoruz
      }
    }
    setProgress({})
    setLogs([])
    setCurrentLang(null)
    setJobId(null)
    lastRunningLangsRef.current = new Set()
  }, [jobId, running, stopPolling])

  const start = useCallback(
    async ({
      source,
      sourceFileName,
      targetCodes,
      model,
      chunkSize,
    }: StartArgs) => {
      if (running) return

      // === Önceki işi tamamen sil (her Başlat = sıfırdan başlangıç) ===
      // Server'daki klasör + local progress + localStorage temizlenir.
      // Cross-session resume hâlâ çalışır çünkü mount'taki useEffect direkt
      // /live polling başlatır; start() sadece kullanıcının elle Başlat'a
      // bastığı durumda tetiklenir.
      if (jobId) {
        log({
          level: 'info',
          message: `Önceki job temizleniyor: ${jobId}…`,
        })
        stopPolling()
        try {
          await fetch(
            `/api/jobs/${encodeURIComponent(jobId)}/cancel?delete=true`,
            { method: 'POST' },
          )
        } catch {
          // server unreachable — yine de devam
        }
        setProgress({})
        setCurrentLang(null)
        setJobId(null)
        lastRunningLangsRef.current = new Set()
      }

      const leaves = collectStringLeaves(source)
      log({
        level: 'info',
        message: `Server'a iş gönderiliyor: ${leaves.length} string, ${targetCodes.length} dil…`,
      })

      // Lang descriptors — server outputCode bazlı çalışır
      const langs = targetCodes
        .map((code) => {
          const loc = getLocaleByCode(code)
          if (!loc) return null
          return {
            code: loc.code,
            outputCode: getOutputCode(loc),
            target: {
              language: loc.language,
              nativeName: loc.nativeName,
              code: loc.code,
            },
          }
        })
        .filter(Boolean)

      try {
        const res = await fetch('/api/jobs/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // jobId verilmedi → server yeni id üretir (eskisini zaten sildik)
            source,
            sourceFileName,
            model,
            chunkSize,
            langs,
          }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`Backend HTTP ${res.status}: ${text.slice(0, 400)}`)
        }
        const data = (await res.json()) as {
          jobId: string
          state: ServerJobState
        }
        setJobId(data.jobId)
        log({
          level: 'success',
          message: `Job başlatıldı: ${data.jobId} — backend worker'ları çalışıyor.`,
        })
        log({
          level: 'info',
          message: `Tarayıcıyı kapatabilirsin — server arka planda devam eder. Sayfayı tekrar açtığında otomatik izlemeye geçer.`,
        })
        applyState(data.state)
        startPolling(data.jobId)
      } catch (err) {
        log({
          level: 'error',
          message: `Start hatası: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    },
    [applyState, jobId, log, running, startPolling],
  )

  return { progress, logs, running, currentLang, jobId, start, cancel, reset }
}
