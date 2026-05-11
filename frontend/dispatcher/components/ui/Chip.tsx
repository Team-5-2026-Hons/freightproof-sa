import { type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

export type ChipKind = 'verified' | 'success' | 'warning' | 'error' | 'pending' | 'neutral' | 'overridden' | 'info'

interface ChipProps {
  kind: ChipKind
  icon?: ReactNode
  children: ReactNode
  animated?: boolean
  className?: string
}

const kindClasses: Record<ChipKind, string> = {
  verified:   'bg-secondary/10 text-secondary',
  info:       'bg-secondary/10 text-secondary',
  success:    'bg-success-container text-success-on-container',
  warning:    'bg-tertiary-container text-tertiary-on-container',
  error:      'bg-error-container text-error-on-container',
  pending:    'bg-surface-container-highest text-surface-on-variant',
  neutral:    'bg-surface-container-highest text-surface-on',
  overridden: 'bg-secondary-fixed text-secondary-on-container',
}

export function Chip({ kind, icon, children, animated = false, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1',
        'rounded-full text-xs font-bold uppercase tracking-wider',
        kindClasses[kind],
        className,
      )}
    >
      {icon ?? (
        <span className={cn('w-1.5 h-1.5 rounded-full bg-current opacity-70', animated && 'animate-pulse')} />
      )}
      {children}
    </span>
  )
}
