// Date and time formatting for the dispatcher UI: one timezone, one wording.
//
// Every formatter here is built from the same formatToParts core, so a date can never read one
// way in a table and another way in a timeline. Operations run on South African time whatever
// the viewer's machine says, so an instant is always shown in SAST and says so.
//
// Extracted because files had grown private copies of the same few lines, which is how they
// ended up showing a different format (and "Sept" vs "Sep") for the same field.

export const OPERATIONS_TIMEZONE = 'Africa/Johannesburg'
// South Africa has had no daylight saving since 1944, so SAST is a fixed +02:00 and a wall-clock
// time can be turned into an instant without a timezone database. Keep in step with
// OPERATIONS_TIMEZONE if that ever changes.
export const SAST_OFFSET = '+02:00'
const TIMEZONE_LABEL = 'SAST'
const MISSING = '—'

// Numeric month and h23 so nothing depends on locale wording; month names come from the table
// below. Intl's own short month differs by ICU version ("Sept" vs "Sep" for en-GB).
const SAST_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: OPERATIONS_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

interface SastFields { day: string; month: string; year: string; time: string }

/** The pieces of an instant in SAST, or null when it is missing or unparseable. Built from
 *  formatToParts, never by splitting a formatted string: the date/time separator is locale data
 *  (", " in older ICU, " at " in newer), so a split silently fails in some browsers. */
function sastFields(iso: string | null | undefined): SastFields | null {
  if (!iso) return null
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  const parts = SAST_FORMAT.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(p => p.type === type)?.value ?? ''
  const month = MONTH_ABBREVIATIONS[Number(part('month')) - 1]
  return { day: part('day'), month, year: part('year'), time: `${part('hour')}:${part('minute')}` }
}

/** The SAST calendar day of an instant as "YYYY-MM-DD" (zero-padded, so it also sorts as a plain
 *  string), or null when unparseable. The one place a calendar day is derived from an instant: a
 *  UTC or browser-local day is wrong for the two hours after 22:00Z, when SAST has already rolled
 *  over. */
export function sastCalendarDay(iso: string | Date): string | null {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  if (!Number.isFinite(date.getTime())) return null
  const parts = SAST_FORMAT.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Today's SAST calendar day, "YYYY-MM-DD". */
export function sastToday(): string {
  // new Date() is always valid, so the null branch of sastCalendarDay cannot occur here.
  return sastCalendarDay(new Date())!
}

/** An instant as separate day and time strings, e.g. { day: "05 Sep 2026", time: "14:30 SAST" },
 *  for cells that stack the two. Null when unparseable. */
export function fmtSastDateParts(iso: string | null | undefined): { day: string; time: string } | null {
  const fields = sastFields(iso)
  return fields ? { day: `${fields.day} ${fields.month} ${fields.year}`, time: `${fields.time} ${TIMEZONE_LABEL}` } : null
}

/** An instant as one string, e.g. "05 Sep 2026, 14:30 SAST", for a line that is not stacking the
 *  two halves. Composed from fmtSastDateParts, so the wording can never differ from the stacked
 *  cells. Null when unparseable. */
export function fmtSastDateTime(iso: string | null | undefined): string | null {
  const parts = fmtSastDateParts(iso)
  return parts ? `${parts.day}, ${parts.time}` : null
}

/** Date and time without the year, e.g. "30 Jul, 14:05 SAST". The default for timeline events. */
export function fmtDateTime(iso: string | null | undefined): string {
  const fields = sastFields(iso)
  return fields ? `${fields.day} ${fields.month}, ${fields.time} ${TIMEZONE_LABEL}` : MISSING
}

/** Time only, e.g. "14:05 SAST". For events already grouped under a date. */
export function fmtTime(iso: string | null | undefined): string {
  const fields = sastFields(iso)
  return fields ? `${fields.time} ${TIMEZONE_LABEL}` : MISSING
}

/** Full date and time including the year, e.g. "30 Jul 2026, 14:05 SAST" — for records, not for
 *  timelines. */
export function fmtFull(iso: string | null | undefined): string {
  return fmtSastDateTime(iso) ?? MISSING
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/

/** A calendar date with no time ("2027-09-23") as "23 Sep 2027", in the same wording as the
 *  rest. Read straight from the string: a date with no time has no timezone, so running it
 *  through Date and a formatter could only move it a day. Null when it is not a date. */
export function fmtCalendarDate(date: string | null | undefined): string | null {
  const match = date ? CALENDAR_DATE_PATTERN.exec(date) : null
  const month = match ? MONTH_ABBREVIATIONS[Number(match[2]) - 1] : undefined
  return match && month ? `${match[3]} ${month} ${match[1]}` : null
}
