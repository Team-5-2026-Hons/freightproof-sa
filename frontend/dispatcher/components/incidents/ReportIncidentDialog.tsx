'use client'

import { useMemo, useState } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { Parcel } from '@shared/lib/types/manifest'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { TextArea } from '@/components/ui/TextArea'
import { ApiError } from '@/lib/api/client'
import { reportIncident } from '@/lib/api/incidents'
import { useManifest } from '@/lib/hooks/useManifest'
import { useToast } from '@/lib/hooks/useToast'
import { sastInputToIso } from '@/lib/format/sast'
import { exceptionDescriptionText, fmtExceptionType } from '@/lib/format/exception'
import {
  CONFIDENCE_HELP,
  CONFIDENCE_LABELS,
  INCIDENT_TYPE_LABELS,
  REPORTER_ROLE_LABELS,
  REPORT_CHANNEL_LABELS,
  reportDefaults,
  tripIsLive,
} from '@/lib/format/incident'
import type {
  IncidentConfidence,
  IncidentDetail,
  IncidentReportChannel,
  IncidentReporterRole,
  IncidentType,
} from '@/lib/types/incident'

type CargoChoice = 'all' | 'chosen' | 'none'

export interface ReportPrefill {
  incidentType: IncidentType
  exceptionIds: string[]
  summary?: string
}

interface Props {
  trip: Trip
  open: boolean
  takenExceptionIds: ReadonlySet<string>
  prefill?: ReportPrefill
  onClose: () => void
  onReported: (incident: IncidentDetail) => void
}

const NOT_GROUPABLE = new Set(['dispatcher_note'])

/**
 * Records what someone reported, as a report: who said what, how, when it reportedly happened
 * and when we were told. A client's phone call stays "reported" — writing it down never makes
 * it a system-confirmed theft. For a hijacking on a live trip, stopping the trip is the default.
 */
export function ReportIncidentDialog(props: Props): React.JSX.Element | null {
  if (!props.open) return null
  return <ReportIncidentForm {...props} />
}

