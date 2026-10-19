// The portal's only way to reach the API. No session, no bearer token: the share token
// in the URL is the credential, sent only to our own API and never in a Referer header.
//
// A pack issued to an email address also needs a viewer grant (FP-291): earned once by
// entering the code emailed to the recipient, kept in this browser, and sent as a header
// on every request for that pack — a header, never the URL, which ends up in logs.
import type { EmailCodeSent, LiveVerification, PublicAuditPackView, PublicPackSeal, ViewerGrant } from './types'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
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

interface ErrorBody {
  detail?: string
  verification_required?: boolean
  email_hint?: string
}

// Storage can throw (private mode, blocked site data). A lost grant only means entering a
// fresh code, so every failure here degrades to "no grant", never to a broken page.
function readGrant(token: string): string | null {
  try {
    return window.localStorage.getItem(GRANT_STORAGE_PREFIX + token)
  } catch {
    return null
  }
}

function storeGrant(token: string, grant: string): void {
  try {
    window.localStorage.setItem(GRANT_STORAGE_PREFIX + token, grant)
  } catch {
    // Not kept: the recipient enters a code again next visit. Nothing else breaks.
  }
}

function forgetGrant(token: string): void {
  try {
    window.localStorage.removeItem(GRANT_STORAGE_PREFIX + token)
  } catch {
    // Nothing stored, or storage unavailable — either way nothing to remove.
  }
}

function packRequest(token: string, init: RequestInit = {}): RequestInit {
  const grant = readGrant(token)
  return { ...REQUEST, ...init, headers: grant ? { [GRANT_HEADER]: grant } : {} }
}

async function failure(response: Response, token: string | null): Promise<PackError> {
  const body = (await response.json().catch(() => ({}))) as ErrorBody
  if (response.status === 401 && body.verification_required && token !== null) {
    // A stored grant the server no longer accepts is useless; drop it so the next code sticks.
    forgetGrant(token)
    return new PackError(401, body.detail ?? 'Enter the emailed code to open this pack.', body.email_hint ?? '')
  }
  return new PackError(response.status, body.detail ?? response.statusText)
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

export async function fetchArtifactBytes(token: string, artifactId: string): Promise<ArrayBuffer> {
  const response = await fetch(`${PUBLIC}/${encode(token)}/artifacts/${encode(artifactId)}`, packRequest(token))
  if (!response.ok) throw new PackError(response.status, 'Evidence file unavailable')
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
