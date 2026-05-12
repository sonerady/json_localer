import { useEffect, useRef } from 'react'
import type { LogEntry } from '@/hooks/useTranslator'
import { cn } from '@/lib/utils'

interface LogPanelProps {
  logs: LogEntry[]
}

function levelColor(level: LogEntry['level']) {
  switch (level) {
    case 'error':
      return 'text-destructive'
    case 'warn':
      return 'text-amber-400'
    case 'success':
      return 'text-emerald-400'
    default:
      return 'text-foreground/80'
  }
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString('tr-TR', { hour12: false })
}

export function LogPanel({ logs }: LogPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [logs.length])

  if (logs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-6 py-10 text-center text-xs text-muted-foreground">
        Canlı log burada görünecek.
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="scrollbar-thin h-[420px] overflow-y-auto rounded-md border border-border bg-card/40 p-3 font-mono text-[11px] leading-relaxed"
    >
      {logs.map((l, i) => (
        <div key={i} className="flex gap-3">
          <span className="shrink-0 text-muted-foreground numerals">{formatTime(l.ts)}</span>
          {l.lang && (
            <span className="shrink-0 text-muted-foreground numerals">[{l.lang}]</span>
          )}
          <span className={cn('min-w-0 break-words', levelColor(l.level))}>{l.message}</span>
        </div>
      ))}
    </div>
  )
}
