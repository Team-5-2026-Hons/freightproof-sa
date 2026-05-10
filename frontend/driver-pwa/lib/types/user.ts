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
  // Step 1: request an OTP to be sent to the driver's registered phone number.
  requestOtp: (phone_number: string) => Promise<void>
  // Step 2: verify the OTP and exchange it for a JWT session.
  signIn: (credentials: { phone_number: string; otp: string }) => Promise<void>
  signOut: () => Promise<void>
}
