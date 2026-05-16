/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 */

import { supabase } from '@/lib/supabase/client'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? null
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers })

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
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
}
