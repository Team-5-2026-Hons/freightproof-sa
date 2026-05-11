"use client"

import { useMemo } from 'react'
import type { TripStatus, TripSummary } from '@shared/lib/types/trip'
import { mockTrips } from '@shared/lib/mocks/trips'

export interface TripsFilter {
  status?: TripStatus[]
  driverId?: string
  hasExceptions?: boolean
}

export function useTrips(filter?: TripsFilter): TripSummary[] {
  const status       = filter?.status
  const driverId     = filter?.driverId
  const hasExceptions = filter?.hasExceptions

  return useMemo(() => {
    return mockTrips
      .filter(t => {
        if (status?.length && !status.includes(t.status)) return false
        if (driverId && t.driver_id !== driverId) return false
        if (hasExceptions !== undefined) {
          const open = t.exceptions.some(e => !e.resolved)
          if (hasExceptions !== open) return false
        }
        return true
      })
      .map((t): TripSummary => ({
        id: t.id,
        trip_reference: t.trip_reference,
        order_number: t.order_number,
        status: t.status,
        // driver and horse are always populated in fixtures; non-null assertion safe here
        driver: t.driver!,
        horse: t.horse!,
        trailers: t.trailers,
        origin_precinct_id: t.origin_precinct_id,
        destination_precinct_id: t.destination_precinct_id,
        planned_departure_at: t.planned_departure_at,
        actual_departure_at: t.actual_departure_at,
        planned_arrival_at: t.planned_arrival_at,
        actual_arrival_at: t.actual_arrival_at,
        open_exception_count: t.exceptions.filter(e => !e.resolved).length,
        created_at: t.created_at,
        updated_at: t.updated_at,
      }))
  }, [status, driverId, hasExceptions])
}
