import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const STALE_SOCKET_ABORT_MS = 3_000
const FRESH_RETRY_TIMEOUT_MS = 8_000

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const run = (timeoutMs: number): Promise<Response> => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    return fetch(input, { ...init, signal })
  }

  try {
    return await run(STALE_SOCKET_ABORT_MS)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return await run(FRESH_RETRY_TIMEOUT_MS)
    }
    throw err
  }
}

let cachedAccessToken: string | null = null

let client: SupabaseClient | undefined

function getClient(): SupabaseClient {
  if (!client) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set')
    }
    client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { fetch: fetchWithTimeout },
    })
    client.auth.onAuthStateChange((_event, session) => {
      cachedAccessToken = session?.access_token ?? null
    })
    void client.auth.getSession().then(({ data: { session } }) => {
      cachedAccessToken ??= session?.access_token ?? null
    })
  }
  return client
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver)
  },
})

export function getAccessToken(): string | null {
  return cachedAccessToken
}
