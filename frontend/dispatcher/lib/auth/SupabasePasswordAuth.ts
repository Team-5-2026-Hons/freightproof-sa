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

type SupabaseAuthClient = Pick<SupabaseClient, 'auth'>

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
    if (error) throw error
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut()
    if (!error) return

    console.error('SupabasePasswordAuth: sign-out call failed; removing the stored session', error)
    clearPersistedSession(window.localStorage)
  }
}

export const supabasePasswordAuth: PasswordAuthPort = new SupabasePasswordAuth(supabase)
