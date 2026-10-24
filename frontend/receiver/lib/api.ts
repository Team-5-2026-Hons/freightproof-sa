// No session or bearer token: the capability token in the URL and an HttpOnly binding
// cookie together authorise every call.
//
// `credentials: 'include'` on BOTH calls is load-bearing, not boilerplate. The GET is how
// the binding cookie is received; the POST is how it is presented. Drop it from either
// and every handover fails its binding check with a 404 that explains nothing. `request()`
// below sets it for every call so no future wrapper can forget it.
//
// Failures are deliberately distinguishable: a 404 means the token was refused, status 0
// means no answer arrived at all (offline, DNS, timeout). The page needs the difference —
// "this link is finished" is the wrong thing to tell someone whose signal just dropped.

const LOCAL_DEV_API_URL = 'http://localhost:8000'

function resolveBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL
  if (configured) return configured
  // A production bundle that fell back to loopback would "work" in every build check and
  // then fail on every receiver's phone, where localhost is the phone itself. Fail the
  // build instead.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be set for a production build; refusing to ship the localhost fallback.',
    )
  }
  return LOCAL_DEV_API_URL
}

const BASE_URL = resolveBaseUrl()

// The scan is read-only and the receiver is staring at a spinner; a write may legitimately
// take longer (it carries a signature image and does ledger work), and aborting one that is
// merely slow invites a second attempt against a single-use token.
const SCAN_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 30_000

/** `HandoverError.status` when no HTTP response arrived at all — the same 0 fetch uses for a network error. */
const NETWORK_FAILURE_STATUS = 0
const NETWORK_FAILURE_MESSAGE = 'The server could not be reached.'
const UNREADABLE_REPLY_MESSAGE = 'The server\'s reply could not be read.'

const HTTP_NOT_FOUND = 404
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_FLOOR = 500
const MS_PER_SECOND = 1_000
const DELTA_SECONDS_PATTERN = /^\d+$/

export class HandoverError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Only set for a 429 that carried a readable Retry-After. */
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'HandoverError'
  }
}

/** The server refused the capability token. All the reasons look identical by design (anti-oracle). */
export function isTokenRejected(err: unknown): boolean {
  return err instanceof HandoverError && err.status === HTTP_NOT_FOUND
}

/** Worth retrying as-is: no answer arrived, we were rate limited, or the server fell over. */
export function isTransientFailure(err: unknown): boolean {
  return (
    err instanceof HandoverError &&
    (err.status === NETWORK_FAILURE_STATUS ||
      err.status === HTTP_TOO_MANY_REQUESTS ||
      err.status >= HTTP_SERVER_ERROR_FLOOR)
  )
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * FastAPI sends `detail` as a string for HTTPException but as an array of
 * `{ loc, msg, type, input }` for a 422. Only `msg` is read: `input` echoes back whatever
 * the receiver typed, and a stranger's name or ID number must not end up in an error
 * string that gets logged or rendered.
 */
function messageFromBody(body: unknown): string | null {
  if (!isRecord(body)) return null
  const { detail } = body
  if (typeof detail === 'string') return detail === '' ? null : detail
  if (Array.isArray(detail)) {
    const messages: string[] = []
    for (const item of detail as unknown[]) {
      if (isRecord(item) && typeof item.msg === 'string') messages.push(item.msg)
    }
    return messages.length > 0 ? messages.join('; ') : null
  }
  return null
}

// Name only, never the error object or its message: both can quote request details.
function failureName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown'
}

async function readFailureMessage(res: Response): Promise<string> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch (err: unknown) {
    // A proxy or gateway error page is not JSON. Fall back to the status line below.
    console.warn('[handover] error response had no readable body:', res.status, failureName(err))
  }
  // HTTP/2 has no reason phrase, so statusText is often empty.
  return messageFromBody(body) ?? (res.statusText || `Request failed (${res.status})`)
}

/** Retry-After is either whole seconds or an HTTP-date (RFC 9110 §10.2.3). */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined
  const value = header.trim()
  if (DELTA_SECONDS_PATTERN.test(value)) return Number(value) * MS_PER_SECOND
  const dateMs = Date.parse(value)
  if (Number.isNaN(dateMs)) return undefined
  return Math.max(0, dateMs - Date.now())
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await readFailureMessage(res)
    const retryAfterMs =
      res.status === HTTP_TOO_MANY_REQUESTS
        ? parseRetryAfterMs(res.headers.get('Retry-After'))
        : undefined
    throw new HandoverError(res.status, message, retryAfterMs)
  }
  try {
    return (await res.json()) as T
  } catch (err: unknown) {
    // A 2xx whose body never arrived or isn't JSON (captive portal, connection lost
    // mid-body). We can't tell what the server did, so it is reported as "no answer".
    console.warn('[handover] success response had no readable body:', failureName(err))
    throw new HandoverError(NETWORK_FAILURE_STATUS, UNREADABLE_REPLY_MESSAGE)
  }
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(timeoutMs)
  // Older WebViews on shared warehouse phones lack AbortSignal.timeout. Without this every
  // request would throw before it left the device.
  const controller = new AbortController()
  setTimeout(() => {
    controller.abort(new DOMException('The request timed out.', 'TimeoutError'))
  }, timeoutMs)
  return controller.signal
}

async function request<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { ...init, credentials: 'include', signal: timeoutSignal(timeoutMs) })
  } catch (err: unknown) {
    // TypeError (offline, DNS, CORS) and TimeoutError/AbortError all mean "no answer".
    // The URL carries the live capability token, so only the error's name is logged and
    // the HandoverError message is fixed text.
    console.warn('[handover] request did not complete:', failureName(err))
    throw new HandoverError(NETWORK_FAILURE_STATUS, NETWORK_FAILURE_MESSAGE)
  }
  return parse<T>(res)
}

export async function fetchScan(token: string): Promise<HandoverScan> {
  return request<HandoverScan>(
    `${BASE_URL}/api/v1/handover/${token}`,
    { cache: 'no-store' },
    SCAN_TIMEOUT_MS,
  )
}

export async function confirmHandover(
  token: string,
  payload: ConfirmPayload,
): Promise<HandoverConfirmed> {
  return request<HandoverConfirmed>(
    `${BASE_URL}/api/v1/handover/${token}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    WRITE_TIMEOUT_MS,
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
  return request<VerificationState>(
    `${BASE_URL}/api/v1/handover/${token}/consent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The server requires `consented` (no default), so a body that omits it can never be
      // read as agreement; a refusal goes through recordConsentDecline.
      body: JSON.stringify({ consent_text: consentText, consented: true, has_document: hasDocument }),
    },
    WRITE_TIMEOUT_MS,
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
  return request<VerificationState>(
    `${BASE_URL}/api/v1/handover/${token}/consent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent_text: consentText, consented: false }),
    },
    WRITE_TIMEOUT_MS,
  )
}

export async function startVerification(token: string): Promise<VerifyStarted> {
  return request<VerifyStarted>(
    `${BASE_URL}/api/v1/handover/${token}/verify`,
    { method: 'POST' },
    WRITE_TIMEOUT_MS,
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
  return request<VerificationState>(
    `${BASE_URL}/api/v1/handover/${token}/verify/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // A body, never the URL: the name and ID number would otherwise be written to the
      // server's access log and every proxy and platform log in front of it. These are the
      // typed identity only; the session id is still never sent.
      body: JSON.stringify({ receiver_name: receiverName, receiver_id_number: receiverIdNumber }),
    },
    WRITE_TIMEOUT_MS,
  )
}
