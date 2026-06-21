/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 */

import { supabase } from '@/lib/supabase/client'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// Delay before retrying a request whose connection was dropped at the network layer.
const NETWORK_RETRY_DELAY_MS = 150

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { retry?: boolean } = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? null

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  }

  // One retry on a network-layer rejection — Safari reuses an HTTP keep-alive connection
  // that uvicorn has already closed (NSURLErrorNetworkConnectionLost), which a fresh
  // connection fixes. Only safe for idempotent calls, so it is opt-in (GETs + explicitly
  // idempotent POSTs like /blockchain/verify). HTTP error responses are NOT retried — they
  // fall through to the ApiError below.
  const maxAttempts = opts.retry ? 2 : 1
  let res: Response | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetch(url, { ...init, headers })
      break
    } catch (err) {
      if (attempt >= maxAttempts) throw err
      await new Promise(resolve => setTimeout(resolve, NETWORK_RETRY_DELAY_MS))
    }
  }
  // The loop either breaks with a response or throws; this guards the type narrowing.
  if (!res) throw new Error(`Request to ${url} produced no response`)

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
