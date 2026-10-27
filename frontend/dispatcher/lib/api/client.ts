/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 */

import { supabase, getAccessToken } from '@/lib/supabase/client'
import { isRecord } from '@/lib/api/json'
import type { Trip, TripCreatePayload, TripStatus } from '@shared/lib/types/trip'
import type { CrewAvailability } from '@shared/lib/types/availability'
import type { PPManifestPreview, PPManifestRef, TripFromPPManifestPayload } from '@shared/lib/types/pp-manifest'
import type { TripException, DispatcherReviewOutcome, ExceptionContactMethod } from '@shared/lib/types/exception'

export const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const NETWORK_RETRY_DELAY_MS = 150

const SESSION_TIMEOUT_MS = 8_000

const REQUEST_TIMEOUT_MS = 20_000

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail: unknown = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function detailMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    const first: unknown = raw[0]
    return isRecord(first) && typeof first.msg === 'string' ? first.msg : fallback
  }
  if (isRecord(raw) && typeof raw.message === 'string') return raw.message
  return fallback
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ApiError(0, `${label} timed out after ${ms}ms`)),
      ms,
    )
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err: unknown) => { clearTimeout(timer); reject(err) },
    )
  })
}

async function resolveToken(): Promise<string | null> {
  const cached = getAccessToken()
  if (cached !== null) return cached
  const { data: { session } } = await withTimeout(
    supabase.auth.getSession(),
    SESSION_TIMEOUT_MS,
    'Auth session lookup',
  )
  return session?.access_token ?? null
}

function buildHeaders(token: string | null, init: RequestInit): Record<string, string> {
  return {
    ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  }
}

interface PendingResponse {
  res: Response
  timedOut: () => boolean
  disarm: () => void
}

