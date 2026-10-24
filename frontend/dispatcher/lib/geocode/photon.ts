// Address search for the precinct form, via Photon (komoot's open-source geocoder over
// OpenStreetMap). Keyless, and — unlike the public Nominatim instance — its usage policy
// allows search-as-you-type.
//
// A suggestion only moves the map. The dispatcher still places the pin by click or drag:
// OSM's South African house-number coverage is patchy, so a street address often resolves
// to the street, not the gate (see PrecinctForm's note on why a geocode is not the truth).
//
// Not the shared `api` client: that one talks to our own backend with our auth headers,
// which must never be sent to a third-party host.

/** Photon's public instance. Overridable for a self-hosted one (`docker run komoot/photon`). */
const PHOTON_PUBLIC_URL = 'https://photon.komoot.io'

// `||`, not `??`: .env.example ships the key blank, so unset arrives as '' (see lib/map/tiles.ts).
export const GEOCODER_URL = (process.env.NEXT_PUBLIC_GEOCODER_URL || PHOTON_PUBLIC_URL).replace(/\/$/, '')

// West, south, east, north. Every precinct is in South Africa, so results elsewhere are noise.
const SOUTH_AFRICA_BBOX = '16.3,-34.9,33.0,-22.1'
const SOUTH_AFRICA_COUNTRY_CODE = 'ZA'

export const ADDRESS_RESULT_LIMIT = 6
export const ADDRESS_QUERY_MIN_LENGTH = 3

export interface AddressSuggestion {
  /** Stable for React keys: OSM type + id. */
  id: string
  /** First line — a place name, or "12 Sookhai Place". */
  label: string
  /** Second line — suburb, city, province. null when there is nothing to add. */
  detail: string | null
  latitude: number
  longitude: number
}

interface PhotonProperties {
  osm_type?: string
  osm_id?: number
  name?: string
  housenumber?: string
  street?: string
  district?: string
  city?: string
  state?: string
  postcode?: string
  countrycode?: string
}

interface PhotonFeature {
  geometry?: { coordinates?: unknown }
  properties?: PhotonProperties
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toSuggestion(feature: PhotonFeature, index: number): AddressSuggestion | null {
  const props = feature.properties ?? {}
  const coords = feature.geometry?.coordinates
  // GeoJSON is [lng, lat] — the reverse of every form field in this app.
  if (!Array.isArray(coords) || !isFiniteNumber(coords[0]) || !isFiniteNumber(coords[1])) return null
  if (props.countrycode !== undefined && props.countrycode !== SOUTH_AFRICA_COUNTRY_CODE) return null

  const streetLine = [props.housenumber, props.street].filter(Boolean).join(' ')
  const label = props.name ?? (streetLine || null)
  if (label === null) return null

  const detailParts = [
    props.name !== undefined && streetLine !== '' ? streetLine : null,
    props.district,
    props.city,
    props.state,
  ].filter((part): part is string => typeof part === 'string' && part !== '' && part !== label)

  return {
    id: `${props.osm_type ?? 'X'}${props.osm_id ?? index}`,
    label,
    detail: detailParts.length > 0 ? Array.from(new Set(detailParts)).join(', ') : null,
    latitude: coords[1],
    longitude: coords[0],
  }
}

/** Parse a Photon GeoJSON response. Anything malformed is dropped, never thrown. */
export function parsePhotonResponse(json: unknown): AddressSuggestion[] {
  if (typeof json !== 'object' || json === null) return []
  const features = (json as { features?: unknown }).features
  if (!Array.isArray(features)) return []

  const seen = new Set<string>()
  const suggestions: AddressSuggestion[] = []
  features.forEach((feature: PhotonFeature, index) => {
    const suggestion = toSuggestion(feature, index)
    // Photon returns the same street once per OSM way segment; one row per label+detail is enough.
    const key = suggestion === null ? '' : `${suggestion.label}|${suggestion.detail}`
    if (suggestion !== null && !seen.has(key)) {
      seen.add(key)
      suggestions.push(suggestion)
    }
  })
  return suggestions
}

/**
 * Search South African addresses and places. Throws on network/HTTP failure so the
 * caller can say "search unavailable" rather than "no results" — those mean different
 * things to a dispatcher.
 */
export async function searchAddresses(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const trimmed = query.trim()
  if (trimmed.length < ADDRESS_QUERY_MIN_LENGTH) return []

  const params = new URLSearchParams({
    q: trimmed,
    limit: String(ADDRESS_RESULT_LIMIT),
    bbox: SOUTH_AFRICA_BBOX,
    lang: 'en',
  })
  const response = await fetch(`${GEOCODER_URL}/api/?${params}`, { signal })
  if (!response.ok) {
    throw new Error(`Address search failed: HTTP ${response.status}`)
  }
  return parsePhotonResponse(await response.json())
}
