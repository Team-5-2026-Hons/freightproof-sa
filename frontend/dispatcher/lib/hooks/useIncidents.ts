'use client'

import { useCallback } from 'react'
import { getIncident, getIncidentEvidence, listIncidents, listTripIncidents } from '@/lib/api/incidents'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import type { RealtimeKind } from '@/lib/realtime/types'
import type { IncidentDetail, IncidentEvidence, IncidentListFilters, IncidentSummary } from '@/lib/types/incident'
import { useAsyncData, type AsyncState } from './useAsyncData'

// An incident changes on its own events; a stop also closes the trip, and a new exception or
// review changes the evidence and the review counts an incident shows.
const INCIDENT_KINDS: readonly RealtimeKind[] = ['incident_changed', 'trip_closed', 'exception_raised', 'exception_reviewed']

/** The organisation's incidents, refreshed live when any trip's incident changes. */
export function useIncidents(filters: IncidentListFilters): AsyncState<IncidentSummary[]> {
  const { status, incident_type, assigned_to } = filters
  const fetchList = useCallback(
    () => listIncidents({ status, incident_type, assigned_to }), [status, incident_type, assigned_to],
  )
  const state = useAsyncData<IncidentSummary[]>(fetchList, [])
  useLiveResource('trip', 'any', state.refetchSilent, { kinds: INCIDENT_KINDS })
  return state
}

/** One trip's incidents, for its detail panel and its exceptions. */
export function useTripIncidents(tripId: string): AsyncState<IncidentSummary[]> {
  const fetchList = useCallback(() => listTripIncidents(tripId), [tripId])
  const state = useAsyncData<IncidentSummary[]>(fetchList, [])
  useLiveResource('trip', tripId, state.refetchSilent, { kinds: INCIDENT_KINDS })
  return state
}

/** One incident in full. `tripId` scopes the live subscription once the incident is loaded. */
export function useIncidentDetail(incidentId: string): AsyncState<IncidentDetail | null> {
  const fetchDetail = useCallback(() => getIncident(incidentId), [incidentId])
  const state = useAsyncData<IncidentDetail | null>(fetchDetail, null)
  useLiveResource('trip', state.data?.trip_id ?? 'any', state.refetchSilent, { kinds: INCIDENT_KINDS })
  return state
}

export function useIncidentEvidence(incidentId: string): AsyncState<IncidentEvidence | null> {
  const fetchEvidence = useCallback(() => getIncidentEvidence(incidentId), [incidentId])
  return useAsyncData<IncidentEvidence | null>(fetchEvidence, null)
}
