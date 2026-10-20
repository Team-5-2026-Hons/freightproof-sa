import { ApiError, api } from './client'
import type {
  AcknowledgeLateEvidenceRequest,
  ArrangeSubstitutionRequest,
  CancelSubstitutionRequest,
  CompleteSubstitutionRequest,
  CorrectSubstitutionRequest,
  LateEvidenceDetailRead,
  LateEvidenceRead,
  ReplaceSubstitutionRequest,
  SubstitutionCorrectionRead,
  SubstitutionErrorCode,
  SubstitutionRequestRead,
} from '@shared/lib/types/driver-substitution'

// FP-83 dispatcher routes (docs/contracts/driver-substitution-v1.md "Dispatcher endpoints").
// Every mutation carries a client_request_id the caller creates once per intentional action, so
// a transport retry with the same body is an exact replay server-side: safe to mark idempotent.

const base = (tripId: string) => `/api/v1/trips/${tripId}/driver-substitutions`

export function arrangeSubstitution(tripId: string, body: ArrangeSubstitutionRequest): Promise<SubstitutionRequestRead> {
  return api.post<SubstitutionRequestRead>(base(tripId), body, { idempotent: true })
}

export function listSubstitutions(tripId: string): Promise<SubstitutionRequestRead[]> {
  return api.get<SubstitutionRequestRead[]>(base(tripId))
}

export function cancelSubstitution(tripId: string, requestId: string, body: CancelSubstitutionRequest): Promise<SubstitutionRequestRead> {
  return api.post<SubstitutionRequestRead>(`${base(tripId)}/${requestId}/cancel`, body, { idempotent: true })
}

export function replaceSubstitution(tripId: string, requestId: string, body: ReplaceSubstitutionRequest): Promise<SubstitutionRequestRead> {
  return api.post<SubstitutionRequestRead>(`${base(tripId)}/${requestId}/replace`, body, { idempotent: true })
}

export function completeSubstitution(tripId: string, requestId: string, body: CompleteSubstitutionRequest): Promise<SubstitutionRequestRead> {
  return api.post<SubstitutionRequestRead>(`${base(tripId)}/${requestId}/complete`, body, { idempotent: true })
}

export function correctSubstitution(tripId: string, substitutionId: string, body: CorrectSubstitutionRequest): Promise<SubstitutionCorrectionRead> {
  return api.post<SubstitutionCorrectionRead>(`${base(tripId)}/completed/${substitutionId}/corrections`, body, { idempotent: true })
}

export function listLateEvidence(tripId: string): Promise<LateEvidenceDetailRead[]> {
  return api.get<LateEvidenceDetailRead[]>(`/api/v1/trips/${tripId}/late-evidence`)
}

export function acknowledgeLateEvidence(tripId: string, evidenceId: string, body: AcknowledgeLateEvidenceRequest): Promise<LateEvidenceRead> {
  return api.post<LateEvidenceRead>(`/api/v1/trips/${tripId}/late-evidence/${evidenceId}/acknowledge`, body, { idempotent: true })
}

/** The contract's coded conflict, when the server sent one ({code, message, ...} detail). */
export function substitutionErrorCode(error: unknown): SubstitutionErrorCode | null {
  if (!(error instanceof ApiError) || typeof error.detail !== 'object' || error.detail === null) return null
  const code = (error.detail as { code?: unknown }).code
  return typeof code === 'string' ? (code as SubstitutionErrorCode) : null
}

/** A fresh key for one intentional action; reuse it for that action's retries, never across actions. */
export function newClientRequestId(): string {
  return crypto.randomUUID()
}
