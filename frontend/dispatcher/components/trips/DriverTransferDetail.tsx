'use client'

import { useCallback, useState } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { CompletedSubstitutionDetail, SubstitutionConfirmationDetail } from '@shared/lib/types/driver-substitution'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { useAsyncData } from '@/lib/hooks/useAsyncData'
import { useOpenerFocus } from '@/lib/hooks/useOpenerFocus'
import { correctSubstitution, getCompletedSubstitution, newClientRequestId } from '@/lib/api/driverSubstitutions'
import { EvidencePhoto } from '@/components/domain/EvidencePhoto'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { InfoRow } from '@/components/ui/InfoRow'
import { Skeleton } from '@/components/ui/Skeleton'
import { TextArea } from '@/components/ui/TextArea'
import {
  IDENTITY_STATUS_LABELS, NOTICE_KIND_LABELS, NOT_RECORDED, fmtAnchorStatus, fmtCompletionMode, fmtProximity, fmtSealCheck,
} from '@/lib/format/driver-transfer'
import { INTEGRITY_CHIP, problemText } from './DriverSubstitutionPanel'

const SKELETON_GROUPS = 4
const SKELETON_ROWS = 3

interface Props { trip: Trip; substitutionId: string; onChanged: () => void }

export function DriverTransferDetail({ trip, substitutionId, onChanged }: Props): React.JSX.Element {
  const tripId = trip.id
  const load = useCallback(() => getCompletedSubstitution(tripId, substitutionId), [tripId, substitutionId])
  const { data, error, isLoading, refetch } = useAsyncData<CompletedSubstitutionDetail | null>(load, null)
  if (error) return <div role="alert">{error}<Button variant="secondary" size="sm" onClick={refetch}>Retry transfer detail</Button></div>
  if (isLoading || data === null) return <TransferDetailSkeleton />

  const driverName = (id: string | null | undefined): string | null =>
    id === data.outgoing.id ? data.outgoing.full_name : id === data.incoming.id ? data.incoming.full_name : null
  const registrations = vehicleRegistrations(trip)
  const vehicle = (id: string): string => registrations.get(id) ?? UNKNOWN_VEHICLE
  const identity = trip.driver_substitutions?.find(request => request.id === data.request_id)?.identity.status
  const completion = data.completion
  const completedBy = completion?.completed_by_name ?? driverName(completion?.completed_by_driver_id)
    ?? (completion?.completed_by_user_id ? 'A dispatcher' : NOT_RECORDED)
  const missingRoles = data.required_confirmation_roles?.filter(role => !data.confirmations.some(c => c.role === role)) ?? []

  return <div className="flex flex-col gap-4 text-[13px] text-on-surf">
    <header>
      <p className="text-sm font-bold">{data.outgoing.full_name} → {data.incoming.full_name}</p>
      <p>Effective {fmtDateTime(data.effective_at)} · {fmtCompletionMode(data.completion_mode, data.request_format)}</p>
      <p className="text-on-surf-v">{data.phase_context ? `During ${PHASE_NAMES[data.phase_context.phase_type].toLowerCase()}` : 'Phase context not recorded'}</p>
    </header>

    <Group title="Arrangement">
      <InfoRow label="Reason" value={data.reason ?? NOT_RECORDED} />
      <InfoRow label="Arranged by" value={data.arranged_by_name ?? (data.arranged_by_user_id ? 'A dispatcher' : NOT_RECORDED)} />
      <InfoRow label="Completed by" value={completedBy} />
      <InfoRow label="Exchange time declared" value={data.declared_exchange_at ? fmtDateTime(data.declared_exchange_at) : NOT_RECORDED} />
      {data.missing_confirmation_reason && <InfoRow label="Missing confirmation" value={data.missing_confirmation_reason} />}
    </Group>

    {data.confirmations.map(capture => {
      const who = driverName(capture.driver_id) ?? 'Driver'
      return <Group key={capture.id} title={`${capture.role === 'incoming' ? 'Incoming' : 'Outgoing'} driver’s check`}>
        <InfoRow label="Driver" value={who} />
        <InfoRow label="Declared" value={fmtDateTime(capture.captured_at)} />
        <InfoRow label="Received" value={fmtDateTime(capture.received_at)} />
        <InfoRow label="Location" value={fmtProximity(capture.action_location_assessment)} />
        <InfoRow label="Phone position" value={phonePosition(capture)} />
        <InfoRow label="Location record" value={capture.location_observation_committed ? 'Covered by the custody seal' : 'Not covered (recorded before this was sealed)'} />
        <InfoRow label="Vehicles checked" value={capture.confirmed_vehicle_ids.map(vehicle).join(', ') || NOT_RECORDED} />
        {capture.seal_checks.map(check => <InfoRow key={check.vehicle_id} label={`Seal · ${vehicle(check.vehicle_id)}`} value={fmtSealCheck(check)} />)}
        {capture.discrepancy_note && <InfoRow label="Note" value={capture.discrepancy_note} />}
      </Group>
    })}
    {!data.confirmations.length && <p>No driver declarations recorded.</p>}
    {missingRoles.map(role => <p key={role}>Required {role} declaration not recorded.</p>)}
    {data.artifacts.length > 0 && <div className="flex flex-wrap gap-3">
      {data.artifacts.map((artifact, index) => <EvidencePhoto key={artifact.id} label={`Transfer photo ${index + 1}`} artifact={artifact} onRetry={refetch} />)}
    </div>}

    <Group title="Identity">
      <InfoRow label="Incoming driver’s identity" value={identity ? IDENTITY_STATUS_LABELS[identity] : NOT_RECORDED} />
      {data.identity_attestation && <p className="pt-1">
        Identity attested by {data.identity_attestation.attested_by_name ?? 'a dispatcher'} at {fmtDateTime(data.identity_attestation.attested_at)}: {data.identity_attestation.reason}
      </p>}
    </Group>

    <Group title="Driver notifications">
      {data.confirmation_policy === 'incoming_acceptance_v2' && <InfoRow label="Outgoing driver’s confirmation" value="Not requested (notification only)" />}
      {(data.outgoing_notices ?? []).map(notice => <InfoRow key={notice.id} label="Outgoing driver notified"
        value={`${NOTICE_KIND_LABELS[notice.kind]}, recorded ${fmtDateTime(notice.created_at)} · ${notice.read_at ? `read ${fmtDateTime(notice.read_at)}` : 'Unread'}`} />)}
      {!data.outgoing_notices?.length && <p>Outgoing notification facts not recorded.</p>}
    </Group>

    <Group title="Record integrity">
      <InfoRow label="Sealing" value={fmtAnchorStatus(data.anchor_status)} />
      <div className="flex items-center justify-between gap-3 py-[8px] text-[13px]">
        <span className="text-[11px] text-on-surf-v">Custody chain</span>
        <Chip type={INTEGRITY_CHIP[data.custody_integrity.status].type} label={INTEGRITY_CHIP[data.custody_integrity.status].label} />
      </div>
      {data.custody_integrity.findings.map(finding => <p key={finding} className="text-err">{finding}</p>)}
    </Group>

    <Group title="Clarifications">
      {data.corrections.length === 0 && <p className="text-on-surf-v">None recorded.</p>}
      {data.corrections.map(correction => <div key={correction.id} className="border-b border-outline-v/20 py-2 last:border-0">
        <p className="font-semibold">{correction.reason}</p>
        <p>{correction.correction_note}</p>
        <p className="text-xs text-on-surf-v">{correction.recorded_by_name ?? 'A dispatcher'} · {fmtDateTime(correction.recorded_at)} · {fmtAnchorStatus(correction.anchor_status)}</p>
      </div>)}
      <ClarificationForm tripId={tripId} substitutionId={substitutionId} onAdded={() => { refetch(); onChanged() }} />
    </Group>

    <p className="text-xs text-on-surf-v">Names are current display labels. Notification delivery or read acknowledgement is not recorded as driver consent.</p>
  </div>
}

