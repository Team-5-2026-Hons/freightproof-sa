// User: authenticated session identity for the Dispatcher Portal.
// DispatcherUser authenticates via email + password (POST /auth/token).
// AuthState is the shape exposed by AuthContext to all consumers via useAuth().

import type { Driver } from '@shared/lib/types/driver'

export type UserId = string & { readonly __brand: 'UserId' }

export interface DispatcherUser {
  id: UserId
  organization_id: string
  email: string
  full_name: string
  is_active: boolean
}

// DriverUser wraps the full Driver record so cross-surface type imports stay consistent.
export type DriverUser = Driver

export interface AuthState {
  user: DispatcherUser | null
  isLoading: boolean
  signIn: (credentials: { email: string; password: string }) => Promise<void>
  signOut: () => Promise<void>
}
