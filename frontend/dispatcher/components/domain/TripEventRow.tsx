'use client'

import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { IncidentStatusChip } from '@/components/incidents/IncidentStatusChip'
import { INCIDENT_TYPE_LABELS } from '@/lib/format/incident'
import { fmtCompletionMode } from '@/lib/format/driver-transfer'
import { SERVER_CLOCK } from '@/lib/phase/act-wording'
import type { TripEventAct } from '@/lib/phase/acts'
import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import type { IncidentSummary } from '@/lib/types/incident'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { COMPACT_HIT_AREA, COMPACT_SUBGRID, CompactActLine } from './CompactActLine'
import { EXCEPTION_SELECTED_SURFACE, EXCEPTION_SELECTION_OUTLINE } from './ExceptionRow'

/** What a trip-event row does when activated: the page shows the incident, or the handover evidence. */
export interface TripEventHandlers {
  onOpenIncident: (incidentId: string) => void
  onOpenTransfer: (substitutionId: string) => void
  selectedIncidentId?: string | null
}

const ROW_BASE = 'relative block min-h-11 w-full min-w-0 rounded-md px-3 py-2 text-left transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec'
const LIVE_INCIDENT = 'border border-err/60 hover:border-err'
const CLOSED_INCIDENT = 'border border-outline-v/40 hover:border-outline'
const LIVE_SURFACE = 'bg-err-c/30'
const CLOSED_SURFACE = 'bg-surf-lowest'
const SELECTED = `${EXCEPTION_SELECTED_SURFACE} ${EXCEPTION_SELECTION_OUTLINE}`
const TRANSFER = '-mx-3 hover:bg-surf'
const TIME = 'font-semibold tabular-nums tracking-[0.03em]'
const ACTION = 'mt-1 inline-flex items-center gap-1 text-meta font-semibold text-sec'
const COMPACT_BUTTON = `${COMPACT_SUBGRID} ${COMPACT_HIT_AREA} relative w-full rounded text-left text-on-surf hover:bg-sec-c/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec`

function incidentTitle(incident: IncidentSummary): string {
  return `${incident.reference} · ${INCIDENT_TYPE_LABELS[incident.incident_type]}`
}

function incidentDetails(incident: IncidentSummary): string {
  return [
    incident.parcels_total > 0 ? `${incident.parcels_unresolved} of ${incident.parcels_total} ${incident.parcels_total === 1 ? 'parcel' : 'parcels'} unresolved` : null,
    incident.assigned_to_name,
  ].filter(Boolean).join(' · ')
}

function transferNames(transfer: CompletedSubstitutionSummary): string {
  return `${transfer.outgoing.full_name} → ${transfer.incoming.full_name}`
}

function IncidentBody({ incident, at, selected, onOpen }: { incident: IncidentSummary; at: string; selected: boolean; onOpen: (id: string) => void }) {
  const live = incident.status !== 'closed'
  const details = incidentDetails(incident)
  const surface = selected ? SELECTED : live ? LIVE_SURFACE : CLOSED_SURFACE
  return (
    <button type="button" data-incident-id={incident.incident_id} onClick={() => onOpen(incident.incident_id)}
      aria-current={selected ? 'true' : undefined} data-selected={selected ? 'true' : undefined}
      aria-label={`Incident ${incidentTitle(incident)}. Open incident`}
      className={`${ROW_BASE} ${live ? LIVE_INCIDENT : CLOSED_INCIDENT} ${surface}`}>
      <span className="flex flex-wrap items-center gap-1.5 text-body font-semibold text-on-surf">
        {incidentTitle(incident)}
        <IncidentStatusChip status={incident.status} />
        {incident.trip_stopped_at && <Chip type="critical" label={`Trip stopped ${fmtDateTime(incident.trip_stopped_at)}`} />}
      </span>
      <span className="block text-meta text-on-surf-v"><span className={TIME}>Reported {fmtDateTime(at)}</span>{details && ` · ${details}`}</span>
      <span className="mt-0.5 line-clamp-2 text-body text-on-surf">{incident.summary}</span>
      <span className={ACTION}>Open incident <Ic n="chev" s={11} /></span>
    </button>
  )
}

function TransferBody({ transfer, onOpen }: { transfer: CompletedSubstitutionSummary; onOpen: (id: string) => void }) {
  return (
    <button type="button" data-transfer-id={transfer.substitution_id} onClick={() => onOpen(transfer.substitution_id)}
      aria-haspopup="dialog" aria-label={`Driver transferred, ${transferNames(transfer)}. View handover`}
      className={`${ROW_BASE} ${TRANSFER}`}>
      <span className="block text-body font-semibold text-on-surf">Driver transferred</span>
      <span className="block text-body text-on-surf-v">{transferNames(transfer)}</span>
      <span className="block text-meta text-on-surf-v">
        <span className={TIME}>{fmtDateTime(transfer.effective_at)} {SERVER_CLOCK}</span>
        {' · '}{fmtCompletionMode(transfer.completion_mode, transfer.request_format)}
      </span>
      <span className={ACTION}>View handover <Ic n="chev" s={11} /></span>
    </button>
  )
}

interface Props {
  act: TripEventAct
  handlers: TripEventHandlers
  density?: 'compact' | 'full'
  connectToNext?: boolean
}

/** An incident or a driver transfer on an In Transit card's Recorded rail. The whole row is a button:
 *  an incident opens in the Info panel, a transfer opens its handover evidence, as they did when they
 *  were drawn between the cards. */
export function TripEventRow({ act, handlers, density = 'full', connectToNext = false }: Props) {
  const { event } = act
  if (density === 'compact') {
    const incident = event.kind === 'incident' ? event.incident : null
    const selected = incident !== null && incident.incident_id === handlers.selectedIncidentId
    return (
      <button type="button" aria-current={selected ? 'true' : undefined} data-selected={selected ? 'true' : undefined} onClick={() => incident ? handlers.onOpenIncident(incident.incident_id) : event.kind === 'transfer' && handlers.onOpenTransfer(event.transfer.substitution_id)}
        aria-label={incident ? `Incident ${incidentTitle(incident)}. Open incident` : event.kind === 'transfer' ? `Driver transferred, ${transferNames(event.transfer)}. View handover` : undefined}
        className={`${COMPACT_BUTTON} ${selected ? SELECTED : ''}`}>
        <CompactActLine times={[{ at: act.at, source: 'server' }]} icon={incident ? 'siren' : 'swap'}
          iconClassName={incident && incident.status !== 'closed' ? 'text-err' : 'text-on-surf-v'} connectToNext={connectToNext}>
          {incident
            ? <><span className="font-semibold">{incidentTitle(incident)}</span>{incident.trip_stopped_at ? ' · Trip stopped' : ''}</>
            : event.kind === 'transfer' && <><span className="font-semibold">Driver transferred</span> · {transferNames(event.transfer)}</>}
        </CompactActLine>
      </button>
    )
  }
  return event.kind === 'incident'
    ? <IncidentBody incident={event.incident} at={act.at} selected={event.incident.incident_id === handlers.selectedIncidentId} onOpen={handlers.onOpenIncident} />
    : <TransferBody transfer={event.transfer} onOpen={handlers.onOpenTransfer} />
}
