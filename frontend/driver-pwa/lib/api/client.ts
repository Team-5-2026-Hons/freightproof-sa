/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 */

import { supabase, getAccessToken } from '@/lib/supabase'
import { actorGeneration } from '@/lib/session/custody-context'
import type { SubstitutionErrorCode } from '@shared/lib/types/driver-substitution'

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

// The coded part of a domain-conflict `detail` object (driver substitution contract v1,
// "Stable errors"). Kept separate from the message so a caller branches on the stable code,
// never on wording the backend is free to change.
export interface ApiErrorDetail {
  code: SubstitutionErrorCode
  requestId: string | null
  currentVersion: number | null
  evidenceId: string | null
}

export class ApiError extends Error {
  // status 0 is reserved for client-side failures where no HTTP response was received
  // (request/session timeout). Any positive status is the real HTTP response code.
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
    // Absent for legacy string details and 422 field errors — most endpoints still send
    // those, so code-less errors remain the normal case, not a malformed one.
    public readonly detail?: ApiErrorDetail,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get code(): SubstitutionErrorCode | undefined {
    return this.detail?.code
  }
}

const MILLISECONDS_PER_SECOND = 1_000

function retryAfterMilliseconds(res: Response): number | undefined {
  if (res.status !== 429) return undefined
  const raw = res.headers?.get('Retry-After')
  if (!raw) return undefined

  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * MILLISECONDS_PER_SECOND
  }

  const retryAt = Date.parse(raw)
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - Date.now())
}

// The backend's exact detail for a device that has been superseded by a newer login —
// app/auth/sessions.py's SESSION_SUPERSEDED_DETAIL. Matched on rather than inferred from
// the status code, because an ordinary expired token is also a 401 and needs the opposite
// treatment (refresh and retry, don't sign out).
export const SESSION_SUPERSEDED_MESSAGE = 'Signed in on another device.'

// Read by the login screen to explain why the driver landed back there. sessionStorage,
// not localStorage: it is a one-off explanation for this launch, not a durable fact.
export const SIGNED_OUT_REASON_KEY = 'fp.signedOutReason'

interface ParsedError {
  message: string
  detail?: ApiErrorDetail
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// FastAPI puts the human-readable reason in `detail`, which is a string for a raised
// HTTPException, an array of field errors for a 422, and — for the substitution domain
// conflicts — a `{code, message, ...}` object. All three must keep parsing: the coded form
// is new, and every existing endpoint still sends the other two.
async function readError(res: Response): Promise<ParsedError> {
  const body = await res.json().catch(() => ({ detail: res.statusText }))
  const raw = (body as { detail?: unknown }).detail
  if (Array.isArray(raw)) {
    return { message: (raw[0] as { msg?: string })?.msg ?? res.statusText }
  }
  if (raw !== null && typeof raw === 'object') {
    const coded = raw as Record<string, unknown>
    const message = nullableString(coded.message) ?? res.statusText
    if (typeof coded.code !== 'string') return { message }
    return {
      message,
      detail: {
        // Not narrowed against the known list: a code this build doesn't know yet must
        // still reach the caller, which then treats it as an unrecognised conflict.
        code: coded.code as SubstitutionErrorCode,
        requestId: nullableString(coded.request_id),
        currentVersion: typeof coded.current_version === 'number' ? coded.current_version : null,
        evidenceId: nullableString(coded.evidence_id),
      },
    }
  }
  return { message: (raw as string | undefined) ?? res.statusText }
}

async function signOutSupersededDevice(): Promise<void> {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(SIGNED_OUT_REASON_KEY, SESSION_SUPERSEDED_MESSAGE)
  }
  try {
    await supabase.auth.signOut()
  } catch (err) {
    // Even if Supabase can't be reached, the local session is what gates the app —
    // AuthContext's own listener sees the sign-out and the (app) layout redirects.
    console.warn('[api] sign-out after a superseded-device 401 failed locally:', err)
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
  originalGeneration: number = actorGeneration(),
): Promise<T> {
  const checkAccount = (): void => {
    if (actorGeneration() !== originalGeneration) throw new ApiError(0, 'Account changed; captured work is retained.')
  }
  checkAccount()
  const url = `${BASE_URL}${path}`
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS

  // On the retry we already hold a freshly refreshed token from refreshSession() —
  // use it directly rather than calling resolveToken() again. resolveToken()'s hot
  // path reads the cache that onAuthStateChange updates asynchronously, which isn't
  // guaranteed to have caught up yet and would risk retrying with the same stale token.
  const token = retryToken ?? (await resolveToken())
  checkAccount()

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
  // Read the error body ONCE, before the retry logic, because one specific 401 is
  // decided by its detail rather than its status — and a Response body can only be
  // consumed once. Non-401 errors reuse this same parse when they throw below.
  const parsedError = res.ok ? null : await readError(res)
  const errorMessage = parsedError?.message ?? null

  // A superseded device (app/auth/sessions.py) must NOT be refresh-retried: a refresh
  // returns a token for the same Supabase session, so the retry would be refused
  // identically. This driver's account is now in use on another handset, so the honest
  // response is to sign this one out rather than leave it half-working.
  if (res.status === 401 && errorMessage === SESSION_SUPERSEDED_MESSAGE) {
    checkAccount()
    await signOutSupersededDevice()
    throw new ApiError(res.status, SESSION_SUPERSEDED_MESSAGE)
  }

  if (res.status === 401 && retryToken === undefined) {
    checkAccount()
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
      checkAccount()
      return request<T>(path, init, isFormData, opts, freshToken, originalGeneration)
    }
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      errorMessage ?? res.statusText,
      retryAfterMilliseconds(res),
      parsedError?.detail,
    )
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
