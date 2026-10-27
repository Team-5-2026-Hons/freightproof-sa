// Display formatting shared by every section, matching the PDF (backend app/core/display.py):
// all human-facing times in SAST, raw data untouched.
import type { PositionFix } from './types'

const SAST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Johannesburg',
  day: '2-digit', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatSast(iso: string | null | undefined): string {
  if (!iso) return '—'
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return '—'
  const parts = Object.fromEntries(SAST.formatToParts(instant).map((p) => [p.type, p.value]))
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]} ${parts.year} ${parts.hour}:${parts.minute} SAST`
}

export function humanise(value: string | null | undefined): string {
  if (!value) return '—'
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function formatCoord(fix: PositionFix | null | undefined): string {
  if (!fix) return '—'
  const accuracy = fix.accuracy_metres != null ? ` (±${Math.round(fix.accuracy_metres)} m)` : ''
  return `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}${accuracy}`
}

export function formatRand(value: string | null): string {
  if (value == null) return 'not declared'
  return `R ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "1 record" / "3 records": counts in prose must agree with their noun. */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
