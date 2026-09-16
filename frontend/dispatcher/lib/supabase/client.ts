import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// First-attempt ceiling. Supabase's token-refresh has no timeout of its own, so after
// the tab idles it can hang on a dead keep-alive socket until the OS drops it — stalling
// getSession() and every page load. Abort fast and retry on a fresh connection instead.
const STALE_SOCKET_ABORT_MS = 3_000
// The retry dials a fresh connection, so give it a normal window.
const FRESH_RETRY_TIMEOUT_MS = 8_000

// Used as the Supabase client's fetch (its auth/token-refresh calls go through this).
const fetchWithTimeout: typeof fetch = async (input, init) => {
  const run = (timeoutMs: number): Promise<Response> => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    // Respect a caller-supplied signal (e.g. the SDK aborting) alongside our timeout.
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    return fetch(input, { ...init, signal })
  }

  try {
    return await run(STALE_SOCKET_ABORT_MS)
  } catch (err) {
    // A timeout means the socket stalled; one retry on a fresh connection clears a dead
    // keep-alive after idle.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return await run(FRESH_RETRY_TIMEOUT_MS)
    }
    throw err
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
})

// The API layer reads this synchronously instead of calling supabase.auth.getSession()
// on every request — that acquires Supabase's auth Web Lock, and calling it from inside
// onAuthStateChange (which runs *while holding that lock*) deadlocked for ~8s after idle.
let cachedAccessToken: string | null = null

supabase.auth.onAuthStateChange((_event, session) => {
  cachedAccessToken = session?.access_token ?? null
})

// Seed the cache once at startup for the hard-reload case, before any auth event fires.
// `??=` so we never clobber a fresher token an auth event may have already set.
void supabase.auth.getSession().then(({ data: { session } }) => {
  cachedAccessToken ??= session?.access_token ?? null
})

export function getAccessToken(): string | null {
  return cachedAccessToken
}
