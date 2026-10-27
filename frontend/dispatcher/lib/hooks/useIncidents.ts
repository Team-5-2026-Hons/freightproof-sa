'use client'

import { useCallback, useEffect, useRef } from 'react'
import { getIncident, getIncidentEvidence, listIncidents } from '@/lib/api/incidents'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import type { RealtimeKind } from '@/lib/realtime/types'
import type { IncidentDetail, IncidentEvidence, IncidentListFilters, IncidentSummary } from '@/lib/types/incident'
import { useAsyncData, type AsyncState } from './useAsyncData'
import { useTripResource } from './useTripResource'

const INCIDENT_KINDS: readonly RealtimeKind[] = ['incident_changed', 'trip_closed', 'exception_raised', 'exception_reviewed']

/** The organisation's incidents, refreshed live when any trip's incident changes. */
export function useIncidents(filters: IncidentListFilters): AsyncState<IncidentSummary[]> {
  const { status, incident_type, assigned_to } = filters
  const fetchList = useCallback(
    () => listIncidents({ status, incident_type, assigned_to }), [status, incident_type, assigned_to],
  )
  const state = useAsyncData<IncidentSummary[]>(fetchList, [])

  const fetchedFor = useRef(fetchList)
  const { refetch } = state
  useEffect(() => {
    if (fetchedFor.current === fetchList) return
    fetchedFor.current = fetchList
    refetch()
  }, [fetchList, refetch])

  useLiveResource('trip', 'any', state.refetchSilent, { kinds: INCIDENT_KINDS })
  return state
}

const NO_INCIDENTS: IncidentSummary[] = []

/** One trip's incidents, for its timeline, detail panel and exceptions. Held in the trip cache beside the
 *  trip itself, so coming back from an incident's page shows them at once and re-reads them behind. */
export function useTripIncidents(tripId: string): AsyncState<IncidentSummary[]> {
  return useTripResource<IncidentSummary[]>(tripId, '/incidents', NO_INCIDENTS, INCIDENT_KINDS)
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
