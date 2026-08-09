'use client'

import { useContext } from 'react'
import { LocationContext, type LocationState } from '@/lib/context/LocationContext'

/**
 * Access the open trip's location trail. Mirrors useTrip/useToast: throws when used
 * outside LocationProvider rather than handing back a silently inert object, because a
 * screen that thinks it is recording positions and isn't would produce an evidence gap
 * nobody notices until a dispute.
 */
export function useLocationTrail(): LocationState {
  const ctx = useContext(LocationContext)
  if (ctx === null) {
    throw new Error('useLocationTrail must be used within a LocationProvider')
  }
  return ctx
}
