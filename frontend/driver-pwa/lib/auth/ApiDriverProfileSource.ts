import { api, ApiError } from '@/lib/api/client'
import type { DriverUser } from '@/lib/types/user'

import type { DriverProfileSource } from './DriverProfileSource'

// The Driver row whose id equals the Supabase auth user's UUID.
const DRIVER_PROFILE_PATH = '/api/v1/drivers/me'

/** DriverProfileSource backed by the backend API. */
export class ApiDriverProfileSource implements DriverProfileSource {
  async loadProfile(): Promise<DriverUser | null> {
    try {
      return await api.get<DriverUser>(DRIVER_PROFILE_PATH)
    } catch (err) {
      // Logged so a backend 500/network failure here is distinguishable from a
      // driver whose phone simply isn't provisioned yet — both currently end up
      // with user = null, but only one of them should be silent.
      //
      // Formatted INTO the message rather than passed as a second argument. On iOS the
      // Capacitor console bridge serialises each log argument with JSON.stringify, and an
      // Error's `message`/`stack` are non-enumerable — so `console.error(msg, err)` arrives
      // in the Xcode console as the literal `{}`, dropping precisely the status and detail
      // that say which auth invariant broke ("Driver account not found." vs "Invalid
      // token." vs a 403 role failure). Interpolating survives the bridge.
      console.error(
        `Failed to fetch driver profile: ${
          err instanceof ApiError ? `${err.status} ${err.message}` : String(err)
        }`,
      )
      return null
    }
  }
}
