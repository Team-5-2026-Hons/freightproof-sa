/** ApiDriverProfileSource: loads the driver's own profile, and says why when it cannot. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DriverUser } from '@/lib/types/user'

class FakeApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

const apiGet = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
  ApiError: FakeApiError,
}))

const { ApiDriverProfileSource } = await import('../ApiDriverProfileSource')

const DRIVER = { id: 'driver-1', full_name: 'Test Driver' } as unknown as DriverUser

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  apiGet.mockReset()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('ApiDriverProfileSource.loadProfile', () => {
  it("returns the driver's own profile from /drivers/me", async () => {
    apiGet.mockResolvedValue(DRIVER)

    expect(await new ApiDriverProfileSource().loadProfile()).toBe(DRIVER)
    expect(apiGet).toHaveBeenCalledWith('/api/v1/drivers/me')
  })

  // Status and detail go INTO the message: the iOS console bridge drops a second argument.
  it('returns null and logs the status and detail of an API error in one string', async () => {
    apiGet.mockRejectedValue(new FakeApiError(403, 'Driver account not found.'))

    expect(await new ApiDriverProfileSource().loadProfile()).toBeNull()
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith('Failed to fetch driver profile: 403 Driver account not found.')
  })

  it('returns null and logs a non-API failure as text', async () => {
    apiGet.mockRejectedValue(new TypeError('Network request failed'))

    expect(await new ApiDriverProfileSource().loadProfile()).toBeNull()
    expect(consoleError).toHaveBeenCalledWith('Failed to fetch driver profile: TypeError: Network request failed')
  })
})
