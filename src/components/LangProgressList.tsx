import { Download, AlertCircle, Loader2, Check, Clock, Ban } from 'lucide-react'
import type { LangProgress } from '@/hooks/useTranslator'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { getLocaleByCode, getOutputCode } from '@/lib/appStoreLocales'
import { cn } from '@/lib/utils'

interface LangProgressListProps {
  progress: Record<string, LangProgress>
  currentLang: string | null
  onDownload: (code: string) => void
}

function statusBadge(status: LangProgress['status']) {
  switch (status) {
    case 'queued':
      return (
        <Badge tone="muted">
          <Clock className="h-3 w-3" /> sırada
        </Badge>
      )
    case 'running':
      return (
        <Badge tone="running">
          <Loader2 className="h-3 w-3 animate-spin" /> çevriliyor
        </Badge>
      )
    case 'done':
      return (
        <Badge tone="success">
          <Check className="h-3 w-3" /> tamam
        </Badge>
      )
    case 'error':
      return (
        <Badge tone="error">
          <AlertCircle className="h-3 w-3" /> hata
        </Badge>
      )
    case 'cancelled':
      return (
        <Badge tone="muted">
          <Ban className="h-3 w-3" /> iptal
        </Badge>
      )
  }
}

export function LangProgressList({ progress, currentLang, onDownload }: LangProgressListProps) {
  const list = Object.values(progress)
  if (list.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
        Hedef dilleri seç ve "Çeviriyi başlat" tuşuna bas.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {list.map((lp) => {
        const pct = lp.chunksTotal === 0 ? 0 : Math.round((lp.chunksDone / lp.chunksTotal) * 100)
        const isCurrent = currentLang === lp.code
        const duration =
          lp.startedAt && lp.finishedAt
            ? ((lp.finishedAt - lp.startedAt) / 1000).toFixed(1) + 's'
            : null
        return (
          <div
            key={lp.code}
            className={cn(
              'rounded-md border bg-card/40 p-4 transition-colors',
              isCurrent ? 'border-foreground/40' : 'border-border',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{lp.nativeName}</span>
                  <span className="text-xs text-muted-foreground">
                    {lp.name} · <span className="numerals">{lp.code}</span>
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {statusBadge(lp.status)}
                {(lp.status === 'done' || lp.status === 'error') && !!lp.result && (
                  <button
                    type="button"
                    onClick={() => onDownload(lp.code)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:border-foreground/40"
                  >
                    <Download className="h-3 w-3" />
                    {(() => {
                      const loc = getLocaleByCode(lp.code)
                      return `${loc ? getOutputCode(loc) : lp.code}.json`
                    })()}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <Progress value={pct} className="flex-1" />
              <span className="w-14 shrink-0 text-right text-xs text-muted-foreground numerals">
                {pct}%
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground numerals">
              <span>
                parça {lp.chunksDone}/{lp.chunksTotal} · string {lp.stringsDone}/{lp.stringsTotal}
              </span>
              {duration && <span>{duration}</span>}
            </div>

            {lp.error && (
              <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {lp.error}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
