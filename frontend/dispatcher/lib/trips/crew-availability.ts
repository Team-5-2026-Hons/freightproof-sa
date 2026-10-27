// Who is busy, as the create-trip screen shows it (FP-139, FP-142). Pure: no React, no I/O.
// The rule itself lives on the server (orchestration/trips/availability.py). This module only
// turns its answer into greyed-out options, short notes and field errors, so the screen can
// never disagree with what POST /trips would refuse.

import type { BusyEntry } from '@shared/lib/types/availability'
import { OPERATIONS_TIMEZONE } from '@shared/lib/utils/datetime'
import { sastInputToIso, type CrewValues, type FieldErrors, type TimeInputs } from '@/lib/trips/manifest-form'

export const CREW_AVAILABILITY_COPY = {
  needTimes: 'Enter departure and arrival to see who is free.',
  checking: 'Checking who is free in this window…',
  unchecked: "Couldn't check who is free. Creating will still refuse a clash.",
} as const

/** One entry per busy driver, horse or trailer id. */
export type BusyById = ReadonlyMap<string, BusyEntry>

export const NOBODY_BUSY: BusyById = new Map()

/** The window to ask about: both times entered and in order, else null (nothing to ask yet). */
export interface AvailabilityWindow {
  startIso: string
  endIso: string
}

export function availabilityWindow(shown: TimeInputs): AvailabilityWindow | null {
  if (!shown.departure || !shown.arrival) return null
  const startIso = sastInputToIso(shown.departure)
  const endIso = sastInputToIso(shown.arrival)
  return new Date(endIso).getTime() > new Date(startIso).getTime() ? { startIso, endIso } : null
}

/** A resource can be busy on more than one trip in the window. Show the one that frees it last:
 *  "how much longer is it unavailable" is the question the dispatcher is asking. */
export function busyById(busy: readonly BusyEntry[]): Map<string, BusyEntry> {
  const byId = new Map<string, BusyEntry>()
  for (const entry of busy) {
    const current = byId.get(entry.resource_id)
    if (!current || freesLater(entry, current)) byId.set(entry.resource_id, entry)
  }
  return byId
}

function freesLater(a: BusyEntry, b: BusyEntry): boolean {
  if (a.busy_until === null) return b.busy_until !== null
  if (b.busy_until === null) return false
  return new Date(a.busy_until).getTime() > new Date(b.busy_until).getTime()
}

const FREE_AT_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: OPERATIONS_TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** "Fri 16 Oct, 16:00": the same wording the server's 409 message uses. */
export function fmtFreeAt(iso: string): string {
  const parts = FREE_AT_FORMAT.formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(p => p.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}`
}

function isLive(entry: BusyEntry): boolean {
  return entry.trip_status === 'active' || entry.trip_status === 'exception_hold'
}

/** The short line under a greyed-out option. */
export function busyNote(entry: BusyEntry): string {
  if (entry.busy_until !== null) return `On ${entry.trip_reference} · free after ${fmtFreeAt(entry.busy_until)}`
  if (isLive(entry)) return `On ${entry.trip_reference} · under way, free when it closes`
  return `On ${entry.trip_reference} · no planned arrival, free when it is closed`
}

/** The field error when something already picked turns out to be busy (the times changed). */
export function pickedBusyError(entry: BusyEntry): string {
  const where = entry.busy_until !== null
    ? `on ${entry.trip_reference} until ${fmtFreeAt(entry.busy_until)}`
    : isLive(entry)
      ? `on ${entry.trip_reference}, which is still under way`
      : `on ${entry.trip_reference}, which has no planned arrival`
  return `${entry.label} is busy in this window: ${where}. Pick another, or change the times.`
}

/** Field errors for picked crew that is busy in the window. Create stays blocked until fixed. */
export function validateCrewAvailability(crew: CrewValues, busy: BusyById): FieldErrors {
  const errors: FieldErrors = {}
  const driver = busy.get(crew.driverId)
  if (driver) errors.driver = pickedBusyError(driver)
  const horse = busy.get(crew.horseId)
  if (horse) errors.horse = pickedBusyError(horse)
  const trailer = crew.trailerIds.map(id => busy.get(id)).find(entry => entry !== undefined)
  if (trailer) errors.trailers = pickedBusyError(trailer)
  return errors
}
