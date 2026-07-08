import { type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export type ChipKind = 'verified' | 'success' | 'warning' | 'error' | 'pending' | 'neutral' | 'overridden' | 'info'

const chipVariants = cva('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider', {
  variants: {
    kind: {
      verified:   'bg-secondary/10 text-secondary',
      info:       'bg-secondary/10 text-secondary',
      success:    'bg-success-container text-success-on-container',
      warning:    'bg-tertiary-container text-tertiary-on-container',
      error:      'bg-error-container text-error-on-container',
      pending:    'bg-surface-container-highest text-surface-on-variant',
      neutral:    'bg-surface-container-highest text-surface-on',
      overridden: 'bg-secondary-fixed text-secondary-on-container',
    } satisfies Record<ChipKind, string>,
  },
})

interface ChipProps extends VariantProps<typeof chipVariants> {
  kind: ChipKind
  icon?: ReactNode
  children: ReactNode
  animated?: boolean
  className?: string
}

export function Chip({ kind, icon, children, animated = false, className }: ChipProps) {
  return (
    <span className={cn(chipVariants({ kind }), className)}>
      {icon ?? (
        <span className={cn('w-1.5 h-1.5 rounded-full bg-current opacity-70', animated && 'animate-pulse')} />
      )}
      {children}
    </span>
  )
}
