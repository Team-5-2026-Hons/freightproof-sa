'use client'

import { useCallback } from 'react'
import type { CompletedSubstitutionDetail } from '@shared/lib/types/driver-substitution'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { useAsyncData } from '@/lib/hooks/useAsyncData'
import { getCompletedSubstitution } from '@/lib/api/driverSubstitutions'
import { EvidencePhoto } from '@/components/domain/EvidencePhoto'
import { Button } from '@/components/ui/Button'

interface Props { tripId: string; substitutionId: string; onChanged: () => void }

export function DriverTransferDetail({ tripId, substitutionId }: Props): React.JSX.Element {
  const load = useCallback(() => getCompletedSubstitution(tripId, substitutionId), [tripId, substitutionId])
  const { data, error, isLoading, refetch } = useAsyncData<CompletedSubstitutionDetail | null>(load, null)
  if (error) return <div role="alert">{error}<Button variant="secondary" size="sm" onClick={refetch}>Retry transfer detail</Button></div>
  if (isLoading || data === null) return <p role="status">Loading transfer evidence…</p>
  return <div className="flex flex-col gap-3 text-[13px] text-on-surf">
    <p className="font-bold">{data.outgoing.full_name} → {data.incoming.full_name}</p>
    <p>Effective {fmtDateTime(data.effective_at)} · {data.completion_mode?.replaceAll('_', ' ') ?? 'Completion mode not recorded'}</p>
    <p>{data.phase_context ? `During ${PHASE_NAMES[data.phase_context.phase_type].toLowerCase()}` : 'Phase context not recorded'}</p>
    <p>Reason: {data.reason ?? 'Not recorded'}</p>
    <p>Dispatcher authorisation: {data.arranged_by_user_id ?? 'Not recorded'}</p>
    <p>Completed by: {data.completion?.completed_by_driver_id ?? data.completion?.completed_by_user_id ?? 'Not recorded'}</p>
    {data.confirmation_policy === 'incoming_acceptance_v2' && <p>Outgoing driver: Not requested — notification only.</p>}
    {(data.outgoing_notices ?? []).map(notice => <p key={notice.id}>Outgoing {notice.kind} notice recorded {fmtDateTime(notice.created_at)} · {notice.read_at ? `read ${fmtDateTime(notice.read_at)}` : 'Unread'}</p>)}
    {!data.outgoing_notices?.length && <p>Outgoing notification facts not recorded.</p>}
    {data.required_confirmation_roles?.filter(role => !data.confirmations.some(c => c.role === role)).map(role => <p key={role}>Required {role} declaration not recorded{data.missing_confirmation_reason && `: ${data.missing_confirmation_reason}`}</p>)}
    {data.confirmations.map(capture => <section key={capture.id} className="rounded-lg border border-outline-v/30 p-3" aria-label={`${capture.role} declaration`}>
      <h4 className="font-semibold">{capture.role === 'incoming' ? 'Incoming acceptance' : 'Outgoing declaration'} · {capture.driver_id}</h4>
      <p>Declared {fmtDateTime(capture.captured_at)} · received {fmtDateTime(capture.received_at)}</p>
      <p>Phone observation: {capture.location_observed_at ? fmtDateTime(capture.location_observed_at) : 'Time not recorded'}</p>
      <p>{capture.latitude == null ? `Location unavailable: ${capture.location_unavailable_reason ?? 'reason not recorded'}` : `${capture.latitude}, ${capture.longitude} · accuracy ${capture.accuracy_metres} m`}</p>
      <p>Observation metadata: {capture.location_observation_committed ? 'covered by custody commitment' : 'not covered by legacy custody commitment'}</p>
      <p>Location corroboration: {capture.action_location_assessment?.proximity ?? 'not assessed'}</p>
      <p>Vehicles checked: {capture.confirmed_vehicle_ids.length}</p>
      <ul>{capture.seal_checks.map(check => <li key={check.vehicle_id}>{check.vehicle_id}: {check.condition}{check.seal_number && ` · ${check.seal_number}`}{check.not_applicable_reason && ` · ${check.not_applicable_reason}`}</li>)}</ul>
      {capture.discrepancy_note && <p>Note: {capture.discrepancy_note}</p>}
    </section>)}
    {!data.confirmations.length && <p>No driver declarations recorded.</p>}
    <div className="flex flex-wrap gap-3">{data.artifacts.map((artifact, index) => <EvidencePhoto key={artifact.id} label={`Transfer photo ${index + 1}`} artifact={artifact} onRetry={refetch} />)}</div>
    {data.identity_attestation && <p>Identity exception by {data.identity_attestation.attested_by_user_id}, {fmtDateTime(data.identity_attestation.attested_at)}: {data.identity_attestation.reason}</p>}
    {data.corrections.map(correction => <p key={correction.id}>Clarification by {correction.recorded_by_user_id}, {fmtDateTime(correction.recorded_at)}: {correction.reason} — {correction.correction_note} · anchor {correction.anchor_status}</p>)}
    <p>Anchor: {data.anchor_status ?? 'not recorded'} · Custody integrity: {data.custody_integrity.status}</p>
    {data.custody_integrity.findings.map(finding => <p key={finding} className="text-err">{finding}</p>)}
    <p className="text-xs text-on-surf-v">Names are current display labels. Notification delivery or read acknowledgement is not recorded as driver consent.</p>
  </div>
}
