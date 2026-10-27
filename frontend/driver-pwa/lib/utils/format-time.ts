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

const timeWithSecondsFormat = lazyFormatter(() => new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))

export function formatTimeWithSeconds(date: Date | string): string {
  return timeWithSecondsFormat().format(typeof date === 'string' ? new Date(date) : date)
}

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

const dateFormat = lazyFormatter(() => new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }))

export function formatDate(date: Date | string): string {
  const parts = dateFormat().formatToParts(typeof date === 'string' ? new Date(date) : date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${Number(part('day'))} ${part('month')} ${part('year')}`
}

const longDateFormat = lazyFormatter(() => new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }))

export function formatLongDate(date: Date): string {
  const parts = longDateFormat().formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('weekday')} ${Number(part('day'))} ${part('month')}`
}
