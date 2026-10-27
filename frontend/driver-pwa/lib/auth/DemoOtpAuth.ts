import type { AuthChangeListener, AuthSession, OtpAuthPort, Unsubscribe } from '@shared/lib/auth/port'

import { MOCK_DRIVER } from './DemoDriverProfileSource'

export const DEMO_SESSION_KEY = 'fp:demo-session'

const DEMO_LATENCY_MS = 600

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** OtpAuthPort for demo mode: any code is accepted; the "session" is a sessionStorage flag. */
export class DemoOtpAuth implements OtpAuthPort {
  async getSession(): Promise<AuthSession | null> {
    return sessionStorage.getItem(DEMO_SESSION_KEY) === 'true'
      ? { userId: String(MOCK_DRIVER.id) }
      : null
  }

  onChange(_listener: AuthChangeListener): Unsubscribe {
    return () => {}
  }

  async requestOtp(_phoneNumber: string): Promise<void> {
    await pause(DEMO_LATENCY_MS)
  }

  async verifyOtp(_phoneNumber: string, _otp: string): Promise<void> {
    await pause(DEMO_LATENCY_MS)
    sessionStorage.setItem(DEMO_SESSION_KEY, 'true')
  }

  async signOut(): Promise<void> {
    sessionStorage.removeItem(DEMO_SESSION_KEY)
  }
}
