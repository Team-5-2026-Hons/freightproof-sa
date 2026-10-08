import type { AuthChangeListener, AuthSession, OtpAuthPort, Unsubscribe } from '@shared/lib/auth/port'

import { MOCK_DRIVER } from './DemoDriverProfileSource'

// Marks an active demo session so a page refresh doesn't log the demo user out
// mid-walkthrough. sessionStorage (not localStorage) on purpose: closing the
// tab still ends the demo. Exported for tests only.
export const DEMO_SESSION_KEY = 'fp:demo-session'

// Pause that makes the demo's OTP steps feel like a real round trip.
const DEMO_LATENCY_MS = 600

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** OtpAuthPort for demo mode: any code is accepted; the "session" is a sessionStorage flag. */
export class DemoOtpAuth implements OtpAuthPort {
  // sessionStorage is read at call time, never at construction: this class is created
  // during static-export prerender, where it does not exist. Methods only run client-side.
  async getSession(): Promise<AuthSession | null> {
    return sessionStorage.getItem(DEMO_SESSION_KEY) === 'true'
      ? { userId: String(MOCK_DRIVER.id) }
      : null
  }

  // Nothing outside this tab can sign the demo driver in or out, so there is nothing to report.
  onChange(_listener: AuthChangeListener): Unsubscribe {
    return () => {}
  }

  async requestOtp(_phoneNumber: string): Promise<void> {
    await pause(DEMO_LATENCY_MS)
  }

  async verifyOtp(_phoneNumber: string, _otp: string): Promise<void> {
    await pause(DEMO_LATENCY_MS)
    // Persist so the demo session survives a page refresh (see DEMO_SESSION_KEY).
    sessionStorage.setItem(DEMO_SESSION_KEY, 'true')
  }

  async signOut(): Promise<void> {
    // End the persisted demo session so the next load lands on /login.
    sessionStorage.removeItem(DEMO_SESSION_KEY)
  }
}
