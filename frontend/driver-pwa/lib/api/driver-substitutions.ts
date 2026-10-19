// Driver-side reads for FP-83 driver substitution (docs/contracts/driver-substitution-v1.md,
// "Driver endpoints"). Every shape is the shared contract type — this file adds no DTO of its
// own, so the live OpenAPI comparison at C6 has exactly one schema to check against.
//
// Kept apart from lib/api/trips.ts on purpose: a pending substitution is NOT the driver's
// current trip. GET /trips/me/active stays the current-assignment read; these are a second,
// independent resource the incoming driver needs even when they have no trip at all.

import { api, ApiError } from './client'
import type {
  DriverParticipationHistoryRead,
  DriverSubstitutionContextRead,
  SubstitutionErrorCode,
  SubstitutionNoticeRead,
  SubstitutionRequestRead,
} from '@shared/lib/types/driver-substitution'

const TRIPS_ME = '/api/v1/trips/me'

// Pending arrangements naming this driver as incoming OR outgoing. Does not replace
// fetchMyActiveTrip — a driver can hold a current trip and an incoming collection at once.
export const fetchDriverSubstitutions = (): Promise<SubstitutionRequestRead[]> =>
  api.get<SubstitutionRequestRead[]>(`${TRIPS_ME}/driver-substitutions`)

// The driver-safe collection context: remaining stops, current findings and the submitted
// declarations. For a cancelled/replaced request the server returns only the arrangement
// snapshot, never later live progress.
export const fetchDriverSubstitutionContext = (
  tripId: string,
  requestId: string,
): Promise<DriverSubstitutionContextRead> =>
  api.get<DriverSubstitutionContextRead>(`${TRIPS_ME}/${tripId}/driver-substitutions/${requestId}`)

// Unread only by default: a notice is persistent until the driver dismisses it, and the
// server already bounds the list newest-first.
export const fetchSubstitutionNotices = (unreadOnly = true): Promise<SubstitutionNoticeRead[]> =>
  api.get<SubstitutionNoticeRead[]>(`${TRIPS_ME}/substitution-notices?unread_only=${unreadOnly}`)

// Marking read only hides the notice. It is never a handover confirmation and never moves
// custody — those are separate, evidence-bearing actions (T2).
export const markSubstitutionNoticeRead = (noticeId: string): Promise<SubstitutionNoticeRead> =>
  api.post<SubstitutionNoticeRead>(`${TRIPS_ME}/substitution-notices/${noticeId}/read`)

// This driver's own periods on a trip, for a former (or current) participant. 404 for a
// driver who never took part.
export const fetchDriverParticipation = (tripId: string): Promise<DriverParticipationHistoryRead> =>
  api.get<DriverParticipationHistoryRead>(`${TRIPS_ME}/${tripId}/participation`)

export function hasErrorCode(err: unknown, code: SubstitutionErrorCode): err is ApiError {
  return err instanceof ApiError && err.code === code
}

// The coded answer a current-assignment read or live write gives a known former participant.
// Distinct from 404 (never this driver's trip) and from a duplicate (EVIDENCE_ALREADY_RECORDED).
export const isTripHandedOver = (err: unknown): err is ApiError => hasErrorCode(err, 'TRIP_HANDED_OVER')
