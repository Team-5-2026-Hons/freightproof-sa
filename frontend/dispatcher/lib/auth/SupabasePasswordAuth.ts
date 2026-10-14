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
    await this.client.auth.signOut()
  }
}

/** The adapter the app uses unless a provider is handed another one. */
export const supabasePasswordAuth: PasswordAuthPort = new SupabasePasswordAuth(supabase)
