// Single locale-pinned time formatter — the driver app is ZA-only and evidence
// timestamps must render identically on every screen.
const TIME_FORMAT = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' })

export function formatTime(date: Date | string): string {
  return TIME_FORMAT.format(typeof date === 'string' ? new Date(date) : date)
}

// Weekday + day + month + time, e.g. "Wed 2 Jul, 06:00" — used where the date itself
// (not just the time) matters, such as disambiguating cross-day trip departures.
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-ZA', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDateTime(date: Date | string): string {
  return DATE_TIME_FORMAT.format(typeof date === 'string' ? new Date(date) : date)
}
