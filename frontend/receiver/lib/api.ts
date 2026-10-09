// frontend/receiver/lib/api.ts
//
// This app talks to exactly two endpoints and holds no session. There is no bearer token
// to attach and no refresh path to get wrong — the capability token in the URL is half
// the authorisation and an HttpOnly cookie is the other half, which is why this file is
// forty lines where the driver app's client is two hundred.
//
// `credentials: 'include'` on BOTH calls is load-bearing, not boilerplate. The GET is how
// the binding cookie is received; the POST is how it is presented. Drop it from either
// and every handover fails its binding check with a 404 that explains nothing.

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export class HandoverError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HandoverError'
  }
}

export interface HandoverScan {
  trip_reference: string
  destination_name: string
  waybill_references: string[]
  expires_at: string
  verification: VerificationState | null
}

export interface ConfirmPayload {
  receiver_name: string
  receiver_id_number: string
  signature_png_base64: string
  receiver_lat: number | null
  receiver_lng: number | null
  receiver_accuracy_m: number | null
}

export interface HandoverConfirmed {
  confirmed_at: string
  trip_reference: string
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new HandoverError(res.status, (body as { detail?: string }).detail ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export async function fetchScan(token: string): Promise<HandoverScan> {
  return parse<HandoverScan>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}`, {
      cache: 'no-store',
      credentials: 'include',
    }),
  )
}

export async function confirmHandover(
  token: string,
  payload: ConfirmPayload,
): Promise<HandoverConfirmed> {
  return parse<HandoverConfirmed>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    }),
  )
}

export interface VerificationState {
  status: 'pending' | 'verified' | 'failed' | 'unverified'
  tier: 'document_and_face' | 'selfie_only' | 'typed_only'
  unverified_reason: string | null
  identity_match: boolean | null
}

export interface VerifyStarted {
  /** Null on every degradation path — quota spent, vendor down, no document. NOT an error. */
  session_url: string | null
  tier: string
  unverified_reason: string | null
}

export async function recordConsent(
  token: string,
  consentText: string,
  hasDocument: boolean,
): Promise<VerificationState> {
  return parse<VerificationState>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      // `consented: true` stated outright rather than left to the server's default: this
      // route records agreement, and a refusal goes through recordConsentDecline.
      body: JSON.stringify({ consent_text: consentText, consented: true, has_document: hasDocument }),
    }),
  )
}

/**
 * Record that the receiver declined the identity check.
 *
 * Separate from recordConsent so a refusal can never be sent as agreement: the server
 * stores no consent timestamp or wording hash for it.
 */
export async function recordConsentDecline(
  token: string,
  consentText: string,
): Promise<VerificationState> {
  return parse<VerificationState>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ consent_text: consentText, consented: false }),
    }),
  )
}

export async function startVerification(token: string): Promise<VerifyStarted> {
  return parse<VerifyStarted>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}/verify`, {
      method: 'POST',
      credentials: 'include',
    }),
  )
}

/**
 * Ask the server to fetch the vendor's decision.
 *
 * Deliberately sends NO session identifier (only the typed name and ID number, in the
 * body for the cross-check) — the server uses the id it stored before
 * redirecting. A client that could name a session could point us at someone else's
 * approved one, and this route has no authentication by design.
 */
export async function resolveVerification(
  token: string,
  receiverName: string,
  receiverIdNumber: string,
): Promise<VerificationState> {
  return parse<VerificationState>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}/verify/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      // A body, never the URL: the name and ID number would otherwise be written to the
      // server's access log and every proxy and platform log in front of it. These are the
      // typed identity only; the session id is still never sent.
      body: JSON.stringify({ receiver_name: receiverName, receiver_id_number: receiverIdNumber }),
    }),
  )
}
