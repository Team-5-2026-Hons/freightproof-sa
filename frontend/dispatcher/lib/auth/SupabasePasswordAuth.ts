import type { AuthChangeEvent as SupabaseAuthEvent, Session, SupabaseClient } from '@supabase/supabase-js'

import type {
  AuthChangeEvent,
  AuthChangeListener,
  AuthSession,
  PasswordAuthPort,
  PasswordCredentials,
  Unsubscribe,
} from '@shared/lib/auth/port'
import { supabase } from '@/lib/supabase/client'

// Structural, not the whole client: tests (and any future backend) only need to supply `auth`.
type SupabaseAuthClient = Pick<SupabaseClient, 'auth'>

// The SDK keeps its session under "sb-<project ref>-auth-token" (plus a "-code-verifier" twin).
// Matched by shape because the project ref comes from the Supabase URL and is not ours to
// hard-code; dispatcher preferences use other prefixes and never match.
const SUPABASE_AUTH_STORAGE_KEY = /^sb-.+-auth-token(-code-verifier)?$/

function clearPersistedSession(store: Storage): void {
  const keys = Array.from({ length: store.length }, (_, index) => store.key(index))
  for (const key of keys) {
    if (key !== null && SUPABASE_AUTH_STORAGE_KEY.test(key)) store.removeItem(key)
  }
}

function toSession(session: Session | null): AuthSession | null {
  return session ? { userId: session.user.id } : null
}

// Anything but an explicit sign-in or sign-out is a refresh-style event the provider must
// not treat as a new login (it caused needless /auth/me refetches when it did).
function toEvent(event: SupabaseAuthEvent): AuthChangeEvent {
  if (event === 'SIGNED_IN') return 'signed_in'
  if (event === 'SIGNED_OUT') return 'signed_out'
  return 'session_updated'
}

/** PasswordAuthPort backed by Supabase Auth. */
export class SupabasePasswordAuth implements PasswordAuthPort {
  constructor(private readonly client: SupabaseAuthClient) {}

  async getSession(): Promise<AuthSession | null> {
    const { data: { session } } = await this.client.auth.getSession()
    return toSession(session)
  }

  onChange(listener: AuthChangeListener): Unsubscribe {
    const { data: { subscription } } = this.client.auth.onAuthStateChange((event, session) => {
      listener(toEvent(event), toSession(session))
    })
    return () => subscription.unsubscribe()
  }

  async signInWithPassword(credentials: PasswordCredentials): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword(credentials)
    // Rethrown as-is: the login page shows this error's own message.
    if (error) throw error
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut()
    if (!error) return

    // On a network failure the SDK RETURNS the error and leaves the stored session in place, so
    // a reload would restore it and sign the dispatcher straight back in on a shared PC. Drop it
    // ourselves. The server-side token expires on its own.
    console.error('SupabasePasswordAuth: sign-out call failed; removing the stored session', error)
    clearPersistedSession(window.localStorage)
  }
}

/** The adapter the app uses unless a provider is handed another one. */
export const supabasePasswordAuth: PasswordAuthPort = new SupabasePasswordAuth(supabase)
