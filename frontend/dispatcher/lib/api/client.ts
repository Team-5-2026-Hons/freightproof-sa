/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 */

import { supabase, getAccessToken } from '@/lib/supabase/client'
import type { Trip } from '@shared/lib/types/trip'
import type { TripException, DispatcherReviewOutcome, ExceptionContactMethod } from '@shared/lib/types/exception'

// Exported so non-fetch transports (the SSE stream reader in lib/realtime) hit the
// same backend origin without re-deriving it.
export const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// Delay before retrying a request whose connection was dropped at the network layer.
const NETWORK_RETRY_DELAY_MS = 150

// getSession() can perform a *blocking* network token refresh near token expiry; if
// that stalls (auto-refresh timer throttled while the tab was idle) it never resolves.
const SESSION_TIMEOUT_MS = 8_000

// Ceiling on a single backend fetch — a stalled socket otherwise hangs with no error.
// Must exceed backend HEDERA_SUBMIT_TIMEOUT_SECONDS (15s, core/config.py): a Hedera-anchoring
// write can legitimately take that long, and the backend's own timeout should produce
// the 504 first, not this one aborting on a request still genuinely in flight.
const REQUEST_TIMEOUT_MS = 20_000

export class ApiError extends Error {
  // status 0 = client-side failure, no HTTP response received (request/session timeout).
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Rejects with a timeout ApiError if the wrapped promise hasn't settled in `ms`. Used to
// bound supabase.auth.getSession(), which can otherwise hang indefinitely.
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

// Hot path: the in-memory cache (kept current by onAuthStateChange) avoids calling
// getSession() per request, since that acquires Supabase's auth lock and caused a
// post-idle deadlock. Cold start only: before the cache is seeded, fall back to one
// bounded getSession().
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
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  }
}

// A response whose timeout is still armed. fetch() resolves at the *headers*, so a
// half-open socket stalls in res.json(), not before it — the caller must disarm once
// the body has settled or been abandoned, or the timer fires on a stale request.
interface PendingResponse {
  res: Response
  timedOut: () => boolean
  disarm: () => void
}

// Sends one logical request with its timeout still armed; HTTP status handling (incl.
// 401) and the body read are the caller's job. Retries once on a network-layer rejection
// (Safari reusing a keep-alive connection uvicorn already closed) — opt-in since it's
// only safe for idempotent calls.
async function send(
  url: string,
  init: RequestInit,
  headers: Record<string, string>,
  retry: boolean,
  timeoutMs: number,
): Promise<PendingResponse> {
  const maxAttempts = retry ? 2 : 1
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Own controller/flag rather than AbortSignal.timeout(): WebKit rejects a timed-out
    // signal as a generic AbortError, not TimeoutError, so inferring the cause from the
    // rejection's name missed every timeout on Safari.
    const controller = new AbortController()
    let timedOut = false
    const expiry = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      const res = await fetch(url, { ...init, headers, signal: controller.signal })
      // Not cleared here — fetch resolving at the headers doesn't mean the body is read
      // yet, so the window (and controller) must stay armed until request() is done.
      return { res, timedOut: () => timedOut, disarm: () => clearTimeout(expiry) }
    } catch (err) {
      clearTimeout(expiry)
      if (timedOut) {
        throw new ApiError(0, `Request to ${url} timed out after ${timeoutMs}ms`)
      }
      if (attempt >= maxAttempts) {
        // Any other fetch-level failure is as ambiguous as a timeout (request may have
        // already reached the server) — normalise to the same ApiError(0, ...) shape.
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
  opts: { retry?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`
  const retry = opts.retry ?? false
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS

  let token = await resolveToken()
  let pending = await send(url, init, buildHeaders(token, init), retry, timeoutMs)

  // Every exit disarms the window, including throwing ones, so a timer never aborts a
  // connection the caller has stopped waiting on.
  try {
    // 401 recovery: a cached token can go stale after a long idle, racing ahead of the
    // visibility-triggered refresh. Refresh once via getSession() and retry; if it still
    // 401s the session is genuinely dead, so sign out (fires SIGNED_OUT → route guard).
    if (pending.res.status === 401) {
      const { data: { session } } = await withTimeout(
        supabase.auth.getSession(),
        SESSION_TIMEOUT_MS,
        'Auth session refresh',
      )
      const refreshed = session?.access_token ?? null
      // Only retry if the token actually changed; an unchanged token means the 401 wasn't
      // a recoverable expiry.
      if (refreshed && refreshed !== token) {
        token = refreshed
        // The 401's body is never read, so disarm it before replacing it.
        pending.disarm()
        pending = await send(url, init, buildHeaders(token, init), retry, timeoutMs)
      }
      if (pending.res.status === 401) {
        // The local sign-out is what matters here; swallow a network failure on signOut
        // and surface the 401 below regardless.
        await supabase.auth.signOut().catch(() => { /* network sign-out failure is non-fatal here */ })
        throw new ApiError(401, 'Session expired. Please sign in again.')
      }
    }

    const res = pending.res

    if (!res.ok) {
      // Bounded by the still-armed window, so a stalled error body falls through to
      // statusText instead of hanging.
      const body = await res.json().catch(() => ({ detail: res.statusText }))
      const raw = (body as { detail?: unknown }).detail
      const message = Array.isArray(raw)
        ? (raw[0] as { msg?: string })?.msg ?? res.statusText
        : (raw as string | undefined) ?? res.statusText
      throw new ApiError(res.status, message)
    }

    try {
      return (await res.json()) as T
    } catch (err) {
      // A body that stalls rejects HERE when the window expires (fetch already resolved
      // at the headers) — the only point this can still be named a timeout, not a bare AbortError.
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
  // GETs are idempotent → retry once on a dropped connection.
  get: <T>(path: string): Promise<T> => request<T>(path, {}, { retry: true }),
  // Not retried by default (may have already mutated state); pass { idempotent: true }
  // for read-only POSTs. timeoutMs overrides REQUEST_TIMEOUT_MS for slower backend calls
  // (e.g. trip creation waiting on the Hedera anchor).
  post: <T>(path: string, body: unknown, opts?: { idempotent?: boolean; timeoutMs?: number }): Promise<T> =>
    request<T>(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      { retry: opts?.idempotent ?? false, timeoutMs: opts?.timeoutMs },
    ),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
}

// Dispatcher-only trip lifecycle exits: typed wrappers so callers never hand-build the
// path/body, returning the full updated TripDetailResponse to avoid a second GET.

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
 *  use refetchSilent() from useExceptionDetail instead. */
export function reviewException(
  exceptionId: string,
  body: { review_note: string; review_outcome: DispatcherReviewOutcome; contact_method: ExceptionContactMethod | null },
): Promise<TripException> {
  return api.patch<TripException>(`/api/v1/exceptions/${exceptionId}/review`, body)
}
