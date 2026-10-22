'use client'

import { ROUTES } from '@/lib/constants/routes'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import type { BookingRow, BookingsCard, ChooseCard, FreeCrewCard, HistoryCard, RecordRef } from '@shared/lib/types/assistant'
import { ASSISTANT_COPY, CREW_GROUP_TITLES } from '../assistantCopy'
import { CardLink, CardShell, Muted, fmtWindow, hrefFor, type CardProps } from './parts'

/** "until 22 Oct, 06:00 SAST", or "until the trip is closed (was due 30 Jul, 18:00 SAST)" for a live trip past its end. */
function busyEnd(row: BookingRow): string {
  if (row.busy_until !== null) return `until ${fmtDateTime(row.busy_until)}`
  const due = row.planned_until ? ` (${ASSISTANT_COPY.wasDue(fmtDateTime(row.planned_until))})` : ''
  return `${ASSISTANT_COPY.untilClosed}${due}`
}

export function BookingLine({ row, onNavigate }: { row: BookingRow } & CardProps) {
  return (
    <li className="flex flex-col gap-0.5">
      <span>
        <CardLink href={ROUTES.tripDetail(row.trip_id)} onNavigate={onNavigate}>{row.trip_reference}</CardLink>
        {' '}<Muted>{row.origin} → {row.destination}</Muted>
      </span>
      <Muted>From {fmtDateTime(row.busy_from)}, {busyEnd(row)}</Muted>
    </li>
  )
}

function RecordName({ record, onNavigate }: { record: RecordRef } & CardProps) {
  return (
    <>
      <CardLink href={hrefFor(record)} onNavigate={onNavigate}>{record.label}</CardLink>
      {record.is_active === false && <Muted> ({ASSISTANT_COPY.inactive})</Muted>}
    </>
  )
}

export function BookingsCardView({ card, onNavigate }: { card: BookingsCard } & CardProps) {
  return (
    <CardShell title={<RecordName record={card.who} onNavigate={onNavigate} />}>
      <Muted>{fmtWindow(card.window_start, card.window_end)}</Muted>
      {card.bookings.length === 0 ? (
        <span className="font-[600]">{ASSISTANT_COPY.nothingBooked}</span>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {card.bookings.map((row) => <BookingLine key={`${row.trip_id}-${row.busy_from}`} row={row} onNavigate={onNavigate} />)}
        </ul>
      )}
    </CardShell>
  )
}

export function FreeCrewCardView({ card, onNavigate }: { card: FreeCrewCard } & CardProps) {
  return (
    <CardShell title={fmtWindow(card.window_start, card.window_end)}>
      {card.groups.map((group) => (
        <div key={group.kind} className="flex flex-col gap-1">
          <span className="font-[700]">{CREW_GROUP_TITLES[group.kind]}</span>
          <span>
            <Muted>{ASSISTANT_COPY.nothingBooked}: </Muted>
            {group.nothing_booked.length === 0 ? <Muted>none</Muted> : group.nothing_booked.map((record, index) => (
              <span key={record.id}>{index > 0 && ', '}<CardLink href={hrefFor(record)} onNavigate={onNavigate}>{record.label}</CardLink></span>
            ))}
          </span>
          {group.booked.map((booked) => (
            <span key={booked.who.id}>
              <CardLink href={hrefFor(booked.who)} onNavigate={onNavigate}>{booked.who.label}</CardLink>
              <Muted>
                {' '}booked: {booked.bookings.map((row) => `${row.trip_reference}, ${busyEnd(row)}`).join('; ')}
              </Muted>
            </span>
          ))}
        </div>
      ))}
    </CardShell>
  )
}

interface ChooseCardViewProps {
  card: ChooseCard
  /** Ask again, meaning exactly this record ("I mean Tim Giltig"). */
  onChoose: (record: RecordRef) => void
  disabled: boolean
}

export function ChooseCardView({ card, onChoose, disabled }: ChooseCardViewProps) {
  return (
    <CardShell title={ASSISTANT_COPY.which(card.what)}>
      <div className="flex flex-wrap gap-1.5">
        {card.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(option)}
            className="rounded-md border border-outline-v/40 px-2.5 py-1.5 text-left font-[600] text-on-surf hover:bg-surf-low disabled:opacity-40"
          >
            {option.label}
            {option.detail && <Muted className="font-[400]"> · {option.detail}</Muted>}
            {option.is_active === false && <Muted className="font-[400]"> · {ASSISTANT_COPY.inactive}</Muted>}
          </button>
        ))}
      </div>
      {card.more > 0 && <Muted>{ASSISTANT_COPY.more(card.more)}</Muted>}
    </CardShell>
  )
}

export function HistoryCardView({ card, onNavigate }: { card: HistoryCard } & CardProps) {
  const span = card.window_start && card.window_end ? fmtWindow(card.window_start, card.window_end) : ASSISTANT_COPY.allTime
  return (
    <CardShell title={<RecordName record={card.who} onNavigate={onNavigate} />}>
      <Muted>{span}</Muted>
      <span className="font-[600]">{ASSISTANT_COPY.historyCounts(card.total, card.completed, card.cancelled, card.live, card.booked)}</span>
      {card.recent.length > 0 && (
        <ul className="flex flex-col gap-1">
          {card.recent.map((row) => (
            <li key={row.trip_id} className="flex flex-col gap-0.5">
              <span>
                <CardLink href={ROUTES.tripDetail(row.trip_id)} onNavigate={onNavigate}>{row.trip_reference}</CardLink>
                {' '}<Muted>{TRIP_STATUS_META[row.status].label} · {row.origin} → {row.destination}</Muted>
              </span>
              <Muted>{fmtDateTime(row.happened_at)}</Muted>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  )
}
