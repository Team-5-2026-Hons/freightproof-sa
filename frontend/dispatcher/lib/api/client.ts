/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 */

import { supabase, getAccessToken } from '@/lib/supabase/client'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

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
const REQUEST_TIMEOUT_MS = 12_000

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

// Sends one logical request, returning the raw Response — HTTP status handling (incl. 401) is
// the caller's job. Includes one retry on a network-layer rejection: Safari reuses an HTTP
// keep-alive connection that uvicorn has already closed (NSURLErrorNetworkConnectionLost),
// which a fresh connection fixes. Only safe for idempotent calls, so it is opt-in.
async function send(
  url: string,
  init: RequestInit,
  headers: Record<string, string>,
  retry: boolean,
): Promise<Response> {
  const maxAttempts = retry ? 2 : 1
  let res: Response | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      break
    } catch (err) {
      // A timeout means the socket stalled rather than cleanly dropped. The retry exists
      // only for the immediate NSURLErrorNetworkConnectionLost dead-keep-alive case, so
      // don't spend a second full timeout window — surface it now as a clear error.
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new ApiError(0, `Request to ${url} timed out after ${REQUEST_TIMEOUT_MS}ms`)
      }
      if (attempt >= maxAttempts) throw err
      await new Promise(resolve => setTimeout(resolve, NETWORK_RETRY_DELAY_MS))
    }
  }
  // The loop either breaks with a response or throws; this guards the type narrowing.
  if (!res) throw new Error(`Request to ${url} produced no response`)
  return res
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { retry?: boolean } = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`
  const retry = opts.retry ?? false

  let token = await resolveToken()
  let res = await send(url, init, buildHeaders(token, init), retry)

  // 401 recovery. The cached token is normally kept fresh by the background auto-refresh, but
  // after a long idle (timers throttled while the tab was backgrounded) it can be stale, so the
  // first request races ahead of the visibility-triggered refresh and the backend rejects it.
  // Refresh the session once via getSession() (which performs the token refresh when expired)
  // and retry. If it still 401s the session is genuinely dead → sign out, which fires SIGNED_OUT
  // and lets AuthContext + the route guard send the user to /login.
  if (res.status === 401) {
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
      res = await send(url, init, buildHeaders(token, init), retry)
    }
    if (res.status === 401) {
      // signOut's local session clear succeeds even if its network call fails, so swallow that
      // failure deliberately — the local sign-out is what matters; we surface the 401 below.
      await supabase.auth.signOut().catch(() => { /* network sign-out failure is non-fatal here */ })
      throw new ApiError(401, 'Session expired. Please sign in again.')
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    const raw = (body as { detail?: unknown }).detail
    const message = Array.isArray(raw)
      ? (raw[0] as { msg?: string })?.msg ?? res.statusText
      : (raw as string | undefined) ?? res.statusText
    throw new ApiError(res.status, message)
  }

  return res.json() as Promise<T>
}

export const api = {
  // GETs are idempotent → retry once on a dropped connection.
  get: <T>(path: string): Promise<T> => request<T>(path, {}, { retry: true }),
  // POSTs are not retried by default (a dropped connection may have already mutated state).
  // Pass { idempotent: true } for read-only POSTs (e.g. /blockchain/verify) to opt in.
  post: <T>(path: string, body: unknown, opts?: { idempotent?: boolean }): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }, { retry: opts?.idempotent ?? false }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
}
