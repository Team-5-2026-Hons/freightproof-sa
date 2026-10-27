import { cn } from '@shared/lib/utils/cn'
import type { ChipType } from '@shared/lib/constants/status-meta'

export type { ChipType }

interface ChipProps {
  type: ChipType
  label?: string
  children?: React.ReactNode
  className?: string
}

const chipStyles: Record<ChipType, string> = {
  transit:   'bg-sec-c text-sec-onc',
  loading:   'bg-sec-c text-sec-onc',
  complete:  'bg-ok-chip text-on-surf',
  exception: 'bg-warn-c text-warn-onc',
  critical:  'bg-err-c text-err-onc',
  pending:   'bg-surf-high text-on-surf-v',
}

/**
 * Trip-status pill — 6 domain types matching DESIGN_SYSTEM.md §7.2.
 * No dot, no icon: colour already carries the signal via the fill itself.
 * Radius is r-md (6px), not rounded-full.
 */
export function Chip({ type, label, children, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center',
        'text-[11px] font-bold tracking-[0.03em] whitespace-nowrap',
        'px-[10px] py-[3px] rounded-md',
        chipStyles[type],
        className,
      )}
    >
      {label ?? children}
    </span>
  )
}
