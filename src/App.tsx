import { useCallback, useEffect, useMemo, useState } from 'react'
import { Languages, Play, Square, RotateCcw, KeyRound, HardDrive, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { FileDropzone } from '@/components/FileDropzone'
import { LocaleSelector } from '@/components/LocaleSelector'
import { LangProgressList } from '@/components/LangProgressList'
import { LogPanel } from '@/components/LogPanel'
import { getLocaleByCode, getOutputCode, isSelectable } from '@/lib/appStoreLocales'
import { collectStringLeaves } from '@/lib/jsonChunk'
import { useTranslator } from '@/hooks/useTranslator'
import { fetchCompletedLangs, fetchServerHealth, type ServerHealth } from '@/lib/deepseek'

const LS_API_KEY = 'dlt.deepseek.apiKey'
const LS_MODEL = 'dlt.deepseek.model'
const LS_CHUNK = 'dlt.chunkSize'
const LS_TARGETS = 'dlt.targetCodes'

export default function App() {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('deepseek-v4-pro')
  const [chunkSize, setChunkSize] = useState(60)
  const [targetCodes, setTargetCodes] = useState<string[]>([])

  const [fileName, setFileName] = useState<string | null>(null)
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [source, setSource] = useState<unknown>(null)

  const { progress, logs, running, currentLang, jobId, start, cancel, reset } = useTranslator()
  const [health, setHealth] = useState<ServerHealth | null>(null)
  const [completedOnDisk, setCompletedOnDisk] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  // Backend health probe
  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      const h = await fetchServerHealth()
      if (!cancelled) setHealth(h)
    }
    void probe()
    const id = setInterval(probe, 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // Disk'te tamamlanmış dilleri (her job klasöründeki progress.json'lardan)
  // çek. Mount + her çeviri biteceğinde refresh: bir dil bitince selector'da
  // anında "Çevrildi" olarak gri görünür.
  const refreshCompleted = useCallback(async () => {
    const langs = await fetchCompletedLangs()
    setCompletedOnDisk(new Set(langs))
  }, [])
  // Mount + jobId/running her değiştiğinde refresh.
  // - jobId değişince: silinen joblar serbest kalır, yeni job için stale data önlenir
  // - running false'a düşünce: yeni biten dil hemen "Çevrildi" gözükür
  useEffect(() => {
    void refreshCompleted()
  }, [jobId, running, refreshCompleted])

  // localStorage'dan ayarları geri yükle (API anahtarı dahil — yerel araç).
  useEffect(() => {
    const k = localStorage.getItem(LS_API_KEY)
    if (k) setApiKey(k)
    const m = localStorage.getItem(LS_MODEL)
    if (m) setModel(m)
    const c = localStorage.getItem(LS_CHUNK)
    if (c) setChunkSize(Math.max(10, Math.min(200, Number(c) || 60)))
    const t = localStorage.getItem(LS_TARGETS)
    if (t) {
      try {
        const parsed = JSON.parse(t)
        if (Array.isArray(parsed)) {
          // Disabled olmuş (RTL / Mevcut / Source) dilleri otomatik temizle.
          // NOT: 'completed' kontrolü mount'ta yapılmaz — completedOnDisk
          // henüz fetch edilmemiş olabilir; ayrı bir effect onu temizler.
          const cleaned = parsed.filter((code: unknown) => {
            if (typeof code !== 'string') return false
            const loc = getLocaleByCode(code)
            return !!loc && isSelectable(loc)
          })
          setTargetCodes(cleaned)
        }
      } catch {
        /* ignore */
      }
    }
  }, [])

  // completedOnDisk değiştiğinde, selected listede artık disabled olan
  // dilleri (çevrildi) otomatik çıkar — kullanıcı seçeneklerini güncel tut.
  useEffect(() => {
    if (completedOnDisk.size === 0) return
    setTargetCodes((prev) => {
      const cleaned = prev.filter((code) => {
        const loc = getLocaleByCode(code)
        return !!loc && isSelectable(loc, completedOnDisk)
      })
      return cleaned.length === prev.length ? prev : cleaned
    })
  }, [completedOnDisk])

  useEffect(() => {
    localStorage.setItem(LS_API_KEY, apiKey)
  }, [apiKey])
  useEffect(() => {
    localStorage.setItem(LS_MODEL, model)
  }, [model])
  useEffect(() => {
    localStorage.setItem(LS_CHUNK, String(chunkSize))
  }, [chunkSize])
  useEffect(() => {
    localStorage.setItem(LS_TARGETS, JSON.stringify(targetCodes))
  }, [targetCodes])

  const stringCount = useMemo(
    () => (source ? collectStringLeaves(source).length : null),
    [source],
  )

  const handleFileLoad = useCallback(
    async (name: string, parsed: unknown, bytes: number) => {
      setFileName(name)
      setSource(parsed)
      setSizeBytes(bytes)
      // Yeni dosya yüklendi → varsa eski job/progress'i temizle ki kullanıcı
      // stale download butonları ile karşılaşmasın.
      if (jobId) await reset()
    },
    [jobId, reset],
  )

  const handleFileClear = useCallback(() => {
    setFileName(null)
    setSource(null)
    setSizeBytes(null)
    reset()
  }, [reset])

  // Server'da DEEPSEEK_API_KEY var mı? Yoksa çeviri yapamaz.
  const needsApiKey = !health?.hasEnvKey
  const canStart =
    !!source && !needsApiKey && targetCodes.length > 0 && !running

  const handleStart = useCallback(() => {
    if (!canStart || !source) return
    void start({
      source,
      sourceFileName: fileName,
      targetCodes,
      model,
      chunkSize,
    })
  }, [canStart, chunkSize, fileName, model, source, start, targetCodes])

  const handleDownload = useCallback(
    async (code: string) => {
      if (!jobId) return
      const loc = getLocaleByCode(code)
      if (!loc) return
      const outputCode = getOutputCode(loc)
      const url = `/api/jobs/${encodeURIComponent(jobId)}/snapshot/${encodeURIComponent(outputCode)}`
      const a = document.createElement('a')
      a.href = url
      a.download = `${outputCode}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
    },
    [jobId],
  )

  const handleDownloadAll = useCallback(() => {
    Object.values(progress)
      .filter((p) => p.status === 'done' || p.status === 'error')
      .forEach((p) => handleDownload(p.code))
  }, [progress, handleDownload])

  const doneCount = useMemo(
    () => Object.values(progress).filter((p) => p.status === 'done').length,
    [progress],
  )
  const totalLangs = Object.values(progress).length
  // Yarım job varsa (resume edilebilir) — chunkSize/model/dosya değişimi
  // kilitlenir: bunlar değişirse chunk hizalaması bozulup yanlış stringler
  // üst üste yazılır.
  const hasResumable = totalLangs > 0 && !running
  const inputsLocked = running || hasResumable
  const overallPct =
    totalLangs === 0
      ? 0
      : Math.round(
          (Object.values(progress).reduce((sum, p) => {
            if (p.chunksTotal === 0) return sum
            return sum + p.chunksDone / p.chunksTotal
          }, 0) /
            totalLangs) *
            100,
        )

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Topbar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border">
              <Languages className="h-3.5 w-3.5" />
            </div>
            <span className="text-base font-medium tracking-[-0.04em]">
              diress<span className="text-muted-foreground">.locale</span>
            </span>
            <Badge tone="muted" className="ml-3 hidden md:inline-flex">
              DeepSeek translator
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {health ? (
              <Badge tone="success" className="hidden md:inline-flex">
                <Server className="h-3 w-3" />
                backend bağlı
                {health.hasEnvKey && (
                  <span className="ml-1 text-muted-foreground">· env-key</span>
                )}
              </Badge>
            ) : (
              <Badge tone="error" className="hidden md:inline-flex">
                <Server className="h-3 w-3" />
                backend yok
              </Badge>
            )}
            {jobId && (
              <Badge tone="muted" className="hidden lg:inline-flex">
                <HardDrive className="h-3 w-3" />
                <span className="numerals">{jobId.slice(0, 8)}</span>
              </Badge>
            )}
            {running ? (
              <Button key="cta-stop" size="sm" variant="destructive" onClick={cancel}>
                <Square className="h-3.5 w-3.5" />
                Durdur
              </Button>
            ) : (
              <Button
                key="cta-start"
                size="sm"
                variant="primary"
                onClick={handleStart}
                disabled={!canStart}
              >
                <Play className="h-3.5 w-3.5" />
                {hasResumable ? 'Devam et' : 'Çeviriyi başlat'}
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        {/* Heading */}
        <div className="mb-8 flex flex-col gap-2">
          <p className="eyebrow">Yerel araç</p>
          <h1 className="text-2xl font-medium tracking-[-0.03em] md:text-3xl">
            JSON locale çeviri akışı
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Kaynak <span className="numerals">en.json</span> dosyanı yükle, hedef App Store dillerini
            seç. DeepSeek parça parça çevirir ve her dil bitince ayrı bir JSON olarak indirilebilir.
          </p>
        </div>

        {/* Genel ilerleme */}
        {totalLangs > 0 && (
          <Card className="mb-8">
            <CardContent className="py-5">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="eyebrow">Genel ilerleme</span>
                  <span className="mt-1 text-sm">
                    <span className="numerals">{doneCount}</span> /{' '}
                    <span className="numerals">{totalLangs}</span> dil tamamlandı
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-2xl font-medium numerals tracking-[-0.03em]">
                    {overallPct}%
                  </span>
                  {doneCount > 0 && !running && (
                    <Button size="sm" variant="secondary" onClick={handleDownloadAll}>
                      Hepsini indir
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Sol: yapılandırma */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>1. Kaynak dosya</CardTitle>
                <CardDescription>
                  Çevrilecek <span className="numerals">en.json</span> — yapısı korunur.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FileDropzone
                  fileName={fileName}
                  sizeBytes={sizeBytes}
                  stringCount={stringCount}
                  onFileLoad={handleFileLoad}
                  onClear={handleFileClear}
                  disabled={inputsLocked}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2. Hedef diller</CardTitle>
                <CardDescription>
                  App Store Connect'in desteklediği yerelleştirmeler — istediklerini seç.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LocaleSelector
                  selected={targetCodes}
                  onChange={setTargetCodes}
                  disabled={running}
                  completedOnDisk={completedOnDisk}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>3. İlerleme</CardTitle>
                <CardDescription>
                  Her dil bittiğinde indir butonu aktifleşir.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LangProgressList
                  progress={progress}
                  currentLang={currentLang}
                  onDownload={handleDownload}
                />
              </CardContent>
            </Card>
          </div>

          {/* Sağ: DeepSeek ayarları + log */}
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" /> DeepSeek
                </CardTitle>
                <CardDescription>
                  {health?.hasEnvKey
                    ? 'Backend .env üzerinden DEEPSEEK_API_KEY kullanılıyor. İstersen burada override edebilirsin.'
                    : 'Backend\'de DEEPSEEK_API_KEY yok — anahtarı burada gir, header ile yönlendirilir.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    API anahtarı {!needsApiKey && <span className="text-foreground/60">(opsiyonel)</span>}
                  </label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={health?.hasEnvKey ? 'env\'den kullanılıyor — boş bırak' : 'sk-...'}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={running}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Model</label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={inputsLocked}
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 numerals"
                    >
                      <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                      <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Parça (string/req)
                    </label>
                    <Input
                      type="number"
                      min={10}
                      max={200}
                      value={chunkSize}
                      onChange={(e) =>
                        setChunkSize(Math.max(10, Math.min(200, Number(e.target.value) || 60)))
                      }
                      disabled={inputsLocked}
                    />
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="text-foreground">Önerilen:</span>{' '}
                  <span className="numerals">deepseek-v4-pro</span> —
                  daha kaliteli çeviri, ~3× pahalı (~$0.87/1M output token).{' '}
                  <span className="numerals">deepseek-v4-flash</span> ucuz ve
                  hızlı (~$0.28/1M); günlük iş için yeterli kalite.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Canlı log</CardTitle>
                <CardDescription>
                  Otomatik olarak en alta kaydırır.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LogPanel logs={logs} />
              </CardContent>
            </Card>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Hedef:{' '}
                <span className="text-foreground numerals">{targetCodes.length}</span> dil seçili
              </span>
              {!running && totalLangs > 0 && (
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" />
                  Temizle
                </button>
              )}
            </div>
          </div>
        </div>

        <Separator className="my-10" />

        <footer className="flex flex-col items-start justify-between gap-2 text-xs text-muted-foreground md:flex-row md:items-center">
          <div>
            Backend her başarılı chunk'ı{' '}
            <span className="numerals text-foreground">server/jobs/&lt;jobId&gt;/&lt;lang&gt;.json</span>{' '}
            yoluna atomik yazar — tarayıcı kapansa bile o ana kadar çevrilen kısım diskte kalır.
            {health?.jobsDir && (
              <>
                {' '}
                Tam yol: <span className="numerals text-foreground">{health.jobsDir}</span>
              </>
            )}
          </div>
          <div className="numerals">
            {targetCodes
              .map((c) => getLocaleByCode(c)?.code ?? c)
              .slice(0, 6)
              .join(', ')}
            {targetCodes.length > 6 ? ` +${targetCodes.length - 6}` : ''}
          </div>
        </footer>
      </main>
    </div>
  )
}
