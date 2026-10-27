import { api, ApiError } from '@/lib/api/client'
import type { DriverUser } from '@/lib/types/user'

import type { DriverProfileSource, ProfileLoad } from './DriverProfileSource'

const DRIVER_PROFILE_PATH = '/api/v1/drivers/me'

const NO_RESPONSE_STATUS = 0

const SERVER_ERROR_FLOOR = 500

/** DriverProfileSource backed by the backend API. */
export class ApiDriverProfileSource implements DriverProfileSource {
  async loadProfile(): Promise<ProfileLoad> {
    try {
      return await api.get<DriverUser>(DRIVER_PROFILE_PATH)
    } catch (err) {
      console.error(
        `Failed to fetch driver profile: ${
          err instanceof ApiError ? `${err.status} ${err.message}` : String(err)
        }`,
      )
      if (err instanceof ApiError && (err.status === NO_RESPONSE_STATUS || err.status >= SERVER_ERROR_FLOOR)) {
        return { unreachable: true }
      }
      if (!(err instanceof ApiError)) return { unreachable: true }
      return null
    }
  }
}
