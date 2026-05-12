import { useCallback, useEffect, useRef, useState } from 'react'
import {
  APP_STORE_LOCALES,
  type AppStoreLocale,
  getLocaleByCode,
  getOutputCode,
} from '@/lib/appStoreLocales'
import {
  buildEmptyTemplate,
  chunkLeaves,
  collectStringLeaves,
  leavesToPayload,
} from '@/lib/jsonChunk'
import {
  fetchJobState,
  findMatchingJob,
  sleep,
  translateChunk,
  type JobState,
} from '@/lib/deepseek'

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
  apiKey: string
  model: string
  chunkSize: number
  maxRetries: number
}

const MAX_LOG_ENTRIES = 400
const LS_JOB_ID = 'dlt.lastJobId'

// Disk-dostu kısa UUID — 22 karakter Base64URL.
function makeJobId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function useTranslator() {
  const [progress, setProgress] = useState<Record<string, LangProgress>>({})
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const [currentLang, setCurrentLang] = useState<string | null>(null)
  // jobId'yi başlangıçta localStorage'dan oku — sayfa kapansa bile son
  // job'a referansı koruyalım (cross-session resume için).
  const [jobId, setJobId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(LS_JOB_ID)
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (jobId) localStorage.setItem(LS_JOB_ID, jobId)
    else localStorage.removeItem(LS_JOB_ID)
  }, [jobId])
  // Aktif fetch'lerin AbortController set'i — cancel hepsini tek seferde keser.
  const abortControllers = useRef<Set<AbortController>>(new Set())
  const cancelFlag = useRef(false)
  // Refs mirror state so `start` can read latest values without re-creating
  // the callback on every progress update.
  const progressRef = useRef(progress)
  const jobIdRef = useRef(jobId)
  useEffect(() => {
    progressRef.current = progress
  }, [progress])
  useEffect(() => {
    jobIdRef.current = jobId
  }, [jobId])

  const log = useCallback((entry: Omit<LogEntry, 'ts'>) => {
    setLogs((prev) => {
      const next = [...prev, { ts: Date.now(), ...entry }]
      return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next
    })
  }, [])

  const cancel = useCallback(() => {
    cancelFlag.current = true
    for (const c of abortControllers.current) c.abort()
    log({ level: 'warn', message: 'Çeviri iptal edildi.' })
  }, [log])

  const reset = useCallback(() => {
    if (running) return
    setProgress({})
    setLogs([])
    setCurrentLang(null)
    setJobId(null)
  }, [running])

  const start = useCallback(
    async ({
      source,
      sourceFileName,
      targetCodes,
      apiKey,
      model,
      chunkSize,
      maxRetries,
    }: StartArgs) => {
      if (running) return
      cancelFlag.current = false
      abortControllers.current = new Set()

      const leaves = collectStringLeaves(source)
      const chunks = chunkLeaves(leaves, chunkSize)

      // === ADIM 1: DİSK TARAMASI (cross-session resume) ===
      // İstek göndermeden ÖNCE server/jobs altındaki TÜM klasörleri tara.
      // Şu anki source (stringsTotal) + chunkSize ile eşleşen en son güncellenen
      // job'ı bul. localStorage geçersiz ise bile uygun job'ı keşfeder.
      let diskJobId: string | null = null
      let diskProgress: Record<string, LangProgress> = {}

      log({
        level: 'info',
        message: `Disk taranıyor: ${leaves.length} string × parça ${chunkSize} ile eşleşen job aranıyor…`,
      })

      let state: JobState | null = await findMatchingJob(
        leaves.length,
        chunkSize,
        sourceFileName,
      )

      // Eğer disk taramasından sonuç gelmediyse, localStorage'da tutulan son
      // jobId'yi fallback olarak dene (folder rename gibi edge case'ler için).
      if (!state) {
        const storedJobId =
          typeof window !== 'undefined' ? localStorage.getItem(LS_JOB_ID) : null
        if (storedJobId) {
          state = await fetchJobState(storedJobId)
          if (
            state &&
            (state.meta?.stringsTotal !== leaves.length ||
              state.meta?.chunkSize !== chunkSize)
          ) {
            state = null // params uyuşmuyor
          }
        }
      }

      if (state) {
        diskJobId = state.jobId
        for (const [outputCode, { progress: p }] of Object.entries(state.langs)) {
          if (!p || typeof p.chunksDone !== 'number') continue
          const loc = APP_STORE_LOCALES.find(
            (l) => getOutputCode(l) === outputCode,
          )
          if (!loc) continue
          const isDone = p.chunksTotal > 0 && p.chunksDone >= p.chunksTotal
          diskProgress[loc.code] = {
            code: loc.code,
            name: loc.name,
            nativeName: loc.nativeName,
            status: isDone ? 'done' : 'queued',
            chunksTotal: chunks.length,
            chunksDone: Math.min(p.chunksDone, chunks.length),
            stringsTotal: leaves.length,
            stringsDone: p.stringsDone ?? 0,
          }
        }
        const total = Object.keys(diskProgress).length
        const done = Object.values(diskProgress).filter(
          (l) => l.status === 'done',
        ).length
        const partial = total - done
        log({
          level: 'success',
          message: `Disk'te ${state.jobId.slice(0, 8)}… job'u bulundu: ${total} dil (${done} tamam, ${partial} yarım). Yarım kalanlar kaldığı parçadan devam edecek.`,
        })
      } else {
        log({
          level: 'info',
          message: `Eşleşen job bulunamadı — yeni job oluşturulacak.`,
        })
      }

      // === ADIM 2: Resume kararı ===
      // Öncelik: disk > in-session > yeni job.
      const inSessionProgress = progressRef.current
      const inSessionJobId = jobIdRef.current
      const inSessionTotal = Object.values(inSessionProgress)[0]?.chunksTotal
      const canResumeInSession =
        !diskJobId &&
        !!inSessionJobId &&
        Object.keys(inSessionProgress).length > 0 &&
        inSessionTotal === chunks.length

      const prevProgress = diskJobId
        ? diskProgress
        : canResumeInSession
          ? inSessionProgress
          : {}
      const prevJobId = diskJobId || (canResumeInSession ? inSessionJobId : null)
      const canResume = !!prevJobId
      const newJobId = canResume ? prevJobId! : makeJobId()
      if (newJobId !== inSessionJobId) setJobId(newJobId)

      if (canResume) {
        log({
          level: 'info',
          message: `Mevcut job sürdürülüyor: ${newJobId} — yarım kalan diller devam edecek.`,
        })
      } else {
        log({
          level: 'info',
          message: `Job oluşturuldu: ${newJobId} — ${leaves.length} string, ${chunks.length} parça (parça başına ${chunkSize}).`,
        })
        log({
          level: 'info',
          message: `Disk: server/jobs/${newJobId}/  (her başarılı chunk anında diske yazılır)`,
        })
        log({
          level: 'info',
          message: `Paralel mod: seçilen tüm diller (${targetCodes.length}) aynı anda DeepSeek'e gönderiliyor.`,
        })
      }

      const meta = {
        jobId: newJobId,
        sourceFileName: sourceFileName || null,
        model,
        chunkSize,
        targetCodes,
        stringsTotal: leaves.length,
        chunksTotal: chunks.length,
        createdAt: new Date().toISOString(),
      }

      // İlk progress haritası — sadece şu anda seçili olan diller. Resume
      // sırasında "done" olanlar olduğu gibi taşınır; diğerleri queued'a
      // alınır ama chunksDone/stringsDone/result korunur.
      const initialProgress: Record<string, LangProgress> = {}
      const processableCodes: string[] = []
      for (const code of targetCodes) {
        const loc = getLocaleByCode(code)
        if (!loc) continue
        const existing = canResume ? prevProgress[code] : undefined
        if (existing?.status === 'done') {
          initialProgress[code] = existing
          continue
        }
        initialProgress[code] = {
          code,
          name: loc.name,
          nativeName: loc.nativeName,
          status: 'queued',
          chunksTotal: chunks.length,
          chunksDone: existing?.chunksDone ?? 0,
          stringsTotal: leaves.length,
          stringsDone: existing?.stringsDone ?? 0,
          result: existing?.result,
          error: undefined,
        }
        processableCodes.push(code)
      }
      setProgress(initialProgress)

      if (processableCodes.length === 0) {
        log({ level: 'info', message: 'İşlenecek dil yok — hepsi zaten tamamlanmış.' })
        return
      }

      setRunning(true)

      // Tek seferlik boş template — backend ilk chunk'ta diske tohumlar
      const emptyTemplate = buildEmptyTemplate(source)

      // Meta yalnızca bir kere gönderilir (ilk chunk'ta). Paralelde
      // birden çok worker aynı anda first chunk'ı çalıştırabilir;
      // ref ile koruyoruz ama yarış olursa backend overwrite zaten safe.
      const metaSentRef = { current: false }

      // Tek dil için chunk loop'unu çalıştır.
      const processLang = async (code: string): Promise<void> => {
        if (cancelFlag.current) return
        const loc = getLocaleByCode(code)
        if (!loc) return

        const langEntry = progressRef.current[code]
        if (langEntry?.status === 'done') {
          log({
            level: 'info',
            lang: code,
            message: `${loc.name} zaten tamamlanmış — atlanıyor.`,
          })
          return
        }

        setCurrentLang(code)
        setProgress((p) => ({
          ...p,
          [code]: {
            ...p[code],
            status: 'running',
            startedAt: Date.now(),
            error: undefined,
          },
        }))

        const outputCode = getOutputCode(loc)
        const startFromChunk = langEntry?.chunksDone ?? 0

        if (startFromChunk > 0) {
          log({
            level: 'info',
            lang: code,
            message: `${loc.name} (${loc.nativeName}) ${startFromChunk}/${chunks.length} parçadan devam ediyor → ${outputCode}.json`,
          })
        } else {
          log({
            level: 'info',
            lang: code,
            message: `${loc.name} (${loc.nativeName}) çevirisi başlıyor → ${outputCode}.json`,
          })
        }

        let langError: string | undefined
        let stringsDone = langEntry?.stringsDone ?? 0
        let currentSnapshot: unknown = langEntry?.result ?? emptyTemplate

        for (let i = startFromChunk; i < chunks.length; i++) {
          if (cancelFlag.current) break
          const chunk = chunks[i]
          const payload = leavesToPayload(chunk)

          let attempt = 0
          while (true) {
            if (cancelFlag.current) break
            attempt++
            const ac = new AbortController()
            abortControllers.current.add(ac)
            const chunkStart = Date.now()
            log({
              level: 'info',
              lang: code,
              message: `Parça ${i + 1}/${chunks.length} gönderiliyor (${chunk.length} string)… DeepSeek yanıtı bekleniyor.`,
            })
            try {
              const isFirstChunkOfLang = i === 0
              const sendMeta = isFirstChunkOfLang && !metaSentRef.current
              if (sendMeta) metaSentRef.current = true

              const { snapshot, stringsApplied } = await translateChunk(
                payload,
                loc,
                {
                  apiKey,
                  model,
                  signal: ac.signal,
                  jobId: newJobId,
                  lang: outputCode,
                  templateInit: isFirstChunkOfLang ? emptyTemplate : undefined,
                  meta: sendMeta ? meta : undefined,
                  progress: {
                    chunksDone: i + 1,
                    chunksTotal: chunks.length,
                    stringsDone,
                    stringsTotal: leaves.length,
                    status: 'running',
                  },
                },
              )

              stringsDone += stringsApplied
              currentSnapshot = snapshot

              setProgress((p) => ({
                ...p,
                [code]: {
                  ...p[code],
                  chunksDone: i + 1,
                  stringsDone,
                  result: snapshot,
                },
              }))
              const elapsed = ((Date.now() - chunkStart) / 1000).toFixed(1)
              log({
                level: 'info',
                lang: code,
                message: `Parça ${i + 1}/${chunks.length} ✓ (${stringsApplied}/${chunk.length} string · ${elapsed}s) · diske yazıldı.`,
              })
              break
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              const isAbort = msg.toLowerCase().includes('abort')
              if (isAbort && cancelFlag.current) break

              if (attempt > maxRetries) {
                langError = msg
                log({
                  level: 'error',
                  lang: code,
                  message: `Parça ${i + 1} ${maxRetries} denemede başarısız: ${msg}`,
                })
                break
              }
              const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000)
              log({
                level: 'warn',
                lang: code,
                message: `Parça ${i + 1} hata (deneme ${attempt}/${maxRetries}). ${backoff}ms sonra tekrar denenecek.`,
              })
              await sleep(backoff)
            } finally {
              abortControllers.current.delete(ac)
            }
          }

          if (langError) break
          if (cancelFlag.current) break
        }

        if (cancelFlag.current) {
          setProgress((p) => ({
            ...p,
            [code]: { ...p[code], status: 'cancelled', result: currentSnapshot },
          }))
          log({
            level: 'warn',
            lang: code,
            message: `${loc.name} iptal edildi (mevcut hâl diskte).`,
          })
          return
        }

        if (langError) {
          setProgress((p) => ({
            ...p,
            [code]: {
              ...p[code],
              status: 'error',
              error: langError,
              finishedAt: Date.now(),
              result: currentSnapshot,
            },
          }))
        } else {
          setProgress((p) => ({
            ...p,
            [code]: {
              ...p[code],
              status: 'done',
              result: currentSnapshot,
              finishedAt: Date.now(),
            },
          }))
          log({
            level: 'success',
            lang: code,
            message: `${loc.name} tamamlandı.`,
          })
        }
      }

      // Tüm seçilen dilleri aynı anda paralel başlat.
      await Promise.all(processableCodes.map((code) => processLang(code)))

      setRunning(false)
      setCurrentLang(null)
      if (!cancelFlag.current) {
        log({ level: 'success', message: 'Tüm diller işlendi.' })
      }
    },
    [log, running],
  )

  return { progress, logs, running, currentLang, jobId, start, cancel, reset }
}
