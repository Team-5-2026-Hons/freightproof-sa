// Date and time formatting for the dispatcher UI. One locale, one set of option shapes.
//
// Extracted because five files had grown a private copy of the same three-line function,
// which is how two of them ended up showing a different format for the same field.

const LOCALE = 'en-ZA'

/** Date and time, e.g. "30 Jul, 14:05". The default for timeline events. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(LOCALE, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** Time only, e.g. "14:05". For events already grouped under a date. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

// Operations run on South African time whatever the viewer's machine says, so a table that
// lists when something happened must not shift with the browser's timezone.
const OPERATIONS_TIMEZONE = 'Africa/Johannesburg'
// Numeric month and h23 so nothing depends on locale wording; month names come from the table
// below. Intl's own short month differs by ICU version ("Sept" vs "Sep" for en-GB).
const SAST_PARTS_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: OPERATIONS_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** An instant as separate day and time strings in SAST, e.g. { day: "05 Sep 2026",
 *  time: "14:30 SAST" }, for cells that stack the two. Built from formatToParts, never by
 *  splitting a formatted string: the date/time separator is locale data (", " in older ICU,
 *  " at " in newer), so a split silently fails in some browsers. Null when unparseable. */
export function fmtSastDateParts(iso: string | null | undefined): { day: string; time: string } | null {
  if (!iso) return null
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  const parts = SAST_PARTS_FORMAT.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(p => p.type === type)?.value ?? ''
  const month = MONTH_ABBREVIATIONS[Number(part('month')) - 1]
  return { day: `${part('day')} ${month} ${part('year')}`, time: `${part('hour')}:${part('minute')} SAST` }
}

/** An instant as one string in SAST, e.g. "05 Sep 2026, 14:30 SAST", for a line that is not
 *  stacking the two halves. Composed from fmtSastDateParts, so the wording can never differ
 *  from the stacked cells. Null when unparseable. */
export function fmtSastDateTime(iso: string | null | undefined): string | null {
  const parts = fmtSastDateParts(iso)
  return parts ? `${parts.day}, ${parts.time}` : null
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/

/** A calendar date with no time ("2027-09-23") as "23 Sep 2027", in the same wording as
 *  fmtSastDateParts. Read straight from the string: a date with no time has no timezone, so
 *  running it through Date and a formatter could only move it a day. Null when it is not a date. */
export function fmtCalendarDate(date: string | null | undefined): string | null {
  const match = date ? CALENDAR_DATE_PATTERN.exec(date) : null
  const month = match ? MONTH_ABBREVIATIONS[Number(match[2]) - 1] : undefined
  return match && month ? `${match[3]} ${month} ${match[1]}` : null
}

/** Full date and time including the year — for records, not for timelines. */
export function fmtFull(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