const UNKNOWN_VEHICLE = 'Vehicle not on this trip'

/** Every plate this trip, or one of its handover requests, names, by vehicle id: a handover can name a vehicle
 *  the trip no longer carries. */
function vehicleRegistrations(trip: Trip): Map<string, string> {
  const plates = new Map<string, string>()
  for (const request of trip.driver_substitutions ?? []) for (const v of request.vehicles) plates.set(v.id, v.registration)
  for (const v of [trip.horse, ...trip.trailers]) if (v) plates.set(v.id, v.registration)
  return plates
}

/** Where the driver's phone said it was, or why it could not say. */
function phonePosition(capture: SubstitutionConfirmationDetail): string {
  if (capture.latitude == null || capture.longitude == null) {
    return `Unavailable: ${capture.location_unavailable_reason?.replaceAll('_', ' ') ?? 'reason not recorded'}`
  }
  const accuracy = capture.accuracy_metres == null ? '' : ` · accuracy ${Math.round(capture.accuracy_metres)} m`
  const observed = capture.location_observed_at ? ` · read ${fmtDateTime(capture.location_observed_at)}` : ''
  return `${capture.latitude.toFixed(5)}, ${capture.longitude.toFixed(5)}${accuracy}${observed}`
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return <section aria-label={title} className="border-t border-outline-v/30 pt-3">
    <h3 className="mb-1 text-sm font-bold text-on-surf">{title}</h3>
    {children}
  </section>
}

