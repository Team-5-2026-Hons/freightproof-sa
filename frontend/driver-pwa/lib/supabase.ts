import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { actorGeneration, observeAuthSession } from '@/lib/session/custody-context'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

let client: SupabaseClient | null = null

let cachedAccessToken: string | null = null

export function getSupabase(): SupabaseClient {
  if (client !== null) return client
  const created = createClient(supabaseUrl, supabaseAnonKey)
  client = created

  created.auth.onAuthStateChange((_event, session) => {
    observeAuthSession(session?.user.id ?? null)
    cachedAccessToken = session?.access_token ?? null
  })

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
