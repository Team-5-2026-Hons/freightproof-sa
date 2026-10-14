import { createClient } from '@supabase/supabase-js'

// Fallback placeholders so this module loads during static export even when Supabase
// env vars are unset — IS_DEMO_MODE gates the real auth path.
//
// `||` rather than `??` deliberately: an unfilled .env.local has `NEXT_PUBLIC_SUPABASE_URL=`,
// the empty string, which is not nullish — `??` would pass "" to createClient and 500
// every page.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// The API layer reads this synchronously instead of calling supabase.auth.getSession()
// on every request — getSession() acquires Supabase's auth Web Lock, so calling it per
// request risks every submit stalling behind a wedged token refresh.
let cachedAccessToken: string | null = null

supabase.auth.onAuthStateChange((_event, session) => {
  cachedAccessToken = session?.access_token ?? null
})

// Seeds the cache once at startup for the hard-reload case, before any auth event fires.
// `??=` so we never clobber a fresher token an auth event may have already set.
void supabase.auth.getSession().then(({ data: { session } }) => {
  cachedAccessToken ??= session?.access_token ?? null
})

export function getAccessToken(): string | null {
  return cachedAccessToken
}
