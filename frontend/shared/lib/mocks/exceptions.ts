import type { TripException } from '@shared/lib/types/exception'
import { mockTrips } from './trips'

// All 8 exceptions derived from the inline trip data — single source of truth.
// Hooks use this flat list for the dispatcher Exceptions feed.
export const mockExceptions: TripException[] = mockTrips.flatMap(t => t.exceptions)