function ReportIncidentForm({ trip, takenExceptionIds, prefill, onClose, onReported }: Props): React.JSX.Element {
  const { notify } = useToast()
  const { manifest } = useManifest(trip.id)
  const live = tripIsLive(trip.status)
  const initialType = prefill?.incidentType ?? 'parcel_shortage'
  const fromAlert = (prefill?.exceptionIds.length ?? 0) > 0
  const [incidentType, setIncidentType] = useState<IncidentType>(initialType)
  const [summary, setSummary] = useState(prefill?.summary ?? '')
  const [reporterRole, setReporterRole] = useState<IncidentReporterRole>(fromAlert ? 'freightproof' : 'client')
  const [reporterName, setReporterName] = useState('')
  const [channel, setChannel] = useState<IncidentReportChannel>(fromAlert ? 'in_app' : 'phone')
  const [occurredAt, setOccurredAt] = useState('')
  const [receivedAt, setReceivedAt] = useState('')
  const [confidence, setConfidence] = useState<IncidentConfidence>(fromAlert ? 'suspected' : 'reported')
  const [exceptionIds, setExceptionIds] = useState<string[]>(prefill?.exceptionIds ?? [])
  const [cargo, setCargo] = useState<CargoChoice>(reportDefaults(initialType, trip.status).allParcels ? 'all' : 'none')
  const [parcelIds, setParcelIds] = useState<string[]>([])
  const [stopTrip, setStopTrip] = useState(reportDefaults(initialType, trip.status).stopTrip)
  const [submitting, setSubmitting] = useState(false)

  const parcels: Parcel[] = useMemo(
    () => manifest?.consignments.flatMap(c => c.stops.flatMap(s => s.parcels)) ?? [], [manifest],
  )
  const groupable = trip.exceptions.filter(e => !NOT_GROUPABLE.has(e.exception_type) && !takenExceptionIds.has(e.id))
  const vehicles = [trip.horse?.registration, ...trip.trailers.map(t => t.registration)].filter(Boolean).join(' + ')

  const missing = !summary.trim() ? 'Describe what was reported.'
    : channel === 'in_app' && exceptionIds.length === 0 ? 'A FreightProof alert report must group at least one exception.'
    : cargo === 'chosen' && parcelIds.length === 0 ? 'Choose the affected parcels, or name none yet.'
    : null

  function chooseType(next: IncidentType): void {
    setIncidentType(next)
    const defaults = reportDefaults(next, trip.status)
    setStopTrip(defaults.stopTrip)
    setCargo(defaults.allParcels ? 'all' : 'none')
  }

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  }

  function close(): void {
    if (!submitting) onClose()
  }

  async function submit(): Promise<void> {
    if (missing || submitting) return
    setSubmitting(true)
    try {
      const incident = await reportIncident(trip.id, {
        incident_type: incidentType, summary: summary.trim(), reported_by_name: reporterName.trim() || null,
        reporter_role: reporterRole, report_channel: channel, reported_occurred_at: sastInputToIso(occurredAt),
        received_at: sastInputToIso(receivedAt), confidence, assigned_to_user_id: null, exception_ids: exceptionIds,
        parcel_ids: cargo === 'chosen' ? parcelIds : [], all_parcels: cargo === 'all', stop_trip: live && stopTrip,
      })
      notify({ kind: 'success', title: `${incident.reference} recorded${incident.trip_stopped_at ? ' and trip stopped' : ''}` })
      onReported(incident)
    } catch (err) {
      const detail = err instanceof ApiError && (err.status === 409 || err.status === 422) ? err.message : 'Please try again.'
      notify({ kind: 'error', title: 'Could not record the incident', body: detail })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={close} closeDisabled={submitting} size="lg" title="Report incident">
      <p className="mb-4 text-[13px] leading-relaxed text-on-surf-v">
        Record what you were told, by whom and when. This is kept as a report: it does not confirm a theft.
        Every later finding is added to the incident; nothing here is overwritten.
      </p>
      <div className="flex flex-col gap-3">
        <Select label="Incident type" value={incidentType} onChange={e => chooseType(e.target.value as IncidentType)}>
          {(Object.keys(INCIDENT_TYPE_LABELS) as IncidentType[]).map(t => <option key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</option>)}
        </Select>
        <TextArea label="What was reported" value={summary} onChange={e => setSummary(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Reported by" value={reporterRole} onChange={e => setReporterRole(e.target.value as IncidentReporterRole)}>
            {(Object.keys(REPORTER_ROLE_LABELS) as IncidentReporterRole[]).map(r => <option key={r} value={r}>{REPORTER_ROLE_LABELS[r]}</option>)}
          </Select>
          <Input label="Reporter's name (optional)" value={reporterName} onChange={e => setReporterName(e.target.value)} />
          <Select label="How it reached us" value={channel} onChange={e => setChannel(e.target.value as IncidentReportChannel)}>
            {(Object.keys(REPORT_CHANNEL_LABELS) as IncidentReportChannel[]).map(c => <option key={c} value={c}>{REPORT_CHANNEL_LABELS[c]}</option>)}
          </Select>
          <Select label="Confidence" value={confidence} helperText={CONFIDENCE_HELP[confidence]} onChange={e => setConfidence(e.target.value as IncidentConfidence)}>
            {(Object.keys(CONFIDENCE_LABELS) as IncidentConfidence[]).map(c => <option key={c} value={c}>{CONFIDENCE_LABELS[c]}</option>)}
          </Select>
          <Input label="When it reportedly happened" type="datetime-local" helperText="Leave blank if the reporter could not say." value={occurredAt} onChange={e => setOccurredAt(e.target.value)} />
          <Input label="When we were told" type="datetime-local" helperText="Leave blank for now." value={receivedAt} onChange={e => setReceivedAt(e.target.value)} />
        </div>

        <fieldset className="rounded-md border border-outline-v/30 p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-on-surf-v">Affected vehicle and cargo</legend>
          <p className="mb-2 text-sm text-on-surf">{vehicles || 'No vehicle on record'}</p>
          <div role="radiogroup" aria-label="Affected cargo" className="flex flex-wrap gap-4 text-sm">
            {([['all', 'Whole load'], ['chosen', 'Choose parcels'], ['none', 'None named yet']] as [CargoChoice, string][]).map(([value, text]) => (
              <label key={value} className="flex items-center gap-2"><input type="radio" name="cargo" checked={cargo === value} onChange={() => setCargo(value)} />{text}</label>
            ))}
          </div>
          {cargo === 'chosen' && (parcels.length === 0
            ? <p className="mt-2 text-xs text-on-surf-v">No parcel list for this trip yet. Name the whole load, or add parcels later.</p>
            : <ul className="mt-2 max-h-48 overflow-auto text-sm">
              {parcels.map(p => (
                <li key={p.id}><label className="flex items-center gap-2 py-1">
                  <input type="checkbox" checked={parcelIds.includes(p.id)} onChange={() => setParcelIds(ids => toggle(ids, p.id))} />
                  <span className="tabular-nums">{p.barcode}</span>
                  <span className="text-xs text-on-surf-v">{p.pp_scan_in_at ? 'scanned in' : p.pp_scan_out_at ? 'no scan-in recorded' : 'no scan recorded'}</span>
                </label></li>
              ))}
            </ul>)}
        </fieldset>

        {groupable.length > 0 && <fieldset className="rounded-md border border-outline-v/30 p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-on-surf-v">Exceptions this incident groups</legend>
          <ul className="max-h-40 overflow-auto text-sm">
            {groupable.map(e => (
              <li key={e.id}><label className="flex items-start gap-2 py-1">
                <input type="checkbox" className="mt-1" checked={exceptionIds.includes(e.id)} onChange={() => setExceptionIds(ids => toggle(ids, e.id))} />
                <span><strong className="font-semibold">{fmtExceptionType(e.exception_type)}</strong> <span className="text-on-surf-v">{exceptionDescriptionText(e)}</span></span>
              </label></li>
            ))}
          </ul>
        </fieldset>}

        {live && <div className="flex items-start justify-between gap-4 rounded-md bg-surf-low p-3">
          <div className="text-sm">
            <p className="font-semibold text-on-surf">Stop this trip</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surf-v">
              The trip ends now and the driver&apos;s app stops asking for steps. Evidence already captured is kept. Reports still
              queued on the phone are still accepted; step submissions it can no longer make are kept on the phone, not lost. This cannot be undone.
            </p>
          </div>
          <Switch checked={stopTrip} onCheckedChange={setStopTrip} ariaLabel="Stop this trip" />
        </div>}
      </div>
      <div className="mt-5 flex flex-col gap-2">
        {missing && <p className="text-xs text-on-surf-v" role="status">{missing}</p>}
        <Button full loading={submitting} disabled={missing !== null || submitting} variant={live && stopTrip ? 'danger' : 'primary'} onClick={submit}>
          {live && stopTrip ? 'Record incident and stop trip' : 'Record incident'}
        </Button>
        <Button variant="secondary" full onClick={close} disabled={submitting}>Cancel</Button>
      </div>
    </Modal>
  )
}
