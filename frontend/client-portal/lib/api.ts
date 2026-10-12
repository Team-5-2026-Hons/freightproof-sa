// The portal's only way to reach the API. No session, no bearer token: the share token
// in the URL is the credential, sent only to our own API and never in a Referer header.
import type { LiveVerification, PublicAuditPackView, PublicPackSeal } from './types'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const PUBLIC = `${BASE_URL}/api/v1/public/audit-packs`

export class PackError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'PackError'
  }
}

const REQUEST: RequestInit = { cache: 'no-store', referrerPolicy: 'no-referrer' }

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string }
    throw new PackError(response.status, body.detail ?? response.statusText)
  }
  return (await response.json()) as T
}

const encode = encodeURIComponent

export async function fetchPack(token: string): Promise<PublicAuditPackView> {
  return parse(await fetch(`${PUBLIC}/${encode(token)}`, REQUEST))
}

export async function fetchSeal(packId: string): Promise<PublicPackSeal> {
  return parse(await fetch(`${PUBLIC}/seal/${encode(packId)}`, REQUEST))
}

export async function runServerVerification(token: string): Promise<LiveVerification> {
  return parse(await fetch(`${PUBLIC}/${encode(token)}/verify`, { ...REQUEST, method: 'POST' }))
}

export async function fetchArtifactBytes(token: string, artifactId: string): Promise<ArrayBuffer> {
  const response = await fetch(`${PUBLIC}/${encode(token)}/artifacts/${encode(artifactId)}`, REQUEST)
  if (!response.ok) throw new PackError(response.status, 'Evidence file unavailable')
  return response.arrayBuffer()
}

export function pdfUrl(token: string): string {
  return `${PUBLIC}/${encode(token)}/pdf`
}

export function incidentSheetUrl(token: string): string {
  return `${PUBLIC}/${encode(token)}/incident-sheet.pdf`
}
