// frontend/receiver/lib/api.ts
//
// This app talks to exactly two endpoints and holds no session. There is no bearer token
// to attach and no refresh path to get wrong — the capability token in the URL is half
// the authorisation and an HttpOnly cookie is the other half, which is why this file is
// forty lines where the driver app's client is two hundred.
//
// `credentials: 'include'` on BOTH calls is load-bearing, not boilerplate. The GET is how
// the binding cookie is received; the POST is how it is presented. Drop it from either
// and every handover fails its binding check with a 404 that explains nothing.

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export class HandoverError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HandoverError'
  }
}

export interface HandoverScan {
  trip_reference: string
  destination_name: string
  waybill_references: string[]
  expires_at: string
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

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new HandoverError(res.status, (body as { detail?: string }).detail ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export async function fetchScan(token: string): Promise<HandoverScan> {
  return parse<HandoverScan>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}`, {
      cache: 'no-store',
      credentials: 'include',
    }),
  )
}

export async function confirmHandover(
  token: string,
  payload: ConfirmPayload,
): Promise<HandoverConfirmed> {
  return parse<HandoverConfirmed>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    }),
  )
}
