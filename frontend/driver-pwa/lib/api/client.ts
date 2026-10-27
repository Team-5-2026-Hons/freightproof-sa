/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 */

import { getSupabase, getAccessToken } from '@/lib/supabase'
import { actorGeneration } from '@/lib/session/custody-context'
import { rememberSignedOutReason } from '@/lib/session/signed-out-reason'
import type { SubstitutionErrorCode } from '@shared/lib/types/driver-substitution'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const SESSION_TIMEOUT_MS = 8_000

const REQUEST_TIMEOUT_MS = 12_000

export type DriverConflictCode = SubstitutionErrorCode | 'PHASE_OVERRIDDEN'

export interface ApiErrorDetail {
  code: DriverConflictCode
  requestId: string | null
  currentVersion: number | null
  evidenceId: string | null
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
    public readonly detail?: ApiErrorDetail,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get code(): DriverConflictCode | undefined {
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

export const SESSION_SUPERSEDED_MESSAGE = 'Signed in on another device.'

interface ParsedError {
  message: string
  detail?: ApiErrorDetail
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

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
        code: coded.code as DriverConflictCode,
        requestId: nullableString(coded.request_id),
        currentVersion: typeof coded.current_version === 'number' ? coded.current_version : null,
        evidenceId: nullableString(coded.evidence_id),
      },
    }
  }
  return { message: (raw as string | undefined) ?? res.statusText }
}

async function signOutSupersededDevice(): Promise<void> {
  if (typeof window !== 'undefined') rememberSignedOutReason(SESSION_SUPERSEDED_MESSAGE)
  try {
    await getSupabase().auth.signOut()
  } catch (err) {
    console.warn('[api] sign-out after a superseded-device 401 failed locally:', err)
  }
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
    getSupabase().auth.getSession(),
    SESSION_TIMEOUT_MS,
    'Auth session lookup',
  )
  return session?.access_token ?? null
}

export interface RequestOptions {
  timeoutMs?: number
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  isFormData = false,
  opts: RequestOptions = {},
  retryToken?: string,
  originalGeneration: number = actorGeneration(),
): Promise<T> {
  const checkAccount = (): void => {
    if (actorGeneration() !== originalGeneration) throw new ApiError(0, 'Account changed; captured work is retained.')
  }
  checkAccount()
  const url = `${BASE_URL}${path}`
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS

  const token = retryToken ?? (await resolveToken())
  checkAccount()

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  }

  let res: Response
  try {
    res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError(0, `Request to ${url} timed out after ${timeoutMs}ms`)
    }
    throw err
  }

  checkAccount()

  const parsedError = res.ok ? null : await readError(res)
  checkAccount()
  const errorMessage = parsedError?.message ?? null

  if (res.status === 401 && errorMessage === SESSION_SUPERSEDED_MESSAGE) {
    checkAccount()
    await signOutSupersededDevice()
    throw new ApiError(res.status, SESSION_SUPERSEDED_MESSAGE)
  }

  if (res.status === 401 && retryToken === undefined) {
    checkAccount()
    let freshToken: string | null = null
    try {
      const { data, error } = await withTimeout(
        getSupabase().auth.refreshSession(),
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
  const body = await res.json() as T
  checkAccount()
  return body
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions): Promise<T> => request<T>(path, {}, false, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }, false, opts),
  postForm: <T>(path: string, form: FormData, opts?: RequestOptions): Promise<T> =>
    request<T>(path, { method: 'POST', body: form }, true, opts),
}
