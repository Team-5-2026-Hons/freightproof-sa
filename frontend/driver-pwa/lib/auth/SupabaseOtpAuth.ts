import type { AuthChangeEvent as SupabaseAuthEvent, Session, SupabaseClient } from '@supabase/supabase-js'

import type { AuthChangeEvent, AuthChangeListener, AuthSession, OtpAuthPort, Unsubscribe } from '@shared/lib/auth/port'

// Structural, not the whole client: tests (and any future backend) only need to supply `auth`.
type SupabaseAuthClient = Pick<SupabaseClient, 'auth'>

function toSession(session: Session | null): AuthSession | null {
  return session ? { userId: session.user.id } : null
}

function toEvent(event: SupabaseAuthEvent): AuthChangeEvent {
  if (event === 'SIGNED_IN') return 'signed_in'
  if (event === 'SIGNED_OUT') return 'signed_out'
  return 'session_updated'
}

/** OtpAuthPort backed by Supabase phone auth. */
export class SupabaseOtpAuth implements OtpAuthPort {
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

  async requestOtp(phoneNumber: string): Promise<void> {
    // shouldCreateUser: false blocks unregistered phone numbers — a driver
    // auth account only exists if a dispatcher provisioned it via /drivers.
    // channel: 'whatsapp' — Twilio's WhatsApp Sandbox for dev/testing, since SMS
    // requires Twilio geo permissions + A2P 10DLC registration we haven't set up
    // for South African destinations yet. Switch back to 'sms' once that's done.
    const { error } = await this.client.auth.signInWithOtp({
      phone: phoneNumber,
      options: { channel: 'whatsapp', shouldCreateUser: false },
    })
    // Rethrown as-is: the login screens show this error's own message.
    if (error) throw error
  }

  async verifyOtp(phoneNumber: string, otp: string): Promise<void> {
    const { error } = await this.client.auth.verifyOtp({
      phone: phoneNumber,
      token: otp,
      type: 'sms',
    })
    if (error) throw error
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut()
  }
}
