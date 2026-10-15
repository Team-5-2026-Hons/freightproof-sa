"use client"

import { useContext } from 'react'
import { TripContext } from '@/lib/context/TripContext'

/**
 * The session trip when a TripProvider is above, else null — for chrome that only
 * enriches itself with trip context (the step header's trip progress) and must still
 * render without it. Its own module, not an export beside useTrip, so a test that mocks
 * useTrip's module does not silently remove this one.
 */
export function useOptionalTrip() {
  return useContext(TripContext)
}
