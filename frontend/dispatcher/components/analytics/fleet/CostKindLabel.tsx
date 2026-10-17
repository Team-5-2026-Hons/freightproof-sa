import { cn } from '@shared/lib/utils/cn'
import { COST_COPY } from './costCopy'

export type CostKind = 'estimate' | 'waybill'

interface CostKindLabelProps {
  kind: CostKind
  className?: string
}

/** Says on the card face whether a money figure is an estimate or comes from waybills (spec D13).
 *  Text, not colour alone: the two read differently even in greyscale. */
export function CostKindLabel({ kind, className }: CostKindLabelProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-[600] leading-none',
        kind === 'estimate' ? 'bg-surf-low text-on-surf-v' : 'bg-sec-c text-sec',
        className,
      )}
    >
      {COST_COPY.kind[kind]}
    </span>
  )
}
