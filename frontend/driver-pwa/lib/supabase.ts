import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { actorGeneration, observeAuthSession } from '@/lib/session/custody-context'

// Fallback placeholders so this module loads during static export even when Supabase
// env vars are unset — IS_DEMO_MODE gates the real auth path.
//
// `||` rather than `??` deliberately: an unfilled .env.local has `NEXT_PUBLIC_SUPABASE_URL=`,
// the empty string, which is not nullish — `??` would pass "" to createClient and 500
// every page.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

// Built on first use, not at import. createClient() plus the startup getSession() cost
// 34-60 ms, and as module-level statements they ran inside the cold-start long task of
// every route that imports the API client, before the first paint. Demo mode never needs
// the client at all. The first caller is AuthProvider's first render (lib/auth/defaults.ts),
// so the token cache below is still seeded before any API request is made.
let client: SupabaseClient | null = null

// The API layer reads this synchronously instead of calling supabase.auth.getSession()
// on every request — getSession() acquires Supabase's auth Web Lock, so calling it per
// request risks every submit stalling behind a wedged token refresh. Null until the client
// exists and has reported a session; resolveToken() in lib/api/client.ts then falls back to
// one bounded getSession() through getSupabase(), which also builds the client.
let cachedAccessToken: string | null = null

export function getSupabase(): SupabaseClient {
  if (client !== null) return client
  const created = createClient(supabaseUrl, supabaseAnonKey)
  client = created

  created.auth.onAuthStateChange((_event, session) => {
    observeAuthSession(session?.user.id ?? null)
    cachedAccessToken = session?.access_token ?? null
  })

  // Seeds the cache once, for the hard-reload case, before any auth event fires.
  // `??=` so we never clobber a fresher token an auth event may have already set.
  const startupGeneration = actorGeneration()
  void created.auth.getSession().then(({ data: { session } }) => {
    if (actorGeneration() !== startupGeneration) return
    observeAuthSession(session?.user.id ?? null)
    cachedAccessToken ??= session?.access_token ?? null
  })
  return created
}

export function getAccessToken(): string | null {
  return cachedAccessToken
}
