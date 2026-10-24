import { mockDrivers } from '@shared/lib/mocks/drivers'
import type { DriverUser } from '@/lib/types/user'

import type { DriverProfileSource } from './DriverProfileSource'

// The one fixture driver the demo walkthrough signs in as.
export const MOCK_DRIVER: DriverUser = mockDrivers[0]

/** DriverProfileSource for demo mode: no server, always the fixture driver. */
export class DemoDriverProfileSource implements DriverProfileSource {
  async loadProfile(): Promise<DriverUser | null> {
    return MOCK_DRIVER
  }
}
