"use client"

import { useMemo } from 'react'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import type { Driver } from '@shared/lib/types/driver'

/** Returns all drivers from mock data. Used by Trip Creation. */
export function useDrivers(): Driver[] {
  return useMemo(() => mockDrivers, [])
}
