"use client"

import { useMemo } from 'react'
import { mockHorses, mockTrailers, mockVehicles } from '@shared/lib/mocks/vehicles'
import type { Vehicle } from '@shared/lib/types/vehicle'

/** Returns horses, trailers, or all vehicles from mock data. Used by Trip Creation and Fleet pages. */
export function useVehicles(): { horses: Vehicle[]; trailers: Vehicle[]; all: Vehicle[] } {
  return useMemo(() => ({
    horses: mockHorses,
    trailers: mockTrailers,
    all: mockVehicles,
  }), [])
}
