// The link the assistant's "Open trip form" button opens, and the trip form's reading of it (assistant spec §7.3,
// D2a, D2c). Ids only, never names, so no personal detail lands in browser history or server logs. Pure: no React.

import { ROUTES } from '@/lib/constants/routes'
import type { TripFormParams } from '@shared/lib/types/assistant'

export const PREFILL_KEYS = {
  mode: 'mode', manifest: 'manifest', driver: 'driver', horse: 'horse', trailers: 'trailers',
  origin: 'origin', destination: 'destination', departure: 'departure', arrival: 'arrival',
} as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FORM_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const POSITIVE_INTEGER = /^[1-9]\d{0,8}$/

/** What a link asks the form to fill in, after dropping anything malformed. */
export interface TripPrefill {
  mode: 'empty_leg' | 'manifest'
  manifestNumber: number | null
  driverId: string | null
  horseId: string | null
  trailerIds: string[]
  originId: string | null
  destinationId: string | null
  departure: string | null
  arrival: string | null
  dropped: string[]
}

export function buildPrefillHref(params: TripFormParams): string {
  const query = new URLSearchParams({ [PREFILL_KEYS.mode]: params.mode })
  const optional: [string, string | number | null][] = [
    [PREFILL_KEYS.manifest, params.manifest_number],
    [PREFILL_KEYS.driver, params.driver_id],
    [PREFILL_KEYS.horse, params.horse_id],
    [PREFILL_KEYS.trailers, params.trailer_ids.length ? params.trailer_ids.join(',') : null],
    [PREFILL_KEYS.origin, params.origin_precinct_id],
    [PREFILL_KEYS.destination, params.destination_precinct_id],
    [PREFILL_KEYS.departure, params.departure],
    [PREFILL_KEYS.arrival, params.arrival],
  ]
  for (const [key, value] of optional) if (value !== null) query.set(key, String(value))
  return `${ROUTES.tripNew}?${query.toString()}`
}

function checked(params: URLSearchParams, key: string, pattern: RegExp, dropped: string[]): string | null {
  const value = params.get(key)
  if (value === null || value === '') return null
  if (pattern.test(value)) return value
  dropped.push(key)
  return null
}

/** The prefill a link carries, or null when it carries none (an ordinary visit to the form). */
export function parsePrefill(params: URLSearchParams): TripPrefill | null {
  const mode = params.get(PREFILL_KEYS.mode)
  if (mode !== 'empty_leg' && mode !== 'manifest') return null
  const dropped: string[] = []
  const manifest = checked(params, PREFILL_KEYS.manifest, POSITIVE_INTEGER, dropped)
  const trailers = (params.get(PREFILL_KEYS.trailers) ?? '').split(',').filter(Boolean)
  const trailerIds = trailers.filter((id) => UUID.test(id))
  if (trailerIds.length !== trailers.length) dropped.push(PREFILL_KEYS.trailers)
  return {
    mode,
    manifestNumber: mode === 'manifest' && manifest !== null ? Number(manifest) : null,
    driverId: checked(params, PREFILL_KEYS.driver, UUID, dropped),
    horseId: checked(params, PREFILL_KEYS.horse, UUID, dropped),
    trailerIds,
    originId: checked(params, PREFILL_KEYS.origin, UUID, dropped),
    destinationId: checked(params, PREFILL_KEYS.destination, UUID, dropped),
    departure: checked(params, PREFILL_KEYS.departure, FORM_TIME, dropped),
    arrival: checked(params, PREFILL_KEYS.arrival, FORM_TIME, dropped),
    dropped,
  }
}
