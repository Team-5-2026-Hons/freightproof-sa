// The portal's only way to reach the API. No session, no bearer token: the share token
// in the URL is the credential, sent only to our own API and never in a Referer header.
//
// A pack issued to an email address also needs a viewer grant: earned once by
// entering the code emailed to the recipient, kept in this browser, and sent as a header
// on every request for that pack — a header, never the URL, which ends up in logs.
import type {
  EmailCodeSent,
  ErrorBody,
  LiveVerification,
  PublicAuditPackView,
  PublicPackSeal,
  ViewerGrant,
} from './types'

const LOCAL_API_URL = 'http://localhost:8000'
const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL
// A production bundle that silently fell back to the loopback address would ship a portal that
// can never load a pack (and would try to reach the visitor's own machine), so fail the build.
if (!configuredApiUrl && process.env.NODE_ENV === 'production') {
  throw new Error('NEXT_PUBLIC_API_URL must be set for a production build of the client portal.')
}
const BASE_URL = configuredApiUrl || LOCAL_API_URL
const PUBLIC = `${BASE_URL}/api/v1/public/audit-packs`

const GRANT_HEADER = 'X-Audit-Pack-Grant'
const GRANT_STORAGE_PREFIX = 'fp-audit-pack-grant:'
const BLOB_URL_LIFETIME_MS = 60_000

export class PackError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Set when the pack needs the emailed code: where it will be sent, masked. */
    public readonly emailHint: string | null = null,
  ) {
    super(message)
    this.name = 'PackError'
  }

  get verificationRequired(): boolean {
    return this.emailHint !== null
  }
}

const REQUEST: RequestInit = { cache: 'no-store', referrerPolicy: 'no-referrer' }

/** FastAPI sends a string for our own errors and a list of {msg} items for a 422. */
export function detailText(detail: ErrorBody['detail']): string | null {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => item.msg).filter((msg) => typeof msg === 'string' && msg !== '')
    return messages.length > 0 ? messages.join('; ') : null
  }
  return null
}

// The grant also lives in memory for the life of the page: when site storage is blocked
// (private mode, "block all cookies") the recipient who just entered a code would otherwise
// be asked again by the very next request, and the pack would never open.
const memoryGrants = new Map<string, string>()
let storageWriteFailed = false

export const STORAGE_BLOCKED_NOTICE = 'This browser blocks site storage, so you may be asked for a code again next time.'

/** True once saving the grant to this browser's storage failed: the next visit will ask for a code again. */
export function storageBlocked(): boolean {
  return storageWriteFailed
}

// Storage can throw (private mode, blocked site data). A lost stored grant only means
// entering a fresh code, so every failure here degrades to the in-memory copy, never to a broken page.
function readGrant(token: string): string | null {
  const remembered = memoryGrants.get(token)
  if (remembered) return remembered
  try {
    return window.localStorage.getItem(GRANT_STORAGE_PREFIX + token)
  } catch (error) {
    console.warn('Could not read the stored viewer grant', error)
    return null
  }
}

function storeGrant(token: string, grant: string): void {
  memoryGrants.set(token, grant)
  try {
    window.localStorage.setItem(GRANT_STORAGE_PREFIX + token, grant)
  } catch (error) {
    storageWriteFailed = true
    console.warn('Could not store the viewer grant; it is kept for this page only', error)
  }
}

function forgetGrant(token: string): void {
  memoryGrants.delete(token)
  try {
    window.localStorage.removeItem(GRANT_STORAGE_PREFIX + token)
  } catch (error) {
    console.warn('Could not remove the stored viewer grant', error)
  }
}

function packRequest(token: string, init: RequestInit = {}): RequestInit {
  const grant = readGrant(token)
  return { ...REQUEST, ...init, headers: grant ? { [GRANT_HEADER]: grant } : {} }
}

async function failure(response: Response, token: string | null): Promise<PackError> {
  const body = (await response.json().catch(() => ({}))) as ErrorBody
  const message = detailText(body.detail)
  if (response.status === 401 && body.verification_required && token !== null) {
    // A stored grant the server no longer accepts is useless; drop it so the next code sticks.
    forgetGrant(token)
    return new PackError(401, message ?? 'Enter the emailed code to open this pack.', body.email_hint ?? '')
  }
  return new PackError(response.status, message ?? response.statusText)
}

async function parse<T>(response: Response, token: string | null = null): Promise<T> {
  if (!response.ok) throw await failure(response, token)
  return (await response.json()) as T
}

const encode = encodeURIComponent

export async function fetchPack(token: string): Promise<PublicAuditPackView> {
  return parse(await fetch(`${PUBLIC}/${encode(token)}`, packRequest(token)), token)
}

export async function fetchSeal(packId: string): Promise<PublicPackSeal> {
  return parse(await fetch(`${PUBLIC}/seal/${encode(packId)}`, REQUEST))
}

export async function runServerVerification(token: string): Promise<LiveVerification> {
  return parse(await fetch(`${PUBLIC}/${encode(token)}/verify`, packRequest(token, { method: 'POST' })), token)
}

/** `signal` lets a photo that scrolls away or unmounts cancel its download. */
export async function fetchArtifactBytes(token: string, artifactId: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(`${PUBLIC}/${encode(token)}/artifacts/${encode(artifactId)}`, packRequest(token, { signal }))
  // Through failure(), not a bare PackError: the caller needs the real status (expired grant,
  // closed link, rate limit, storage outage) and whether the emailed code is wanted again.
  if (!response.ok) throw await failure(response, token)
  return response.arrayBuffer()
}

export async function requestEmailCode(token: string): Promise<EmailCodeSent> {
  return parse(await fetch(`${PUBLIC}/${encode(token)}/email-code`, { ...REQUEST, method: 'POST' }))
}

/** Exchanges the emailed code for a grant and keeps it, so later visits skip the code. */
export async function verifyEmailCode(token: string, code: string): Promise<void> {
  const grant = await parse<ViewerGrant>(await fetch(`${PUBLIC}/${encode(token)}/email-code/verify`, {
    ...REQUEST,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }))
  storeGrant(token, grant.grant)
}

export type PackDownload = 'pdf' | 'incident-sheet.pdf'

/**
 * Downloads one of the pack's PDFs. Fetched rather than linked: a plain link cannot carry
 * the grant header, and the grant must never go in the URL.
 */
export async function downloadPackFile(token: string, file: PackDownload, filename: string): Promise<void> {
  const response = await fetch(`${PUBLIC}/${encode(token)}/${file}`, packRequest(token))
  if (!response.ok) throw await failure(response, token)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoked later, not at once: some browsers are still reading the blob when click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS)
}
