// User: authenticated session identity for the Driver PWA.
// Drivers authenticate via phone OTP — two steps: requestOtp then signIn.
// AuthState is the shape exposed by AuthContext to all consumers via useAuth().

import type { Driver } from '@shared/lib/types/driver'

// The driver session wraps the full Driver record so handshake screens can read
// identity fields (id_number, phone_number) without a separate fetch.
export type DriverUser = Driver

export interface AuthState {
  user: DriverUser | null
  isLoading: boolean
  // True when the driver's profile could not be loaded because the backend never
  // answered (or answered 5xx) — NOT because they are signed out. The guarded layout
  // branches on this instead of redirecting to /login, which would blame the driver for
  // an infrastructure fault. See lib/auth/DriverProfileSource.ts.
  connectionFault: boolean
  /** Re-attempt the profile load after a connection fault. */
  retryProfile: () => Promise<void>
  // Step 1: request an OTP to be sent to the driver's registered phone number.
  requestOtp: (phone_number: string) => Promise<void>
  // Step 2: verify the OTP and exchange it for a JWT session.
  signIn: (credentials: { phone_number: string; otp: string }) => Promise<void>
  signOut: () => Promise<void>
}
