'use client'

import { Chip } from '@/components/ui/Chip'
import { ROUTES } from '@/lib/constants/routes'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type {
  IncidentListCard, IncidentRow, ReviewQueueCard, TripCard, TripListCard, TripRow,
} from '@shared/lib/types/assistant'
import { ASSISTANT_COPY, delayWords, words } from '../assistantCopy'
import { CardLink, CardShell, Muted, ReviewCounts, fmtWindow, type CardProps } from './parts'

function StatusChip({ row }: { row: Pick<TripRow, 'status'> }) {
  const meta = TRIP_STATUS_META[row.status]
  return <Chip type={meta.chipType} label={meta.label} />
}

function TripLine({ row, onNavigate }: { row: TripRow } & CardProps) {
  const due = row.actual_arrival_at ?? row.planned_arrival_at
  return (
    <li className="flex flex-col gap-0.5 border-t border-outline-v/15 pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <CardLink href={ROUTES.tripDetail(row.trip_id)} onNavigate={onNavigate}>{row.trip_reference}</CardLink>
        <StatusChip row={row} />
        {row.overdue && <span className="font-[700] text-err">{ASSISTANT_COPY.overdue}</span>}
      </div>
      <span>{row.origin} → {row.destination}</span>
      <Muted>
        {row.driver} · {row.horse}
        {due && ` · ${row.actual_arrival_at ? 'arrived' : 'due'} ${fmtDateTime(due)}`}
      </Muted>
      <ReviewCounts counts={row.needs_review} />
    </li>
  )
}

export function TripListCardView({ card, onNavigate }: { card: TripListCard } & CardProps) {
  return (
    <CardShell title={`${card.title} · ${card.total}`}>
      <Muted>
        {card.on_the_road} on the road · {card.booked} booked · {card.on_hold} on hold
        {card.window_start && card.window_end && ` · ${fmtWindow(card.window_start, card.window_end)}`}
      </Muted>
      {card.rows.length === 0 ? (
        <Muted>{ASSISTANT_COPY.noTrips}</Muted>
      ) : (
        <ul className="flex flex-col gap-2">
          {card.rows.map((row) => <TripLine key={row.trip_id} row={row} onNavigate={onNavigate} />)}
        </ul>
      )}
      {card.truncated && (
        <Muted>
          {ASSISTANT_COPY.showing(card.rows.length, card.total)} ·{' '}
          {card.full_list === 'history'
            ? <CardLink href={ROUTES.history} onNavigate={onNavigate}>{ASSISTANT_COPY.openHistory}</CardLink>
            : <CardLink href={ROUTES.home} onNavigate={onNavigate}>{ASSISTANT_COPY.openDashboard}</CardLink>}
        </Muted>
      )}
    </CardShell>
  )
}

function IncidentLine({ row, onNavigate }: { row: IncidentRow } & CardProps) {
  return (
    <li className="flex flex-wrap items-center gap-1.5">
      <CardLink href={ROUTES.incidentDetail(row.incident_id)} onNavigate={onNavigate}>{row.reference}</CardLink>
      <span className="font-[600] capitalize">{words(row.incident_type)}</span>
      <Muted>
        {words(row.status)} · {row.trip_reference}
        {row.investigated_by && ` · ${ASSISTANT_COPY.withInvestigator(row.investigated_by)}`}
        {row.outcome && ` · ${words(row.outcome)}`}
      </Muted>
    </li>
  )
}

export function IncidentRows({ rows, onNavigate }: { rows: IncidentRow[] } & CardProps) {
  return <ul className="flex flex-col gap-1">{rows.map((row) => <IncidentLine key={row.incident_id} row={row} onNavigate={onNavigate} />)}</ul>
}

export function IncidentListCardView({ card, onNavigate }: { card: IncidentListCard } & CardProps) {
  return (
    <CardShell title={`${card.title} · ${card.rows.length}${card.truncated ? '+' : ''}`}>
      {card.rows.length === 0 ? <Muted>{ASSISTANT_COPY.noIncidents}</Muted> : <IncidentRows rows={card.rows} onNavigate={onNavigate} />}
      {card.truncated && <CardLink href={ROUTES.incidents} onNavigate={onNavigate}>{ASSISTANT_COPY.openIncidents}</CardLink>}
    </CardShell>
  )
}

