import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { usePrecincts } from './usePrecincts'
import { api } from '@/lib/api/client'
import type { Precinct } from '@shared/lib/types/precinct'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)

function makePrecinct(): Precinct {
  return {
    id: 'c0c3312c-d68d-4346-9508-5fefbc64489a' as Precinct['id'],
    name: 'Bloemfontein Depot (Hamilton)',
    principal_organization_id: '00000000-0000-0000-0000-000000000003' as Precinct['principal_organization_id'],
    address: null,
    latitude: -29.1,
    longitude: 26.2,
    geofence_radius_metres: 200,
    is_shared: false,
    created_at: '2026-08-01T00:00:00Z',
  }
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('usePrecincts', () => {
  it('returns the fetched precincts and no error on success', async () => {
    mockedGet.mockResolvedValue([makePrecinct()])

    const { result } = renderHook(() => usePrecincts())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.precincts).toHaveLength(1)
    expect(result.current.error).toBeNull()
  })

  // The defect this hook exists to prevent: callers resolve precinct names by id and
  // fall back to an em-dash, so a swallowed failure renders as "this trip has no
  // origin". The error must reach the caller.
  it('surfaces the error when the request fails', async () => {
    mockedGet.mockRejectedValue(new Error('Request to /api/v1/precincts failed'))

    const { result } = renderHook(() => usePrecincts())

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toContain('failed')
    expect(result.current.precincts).toEqual([])
  })

  it('retries once after a failure and recovers when the retry succeeds', async () => {
    mockedGet
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue([makePrecinct()])

    const { result } = renderHook(() => usePrecincts())

    await waitFor(() => expect(result.current.precincts).toHaveLength(1))
    expect(result.current.error).toBeNull()
  })

  // The failure mode the reset condition guards: refetch() nulls `error` synchronously,
  // so re-arming on `error === null` alone would retry forever against a down backend.
  it('stops after exactly one retry when the request keeps failing', async () => {
    mockedGet.mockRejectedValue(new Error('still down'))

    const { result } = renderHook(() => usePrecincts())

    await waitFor(() => expect(result.current.error).not.toBeNull())
    // Settle any retry the effect scheduled, then confirm the count stopped climbing.
    await new Promise(resolve => setTimeout(resolve, 50))
    const callsAfterRetry = mockedGet.mock.calls.length

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mockedGet.mock.calls.length).toBe(callsAfterRetry)
    expect(result.current.error).not.toBeNull()
  })

  it('exposes a refetch that re-requests the precinct list', async () => {
    mockedGet.mockResolvedValue([makePrecinct()])

    const { result } = renderHook(() => usePrecincts())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const callsAfterMount = mockedGet.mock.calls.length

    act(() => {
      result.current.refetch()
    })

    await waitFor(() => expect(mockedGet.mock.calls.length).toBe(callsAfterMount + 1))
  })
})
