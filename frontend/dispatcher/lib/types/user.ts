// Authenticated session identity for the Dispatcher Portal. DispatcherUser authenticates
// via Supabase Auth; GET /api/v1/auth/me validates the resulting Bearer token and returns
// this shape. AuthState is what AuthContext exposes via useAuth().

import type { Driver } from '@shared/lib/types/driver'

export type UserId = string & { readonly __brand: 'UserId' }

export interface DispatcherUser {
  id: UserId
  organization_id: string
  email: string
  full_name: string
  is_active: boolean
  role: 'dispatcher' | 'admin_dispatcher'
}

export type DriverUser = Driver

export interface AuthState {
  user: DispatcherUser | null
  isLoading: boolean
  signIn: (credentials: { email: string; password: string }) => Promise<void>
  signOut: () => Promise<void>
}