/** The finished layout in grey, so nothing jumps when the evidence lands; it shows no fact a reader could mistake for a record. */
function TransferDetailSkeleton(): React.JSX.Element {
  return <div role="status" aria-busy="true" aria-label="Loading transfer evidence" className="flex flex-col gap-4">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-5 w-64 max-w-full rounded-md" />
      <Skeleton className="h-4 w-80 max-w-full rounded-md" />
    </div>
    {Array.from({ length: SKELETON_GROUPS }).map((_, group) => <div key={group} className="border-t border-outline-v/30 pt-3">
      <Skeleton className="mb-2 h-4 w-32 rounded-md" />
      {Array.from({ length: SKELETON_ROWS }).map((_, row) => <Skeleton key={row} className="mb-2 h-4 w-full rounded-md" />)}
    </div>)}
  </div>
}

/** Adds to the record without changing it: a clarification cannot alter the drivers, the time or who holds the trip. */
function ClarificationForm({ tripId, substitutionId, onAdded }: { tripId: string; substitutionId: string; onAdded: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [key, setKey] = useState(newClientRequestId)

  function start(): void {
    setKey(newClientRequestId())
    setProblem(null)
    setOpen(true)
  }

  async function submit(): Promise<void> {
    setBusy(true)
    try {
      await correctSubstitution(tripId, substitutionId, { client_request_id: key, reason: reason.trim(), correction_note: note.trim() })
      setOpen(false)
      setReason('')
      setNote('')
      onAdded()
    } catch (err) {
      setProblem(problemText(err, 'Could not add the clarification.'))
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <section aria-label="Add clarification" className="flex flex-col gap-2 rounded-lg border border-outline-v/30 p-3">
      <p className="text-[12px] text-on-surf-v">A clarification is appended to the record. It cannot change the drivers, the time or who holds the trip.</p>
      <TextArea label="Reason" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} />
      <TextArea label="Clarification" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" loading={busy} disabled={!reason.trim() || !note.trim()} onClick={submit}>Add clarification</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Back</Button>
      </div>
      {problem && <p role="alert" className="text-err">{problem}</p>}
    </section>
  )

  const root = useOpenerFocus(open ? 'clarify' : null)

  return <div ref={root}>{open ? form : <Button size="sm" variant="ghost" data-opener="clarify" onClick={start}>Add clarification</Button>}</div>
}
