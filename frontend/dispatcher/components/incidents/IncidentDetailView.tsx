'use client'

import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import { TopBar } from '@/components/ui/TopBar'
import { BackButton } from '@/components/ui/BackButton'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { TextArea } from '@/components/ui/TextArea'
import { Modal } from '@/components/ui/Modal'
import { DeclareIncidentDialog } from '@/components/domain/DeclareIncidentDialog'
import { ApiError } from '@/lib/api/client'
import { incidentSheetPdf, saveBlob } from '@/lib/api/auditPacks'
import {
  appendIncidentUpdate,
  assignIncidentToMe,
  attachIncidentDocument,
  closeIncident,
  incidentDocumentUrl,
  reopenIncident,
  stopIncidentTrip,
} from '@/lib/api/incidents'
import { useAuth } from '@/lib/hooks/useAuth'
import { useIncidentDetail, useIncidentEvidence } from '@/lib/hooks/useIncidents'
import { useToast } from '@/lib/hooks/useToast'
import { ROUTES } from '@/lib/constants/routes'
import {
  INCIDENT_TYPE_LABELS,
  REPORTER_ROLE_LABELS,
  REPORT_CHANNEL_LABELS,
  tripIsLive,
} from '@/lib/format/incident'
import { THEFT_REPORTED_WITHOUT_CAS, type IncidentDetail, type IncidentExternalAction, type IncidentUpdateCreate } from '@/lib/types/incident'
import { AddUpdateDialog, type UpdateMode } from './AddUpdateDialog'
import { AffectedCargoPanel } from './AffectedCargoPanel'
import { AttachDocumentDialog } from './AttachDocumentDialog'
import { CloseIncidentDialog } from './CloseIncidentDialog'
import { HijackResponseGuide } from './HijackResponseGuide'
import { IncidentEvidencePanel } from './IncidentEvidencePanel'
import { IncidentIssuePackDialog } from './IncidentIssuePackDialog'
import { IncidentDetailSkeleton, SectionRowsSkeleton } from './IncidentSkeletons'
import { IncidentStatusStrip } from './IncidentStatusStrip'
import { IncidentTimeline } from './IncidentTimeline'

interface Props {
  incidentId: string
  /** Where Back goes: the trip it was opened from, else the incidents list (already validated). */
  backHref: string
  onNavigate: (href: string) => void
}

type Dialog =
  | { kind: 'update'; mode: UpdateMode; action?: IncidentExternalAction }
  | { kind: 'close' } | { kind: 'reopen' } | { kind: 'stop' } | { kind: 'saps' } | { kind: 'document' } | { kind: 'pack' }

function Panel({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-outline-v/30 bg-surf-lowest" aria-label={title}>
      <h2 className="border-b border-outline-v/30 bg-surf-low px-4 py-[10px] text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v sm:px-6">{title}</h2>
      <div className="p-4 sm:p-6">{children}</div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-on-surf-v">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-on-surf">{value}</dd>
    </div>
  )
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError && (err.status === 409 || err.status === 422 || err.status === 503) ? err.message : 'Please try again.'
}

/** One incident: what was reported, what it affects, what the evidence says, and everything
 *  recorded since — with the hijacking response steps when it is a hijacking. */
