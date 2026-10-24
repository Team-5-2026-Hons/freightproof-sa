import { api } from './client'
import type {
  IncidentCreate,
  IncidentDetail,
  IncidentDocumentLink,
  IncidentEvidence,
  IncidentListFilters,
  IncidentOutcome,
  IncidentSummary,
  IncidentUpdateCreate,
} from '@/lib/types/incident'

// Reporting a hijacking may stop the trip, which cancels any pending driver handover in the
// same request; give it more than the default budget on a slow day.
const REPORT_TIMEOUT_MS = 30_000
// An upload carries up to the evidence size limit over a dispatcher's office connection.
const UPLOAD_TIMEOUT_MS = 60_000
// The evidence view builds the trip's audit-pack manifest server-side.
const EVIDENCE_TIMEOUT_MS = 30_000

export function reportIncident(tripId: string, body: IncidentCreate): Promise<IncidentDetail> {
  return api.post<IncidentDetail>(`/api/v1/trips/${tripId}/incidents`, body, { timeoutMs: REPORT_TIMEOUT_MS })
}

export function listTripIncidents(tripId: string): Promise<IncidentSummary[]> {
  return api.get<IncidentSummary[]>(`/api/v1/trips/${tripId}/incidents`)
}

export function listIncidents(filters: IncidentListFilters = {}): Promise<IncidentSummary[]> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return api.get<IncidentSummary[]>(`/api/v1/incidents${suffix}`)
}

export function getIncident(incidentId: string): Promise<IncidentDetail> {
  return api.get<IncidentDetail>(`/api/v1/incidents/${incidentId}`)
}

export function getIncidentEvidence(incidentId: string): Promise<IncidentEvidence> {
  return api.get<IncidentEvidence>(`/api/v1/incidents/${incidentId}/evidence`, { timeoutMs: EVIDENCE_TIMEOUT_MS })
}

export function appendIncidentUpdate(incidentId: string, body: IncidentUpdateCreate): Promise<IncidentDetail> {
  return api.post<IncidentDetail>(`/api/v1/incidents/${incidentId}/updates`, body)
}

export function closeIncident(incidentId: string, outcome: IncidentOutcome, reason: string): Promise<IncidentDetail> {
  return api.post<IncidentDetail>(`/api/v1/incidents/${incidentId}/close`, { outcome, reason })
}

export function reopenIncident(incidentId: string, reason: string): Promise<IncidentDetail> {
  return api.post<IncidentDetail>(`/api/v1/incidents/${incidentId}/reopen`, { reason })
}

export function stopIncidentTrip(incidentId: string): Promise<IncidentDetail> {
  return api.post<IncidentDetail>(`/api/v1/incidents/${incidentId}/stop-trip`, {}, { timeoutMs: REPORT_TIMEOUT_MS })
}

export function assignIncidentToMe(incidentId: string, userId: string): Promise<IncidentDetail> {
  return appendIncidentUpdate(incidentId, { kind: 'assigned', assigned_to_user_id: userId })
}

export function attachIncidentDocument(incidentId: string, file: File, note: string): Promise<IncidentDetail> {
  const form = new FormData()
  form.append('file', file)
  form.append('note', note)
  return api.postForm<IncidentDetail>(`/api/v1/incidents/${incidentId}/documents`, form, { timeoutMs: UPLOAD_TIMEOUT_MS })
}

export function incidentDocumentUrl(incidentId: string, artifactId: string): Promise<IncidentDocumentLink> {
  return api.get<IncidentDocumentLink>(`/api/v1/incidents/${incidentId}/documents/${artifactId}/url`)
}
