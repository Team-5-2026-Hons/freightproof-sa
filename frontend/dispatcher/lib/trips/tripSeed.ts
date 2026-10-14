'use client'

import type { TripChecklistItem } from '@shared/lib/types/trip'
import { registerSessionCache } from '@/lib/cache/sessionCache'

// A list row holds enough to name a trip and its driver. Only the active-trips list
// carries arrival times, so those stay optional.
export interface TripSeed extends TripChecklistItem {
  planned_departure_at?: string | null
  actual_departure_at?: string | null
  planned_arrival_at?: string | null
  actual_arrival_at?: string | null
  // Absent means the list didn't carry trailers — NOT the same as a trip having none
  // (rigid trucks legitimately run without them).
  trailers?: readonly { registration: string }[]
}

// Enough to cover a dispatcher's working set without growing unbounded across a shift.
const MAX_SEEDS = 200

const seeds = new Map<string, TripSeed>()

/** Record what a list already knows, so opening one of its rows can paint immediately. */
export function putTripSeeds(rows: readonly TripSeed[]): void {
  for (const row of rows) {
    // Delete first so a re-listed trip moves to the end: Map iterates in insertion order,
    // making the eviction below oldest-first.
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

/** Forget every seeded row, so it can't outlive a sign-out and paint a trip the next
 *  dispatcher cannot open. */
export function clearTripSeeds(): void {
  seeds.clear()
}

registerSessionCache(clearTripSeeds)

/** Test-only alias: the store outlives any component, so suites must clear it between cases. */
export const __resetTripSeeds = clearTripSeeds
