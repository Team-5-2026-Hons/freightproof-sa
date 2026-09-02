/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 */

import { supabase, getAccessToken } from '@/lib/supabase/client'
import type { Trip } from '@shared/lib/types/trip'

// Exported so non-fetch transports that can't use this wrapper — notably the SSE
// stream reader in lib/realtime — hit the same backend origin without re-deriving it.
export const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// Delay before retrying a request whose connection was dropped at the network layer.
const NETWORK_RETRY_DELAY_MS = 150

// Hard ceiling on the auth-session lookup. supabase.auth.getSession() is not always a
// cheap local read: when the access token is near expiry (within auth-js's 90s margin)
// it performs a *blocking* network token refresh. If that refresh stalls — e.g. the
// background auto-refresh timer was throttled while the tab was idle, leaving a wedged
// connection — getSession() never resolves and the caller's loading state spins forever.
const SESSION_TIMEOUT_MS = 8_000

// Hard ceiling on a single backend fetch. A stalled socket (Safari's dead HTTP keep-alive,
// see the retry note below) otherwise hangs with no error, so the request never settles.
//
// Must exceed backend/app/core/config.py's HEDERA_SUBMIT_TIMEOUT_SECONDS (15s): any
// write that anchors to Hedera (precincts, vehicles, drivers) can legitimately take that
// long, and the backend's own asyncio.wait_for is what turns a slow/unreachable Hedera
// call into a clean 504 — if this fires first instead, the client aborts and reports a
// bare timeout while the backend request is still genuinely in flight, with nothing in
// its logs yet to explain why. 20s clears that with margin for network/serialisation
// overhead on top of the backend's own ceiling.
const REQUEST_TIMEOUT_MS = 20_000

