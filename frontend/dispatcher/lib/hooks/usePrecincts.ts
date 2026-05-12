"use client"

import { useMemo } from 'react'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import type { Precinct } from '@shared/lib/types/precinct'

/** Returns all precincts from mock data. Used by Trip Creation. */
export function usePrecincts(): Precinct[] {
  return useMemo(() => mockPrecincts, [])
}
