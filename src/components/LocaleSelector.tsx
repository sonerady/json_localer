import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import {
  APP_STORE_LOCALES,
  getDisabledReason,
  isSelectable,
  type AppStoreLocale,
  type DisabledReason,
} from '@/lib/appStoreLocales'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface LocaleSelectorProps {
  selected: string[]
  onChange: (codes: string[]) => void
  disabled?: boolean
  /** Disk'te tamamlanmış (chunksDone === chunksTotal) çevirilerin outputCode set'i. */
  completedOnDisk?: ReadonlySet<string>
}

const REASON_LABEL: Record<DisabledReason, string> = {
  source: 'Kaynak',
  rtl: 'RTL',
  existing: 'Mevcut',
  completed: 'Çevrildi',
}

const REASON_TOOLTIP: Record<DisabledReason, string> = {
  source: 'Kaynak dil (en-US) — çevrilemez.',
  rtl: 'RTL dilleri şu an desteklenmiyor.',
  existing: 'diress/client/locales klasöründe zaten var.',
  completed: 'Diskte tamamlanmış bir çeviri mevcut (server/jobs/).',
}

export function LocaleSelector({
  selected,
  onChange,
  disabled,
  completedOnDisk,
}: LocaleSelectorProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return APP_STORE_LOCALES
    return APP_STORE_LOCALES.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q),
    )
  }, [query])

  const toggle = (loc: AppStoreLocale) => {
    if (disabled) return
    if (!isSelectable(loc, completedOnDisk)) return
    if (selected.includes(loc.code)) {
      onChange(selected.filter((c) => c !== loc.code))
    } else {
      onChange([...selected, loc.code])
    }
  }

  // Disabled (RTL / Mevcut / Source / Çevrildi) dilleri preset'lere hiç dahil etme.
  const selectAll = () =>
    onChange(
      APP_STORE_LOCALES.filter((l) => isSelectable(l, completedOnDisk)).map(
        (l) => l.code,
      ),
    )
  const clearAll = () => onChange([])

  const selectableCount = APP_STORE_LOCALES.filter((l) =>
    isSelectable(l, completedOnDisk),
  ).length
  const disabledCount = APP_STORE_LOCALES.length - selectableCount

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Dil ara (örn: Spanish, ja, türkçe)"
            className="pl-9"
            disabled={disabled}
          />
        </div>
        <Button size="sm" variant="ghost" onClick={selectAll} disabled={disabled}>
          Hepsini seç ({selectableCount})
        </Button>
        <Button size="sm" variant="ghost" onClick={clearAll} disabled={disabled}>
          Temizle
        </Button>
      </div>

      <div className="scrollbar-thin grid max-h-72 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-border bg-card/40 p-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((loc) => {
          const checked = selected.includes(loc.code)
          const reason = getDisabledReason(loc, completedOnDisk)
          const isDisabledItem = disabled || reason !== null
          return (
            <button
              key={loc.code}
              type="button"
              onClick={() => toggle(loc)}
              disabled={isDisabledItem}
              title={reason ? REASON_TOOLTIP[reason] : undefined}
              className={cn(
                'group flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors',
                checked
                  ? 'border-foreground/40 bg-foreground/10'
                  : 'border-transparent hover:bg-muted',
                isDisabledItem && 'cursor-not-allowed opacity-40 hover:bg-transparent',
              )}
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{loc.nativeName}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <span className="truncate">
                    {loc.name} · <span className="numerals">{loc.code}</span>
                  </span>
                  {reason && (
                    <Badge tone="muted" className="px-1.5 py-0 text-[10px]">
                      {REASON_LABEL[reason]}
                    </Badge>
                  )}
                </span>
              </div>
              <div
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                  checked
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border',
                  reason && 'opacity-50',
                )}
              >
                {checked && <Check className="h-3 w-3" />}
              </div>
            </button>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="numerals">{selected.length}</span> /{' '}
        <span className="numerals">{selectableCount}</span> dil seçildi.
        <span className="ml-2 text-foreground/40">
          ({disabledCount} dil disabled · RTL / Mevcut / Kaynak / Çevrildi)
        </span>
      </p>
    </div>
  )
}
