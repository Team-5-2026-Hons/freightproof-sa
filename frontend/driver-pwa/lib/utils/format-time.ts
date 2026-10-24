// Single locale-pinned time formatter — the driver app is ZA-only and evidence
// timestamps must render identically on every screen.
//
// Built on first use, not at import. Every screen imports this module, so its body runs
// inside the one long task every cold start has (module evaluation, ~300 ms in the dev
// profile); each Intl.DateTimeFormat costs several ms to construct, and here that work
// moved out of that task and into the first render that actually needs the formatter.
function lazyFormatter(build: () => Intl.DateTimeFormat): () => Intl.DateTimeFormat {
  let instance: Intl.DateTimeFormat | null = null
  return () => (instance ??= build())
}

const timeFormat = lazyFormatter(() => new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' }))

export function formatTime(date: Date | string): string {
  return timeFormat().format(typeof date === 'string' ? new Date(date) : date)
}

// To the second, for the one record where seconds matter to the reader: when a panic
// alert went.
const timeWithSecondsFormat = lazyFormatter(() => new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))

export function formatTimeWithSeconds(date: Date | string): string {
  return timeWithSecondsFormat().format(typeof date === 'string' ? new Date(date) : date)
}

// Weekday + day + month + time, e.g. "Wed 2 Jul, 06:00" — used where the date itself
// (not just the time) matters, such as disambiguating cross-day trip departures.
const dateTimeFormat = lazyFormatter(() => new Intl.DateTimeFormat('en-ZA', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
}))

export function formatDateTime(date: Date | string): string {
  return dateTimeFormat().format(typeof date === 'string' ? new Date(date) : date)
}

// Day + month + year, e.g. "12 Mar 2027", for calendar dates such as a licence expiry.
// Formatted in UTC so a date-only "YYYY-MM-DD" (parsed as UTC midnight) never slides to
// the previous day on a device behind UTC.
const dateFormat = lazyFormatter(() => new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }))

export function formatDate(date: Date | string): string {
  const parts = dateFormat().formatToParts(typeof date === 'string' ? new Date(date) : date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  // ICU's en-ZA pads the day ("01 Jan") even with day: 'numeric'; drop the zero.
  return `${Number(part('day'))} ${part('month')} ${part('year')}`
}

// "Saturday 9 May" — Home's date line above the greeting. Local time: it names the
// driver's own today.
const longDateFormat = lazyFormatter(() => new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }))

export function formatLongDate(date: Date): string {
  const parts = longDateFormat().formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  // Built from parts: en-ZA inserts a comma and pads the day, neither of which a heading wants.
  return `${part('weekday')} ${Number(part('day'))} ${part('month')}`
}
