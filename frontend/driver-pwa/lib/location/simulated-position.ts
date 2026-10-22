// Demo-only phone-position override.
//
// WHY THIS EXISTS AT ALL: the demo runs against the hosted backend, where the
// presenter's phone is nowhere near the depots a trip names, so every phase capture
// would sit ~1000km from its expected precinct and fire a location warning. The truck
// side of that pairing already has a staging seam (the dispatcher's "move the truck"
// panel, backend app/dev/endpoints/pulsit.py); this is its phone-side counterpart.
//
// WHY IT IS DANGEROUS: useLocation.ts states the guarantee this bypasses — "a fabricated
// coordinate that looks like a genuine capture is the single worst defect this app can
// ship". A simulated fix submitted from here lands in phase_events.driver_phone_lat/lng
// indistinguishable from a real one; the ledger does NOT record that it was simulated
// (deliberate scope decision, Tim, 21 Oct 2026). Three things contain that:
//   1. NEXT_PUBLIC_DEMO_GPS must be 'true' in the BUILD. Absent, every read below
//      returns null and the override cannot be switched on from the UI at all.
//   2. It is off by default and never auto-enables.
//   3. While active, SimulatedGpsBanner holds a permanent on-screen warning that cannot
//      be dismissed — so no one can present a simulated capture believing it is real.
// If the override is ever needed in a build that produces evidence anyone relies on,
// the fix is provenance in the ledger, not a quieter banner.


// Type-only: useLocation imports this module back, and an erased import cannot cycle.
import type { LocationCoords } from '@/lib/hooks/useLocation'

/** Per-phone, per-browser. Never synced, never sent anywhere but the capture path. */
const STORAGE_KEY = 'fp.demo.simulated-position'

/** Fired on every change so the banner and panel re-read without prop plumbing. */
export const SIMULATED_POSITION_EVENT = 'fp:simulated-position-changed'

/** Plausible phone accuracy for a fix with a clear sky view, in metres. */
const DEFAULT_ACCURACY_METRES = 8

/** Default jitter between successive captures, so a walk does not report one frozen pin. */
const DEFAULT_DRIFT_METRES = 25

/** Degrees of latitude per metre — WGS84 meridian, exact enough at demo scale. */
const METRES_PER_DEGREE_LATITUDE = 111_320

const MAX_LATITUDE = 90
const MAX_LONGITUDE = 180

export interface SimulatedPosition {
  lat: number
  lng: number
  /** Reported accuracy, metres. */
  accuracyM: number
  /** Random offset applied per capture, metres. 0 pins the position exactly. */
  driftM: number
}

/**
 * Whether this BUILD can simulate at all. False in any normal build.
 *
 * Read from process.env here rather than through lib/constants/env, deliberately: a
 * dozen test files replace that module with a vi.mock factory exporting only the
 * constants they care about, and Vitest's mock proxy THROWS on any export the factory
 * omitted. Routing this flag through it would make every GPS capture in those tests
 * fail at module level. `NEXT_PUBLIC_*` is inlined at build time either way, so reading
 * it directly loses none of the build-time guarantee this gate depends on.
 */
export function isSimulationAvailable(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_GPS === 'true'
}

function isFiniteWithin(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
}

/**
 * The stored override, or null when the build forbids it, nothing is stored, or the
 * stored value is unusable. Never throws: storage can be blocked entirely (private
 * window, cleared site data), and a capture must not fail because of this module.
 */
export function readSimulatedPosition(): SimulatedPosition | null {
  if (!isSimulationAvailable()) return null
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const { lat, lng, accuracyM, driftM } = parsed as Record<string, unknown>
    if (!isFiniteWithin(lat, MAX_LATITUDE) || !isFiniteWithin(lng, MAX_LONGITUDE)) return null
    return {
      lat,
      lng,
      accuracyM: isFiniteWithin(accuracyM, Number.MAX_SAFE_INTEGER) && accuracyM > 0
        ? accuracyM : DEFAULT_ACCURACY_METRES,
      driftM: isFiniteWithin(driftM, Number.MAX_SAFE_INTEGER) && driftM >= 0
        ? driftM : DEFAULT_DRIFT_METRES,
    }
  } catch {
    // Corrupt JSON is the same as nothing stored — the capture falls through to the
    // real device, which is always the safe direction to fail in.
    return null
  }
}

function notifyChanged(): void {
  try {
    window.dispatchEvent(new Event(SIMULATED_POSITION_EVENT))
  } catch {
    // No window (prerender) or no Event constructor — the UI just re-reads on its
    // next render instead of being pushed.
  }
}

/** Switch the override on at `position`. No-op when the build forbids simulation. */
export function writeSimulatedPosition(position: SimulatedPosition): boolean {
  if (!isSimulationAvailable()) return false
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
  } catch {
    return false
  }
  notifyChanged()
  return true
}

/** Switch the override off. Safe to call when it was never on. */
export function clearSimulatedPosition(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to undo — a read that still succeeds will keep returning the old value,
    // and the banner will keep warning about it, which is the honest failure here.
  }
  notifyChanged()
}

/**
 * One simulated capture, shaped exactly like a real one.
 *
 * `driftM` offsets each call independently so successive phases of a walk report
 * slightly different positions — a frozen coordinate across seven phases is both
 * unconvincing on stage and a worse lie than a moving one.
 */
export function simulatedCapture(): LocationCoords | null {
  const stored = readSimulatedPosition()
  if (stored === null) return null

  const metresPerDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((stored.lat * Math.PI) / 180)
  const offsetNorth = (Math.random() - 0.5) * 2 * stored.driftM
  const offsetEast = (Math.random() - 0.5) * 2 * stored.driftM

  return {
    latitude: stored.lat + offsetNorth / METRES_PER_DEGREE_LATITUDE,
    // At the poles the cosine collapses and the longitude offset explodes; no demo runs
    // there, but guard rather than emit Infinity into an evidence field.
    longitude: metresPerDegreeLongitude === 0
      ? stored.lng
      : stored.lng + offsetEast / metresPerDegreeLongitude,
    accuracy: stored.accuracyM,
    capturedAt: new Date().toISOString(),
  }
}

/**
 * Parse "lat, lng" as pasted from the dispatcher's move-truck panel (or Google Maps).
 * Accepts comma or whitespace separation. Null when it isn't a usable pair, so the
 * caller can say so instead of storing a half-read coordinate.
 */
export function parseCoordinatePair(text: string): { lat: number; lng: number } | null {
  const parts = text.trim().split(/[\s,]+/).filter(part => part.length > 0)
  if (parts.length !== 2) return null

  const lat = Number(parts[0])
  const lng = Number(parts[1])
  if (!isFiniteWithin(lat, MAX_LATITUDE) || !isFiniteWithin(lng, MAX_LONGITUDE)) return null
  return { lat, lng }
}

export { DEFAULT_ACCURACY_METRES, DEFAULT_DRIFT_METRES }