export function IncidentDetailView({ incidentId, backHref, onNavigate }: Props): React.JSX.Element {
  const { data: incident, isLoading, error, refetch, refetchSilent } = useIncidentDetail(incidentId)
  const evidence = useIncidentEvidence(incidentId)
  const { user } = useAuth()
  const { notify } = useToast()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const back = <BackButton onClick={() => onNavigate(backHref)} />

  if (isLoading && !incident) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <TopBar title="Incident" left={back} />
        <IncidentDetailSkeleton />
      </div>
    )
  }
  if (!incident) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <TopBar title="Incident" left={back} />
        <EmptyState icon={<AlertCircle />} title="Incident not available" body={error ?? 'It may belong to another organisation.'}
          cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>} />
      </div>
    )
  }

  const closed = incident.status === 'closed'
  const { trip_id: tripId, trip_reference: tripReference } = incident
  const live = tripIsLive(incident.trip_status)
  const hasCaseNumber = incident.declarations.some(d => d.saps_cas_number)

  /** Run one write, refresh both the incident and its evidence, and report the outcome. */
  async function act(work: () => Promise<IncidentDetail>, success: string): Promise<boolean> {
    try {
      const updated = await work()
      if (updated.warnings.includes(THEFT_REPORTED_WITHOUT_CAS)) {
        notify({ kind: 'warning', title: `${success}. No SAPS case number is on record.` })
      } else {
        notify({ kind: 'success', title: success })
      }
      refetchSilent()
      evidence.refetchSilent()
      return true
    } catch (err) {
      notify({ kind: 'error', title: 'Could not save', body: errorMessage(err) })
      return false
    }
  }

  async function openDocument(artifactId: string): Promise<void> {
    try {
      const link = await incidentDocumentUrl(incidentId, artifactId)
      if (link.signed_url) window.open(link.signed_url, '_blank', 'noopener')
      else notify({ kind: 'error', title: 'The document cannot be opened right now.' })
    } catch (err) {
      notify({ kind: 'error', title: 'Could not open the document', body: errorMessage(err) })
    }
  }

  async function downloadSheet(): Promise<void> {
    try {
      saveBlob(await incidentSheetPdf(tripId), `${tripReference}-incident-sheet.pdf`)
    } catch (err) {
      notify({ kind: 'error', title: 'Could not create the fact sheet', body: errorMessage(err) })
    }
  }

  const update = (body: IncidentUpdateCreate, success: string): Promise<boolean> =>
    act(() => appendIncidentUpdate(incidentId, body), success)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title={`${incident.reference} · ${INCIDENT_TYPE_LABELS[incident.incident_type]}`} left={back} identity={
        <div className="min-w-0">
          <h1 className="text-[18px] font-[800] leading-tight tracking-[-0.02em] text-on-surf">
            {incident.reference} · {INCIDENT_TYPE_LABELS[incident.incident_type]}
          </h1>
          <button type="button" onClick={() => onNavigate(ROUTES.tripDetail(incident.trip_id))} className="mt-[2px] text-xs font-medium tracking-[0.03em] text-sec tabular-nums hover:underline">
            Trip {incident.trip_reference}
          </button>
        </div>
      } />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-6 py-6">
          {error && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-warn-c px-4 py-3 text-sm text-warn-onc">
            This record may be out of date, the last refresh failed.<Button variant="ghost" onClick={refetchSilent}>Retry</Button>
          </div>}
          <IncidentStatusStrip incident={incident} />

          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-x-6">
            <div className="flex min-w-0 flex-col gap-4">
              <Panel title="What was reported">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-on-surf">{incident.summary}</p>
                <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Fact label="Reported by" value={`${REPORTER_ROLE_LABELS[incident.reporter_role]}${incident.reported_by_name ? ` · ${incident.reported_by_name}` : ''}`} />
                  <Fact label="How it reached us" value={REPORT_CHANNEL_LABELS[incident.report_channel]} />
                  <Fact label="Reportedly happened" value={fmtSastDateTime(incident.reported_occurred_at) ?? 'Not stated by the reporter'} />
                  <Fact label="When we were told" value={fmtSastDateTime(incident.received_at) ?? '—'} />
                  <Fact label="Recorded by" value={incident.recorded_by_name ?? '—'} />
                  <Fact label="Investigated by" value={incident.assigned_to_name ?? 'Unassigned'} />
                  {closed && <Fact label="Established" value={incident.closure_reason ?? '—'} />}
                </dl>
              </Panel>

              {incident.response_guide && <Panel title="Hijacking response">
                <HijackResponseGuide steps={incident.response_guide} closed={closed} tripLive={live}
                  documentUploadEnabled={incident.document_upload_enabled}
                  onStopTrip={() => setDialog({ kind: 'stop' })}
                  onRecordAction={action => setDialog({ kind: 'update', mode: 'external_action', action })}
                  onRecordSaps={() => setDialog({ kind: 'saps' })}
                  onAttachCaseSlip={() => setDialog({ kind: 'document' })}
                  onIssuePack={() => setDialog({ kind: 'pack' })}
                  onDownloadSheet={downloadSheet} />
              </Panel>}

              <Panel title="Affected cargo">
                <AffectedCargoPanel parcels={incident.parcels} closed={closed}
                  onRecordFinding={(parcelId, finding, note) => update({ kind: 'parcel_finding', parcel_id: parcelId, finding, note }, 'Finding recorded')} />
              </Panel>

              <Panel title="Evidence">
                {evidence.data
                  ? <IncidentEvidencePanel evidence={evidence.data} incidentId={incident.incident_id} closed={closed}
                    onLinkException={exceptionId => { void update({ kind: 'exception_linked', exception_id: exceptionId }, 'Exception grouped') }} />
                  : evidence.isLoading ? <SectionRowsSkeleton rows={4} label="Loading evidence" />
                    : <p className="text-sm text-on-surf-v">{evidence.error ?? 'Evidence unavailable.'}</p>}
              </Panel>
            </div>

            <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4">
              <Panel title="Follow-up">
                <div className="flex flex-col gap-2">
                  {closed ? <Button variant="secondary" onClick={() => setDialog({ kind: 'reopen' })}>Reopen incident</Button> : <>
                    <Button onClick={() => setDialog({ kind: 'update', mode: 'note' })}>Add to the incident</Button>
                    {user && incident.assigned_to_user_id !== user.id && (
                      <Button variant="secondary" onClick={() => { void act(() => assignIncidentToMe(incidentId, user.id), 'You now own this incident') }}>Take ownership</Button>
                    )}
                    {incident.status === 'open' && (
                      <Button variant="secondary" onClick={() => { void update({ kind: 'status_changed', status: 'investigating' }, 'Marked as investigating') }}>Mark as investigating</Button>
                    )}
                    {incident.document_upload_enabled && <Button variant="secondary" onClick={() => setDialog({ kind: 'document' })}>Attach a document</Button>}
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'close' })}>Close incident</Button>
                  </>}
                </div>
              </Panel>
              <Panel title="History">
                <IncidentTimeline incident={incident} onOpenDocument={id => { void openDocument(id) }} />
              </Panel>
            </div>
          </div>
        </div>
      </div>

      <AddUpdateDialog open={dialog?.kind === 'update'} initialMode={dialog?.kind === 'update' ? dialog.mode : 'note'}
        initialAction={dialog?.kind === 'update' ? dialog.action : undefined} currentConfidence={incident.confidence}
        onClose={() => setDialog(null)} onSubmit={body => update(body, 'Added to the incident')} />
      <CloseIncidentDialog open={dialog?.kind === 'close'} unresolved={incident.parcels.filter(p => p.latest_finding === null)}
        hasCaseNumber={hasCaseNumber} onClose={() => setDialog(null)} onRecordCase={() => setDialog({ kind: 'saps' })}
        onSubmit={(outcome, reason) => act(() => closeIncident(incidentId, outcome, reason), 'Incident closed')} />
      <ReasonDialog open={dialog?.kind === 'reopen'} title="Reopen incident" label="Why it is being reopened" confirm="Reopen"
        onClose={() => setDialog(null)} onSubmit={reason => act(() => reopenIncident(incidentId, reason), 'Incident reopened')} />
      <StopTripDialog open={dialog?.kind === 'stop'} tripReference={incident.trip_reference} onClose={() => setDialog(null)}
        onConfirm={() => act(() => stopIncidentTrip(incidentId), 'Trip stopped')} />
      <AttachDocumentDialog open={dialog?.kind === 'document'} onClose={() => setDialog(null)}
        onSubmit={(file, note) => act(() => attachIncidentDocument(incidentId, file, note), 'Document attached')} />
      {dialog?.kind === 'pack' && (
        // Issued here, not on the trip page: the guide's last step should not take the
        // dispatcher away from the incident they are working.
        <IncidentIssuePackDialog tripId={incident.trip_id} onClose={() => setDialog(null)}
          onIssued={() => { refetchSilent(); evidence.refetchSilent() }} />
      )}
      <DeclareIncidentDialog tripId={incident.trip_id} incidentId={incident.incident_id} open={dialog?.kind === 'saps'}
        onClose={() => setDialog(null)} onDeclared={() => { refetchSilent(); evidence.refetchSilent() }} />
    </div>
  )
}