export function ReviewQueueCardView({ card, onNavigate }: { card: ReviewQueueCard } & CardProps) {
  return (
    <CardShell title={`${ASSISTANT_COPY.reviewQueue} · ${card.total}`}>
      {card.total === 0 ? (
        <Muted>{ASSISTANT_COPY.nothingWaiting}</Muted>
      ) : (
        <>
          <ReviewCounts counts={card.by_severity} />
          <Muted>
            {ASSISTANT_COPY.claimed(card.claimed, card.unclaimed)}
            {card.on_finished_trips > 0 && ` · ${ASSISTANT_COPY.onFinishedTrips(card.on_finished_trips)}`}
          </Muted>
        </>
      )}
      <CardLink href={ROUTES.exceptions} onNavigate={onNavigate}>{ASSISTANT_COPY.openExceptions}</CardLink>
    </CardShell>
  )
}

/** "Left 25 min late · Arrived on time": only the times the trip has both a plan and a record for. */
function delayLine(card: TripCard): string | null {
  const parts = [
    card.departure_delay_minutes !== null && `${ASSISTANT_COPY.left} ${delayWords(card.departure_delay_minutes)}`,
    card.arrival_delay_minutes !== null && `${ASSISTANT_COPY.arrived} ${delayWords(card.arrival_delay_minutes)}`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** The trip page's Record integrity tally. Stored receipts only: it never claims the record is verified. */
function IntegrityLine({ card }: { card: TripCard }) {
  return (
    <span>
      <span className={card.journey_lock_anchored ? 'font-[600]' : 'font-[600] text-warn'}>
        {card.journey_lock_anchored ? ASSISTANT_COPY.lockAnchored : ASSISTANT_COPY.lockNotAnchored}
      </span>
      {card.receipts_owed > 0 && <Muted> · {ASSISTANT_COPY.receipts(card.receipts_anchored, card.receipts_owed)}</Muted>}
      {card.receipts_failed > 0 && <span className="font-[600] text-err"> · {ASSISTANT_COPY.receiptsFailed(card.receipts_failed)}</span>}
    </span>
  )
}

export function TripCardView({ card, onNavigate }: { card: TripCard } & CardProps) {
  const { trip } = card
  return (
    <CardShell
      title={(
        <span className="flex flex-wrap items-center gap-1.5">
          <CardLink href={ROUTES.tripDetail(trip.trip_id)} onNavigate={onNavigate}>{trip.trip_reference}</CardLink>
          <StatusChip row={trip} />
          {trip.overdue && <span className="font-[700] text-err">{ASSISTANT_COPY.overdue}</span>}
        </span>
      )}
    >
      <span>{card.stops.join(' → ')}</span>
      <span>
        <CardLink href={ROUTES.fleetDriverDetail(trip.driver_id)} onNavigate={onNavigate}>{trip.driver}</CardLink>
        {card.original_driver && <Muted> ({ASSISTANT_COPY.tookOver(card.original_driver)})</Muted>}
        {' · '}
        <CardLink href={ROUTES.fleetVehicleDetail(trip.horse_id)} onNavigate={onNavigate}>{trip.horse}</CardLink>
        {trip.trailers.length > 0 && <Muted> + {trip.trailers.join(', ')}</Muted>}
      </span>
      {trip.current_phase && (
        <Muted>{words(trip.current_phase)} · {trip.phase_completed} of {trip.phase_total} steps done</Muted>
      )}
      <Muted>
        Departure {fmtDateTime(trip.actual_departure_at ?? trip.planned_departure_at)} · Arrival{' '}
        {fmtDateTime(trip.actual_arrival_at ?? trip.planned_arrival_at)}
      </Muted>
      {delayLine(card) && <Muted>{delayLine(card)}</Muted>}
      {card.delivery_confirmed_at && <Muted>{ASSISTANT_COPY.deliveryConfirmed} {fmtDateTime(card.delivery_confirmed_at)}</Muted>}
      {card.closed_at && <Muted>{ASSISTANT_COPY.closed} {fmtDateTime(card.closed_at)}</Muted>}
      {trip.manifest && <Muted>Manifest {trip.manifest}</Muted>}
      {/* An empty leg carries no parcels, so it gets no parcels line unless something was scanned anyway. */}
      {(card.parcels_booked !== null || card.parcels_scanned_out > 0 || card.parcels_scanned_in > 0) && (
        <Muted>{ASSISTANT_COPY.parcels(card.parcels_booked, card.parcels_scanned_out, card.parcels_scanned_in)}</Muted>
      )}
      <IntegrityLine card={card} />
      <Muted className="text-[11px]">{ASSISTANT_COPY.integrityNote}</Muted>
      <ReviewCounts counts={trip.needs_review} />
      {card.open_incidents.length > 0 && <IncidentRows rows={card.open_incidents} onNavigate={onNavigate} />}
    </CardShell>
  )
}
