// A <input type="datetime-local"> value has no time zone. Every time a dispatcher types is
// South African, so it is sent with SAST's fixed offset — the backend refuses zone-less
// times, since guessing would shift a police-report time by two hours.
const SAST_OFFSET = '+02:00'
const MINUTE_PRECISION_LENGTH = 16 // "YYYY-MM-DDTHH:mm"

/** "2026-09-12T13:40" → "2026-09-12T13:40:00+02:00"; empty input → null. */
export function sastInputToIso(value: string): string | null {
  if (!value) return null
  return `${value.length === MINUTE_PRECISION_LENGTH ? `${value}:00` : value}${SAST_OFFSET}`
}
