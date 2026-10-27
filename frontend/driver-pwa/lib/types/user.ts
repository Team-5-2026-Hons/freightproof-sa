// User: authenticated session identity for the Driver PWA.
// Drivers authenticate via phone OTP — two steps: requestOtp then signIn.
// AuthState is the shape exposed by AuthContext to all consumers via useAuth().

import type { Driver } from '@shared/lib/types/driver'

export type DriverUser = Driver

export interface AuthState {
  user: DriverUser | null
  isLoading: boolean
  connectionFault: boolean
  /** Re-attempt the profile load after a connection fault. */
  retryProfile: () => Promise<void>
  requestOtp: (phone_number: string) => Promise<void>
  signIn: (credentials: { phone_number: string; otp: string }) => Promise<void>
  signOut: () => Promise<void>
}