async function send(
  url: string,
  init: RequestInit,
  headers: Record<string, string>,
  retry: boolean,
  timeoutMs: number,
): Promise<PendingResponse> {
  const maxAttempts = retry ? 2 : 1
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    let timedOut = false
    const expiry = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      const res = await fetch(url, { ...init, headers, signal: controller.signal })
      return { res, timedOut: () => timedOut, disarm: () => clearTimeout(expiry) }
    } catch (err) {
      clearTimeout(expiry)
      if (timedOut) {
        throw new ApiError(0, `Request to ${url} timed out after ${timeoutMs}ms`)
      }
      if (attempt >= maxAttempts) {
        const message = err instanceof Error ? err.message : String(err)
        throw new ApiError(0, `Request to ${url} failed: ${message}`)
      }
      await new Promise(resolve => setTimeout(resolve, NETWORK_RETRY_DELAY_MS))
    }
  }
  throw new Error(`Request to ${url} produced no response`)
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { retry?: boolean; timeoutMs?: number; as?: 'json' | 'blob' } = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`
  const retry = opts.retry ?? false
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS

  let token = await resolveToken()
  let pending = await send(url, init, buildHeaders(token, init), retry, timeoutMs)

  try {
    if (pending.res.status === 401) {
      const { data: { session } } = await withTimeout(
        supabase.auth.getSession(),
        SESSION_TIMEOUT_MS,
        'Auth session refresh',
      )
      const refreshed = session?.access_token ?? null
      if (refreshed && refreshed !== token) {
        token = refreshed
        pending.disarm()
        pending = await send(url, init, buildHeaders(token, init), retry, timeoutMs)
      }
      if (pending.res.status === 401) {
        await supabase.auth.signOut().catch(() => { })
        throw new ApiError(401, 'Session expired. Please sign in again.')
      }
    }

    const res = pending.res

    if (!res.ok) {
      const body: unknown = await res.json().catch(() => ({ detail: res.statusText }))
      const raw = isRecord(body) ? body.detail : undefined
      throw new ApiError(res.status, detailMessage(raw, res.statusText), raw ?? null)
    }

    try {
      return (opts.as === 'blob' ? await res.blob() : await res.json()) as T
    } catch (err) {
      if (pending.timedOut()) {
        throw new ApiError(0, `Request to ${url} timed out after ${timeoutMs}ms`)
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new ApiError(0, `Reading the response from ${url} failed: ${message}`)
    }
  } finally {
    pending.disarm()
  }
}


export const api = {
  get: <T>(path: string, opts?: { timeoutMs?: number }): Promise<T> =>
    request<T>(path, {}, { retry: true, timeoutMs: opts?.timeoutMs }),
  getBlob: (path: string, opts?: { timeoutMs?: number }): Promise<Blob> =>
    request<Blob>(path, {}, { retry: true, as: 'blob', timeoutMs: opts?.timeoutMs }),
  post: <T>(path: string, body: unknown, opts?: { idempotent?: boolean; timeoutMs?: number }): Promise<T> =>
    request<T>(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      { retry: opts?.idempotent ?? false, timeoutMs: opts?.timeoutMs },
    ),
  postForm: <T>(path: string, form: FormData, opts?: { timeoutMs?: number }): Promise<T> =>
    request<T>(path, { method: 'POST', body: form }, { timeoutMs: opts?.timeoutMs }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
}

/** POST /trips/{tripId}/cancel — dispatcher abandons a trip mid-plan. Phase rows are
 *  left as-is (evidence, not completion); `note` is required server-side (422 on blank). */
export function cancelTrip(tripId: string, note: string): Promise<Trip> {
  return api.post<Trip>(`/api/v1/trips/${tripId}/cancel`, { note })
}

/** POST /trips/{tripId}/phases/{phaseEventId}/override — dispatcher records that the
 *  driver could not complete a phase. Only legal while PENDING or IN_PROGRESS server-side
 *  (409 otherwise). */
export function overridePhase(tripId: string, phaseEventId: string, note: string): Promise<Trip> {
  return api.post<Trip>(`/api/v1/trips/${tripId}/phases/${phaseEventId}/override`, { note })
}

/** PATCH /exceptions/{exceptionId}/review — dispatcher records their assessment of an
 *  exception. `contact_method` must be sent explicitly, including `null`, since the
 *  backend treats a missing key differently from an explicit null. Never touches
 *  Trip.status, so it's legal on a closed/cancelled trip too.
 *
 *  Returns the narrower TripExceptionRead shape (no trip_status/phase_label/
 *  supporting_artifact) — don't re-render the exception-detail page from it directly,
 *  use refetchSilent() from useExceptionDetail instead.
 *
 *  `take_over: true` takes a colleague's claim and reviews in one step (soft claim);
 *  omit it otherwise. */
export function reviewException(
  exceptionId: string,
  body: {
    review_note: string
    review_outcome: DispatcherReviewOutcome
    contact_method: ExceptionContactMethod | null
    take_over?: boolean
  },
): Promise<TripException> {
  return api.patch<TripException>(`/api/v1/exceptions/${exceptionId}/review`, body)
}

/** POST /exceptions/{id}/claim — the caller is now working this exception. takeOver
 *  replaces a colleague's claim; without it a colleague's claim is a 409. */
export function claimException(exceptionId: string, takeOver = false): Promise<TripException> {
  return api.post<TripException>(`/api/v1/exceptions/${exceptionId}/claim`, { take_over: takeOver })
}

/** DELETE /exceptions/{id}/claim — give the exception back to the unreviewed inbox. */
export function releaseException(exceptionId: string): Promise<TripException> {
  return api.delete<TripException>(`/api/v1/exceptions/${exceptionId}/claim`)
}

/** GET /trips/pp-manifest-preview: read-only. The warnings say what blocks creation and
 *  what the dispatcher must supply (spec §10.1). */
export function previewPPManifest(manifestNumber: number): Promise<PPManifestPreview> {
  return api.get<PPManifestPreview>(`/api/v1/trips/pp-manifest-preview?manifest_number=${manifestNumber}`)
}

export const TRIP_CREATE_TIMEOUT_MS = 30_000

/** POST /trips/from-pp-manifest: a loaded trip from a PP manifest (spec §10.2). */
export function createTripFromPPManifest(payload: TripFromPPManifestPayload): Promise<Trip> {
  return api.post<Trip>('/api/v1/trips/from-pp-manifest', payload, { timeoutMs: TRIP_CREATE_TIMEOUT_MS })
}

/** POST /trips: the explicit path, which the screen uses for empty legs (spec §10.3). */
export function createTrip(payload: TripCreatePayload): Promise<Trip> {
  return api.post<Trip>('/api/v1/trips', payload, { timeoutMs: TRIP_CREATE_TIMEOUT_MS })
}

/** GET /trips/availability: every driver, horse and trailer busy in [start, end), with the trip
 *  holding it and until when (FP-142). Read-only; the same rule trip creation refuses with. */
export function getCrewAvailability(startIso: string, endIso: string): Promise<CrewAvailability> {
  const query = new URLSearchParams({ start: startIso, end: endIso })
  return api.get<CrewAvailability>(`/api/v1/trips/availability?${query.toString()}`)
}

interface TripManifestRow {
  id: string
  status: TripStatus
  pp_manifest: PPManifestRef | null
}

/** The non-cancelled trip carrying this manifest, or null (spec §10.4). The filter on the
 *  number is exact. The full key is then compared, because the number alone is unique
 *  only in the mock. Throws ApiError when the lookup itself fails. */
export async function findLiveTripForManifest(key: PPManifestRef): Promise<{ id: string } | null> {
  const rows = await api.get<TripManifestRow[]>(`/api/v1/trips?pp_manifest_number=${key.number}`)
  const live = rows.find(row =>
    row.status !== 'cancelled'
    && row.pp_manifest?.issuer_account === key.issuer_account
    && row.pp_manifest.origin_hub === key.origin_hub
    && row.pp_manifest.number === key.number,
  )
  return live ? { id: live.id } : null
}

export interface BatchReviewBody {
  trip_id: string
  exception_ids: string[]
  review_note: string
  review_outcome: DispatcherReviewOutcome
  contact_method: ExceptionContactMethod | null
}

/** POST /exceptions/review-batch — one note and outcome across several non-critical
 *  exceptions on one trip. Explicit ids: only the rows the dispatcher was shown. */
export function reviewExceptionBatch(body: BatchReviewBody): Promise<TripException[]> {
  return api.post<TripException[]>('/api/v1/exceptions/review-batch', body)
}