export class ApiError extends Error {
  // status 0 is reserved for client-side failures where no HTTP response was received
  // (request/session timeout). Any positive status is the real HTTP response code.
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Rejects with a timeout ApiError if the wrapped promise has not settled in `ms`.
// Used to bound supabase.auth.getSession(), which can otherwise hang indefinitely.
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

// Resolve the bearer token. Hot path: the in-memory cache (kept current by onAuthStateChange),
// which avoids calling getSession() per request — that acquires Supabase's auth lock and was the
// source of the post-idle deadlock. Cold start only: before the cache is seeded (very first
// request after a hard page load), fall back to one bounded getSession() so the request still
// carries a token. This fallback no longer runs on the hot path, so it can't stall navigation.
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

// A response whose timeout is still armed. fetch() resolves at the *headers*, so the
// window has to outlive it: a half-open socket stalls in res.json(), not before it.
// The caller owns disarming and must do so once the body has settled or been abandoned,
// or the timer fires on a request it no longer represents.
interface PendingResponse {
  res: Response
  timedOut: () => boolean
  disarm: () => void
}

// Sends one logical request, returning the response with its timeout still armed — HTTP
// status handling (incl. 401) and the body read are the caller's job. Includes one retry on
// a network-layer rejection: Safari reuses an HTTP keep-alive connection that uvicorn has
// already closed (NSURLErrorNetworkConnectionLost), which a fresh connection fixes. Only
// safe for idempotent calls, so it is opt-in.
async function send(
  url: string,
  init: RequestInit,
  headers: Record<string, string>,
  retry: boolean,
  timeoutMs: number,
): Promise<PendingResponse> {
  const maxAttempts = retry ? 2 : 1
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Our own controller and flag rather than AbortSignal.timeout(), so "did WE time this
    // out?" is something we recorded rather than something inferred from the rejection's
    // name. It was inferred before, and the inference was wrong: WebKit rejects a
    // timed-out signal as an AbortError ("Fetch is aborted"), not the TimeoutError the
    // spec names. Every timeout therefore missed the check below and fell through to the
    // generic branch — so a stalled GET spent a SECOND full window retrying before
    // surfacing, and told the user it had "failed" rather than timed out.
    const controller = new AbortController()
    let timedOut = false
    const expiry = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      const res = await fetch(url, { ...init, headers, signal: controller.signal })
      // Deliberately NOT cleared here. Disarming on the headers is what left the body
      // unbounded: fetch has resolved, but nothing has been read yet, so the window has
      // to stay armed — and the controller reachable — until request() is done with it.
      return { res, timedOut: () => timedOut, disarm: () => clearTimeout(expiry) }
    } catch (err) {
      clearTimeout(expiry)
      // A timeout means the socket stalled rather than cleanly dropped. The retry exists
      // only for the immediate NSURLErrorNetworkConnectionLost dead-keep-alive case, so
      // don't spend a second full timeout window — surface it now as a clear error.
      if (timedOut) {
        throw new ApiError(0, `Request to ${url} timed out after ${timeoutMs}ms`)
      }
      if (attempt >= maxAttempts) {
        // Any other fetch-level failure (connection reset, DNS failure, offline) is just
        // as ambiguous as a timeout — the request may have already reached the server.
        // Normalise it to the same ApiError(0, ...) shape so callers can reconcile every
        // "did it actually happen?" failure the same way, not only clean timeouts.
        const message = err instanceof Error ? err.message : String(err)
        throw new ApiError(0, `Request to ${url} failed: ${message}`)
      }
      await new Promise(resolve => setTimeout(resolve, NETWORK_RETRY_DELAY_MS))
    }
  }
  // The loop either returns a response or throws; this satisfies return-path analysis.
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

  // Every exit from here disarms the window, including the throwing ones — a timer left
  // armed would abort a connection the caller has already stopped waiting on.
  try {
    // 401 recovery. The cached token is normally kept fresh by the background auto-refresh, but
    // after a long idle (timers throttled while the tab was backgrounded) it can be stale, so the
    // first request races ahead of the visibility-triggered refresh and the backend rejects it.
    // Refresh the session once via getSession() (which performs the token refresh when expired)
    // and retry. If it still 401s the session is genuinely dead → sign out, which fires SIGNED_OUT
    // and lets AuthContext + the route guard send the user to /login.
    if (pending.res.status === 401) {
      const { data: { session } } = await withTimeout(
        supabase.auth.getSession(),
        SESSION_TIMEOUT_MS,
        'Auth session refresh',
      )
      const refreshed = session?.access_token ?? null
      // Only retry if the refresh produced a *different* token; an unchanged token means the 401
      // wasn't a recoverable expiry (e.g. a revoked session), so don't waste a second round-trip.
      if (refreshed && refreshed !== token) {
        token = refreshed
        // Abandon the 401 outright: its body is never read, so disarm it here rather than
        // leaving an armed timer — and a controller nothing can reach — behind on a
        // response we are about to replace.
        pending.disarm()
        pending = await send(url, init, buildHeaders(token, init), retry, timeoutMs)
      }
      if (pending.res.status === 401) {
        // signOut's local session clear succeeds even if its network call fails, so swallow that
        // failure deliberately — the local sign-out is what matters; we surface the 401 below.
        await supabase.auth.signOut().catch(() => { /* network sign-out failure is non-fatal here */ })
        throw new ApiError(401, 'Session expired. Please sign in again.')
      }
    }

    const res = pending.res

    if (!res.ok) {
      // Bounded by the still-armed window: an error body that stalls gets aborted and falls
      // through to statusText instead of hanging. Deliberately not re-reported as a timeout —
      // the real HTTP status tells the caller more than "timed out" would.
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
      // fetch() resolved back at the headers, so a body that stalls rejects HERE when the
      // window expires — this is the only point at which that abort can still be named as
      // the timeout it is, rather than surfacing as a bare AbortError.
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
  // POSTs are not retried by default (a dropped connection may have already mutated state).
  // Pass { idempotent: true } for read-only POSTs (e.g. /blockchain/verify) to opt in.
  // timeoutMs overrides REQUEST_TIMEOUT_MS for calls whose backend legitimately works longer
  // (trip creation waits synchronously on the Hedera anchor).
  post: <T>(path: string, body: unknown, opts?: { idempotent?: boolean; timeoutMs?: number }): Promise<T> =>
    request<T>(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      { retry: opts?.idempotent ?? false, timeoutMs: opts?.timeoutMs },
    ),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
}

// ── Dispatcher-only trip lifecycle exits (task 6.1) ─────────────────────────
// Both are terminal-per-row actions with no other UI entry point, so they are typed
// wrappers here rather than inline api.post calls — callers never hand-build the path
// or body shape, and each is exercised in isolation from the component that calls it.
// Both return the FULL updated TripDetailResponse so the caller can reconcile from the
// response directly rather than issuing a second GET.

/** POST /trips/{tripId}/cancel — dispatcher abandons a trip mid-plan. Phase rows are
 *  left exactly as they are (evidence, not completion); `note` is required server-side
 *  (422 on blank) so this is never an unexplained dead end. */
export function cancelTrip(tripId: string, note: string): Promise<Trip> {
  return api.post<Trip>(`/api/v1/trips/${tripId}/cancel`, { note })
}

/** POST /trips/{tripId}/phases/{phaseEventId}/override — dispatcher records that the
 *  driver could not complete a phase (lost phone, left the depot, device wiped). Only
 *  legal while the phase is PENDING or IN_PROGRESS server-side (409 otherwise). */
export function overridePhase(tripId: string, phaseEventId: string, note: string): Promise<Trip> {
  return api.post<Trip>(`/api/v1/trips/${tripId}/phases/${phaseEventId}/override`, { note })
}
