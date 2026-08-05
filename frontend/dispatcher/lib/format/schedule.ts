// Planned-versus-actual arithmetic for the trip schedule.
//
// Pure and module-scoped rather than page-local so the sign convention is provable: a
// positive delay is LATE, and getting that backwards would report a truck that arrived
// two hours early as two hours late on the one screen a dispatcher checks it on.

const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60

/** Signed lateness in whole minutes — positive is late. Null when either end is absent. */
export function delayMinutes(planned: string | null, actual: string | null): number | null {
  if (planned === null || actual === null) return null
  return Math.round((new Date(actual).getTime() - new Date(planned).getTime()) / MS_PER_MINUTE)
}

/** "2 h 15 m late" / "40 m early" / "On time". */
export function fmtDelay(minutes: number): string {
  if (minutes === 0) return 'On time'

  const total = Math.abs(minutes)
  const hours = Math.floor(total / MINUTES_PER_HOUR)
  const mins = total % MINUTES_PER_HOUR
  const span = hours > 0
    ? `${hours} h${mins > 0 ? ` ${mins} m` : ''}`
    : `${mins} m`

  return `${span} ${minutes > 0 ? 'late' : 'early'}`
}
