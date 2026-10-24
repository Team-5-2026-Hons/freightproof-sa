'use client'

import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'
import { fmtCalendarDate, fmtDateTime } from '@shared/lib/utils/datetime'
import type {
  DiscState, DocumentKind, ExpiryListCard, ParcelCard, RosterCard, RosterGroupCard, RosterKind, RouteTimeCard, VehicleCard,
} from '@shared/lib/types/assistant'
import { ASSISTANT_COPY, DISC_WORDS, ROSTER_TITLES, fmtMinutes, words } from '../assistantCopy'
import { BookingLine } from './CrewCards'
import { CardLink, CardShell, Muted, ReviewCounts, hrefFor, type CardProps } from './parts'
import { IncidentRows } from './TripCards'

const DISC_COLOURS: Record<DiscState, string> = {
  expired: 'text-err', expiring: 'text-warn', ok: 'text-on-surf', unknown: 'text-on-surf-v',
}

/** "Volvo FH16 2021 · 16 m · 56000 kg GVM": what the vehicle page's Details panel shows, the parts recorded. */
function specsLine(card: VehicleCard): string | null {
  const name = [card.make, card.model, card.year].filter((part) => part !== null).join(' ')
  const parts = [
    name,
    card.length_m !== null && `${card.length_m} m`,
    card.gross_vehicle_mass_kg !== null && `${card.gross_vehicle_mass_kg} kg GVM`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function VehicleCardView({ card, onNavigate }: { card: VehicleCard } & CardProps) {
  const expiry = fmtCalendarDate(card.licence_disc_expiry)
  return (
    <CardShell
      title={(
        <span>
          <CardLink href={hrefFor(card.vehicle)} onNavigate={onNavigate}>{card.vehicle.label}</CardLink>
          {card.vehicle.detail && <Muted className="font-[400]"> · {card.vehicle.detail}</Muted>}
          {card.vehicle.is_active === false && <Muted className="font-[400]"> · {ASSISTANT_COPY.inactive}</Muted>}
        </span>
      )}
    >
      {specsLine(card) && <Muted>{specsLine(card)}</Muted>}
      <span className={cn('font-[600]', DISC_COLOURS[card.disc_state])}>
        {DISC_WORDS[card.disc_state]}{expiry && ` · ${expiry}`}
      </span>
      {card.on_trip_now.length > 0 && (
        <ul className="flex flex-col gap-1">
          {card.on_trip_now.map((row) => <BookingLine key={row.trip_id} row={row} onNavigate={onNavigate} />)}
        </ul>
      )}
      <span>
        <Muted>{ASSISTANT_COPY.aboutVehicle}: </Muted>
        <ReviewCounts counts={card.exceptions_to_review} empty={ASSISTANT_COPY.nothingToReview} />
        {card.exception_types.length > 0 && <Muted> ({card.exception_types.map(words).join(', ')})</Muted>}
      </span>
      <span>
        <Muted>{ASSISTANT_COPY.onItsTrips}: </Muted>
        <ReviewCounts counts={card.trip_exceptions_to_review} empty={ASSISTANT_COPY.nothingToReview} />
      </span>
      <Muted>{ASSISTANT_COPY.breakdowns(card.recent_breakdowns)}</Muted>
      {card.open_incidents.length > 0 && <IncidentRows rows={card.open_incidents} onNavigate={onNavigate} />}
      <Muted className="text-[11px]">{ASSISTANT_COPY.notRecorded}</Muted>
    </CardShell>
  )
}

const DOCUMENT_WORDS: Record<DocumentKind, string> = { driver_licence: 'licence', vehicle_disc: 'disc' }

export function ExpiryListCardView({ card, onNavigate }: { card: ExpiryListCard } & CardProps) {
  const title = card.within_days === null
    ? ASSISTANT_COPY.expiryOne
    : `${ASSISTANT_COPY.expiryWithin(card.within_days)} · ${card.rows.length}`
  return (
    <CardShell title={title}>
      {card.rows.length === 0 ? (
        <Muted>{ASSISTANT_COPY.nothingExpiring}</Muted>
      ) : (
        <ul className="flex flex-col gap-1">
          {card.rows.map((row) => (
            <li key={`${row.document}-${row.record.id}`} className="flex flex-wrap items-center gap-1.5">
              <CardLink href={hrefFor(row.record)} onNavigate={onNavigate}>{row.record.label}</CardLink>
              <Muted>{DOCUMENT_WORDS[row.document]}</Muted>
              {row.expiry === null ? (
                <Muted>{ASSISTANT_COPY.noDate}</Muted>
              ) : (
                <span className={row.expired ? 'font-[600] text-err' : 'text-warn'}>
                  {row.expired ? 'expired' : 'expires'} {fmtCalendarDate(row.expiry)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {card.without_date > 0 && card.within_days !== null && <Muted>{ASSISTANT_COPY.withoutDate(card.without_date)}</Muted>}
      {card.truncated && <Muted>{ASSISTANT_COPY.moreExpiring}</Muted>}
    </CardShell>
  )
}

export function RouteTimeCardView({ card, onNavigate }: { card: RouteTimeCard } & CardProps) {
  return (
    <CardShell
      title={(
        <span>
          <CardLink href={hrefFor(card.origin)} onNavigate={onNavigate}>{card.origin.label}</CardLink>
          {' → '}
          <CardLink href={hrefFor(card.destination)} onNavigate={onNavigate}>{card.destination.label}</CardLink>
        </span>
      )}
    >
      {card.driving_minutes !== null ? (
        <span>
          <span className="font-[700]">{ASSISTANT_COPY.driving}: {fmtMinutes(card.driving_minutes)}</span>
          {card.distance_km !== null && <Muted> · {card.distance_km} km</Muted>}
          <Muted> ({ASSISTANT_COPY.drivingNote})</Muted>
        </span>
      ) : (
        <Muted>{card.driving_unavailable}</Muted>
      )}
      {card.history_left_out ? (
        <Muted>{ASSISTANT_COPY.historyLeftOut}</Muted>
      ) : card.past_trip_count === 0 ? (
        <Muted>{ASSISTANT_COPY.noHistory}</Muted>
      ) : (
        <span>
          <span className="font-[600]">{ASSISTANT_COPY.pastTrips(card.past_trip_count)}</span>
          {card.typical_minutes !== null && <Muted> · {ASSISTANT_COPY.typical} {fmtMinutes(card.typical_minutes)}</Muted>}
          {card.slow_minutes !== null && <Muted> · {ASSISTANT_COPY.slow} {fmtMinutes(card.slow_minutes)}</Muted>}
        </span>
      )}
    </CardShell>
  )
}

function parcelsHref(card: ParcelCard): string {
  const params = new URLSearchParams({ waybill: card.waybill })
  if (card.barcode) params.set('barcode', card.barcode)
  return `${ROUTES.parcels}?${params.toString()}`
}

export function ParcelCardView({ card, onNavigate }: { card: ParcelCard } & CardProps) {
  return (
    <CardShell title={card.barcode ? `Parcel ${card.barcode} · waybill ${card.waybill}` : `Waybill ${card.waybill}`}>
      <ul className="flex flex-col gap-1.5">
        {card.journeys.map((journey) => (
          <li key={journey.trip_id} className="flex flex-col gap-0.5">
            <span>
              <CardLink href={ROUTES.tripDetail(journey.trip_id)} onNavigate={onNavigate}>{journey.trip_reference}</CardLink>
              {' '}<Muted>{journey.origin} → {journey.destination}</Muted>
            </span>
            <Muted>
              {[journey.position && words(journey.position), journey.phase, journey.last_depot && `last at ${journey.last_depot}`,
                journey.last_recorded_at && fmtDateTime(journey.last_recorded_at)].filter(Boolean).join(' · ')}
            </Muted>
          </li>
        ))}
      </ul>
      <CardLink href={parcelsHref(card)} onNavigate={onNavigate}>{ASSISTANT_COPY.openParcel}</CardLink>
    </CardShell>
  )
}

const ROSTER_PAGES: Record<RosterKind, { href: string; name: string }> = {
  driver: { href: ROUTES.fleetDrivers, name: 'Drivers' },
  horse: { href: ROUTES.fleetVehicles, name: 'Vehicles' },
  trailer: { href: ROUTES.fleetVehicles, name: 'Vehicles' },
  depot: { href: ROUTES.precincts, name: 'Precincts' },
}

function RosterGroupView({ group, onNavigate }: { group: RosterGroupCard } & CardProps) {
  const page = ROSTER_PAGES[group.kind]
  return (
    <div className="flex flex-col gap-1">
      <span>
        <span className="font-[700]">{ROSTER_TITLES[group.kind]}</span>{' '}
        <Muted>
          {group.inactive_total === null
            ? ASSISTANT_COPY.activeOnly(group.active_total)
            : ASSISTANT_COPY.activeInactive(group.active_total, group.inactive_total)}
        </Muted>
      </span>
      {group.depots.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {group.depots.map((line) => (
            <li key={line.depot.id}>
              <CardLink href={hrefFor(line.depot)} onNavigate={onNavigate}>{line.depot.label}</CardLink>
              {line.address && <Muted> · {line.address}</Muted>}
              {!line.owned && <Muted> ({ASSISTANT_COPY.sharedWithUs})</Muted>}
            </li>
          ))}
        </ul>
      )}
      {group.records.length > 0 && (
        <span className="flex flex-wrap gap-x-2 gap-y-0.5">
          {group.records.map((record) => (
            <CardLink key={record.id} href={hrefFor(record)} onNavigate={onNavigate}>{record.label}</CardLink>
          ))}
        </span>
      )}
      {group.truncated && <CardLink href={page.href} onNavigate={onNavigate}>{ASSISTANT_COPY.seeAllOn(page.name)}</CardLink>}
    </div>
  )
}

export function RosterCardView({ card, onNavigate }: { card: RosterCard } & CardProps) {
  return (
    <CardShell title={card.groups.map((group) => ROSTER_TITLES[group.kind]).join(' · ')}>
      {card.groups.map((group) => <RosterGroupView key={group.kind} group={group} onNavigate={onNavigate} />)}
    </CardShell>
  )
}