interface ReasonDialogProps {
  open: boolean
  title: string
  label: string
  confirm: string
  onClose: () => void
  onSubmit: (reason: string) => Promise<boolean>
}

function ReasonDialog({ open, title, label, confirm, onClose, onSubmit }: ReasonDialogProps): React.JSX.Element | null {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  if (!open) return null
  async function save(): Promise<void> {
    setSaving(true)
    try {
      if (await onSubmit(reason.trim())) { setReason(''); onClose() }
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open onClose={() => { if (!saving) onClose() }} closeDisabled={saving} title={title}>
      <TextArea label={label} value={reason} onChange={e => setReason(e.target.value)} />
      <div className="mt-5 flex flex-col gap-2">
        <Button full loading={saving} disabled={!reason.trim() || saving} onClick={save}>{confirm}</Button>
        <Button variant="secondary" full onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </Modal>
  )
}

interface StopTripDialogProps {
  open: boolean
  tripReference: string
  onClose: () => void
  onConfirm: () => Promise<boolean>
}

function StopTripDialog({ open, tripReference, onClose, onConfirm }: StopTripDialogProps): React.JSX.Element | null {
  const [saving, setSaving] = useState(false)
  if (!open) return null
  async function confirm(): Promise<void> {
    setSaving(true)
    try {
      if (await onConfirm()) onClose()
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open onClose={() => { if (!saving) onClose() }} closeDisabled={saving} title={`Stop trip ${tripReference}?`}>
      <p className="text-sm leading-relaxed text-on-surf">
        The trip ends now and the driver&apos;s app stops asking for steps. Evidence already captured is kept. Reports still
        queued on the phone are still accepted; step submissions it can no longer make are kept on the phone, not lost. This cannot be undone.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <Button full variant="danger" loading={saving} disabled={saving} onClick={confirm}>Stop trip</Button>
        <Button variant="secondary" full onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </Modal>
  )
}
