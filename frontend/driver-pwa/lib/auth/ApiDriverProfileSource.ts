import { api, ApiError } from '@/lib/api/client'
import type { DriverUser } from '@/lib/types/user'

import type { DriverProfileSource, ProfileLoad } from './DriverProfileSource'

// The Driver row whose id equals the Supabase auth user's UUID.
const DRIVER_PROFILE_PATH = '/api/v1/drivers/me'

// ApiError reserves status 0 for a client-side failure where no HTTP response arrived at
// all (request or session timeout, dead host, DNS failure) — see lib/api/client.ts.
const NO_RESPONSE_STATUS = 0

// A 5xx is the service failing, not this driver's session failing. Treated the same as no
// answer: retrying is the right move, and signing them out would be a lie about the cause.
const SERVER_ERROR_FLOOR = 500

/** DriverProfileSource backed by the backend API. */
export class ApiDriverProfileSource implements DriverProfileSource {
  async loadProfile(): Promise<ProfileLoad> {
    try {
      return await api.get<DriverUser>(DRIVER_PROFILE_PATH)
    } catch (err) {
      // Logged so a backend 500/network failure here is distinguishable from a
      // driver whose phone simply isn't provisioned yet.
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
      // The split that keeps the app honest: no answer (or the service erroring) is a
      // connection fault the driver can retry; anything the backend actually decided
      // (401, 403, 404) stays null and ends the session as before.
      if (err instanceof ApiError && (err.status === NO_RESPONSE_STATUS || err.status >= SERVER_ERROR_FLOOR)) {
        return { unreachable: true }
      }
      // A non-ApiError escaping the client is an unexpected client-side throw, not a
      // backend verdict — also treated as unreachable rather than as "signed out".
      if (!(err instanceof ApiError)) return { unreachable: true }
      return null
    }
  }
}
