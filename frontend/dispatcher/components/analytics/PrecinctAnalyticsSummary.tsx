'use client'

import { useState } from 'react'

import { fmtRate } from '@/lib/format/analytics'
import { defaultMonthRange, fmtMonthRange } from '@/lib/format/month'
import { useFacilityAnalytics } from '@/lib/hooks/useAnalytics'
import type { MonthRange } from '@/lib/types/month-range'
import type { FacilityMetrics } from '@shared/lib/types/analytics'
import type { PrecinctId } from '@shared/lib/types/precinct'
import { ANALYTICS_COPY } from './copy'
import {
  AnalyticsSummaryFrame, CountStrip, EmptyNote, SectionHeading, StatTile, StatTiles,
  type CountStyle,
} from './SummaryParts'

export interface PrecinctAnalyticsSummaryProps {
  precinctId: PrecinctId
}

// Same wording as FacilityPanel's columns. "Confirmed ✓" / "Mismatch ✗" match
// PhaseLocationSection; unwitnessed deliberately avoids its live-trip "Awaiting Pulsit",
// because on a closed trip the reading was never taken (FP-156 §0 #18).
const LABELS = {
  corroborationRate: 'Corroboration rate',
  confirmed: 'Confirmed ✓',
  mismatch: 'Mismatch ✗',
  unwitnessed: 'Unwitnessed (no Pulsit reading)',
} as const

const SUMMARY_COPY = {
  monthsHeading: 'Selected months',
  verdictsHeading: 'Pulsit verdicts',
  // Facility figures are scoped to the signed-in operator (FP-153 Q1), but a shared
  // precinct is visited by other operators' trucks too. Without this line the figures
  // could read as the precinct's whole traffic.
  orgScopeNote: "Only your organisation's closed trips are counted, even at a shared precinct.",
} as const

type Verdict = 'confirmed' | 'mismatch' | 'unwitnessed'

// Confirmed and mismatch take the chip colours for complete and critical. Unwitnessed is
// a coverage gap, not a failure (FP-153 §8), so it is marked but never tinted.
const VERDICT_STYLE: Record<Verdict, CountStyle> = {
  confirmed: { dot: 'bg-ok', tint: 'bg-ok-c/30', text: 'text-ok' },
  mismatch: { dot: 'bg-err', tint: 'bg-err-c/40', text: 'text-err' },
  unwitnessed: { dot: 'bg-outline-v' },
}

/** One precinct's Pulsit corroboration on its own detail page: the Facility tab's figures
 *  from /analytics as stat tiles, since a one-row table reads as broken UI.
 *
 *  The endpoint takes no precinct filter, so this fetches the organisation's list and
 *  picks this precinct out client-side. A server-side filter is backend work, left out on
 *  purpose. */
export function PrecinctAnalyticsSummary({ precinctId }: PrecinctAnalyticsSummaryProps) {
  const [range, setRange] = useState<MonthRange>(() => defaultMonthRange())
  const facilities = useFacilityAnalytics(range)

  return (
    <AnalyticsSummaryFrame
      range={range}
      onRangeChange={setRange}
      isLoading={facilities.isLoading}
      error={facilities.error}
      onRetry={facilities.refetch}
    >
      <Figures
        rangeLabel={fmtMonthRange(range)}
        metrics={facilities.rows.find((row) => row.precinct_id === precinctId)}
      />
    </AnalyticsSummaryFrame>
  )
}

function Figures({ rangeLabel, metrics }: { rangeLabel: string; metrics: FacilityMetrics | undefined }) {
  if (!metrics) {
    return (
      <section>
        <SectionHeading title={SUMMARY_COPY.monthsHeading} detail={rangeLabel} />
        <EmptyNote />
      </section>
    )
  }

  return (
    <>
      <section>
        <SectionHeading title={SUMMARY_COPY.monthsHeading} detail={rangeLabel} />
        <StatTiles>
          <StatTile
            label={LABELS.corroborationRate}
            // Same denominator as FacilityPanel: unwitnessed is deliberately left out, since
            // "could not check" is not a failed check.
            value={fmtRate(metrics.corroboration_rate, metrics.confirmed_count, metrics.confirmed_count + metrics.mismatch_count)}
            accent
          />
        </StatTiles>
      </section>

      <section>
        <SectionHeading title={SUMMARY_COPY.verdictsHeading} />
        <CountStrip
          cells={[
            { label: LABELS.confirmed, count: metrics.confirmed_count, style: VERDICT_STYLE.confirmed },
            { label: LABELS.mismatch, count: metrics.mismatch_count, style: VERDICT_STYLE.mismatch },
            { label: LABELS.unwitnessed, count: metrics.unwitnessed_count, style: VERDICT_STYLE.unwitnessed },
          ]}
        />
        <div className="mt-3 flex flex-col gap-1 px-1 text-[12px] text-on-surf-v">
          <p>{ANALYTICS_COPY.facilityRateNote}</p>
          <p>{SUMMARY_COPY.orgScopeNote}</p>
        </div>
      </section>
    </>
  )
}
