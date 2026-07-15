import { createClient } from '@supabase/supabase-js'

// Fallback placeholders so this module loads during static export (output: 'export')
// even when Supabase env vars are unset — IS_DEMO_MODE gates the real auth path,
// so these values are only ever exercised once Supabase is actually configured.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ── Cached access token ──────────────────────────────────────────────────────
// The API layer reads this synchronously instead of calling supabase.auth.getSession()
// on every request. getSession() acquires Supabase's auth Web Lock, so calling it per
// request (as lib/api/client.ts used to) risks every handshake submit stalling behind a
// wedged token refresh — e.g. after the tab idles and the background auto-refresh timer
// was throttled. onAuthStateChange fires on sign-in and on every background token
// refresh, so this cache always reflects the latest valid token.
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
