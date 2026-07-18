/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 */

import { supabase, getAccessToken } from '@/lib/supabase'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// Hard ceiling on the auth-session lookup. supabase.auth.getSession() is not always a
// cheap local read: when the access token is near expiry (within auth-js's refresh
// margin) it performs a *blocking* network token refresh. If that refresh stalls — e.g.
// the background auto-refresh timer was throttled while the tab was idle, leaving a
// wedged connection — getSession() never resolves and a handshake submit awaiting it
// hangs forever with the UI showing nothing.
const SESSION_TIMEOUT_MS = 8_000

// Hard ceiling on a single backend fetch. A stalled socket otherwise hangs with no
// error, so an evidence submit never settles and never reaches the backend.
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

// Resolve the bearer token. Hot path: the in-memory cache (kept current by
// onAuthStateChange), which avoids calling getSession() per request — that acquires
// Supabase's auth lock and is what let a single wedged token refresh hang every
// handshake submit. Cold start only: before the cache is seeded (the very first request
// after a hard page load), fall back to one bounded getSession() so the request still
// carries a token. This fallback no longer runs on the hot path, so it can't stall a
// driver mid-handshake.
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

// Per-call override of the default request ceiling. Some endpoints (handshake
// completes that anchor to Hedera server-side, multipart photo uploads on mobile
// networks) legitimately take longer than the 12s default — callers that know this
// pass a bigger budget rather than the wrapper guessing per-path.
export interface RequestOptions {
  timeoutMs?: number
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  isFormData = false,
  opts: RequestOptions = {},
  // Set only on the internal one-shot 401 retry below — its presence *is* the "already
  // retried" flag, so a retried request can never retry again even if the refreshed
  // token itself comes back 401.
  retryToken?: string,
): Promise<T> {
  const url = `${BASE_URL}${path}`
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS

  // On the retry we already hold a freshly refreshed token from refreshSession() —
  // use it directly rather than calling resolveToken() again. resolveToken()'s hot
  // path reads the cache that onAuthStateChange updates asynchronously, which isn't
  // guaranteed to have caught up yet and would risk retrying with the same stale token.
  const token = retryToken ?? (await resolveToken())

  const headers: Record<string, string> = {
    // FormData sets its own multipart boundary — never set Content-Type ourselves for it.
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  }

  let res: Response
  try {
    res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    // AbortSignal.timeout rejects with a DOMException named 'TimeoutError' once the
    // ceiling is hit — this is what previously let a stalled socket hang an evidence
    // submit forever with no error and no feedback to the driver.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError(0, `Request to ${url} timed out after ${timeoutMs}ms`)
    }
    throw err
  }

  // A 401 usually means the access token expired between resolveToken() and the
  // backend validating it, or the cache was simply stale — not that the session is
  // truly invalid. Force one refresh and retry exactly once with the new token; a
  // fresh AbortSignal.timeout(timeoutMs) is created for the retry by the recursive
  // call, so the per-request timeout ceiling still applies to it.
  if (res.status === 401 && retryToken === undefined) {
    // Bounded like every other auth call in this file: refreshSession() hits the
    // network and can wedge exactly the way getSession() used to — an unbounded await
    // here would hang the submit the 401 interrupted. On any refresh failure
    // (error result, timeout, throw) we fall through WITHOUT retrying so the driver
    // gets the original 401 — and the recursive retry sits outside the try so its own
    // failures (e.g. a genuine 422 on the retried request) are never masked as a 401.
    let freshToken: string | null = null
    try {
      const { data, error } = await withTimeout(
        supabase.auth.refreshSession(),
        SESSION_TIMEOUT_MS,
        'Auth session refresh',
      )
      if (!error) freshToken = data.session?.access_token ?? null
    } catch (refreshErr) {
      console.warn('[api] token refresh after 401 failed — surfacing the original 401:', refreshErr)
    }
    if (freshToken) {
      return request<T>(path, init, isFormData, opts, freshToken)
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

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions): Promise<T> => request<T>(path, {}, false, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }, false, opts),
  postForm: <T>(path: string, form: FormData, opts?: RequestOptions): Promise<T> =>
    request<T>(path, { method: 'POST', body: form }, true, opts),
}
