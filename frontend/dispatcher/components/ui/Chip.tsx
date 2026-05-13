import { cn } from '@shared/lib/utils/cn'
import type { ChipType } from '@shared/lib/constants/status-meta'

export type { ChipType }

interface ChipProps {
  type: ChipType
  /** Text label. Accepts children as an alternative. */
  label?: string
  children?: React.ReactNode
  className?: string
}

const chipStyles: Record<ChipType, string> = {
  transit:   'bg-sec-c text-sec-onc',
  loading:   'bg-sec-c text-sec-onc',
  complete:  'bg-ok-c text-ok-onc',
  exception: 'bg-warn-c text-warn-onc',
  critical:  'bg-err-c text-err-onc',
  pending:   'bg-surf-high text-on-surf-v',
}

const dotStyles: Record<ChipType, string> = {
  transit:   'bg-sec',
  loading:   'bg-sec',
  complete:  'bg-ok',
  exception: 'bg-warn',
  critical:  'bg-err',
  pending:   'bg-outline-v',
}

/**
 * Trip-status pill — 6 domain types matching DESIGN_SYSTEM.md §7.2.
 * Always renders a 6×6 dot on the left. Never uses icons.
 * Radius is r-md (6px), not rounded-full.
 */
export function Chip({ type, label, children, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px]',
        'text-[11px] font-bold tracking-[0.03em] whitespace-nowrap',
        'px-[10px] py-[3px] rounded-md',
        chipStyles[type],
        className,
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotStyles[type])} />
      {label ?? children}
    </span>
  )
}
