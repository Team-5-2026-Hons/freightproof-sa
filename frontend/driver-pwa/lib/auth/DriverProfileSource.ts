import type { DriverUser } from '@/lib/types/user'

// Why this is not part of the auth port: proving who someone is (a session) and loading
// the application record about them (the Driver row) are different jobs with different
// backends. Keeping them apart lets the demo walkthrough supply a fixture profile without
// pretending to be an auth server, and lets auth be swapped without touching profiles.
export interface DriverProfileSource {
  /** The signed-in driver's own profile, or null when it cannot be loaded. */
  loadProfile(): Promise<DriverUser | null>
}
