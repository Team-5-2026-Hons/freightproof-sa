import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// First-attempt ceiling. Supabase's token-refresh request carries no timeout of its own,
// so after the tab idles it can be sent over a dead HTTP keep-alive socket and hang until
// the OS finally drops the connection (well over 8s). That stalls getSession() — and
// therefore every page load — after the user returns. Aborting a stalled attempt quickly
// lets us retry on a fresh connection instead of waiting it out.
const STALE_SOCKET_ABORT_MS = 3_000
// Retry leash. The retry dials a fresh connection, so give it a normal window rather than
// re-aborting a genuinely slow-but-healthy network.
const FRESH_RETRY_TIMEOUT_MS = 8_000

// Wraps fetch so a stalled request aborts fast and retries once on a fresh connection.
// Used as the Supabase client's fetch, which is what its auth/token-refresh calls go through.
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
    // A timeout means the socket stalled rather than cleanly failed — one retry opens a
    // fresh connection, which is what actually clears a dead keep-alive after idle.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return await run(FRESH_RETRY_TIMEOUT_MS)
    }
    throw err
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
})

// ── Cached access token ──────────────────────────────────────────────────────
// The API layer reads this synchronously instead of calling supabase.auth.getSession()
// on every request. getSession() acquires Supabase's auth Web Lock; using it on the hot
// path caused lock contention, and calling it (via the API client) from inside an
// onAuthStateChange callback — which Supabase runs *while holding that lock* — deadlocked
// for ~8s after the tab idled. onAuthStateChange fires on sign-in and on every background
// token refresh, so this cache always reflects the latest valid token.
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
