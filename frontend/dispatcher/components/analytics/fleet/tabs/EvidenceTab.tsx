'use client'

import { Check, X } from 'lucide-react'

import { ANALYTICS_COPY } from '@/components/analytics/copy'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { fmtBucketLabel, type TabQuery } from '@/lib/format/period'
import { useFleetEvidence, type FleetQueryResult } from '@/lib/hooks/useFleetAnalytics'
import { NEUTRAL_COLOR, SERIES_COLORS, STATUS_COLORS } from '@/lib/tokens'
import type {
  FleetEvidence,
  Grain,
  OverridesBucket,
  ReceiverSignoffBucket,
  TrackerBucket,
} from '@shared/lib/types/fleet-analytics'
import { ChartCard, queryState } from '../ChartCard'
import { ChartLegend } from '../charts/ChartLegend'
import { ChartTooltip } from '../charts/ChartTooltip'
import { TrendColumns } from '../charts/TrendColumns'
import { TrendLines } from '../charts/TrendLines'
import { FLEET_COPY } from '../copy'
import { fmtBucketName, fmtShare, sumOf } from '../format'

const COPY = FLEET_COPY.evidence
const PERCENT = 100
const PERCENT_DOMAIN: [number, number] = [0, PERCENT]
const LEGEND_ICON_SIZE = 12
const [SERIES_COLOR] = SERIES_COLORS

interface TabCardProps {
  evidence: FleetQueryResult<FleetEvidence>
  grain: Grain
  today: string
}

interface TrackerRow {
  period: string
  confirmed: number
  unwitnessed: number
  mismatch: number
  agreement: string
}

/** Chart 5.1: confirmed · unwitnessed · mismatch, stacked in that order so the neutral grey
 *  always sits between the green and the red and the two never touch (spec §5.5). Each keyed
 *  by an icon as well as colour. The headline agreement rate leaves "could not check" out; it
 *  describes the chart, so it lives behind the "i" (D25), and each period's rate is in the
 *  tooltip and the table. */
function TrackerCard({ evidence, grain, today }: TabCardProps) {
  const rows = evidence.data?.tracker ?? []
  const confirmed = sumOf(rows, (row) => row.confirmed_count)
  const mismatch = sumOf(rows, (row) => row.mismatch_count)
  const unwitnessed = sumOf(rows, (row) => row.unwitnessed_count)
  const checked = confirmed + mismatch
  const overall = checked === 0 ? null : confirmed / checked
  const tableRows: TrackerRow[] = rows.map((row) => ({
    period: fmtBucketName(row.bucket_start, row.is_partial, grain, today),
    confirmed: row.confirmed_count,
    unwitnessed: row.unwitnessed_count,
    mismatch: row.mismatch_count,
    agreement: fmtShare(row.agreement_rate),
  }))
  const columns: Column<TrackerRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'confirmed', label: COPY.tracker.confirmed },
    { key: 'unwitnessed', label: COPY.tracker.unwitnessed },
    { key: 'mismatch', label: COPY.tracker.mismatch },
    { key: 'agreement', label: COPY.tracker.columns.agreement },
  ]

  return (
    <ChartCard
      title={COPY.tracker.title}
      question={COPY.tracker.question}
      basis={`${COPY.tracker.agreement(fmtShare(overall), confirmed, checked)}. ${COPY.tracker.basis(checked, unwitnessed)}`}
      note={ANALYTICS_COPY.facilityRateNote}
      timeAxis
      legend={
        <ChartLegend
          items={[
            { label: COPY.tracker.confirmed, color: STATUS_COLORS.good, mark: 'bar', icon: <Check size={LEGEND_ICON_SIZE} /> },
            { label: COPY.tracker.unwitnessed, color: NEUTRAL_COLOR, mark: 'bar' },
            { label: COPY.tracker.mismatch, color: STATUS_COLORS.critical, mark: 'bar', icon: <X size={LEGEND_ICON_SIZE} /> },
          ]}
        />
      }
      {...queryState(evidence)}
      isEmpty={checked + unwitnessed === 0}
      emptyBody={COPY.tracker.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendColumns<TrackerBucket>
        rows={rows}
        rowKey={(row) => row.bucket_start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.checks}
        series={[
          { key: 'confirmed', label: COPY.tracker.confirmed, color: STATUS_COLORS.good, value: (row) => row.confirmed_count },
          { key: 'unwitnessed', label: COPY.tracker.unwitnessed, color: NEUTRAL_COLOR, value: (row) => row.unwitnessed_count },
          { key: 'mismatch', label: COPY.tracker.mismatch, color: STATUS_COLORS.critical, value: (row) => row.mismatch_count },
        ]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.bucket_start, row.is_partial, grain, today)}
            lines={[
              { value: String(row.confirmed_count), label: COPY.tracker.confirmed, color: STATUS_COLORS.good },
              { value: String(row.unwitnessed_count), label: COPY.tracker.unwitnessed, color: NEUTRAL_COLOR },
              { value: String(row.mismatch_count), label: COPY.tracker.mismatch, color: STATUS_COLORS.critical },
            ]}
            note={COPY.tracker.agreement(fmtShare(row.agreement_rate), row.confirmed_count, row.confirmed_count + row.mismatch_count)}
          />
        )}
      />
    </ChartCard>
  )
}

