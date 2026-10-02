'use client'

import { Button } from '@/components/ui/Button'
import { cn } from '@shared/lib/utils/cn'

const HINT_ID = 'create-trip-disabled-hint'

export interface SummaryRow {
  label: string
  value: string
  /** Identifiers, plates, times: tabular figures (DESIGN_SYSTEM.md §5.2). */
  numeric?: boolean
}

export interface CreateTripSummaryProps {
  rows: readonly SummaryRow[]
  /** One sentence on what the journey lock will cover. */
  canCreate: boolean
  busy: boolean
  /** Shown above the CTA after an attempt with invalid fields. */
  errorText: string | null
  onCreate: () => void
  /** Why the CTA is disabled, when it is. Linked to the button for screen readers. */
  disabledHint?: string | null
}

/** The dark Trip Summary panel of DESIGN_SYSTEM.md §8.3, holding the screen's one gradient CTA. */
export function CreateTripSummary(
  { rows, canCreate, busy, errorText, onCreate, disabledHint = null }: CreateTripSummaryProps,
): React.JSX.Element {
  return (
    <aside
      aria-label="Trip summary"
      className="w-full shrink-0 rounded-lg bg-primary p-[22px] shadow-level-5"
    >
      {/* 60% white, not the old wizard's 40%: 4.5:1 on --primary for 11px text. */}
      <h2 className="mb-[14px] text-[11px] font-[700] uppercase tracking-[0.1em] text-white/60">Trip summary</h2>
      <dl>
        {rows.map(row => (
          <div key={row.label} className="mb-2 flex justify-between gap-3 border-b border-white/[0.08] pb-2">
            <dt className="shrink-0 text-[11px] text-white/60">{row.label}</dt>
            <dd
              className={cn(
                'min-w-0 break-words text-right text-white/90',
                row.numeric ? 'text-[13px] font-[600] tabular-nums tracking-[0.05em]' : 'text-[12px] font-[500]',
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {errorText && (
        <p role="alert" className="mb-3 rounded-md bg-err-c px-3 py-2 text-[12px] font-[600] text-err-onc">{errorText}</p>
      )}
      <Button
        full
        size="lg"
        onClick={onCreate}
        disabled={!canCreate}
        loading={busy}
        aria-describedby={disabledHint ? HINT_ID : undefined}
      >
        Create Trip + Lock to Blockchain
      </Button>
      {disabledHint && (
        <p id={HINT_ID} className="mt-3 text-[12px] leading-relaxed text-white/60">{disabledHint}</p>
      )}
    </aside>
  )
}
