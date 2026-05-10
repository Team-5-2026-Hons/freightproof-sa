// User: authenticated session identity. Two distinct shapes depending on surface:
// DispatcherUser for the dispatcher dashboard, DriverUser for the driver PWA.
// AuthState is the shape exposed by AuthContext to all consumers via useAuth().

import type { Driver } from './driver'

export type UserId = string & { readonly __brand: 'UserId' }

export interface DispatcherUser {
  id: UserId
  organization_id: string
  email: string
  full_name: string
  is_active: boolean
}

// The driver PWA session wraps the full Driver record so handshake screens can
// read driver identity fields (id_number, phone_number) without a separate fetch.
export type DriverUser = Driver

export interface AuthState {
  user: DispatcherUser | DriverUser | null
  isLoading: boolean
  signIn: (credentials: { email: string; password: string }) => Promise<void>
  signOut: () => Promise<void>
}
