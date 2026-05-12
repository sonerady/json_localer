import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number
  className?: string
}

export function Progress({ value, className }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className="h-full bg-foreground transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
