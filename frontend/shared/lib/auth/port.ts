// Auth ports: what the apps' AuthContext providers need from an authentication backend,
// stated without naming one.
//
// Why this exists (Dependency Inversion): the providers used to call `supabase.auth.*`
// directly, so the session logic could only be exercised by mocking a vendor SDK, and
// swapping the backend meant rewriting React state code. They now depend on these
// interfaces; each app supplies an adapter (Supabase for real use, a fake in tests).
//
// Deliberately NOT here: loading the user's profile. That is a separate concern from
// proving who someone is, and it lives behind its own interface in the app that needs it.
// Deliberately split by credential type (Interface Segregation): the dispatcher signs in
// with a password and has no OTP, the driver the reverse, so neither depends on the other's.
//
// Types only, no imports: this folder is shared by apps that resolve packages from their
// own node_modules, so nothing vendor-specific can live here.

/** Who is signed in. Only identity, never tokens: tokens stay inside the adapter. */
export interface AuthSession {
  readonly userId: string
}

/** Vendor-neutral session events. Anything that is neither sign-in nor sign-out
 *  (token refresh, user update, initial restore) is `session_updated`. */
export type AuthChangeEvent = 'signed_in' | 'signed_out' | 'session_updated'

export type Unsubscribe = () => void

export type AuthChangeListener = (event: AuthChangeEvent, session: AuthSession | null) => void

export interface AuthPort {
  /** The current session, or null when nobody is signed in. */
  getSession(): Promise<AuthSession | null>
  /** Subscribe to session changes. The returned function removes the subscription. */
  onChange(listener: AuthChangeListener): Unsubscribe
  signOut(): Promise<void>
}

export interface PasswordCredentials {
  email: string
  password: string
}

/** Email + password sign-in (dispatcher portal). Rejects with the backend's own error, so
 *  the login form can show its message. */
export interface PasswordAuthPort extends AuthPort {
  signInWithPassword(credentials: PasswordCredentials): Promise<void>
}
