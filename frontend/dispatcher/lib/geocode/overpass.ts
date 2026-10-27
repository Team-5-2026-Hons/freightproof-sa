// Candidate property outlines for a precinct pin, from OpenStreetMap via the Overpass API.
//
// What OSM can and cannot give, measured on SA depots on 2026-10-14: building footprints
// near the pin, and the mapped areas the pin sits in (an industrial estate, a works, a
// car park). It has no cadastral property boundaries, so a candidate is a STARTING shape
// for the dispatcher to drag to the fence line, never the fence itself.
//
// Not the shared `api` client: that one carries our auth headers, which must never reach
// a third-party host. Only the pin (a business location) is sent — no personal data.

import type { LatLngPair } from '@shared/lib/types/precinct'
import {
  MAX_OUTLINE_AREA_M2, MAX_OUTLINE_CORNERS, MIN_OUTLINE_AREA_M2,
  areaSquareMetres, contains, distanceToBoundaryMetres, isSimple,
} from '@/lib/map/polygon'

const OVERPASS_PUBLIC_URL = 'https://overpass-api.de/api/interpreter'
export const OVERPASS_URL = process.env.NEXT_PUBLIC_OVERPASS_URL || OVERPASS_PUBLIC_URL

const NEARBY_BUILDING_METRES = 60
const QUERY_TIMEOUT_SECONDS = 20
export const MAX_CANDIDATES = 6

const AREA_TAGS = ['landuse', 'amenity', 'man_made', 'industrial'] as const

export interface OutlineCandidate {
  id: string
  label: string
  detail: string
  polygon: LatLngPair[]
  areaM2: number
  containsPin: boolean
}

interface OverpassElement {
  type?: string
  id?: number
  tags?: Record<string, string>
  geometry?: Array<{ lat?: number; lon?: number }>
}

export function buildOutlineQuery(lat: number, lng: number): string {
  const areaQueries = AREA_TAGS.map((tag) => `way(pivot.a)[${tag}];`).join('')
  return (
    `[out:json][timeout:${QUERY_TIMEOUT_SECONDS}];` +
    `(way(around:${NEARBY_BUILDING_METRES},${lat},${lng})[building];)->.b;` +
    `is_in(${lat},${lng})->.a;(${areaQueries})->.c;` +
    `(.b;.c;);out tags geom;`
  )
}

function kindLabel(tags: Record<string, string>): string {
  if (tags.building === 'warehouse') return 'Warehouse'
  if (tags.building === 'industrial') return 'Industrial building'
  if (tags.building) return 'Building'
  if (tags.landuse === 'industrial' || tags.industrial) return 'Industrial site'
  if (tags.landuse === 'commercial') return 'Commercial site'
  if (tags.landuse === 'retail') return 'Retail site'
  if (tags.amenity === 'parking') return 'Parking area'
  if (tags.man_made === 'works') return 'Works'
  return 'Mapped area'
}

function formatArea(areaM2: number): string {
  return areaM2 >= 10_000 ? `${(areaM2 / 10_000).toFixed(1)} ha` : `${Math.round(areaM2).toLocaleString('en-ZA')} m²`
}

/** Parse an Overpass response into usable outlines, best first. Malformed or unusable
 *  shapes (too few corners, self-crossing, outside the allowed size) are dropped, never thrown. */
export function parseOverpassOutlines(json: unknown, pin: LatLngPair): OutlineCandidate[] {
  if (typeof json !== 'object' || json === null) return []
  const elements = (json as { elements?: unknown }).elements
  if (!Array.isArray(elements)) return []

  const candidates: OutlineCandidate[] = []
  const seen = new Set<string>()
  for (const element of elements as OverpassElement[]) {
    if (element.type !== 'way' || !Array.isArray(element.geometry)) continue
    const ring = element.geometry
      .filter((p): p is { lat: number; lon: number } => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p): LatLngPair => [p.lat, p.lon])
    const first = ring[0]
    const last = ring[ring.length - 1]
    const polygon = first && last && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring
    if (polygon.length > MAX_OUTLINE_CORNERS || !isSimple(polygon)) continue

    const areaM2 = areaSquareMetres(polygon)
    if (areaM2 < MIN_OUTLINE_AREA_M2 || areaM2 > MAX_OUTLINE_AREA_M2) continue

    const id = `way/${element.id ?? candidates.length}`
    if (seen.has(id)) continue
    seen.add(id)

    const tags = element.tags ?? {}
    const containsPin = contains(polygon, pin)
    const where = containsPin ? 'contains the pin' : `${Math.round(distanceToBoundaryMetres(polygon, pin))} m from the pin`
    candidates.push({
      id,
      label: tags.name ? `${tags.name} (${kindLabel(tags).toLowerCase()})` : kindLabel(tags),
      detail: `${formatArea(areaM2)} · ${where}`,
      polygon,
      areaM2,
      containsPin,
    })
  }

  return candidates
    .sort((a, b) => {
      if (a.containsPin !== b.containsPin) return a.containsPin ? -1 : 1
      if (a.containsPin) return a.areaM2 - b.areaM2
      return distanceToBoundaryMetres(a.polygon, pin) - distanceToBoundaryMetres(b.polygon, pin)
    })
    .slice(0, MAX_CANDIDATES)
}

/** Fetch outline candidates around a pin. Throws on network/HTTP failure so the form can
 *  say "unavailable" (and offer the starter rectangle) rather than "nothing mapped here". */
export async function fetchOutlineCandidates(lat: number, lng: number, signal?: AbortSignal): Promise<OutlineCandidate[]> {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: buildOutlineQuery(lat, lng) }),
    signal,
  })
  if (!response.ok) throw new Error(`Outline lookup failed: HTTP ${response.status}`)
  return parseOverpassOutlines(await response.json(), [lat, lng])
}
