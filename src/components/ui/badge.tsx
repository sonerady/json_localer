import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-tight transition-colors',
  {
    variants: {
      tone: {
        default: 'border-border text-foreground/80',
        muted: 'border-border bg-muted text-muted-foreground',
        success: 'border-border bg-muted text-foreground',
        running: 'border-foreground/30 bg-transparent text-foreground',
        error: 'border-destructive/40 bg-transparent text-destructive',
      },
    },
    defaultVariants: { tone: 'default' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ tone }), className)} {...props} />
}
