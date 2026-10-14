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
  // Not the usual `ok-c`/`ok-onc` container pair: that reads as a too-bright neon
  // mint here. `ok-chip` is a solid, OPAQUE 45%-with-white mix of `--ok` itself (see
  // tailwind.config.ts) — not an alpha-transparent overlay (that blended with
  // whatever card sat behind it, reading differently, and weaker, on the peach
  // "Unloading" card than on white) and not a separately invented hex either, so
  // this chip's fill is provably the same green, just lighter. Text is `on-surf` —
  // the app's standard near-black body-text colour, not a green-tinted dark, so it
  // reads as plain text on a coloured background rather than "dark green on green".
  // `ok-c`/`ok-onc` are untouched and still back every other "success" surface
  // (banners, badges) that uses them.
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
