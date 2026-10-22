import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { ApiDriverProfileSource } from '../ApiDriverProfileSource'
import { isProfileUnreachable } from '../DriverProfileSource'

const get = vi.fn()
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>()
  return { ...actual, api: { get: (...args: unknown[]) => get(...args) } }
})

afterEach(() => {
  get.mockReset()
  vi.restoreAllMocks()
})

// The whole point of this split: a driver must never be told to log in again because the
// backend was unreachable. See lib/auth/DriverProfileSource.ts.
describe('ApiDriverProfileSource', () => {
  it('returns the driver on success', async () => {
    const driver = { id: 'd1', full_name: 'Timothy Gultig' }
    get.mockResolvedValue(driver)

    const result = await new ApiDriverProfileSource().loadProfile()

    expect(result).toBe(driver)
    expect(isProfileUnreachable(result)).toBe(false)
  })

  it('reports unreachable when no HTTP response arrived (status 0)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    get.mockRejectedValue(new ApiError(0, 'Request timed out'))

    const result = await new ApiDriverProfileSource().loadProfile()

    expect(isProfileUnreachable(result)).toBe(true)
  })

  it('reports unreachable on a 5xx, which is the service failing and not the session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    get.mockRejectedValue(new ApiError(502, 'Bad gateway'))

    expect(isProfileUnreachable(await new ApiDriverProfileSource().loadProfile())).toBe(true)
  })

  it.each([
    [401, 'Invalid token.'],
    [403, 'Missing authentication credentials.'],
    [404, 'Driver account not found.'],
  ])('returns null on %i, which the backend actually decided', async (status, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    get.mockRejectedValue(new ApiError(status, message))

    const result = await new ApiDriverProfileSource().loadProfile()

    expect(result).toBeNull()
    expect(isProfileUnreachable(result)).toBe(false)
  })

  it('reports unreachable when a non-ApiError escapes the client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    get.mockRejectedValue(new TypeError('Load failed'))

    expect(isProfileUnreachable(await new ApiDriverProfileSource().loadProfile())).toBe(true)
  })
})
