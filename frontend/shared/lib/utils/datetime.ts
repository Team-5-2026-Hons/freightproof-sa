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

/** Full date and time including the year — for records, not for timelines. */
export function fmtFull(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
