'use client'

import type { TripChecklistItem } from '@shared/lib/types/trip'
import { registerSessionCache } from '@/lib/cache/sessionCache'

// A list row holds enough to name a trip and say who is driving it, which is most of the
// detail header. Both list shapes extend TripChecklistItem; only the active-trips list
// carries arrival times, so those stay optional and history simply has none.
export interface TripSeed extends TripChecklistItem {
  planned_departure_at?: string | null
  actual_departure_at?: string | null
  planned_arrival_at?: string | null
  actual_arrival_at?: string | null
  // Absent means the list did not carry trailers, which is NOT the same as a trip having
  // none — rigid trucks legitimately run without them. Callers must not read one as the
  // other; an absent list stays silent rather than claiming "no trailers".
  trailers?: readonly { registration: string }[]
}

// Enough to cover a dispatcher's working set without growing unbounded across a shift.
const MAX_SEEDS = 200

const seeds = new Map<string, TripSeed>()

/** Record what a list already knows, so opening one of its rows can paint immediately. */
export function putTripSeeds(rows: readonly TripSeed[]): void {
  for (const row of rows) {
    // Delete first so a re-listed trip moves to the end: Map iterates in insertion order,
    // which is what makes the eviction below oldest-first rather than arbitrary.
    seeds.delete(row.id)
    seeds.set(row.id, row)
  }
  while (seeds.size > MAX_SEEDS) {
    const oldest = seeds.keys().next()
    if (oldest.done) break
    seeds.delete(oldest.value)
  }
}

/** A seed is a memory of a list row, never a substitute for the trip record itself. */
export function getTripSeed(id: string): TripSeed | null {
  return seeds.get(id) ?? null
}

/** Forget every seeded row. A seed names a trip and who is driving it, so it outliving a
 *  sign-out would let the header of a trip the new dispatcher cannot open still paint. */
export function clearTripSeeds(): void {
  seeds.clear()
}

registerSessionCache(clearTripSeeds)

/** Test-only alias: the store outlives any component, so suites must clear it between cases. */
export const __resetTripSeeds = clearTripSeeds
