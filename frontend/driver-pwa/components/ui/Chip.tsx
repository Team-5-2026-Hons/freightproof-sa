import type { LucideIcon } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import type { ChipKind } from '@/lib/constants/status-meta'

interface ChipProps {
  kind: ChipKind
  icon?: LucideIcon
  className?: string
  children: React.ReactNode
}

const kindClass: Record<ChipKind, string> = {
  success:    'bg-success-container text-success-on-container',
  warning:    'bg-tertiary-container text-tertiary-on-container',
  error:      'bg-error-container text-error-on-container',
  pending:    'bg-surface-container-highest text-surface-on-variant',
  overridden: 'bg-secondary-container text-secondary-on-container',
  info:       'bg-surface-container-low text-surface-on',
}

export function Chip({ kind, icon: Icon, className, children }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-[10px] py-1 text-[14px] font-semibold leading-5 tracking-[0.006em]',
        kindClass[kind],
        className,
      )}
    >
      {Icon && <Icon size={14} strokeWidth={1.5} aria-hidden="true" />}
      {children}
    </span>
  )
}
