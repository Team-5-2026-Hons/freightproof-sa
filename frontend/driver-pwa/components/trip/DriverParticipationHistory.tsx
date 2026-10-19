'use client'

import type {
  DriverParticipationHistoryRead,
  LateEvidenceKind,
  SubstitutionConfirmationDetail,
  SubstitutionSealCondition,
} from '@shared/lib/types/driver-substitution'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { formatDateTime } from '@/lib/utils/format-time'
import { TabSubpage } from '@/components/layout/TabSubpage'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { StatusBanner } from '@/components/ui/StatusBanner'

export interface DriverParticipationHistoryProps {
  history: DriverParticipationHistoryRead
  onBack: () => void
}

const ACTION_LABEL: Record<LateEvidenceKind, string> = {
  phase: 'Phase recorded',
  checkpoint: 'Checkpoint',
  location: 'Location report',
  exception: 'Exception reported',
}

const SEAL_LABEL: Record<SubstitutionSealCondition, string> = {
  intact: 'Seal intact',
  damaged: 'Seal damaged',
  missing: 'Seal missing',
  not_applicable: 'No seal (empty leg)',
}

function periodLabel(startedAt: string | null, endedAt: string | null): string {
  const start = startedAt === null ? 'Start not recorded' : formatDateTime(startedAt)
  // An open period is the driver's CURRENT custody — only possible here on A→B→A, where a
  // driver is both a former and the current participant on the same trip.
  const end = endedAt === null ? 'now' : formatDateTime(endedAt)
  return `${start} – ${end}`
}

function Declaration({ declaration }: { declaration: SubstitutionConfirmationDetail }) {
  return (
    <li className="px-5 py-3">
      <p className="text-headline text-surface-on">
        {declaration.role === 'outgoing' ? 'Your handover check' : 'Your takeover check'}
      </p>
      <p className="text-subhead text-surface-on-variant">
        Captured {formatDateTime(declaration.captured_at)} · received {formatDateTime(declaration.received_at)}
      </p>
      <ul className="mt-1 text-subhead text-surface-on">
        {declaration.seal_checks.map((check) => (
          <li key={check.vehicle_id}>
            {SEAL_LABEL[check.condition]}
            {check.seal_number !== null && ` · ${check.seal_number}`}
            {check.not_applicable_reason !== null && ` · ${check.not_applicable_reason}`}
          </li>
        ))}
      </ul>
      {declaration.discrepancy_note !== null && (
        <p className="mt-1 text-subhead text-surface-on">Note: {declaration.discrepancy_note}</p>
      )}
    </li>
  )
}

/**
 * A driver's own part in a trip they handed over (FP-83 T1). Built only from the restricted
 * participation read — never from trip detail — so it can show nothing the server did not
 * scope to this driver: no later live position, no other driver's details, no manifest. The
 * trip's status is the real one (often still Active for the next driver), stated as such.
 */
export function DriverParticipationHistory({ history, onBack }: DriverParticipationHistoryProps) {
  return (
    <TabSubpage title="Your record" subtitle={history.trip_reference} backLabel="Trips" onBack={onBack}>
      <StatusBanner tone="neutral" title="You handed over this trip" className="mx-4 mt-4">
        {`Trip status now: ${TRIP_STATUS_META[history.trip_status].label}. This shows only your part of it.`}
      </StatusBanner>

      <section aria-labelledby="participation-periods" className="mt-6">
        <SectionHeading id="participation-periods" title="Your time on this trip" />
        <ul>
          {history.custody_periods.map((period) => (
            <li key={period.custody_sequence} className="px-5 py-2 text-body text-surface-on">
              {periodLabel(period.started_at, period.ended_at)}
              {period.completion_mode === 'dispatcher_attested' && (
                <span className="block text-subhead text-surface-on-variant">Handover recorded by dispatch</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {history.action_references.length > 0 && (
        <section aria-labelledby="participation-actions" className="mt-6">
          <SectionHeading id="participation-actions" title="What you recorded" />
          <ul>
            {history.action_references.map((action) => (
              <li key={`${action.kind}-${action.id}`} className="px-5 py-2 text-body text-surface-on">
                {ACTION_LABEL[action.kind]}
                <span className="block text-subhead text-surface-on-variant">{formatDateTime(action.recorded_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.declarations.length > 0 && (
        <section aria-labelledby="participation-declarations" className="mt-6">
          <SectionHeading id="participation-declarations" title="Handover checks" />
          <ul>
            {history.declarations.map((declaration) => <Declaration key={declaration.id} declaration={declaration} />)}
          </ul>
        </section>
      )}

      {history.artifacts.length > 0 && (
        <section aria-labelledby="participation-photos" className="mt-6">
          <SectionHeading id="participation-photos" title="Your photos" />
          <ul className="grid grid-cols-3 gap-2 px-5 pt-2">
            {history.artifacts.map((artifact) => (
              <li key={artifact.id} className="aspect-square overflow-hidden rounded-xl bg-fill">
                {artifact.signed_url === null ? (
                  // Storage declined to sign: the record still exists and says so.
                  <span className="flex h-full items-center justify-center p-2 text-center text-footnote text-surface-on-variant">
                    Photo unavailable
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- static export: next/image optimisation is unavailable
                  <img src={artifact.signed_url} alt={`Photo captured ${formatDateTime(artifact.captured_at)}`} className="h-full w-full object-cover" />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </TabSubpage>
  )
}