interface OverridesRow {
  period: string
  steps: number
  overridden: number
  share: string
}

/** Chart 5.2: the override share, the same definition as the driver pages' override_rate.
 *  Closed trips only, like every trend: an override on a trip later cancelled never counts. */
function OverridesCard({ evidence, grain, today }: TabCardProps) {
  const rows = evidence.data?.overrides ?? []
  const steps = sumOf(rows, (row) => row.phase_count)
  const overridden = sumOf(rows, (row) => row.override_count)
  const tableRows: OverridesRow[] = rows.map((row) => ({
    period: fmtBucketName(row.bucket_start, row.is_partial, grain, today),
    steps: row.phase_count,
    overridden: row.override_count,
    share: fmtShare(row.override_rate),
  }))
  const columns: Column<OverridesRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'steps', label: COPY.overrides.columns.steps },
    { key: 'overridden', label: COPY.overrides.columns.overridden },
    { key: 'share', label: COPY.overrides.columns.share },
  ]

  return (
    <ChartCard
      title={COPY.overrides.title}
      question={COPY.overrides.question}
      basis={COPY.overrides.basis(overridden, steps)}
      note={COPY.overrides.note}
      timeAxis
      {...queryState(evidence)}
      isEmpty={steps === 0}
      emptyBody={COPY.overrides.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendLines<OverridesBucket>
        rows={rows}
        rowKey={(row) => row.bucket_start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.overridden}
        yTickFormat={(value) => `${value}%`}
        allowDecimals
        series={[{
          key: 'share', label: COPY.overrides.lower, color: SERIES_COLOR,
          value: (row) => (row.override_rate === null ? null : row.override_rate * PERCENT),
        }]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.bucket_start, row.is_partial, grain, today)}
            lines={[{ value: fmtShare(row.override_rate), label: `${COPY.overrides.lower} (${row.override_count} of ${row.phase_count})`, color: SERIES_COLOR }]}
          />
        )}
      />
    </ChartCard>
  )
}

interface SignoffRow {
  period: string
  signoffs: number
  scans: number
  share: string
}

/** Chart 5.7 (trial): the share of sign-offs the receiver scanned. The period's same-phone and
 *  rejected-scan figures describe it, so they sit behind the "i" (D25). The go-live date stays
 *  on the card face: it explains why earlier weeks read zero. */
function SignoffCard({ evidence, grain, today }: TabCardProps) {
  const rows = evidence.data?.receiver_signoff ?? []
  const confirmations = sumOf(rows, (row) => row.confirmation_count)
  const scans = sumOf(rows, (row) => row.receiver_scan_count)
  const flags = evidence.data?.signoff_flags ?? { same_phone_count: 0, rejected_attempt_count: 0 }
  const tableRows: SignoffRow[] = rows.map((row) => ({
    period: fmtBucketName(row.bucket_start, row.is_partial, grain, today),
    signoffs: row.confirmation_count,
    scans: row.receiver_scan_count,
    share: fmtShare(row.receiver_scan_rate),
  }))
  const columns: Column<SignoffRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'signoffs', label: COPY.signoff.columns.signoffs },
    { key: 'scans', label: COPY.signoff.columns.scans },
    { key: 'share', label: COPY.signoff.columns.share },
  ]

  return (
    <ChartCard
      className="lg:col-span-2"
      title={COPY.signoff.title}
      question={COPY.signoff.question}
      basis={COPY.signoff.basis(scans, confirmations)}
      note={COPY.signoff.flags(flags.same_phone_count, flags.rejected_attempt_count)}
      caveat={COPY.signoff.live}
      timeAxis
      sampleSize={confirmations}
      {...queryState(evidence)}
      isEmpty={confirmations === 0}
      emptyBody={COPY.signoff.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendLines<ReceiverSignoffBucket>
        rows={rows}
        rowKey={(row) => row.bucket_start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.scanned}
        yDomain={PERCENT_DOMAIN}
        yTickFormat={(value) => `${value}%`}
        series={[{
          key: 'share', label: COPY.signoff.lower, color: SERIES_COLOR,
          value: (row) => (row.receiver_scan_rate === null ? null : row.receiver_scan_rate * PERCENT),
        }]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.bucket_start, row.is_partial, grain, today)}
            lines={[{ value: fmtShare(row.receiver_scan_rate), label: `${COPY.signoff.lower} (${row.receiver_scan_count} of ${row.confirmation_count})`, color: SERIES_COLOR }]}
          />
        )}
      />
    </ChartCard>
  )
}

interface EvidenceTabProps {
  query: TabQuery
  allTimeStart: string | null
  today: string
}

/** Evidence tab (spec §5.5, D25): how strong the record is. Tracker agreement and overrides
 *  side by side, then receiver sign-off across the full width. The blockchain receipts chart
 *  was removed; what is still owed stays on the Receipts owed tile, which deep-links here. One
 *  request, for the tab's own period and grain. */
export function EvidenceTab({ query, allTimeStart, today }: EvidenceTabProps) {
  const evidence = useFleetEvidence(query, allTimeStart)
  const grain = evidence.data?.period.grain ?? query.grain

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <TrackerCard evidence={evidence} grain={grain} today={today} />
      <OverridesCard evidence={evidence} grain={grain} today={today} />
      <SignoffCard evidence={evidence} grain={grain} today={today} />
    </div>
  )
}
