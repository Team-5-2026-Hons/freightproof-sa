import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  getCrewAvailability: vi.fn(),
}))

import { ApiError, getCrewAvailability } from '@/lib/api/client'
import type { AvailabilityWindow } from '@/lib/trips/crew-availability'
import type { BusyEntry, CrewAvailability } from '@shared/lib/types/availability'
import { AVAILABILITY_DEBOUNCE_MS, useCrewAvailability } from './useCrewAvailability'

const mocked = vi.mocked(getCrewAvailability)
const MORNING: AvailabilityWindow = { startIso: '2026-10-16T06:00:00.000Z', endIso: '2026-10-16T10:00:00.000Z' }
const AFTERNOON: AvailabilityWindow = { startIso: '2026-10-16T12:00:00.000Z', endIso: '2026-10-16T16:00:00.000Z' }

function busyHorse(reference: string): BusyEntry {
  return {
    resource_type: 'horse', resource_id: 'h-1', label: 'CA 441 892', trip_id: 't-1', trip_reference: reference,
    trip_status: 'created', busy_from: '2026-10-16T06:00:00Z', busy_until: '2026-10-16T14:00:00Z',
    planned_until: '2026-10-16T14:00:00Z',
  }
}

function answer(window: AvailabilityWindow, busy: BusyEntry[]): CrewAvailability {
  return { start: window.startIso, end: window.endIso, busy }
}

/** Let the debounce elapse and the request settle. */
async function settle(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(AVAILABILITY_DEBOUNCE_MS) })
}

beforeEach(() => {
  vi.useFakeTimers()
  mocked.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCrewAvailability', () => {
  it('asks nothing until there is a window', async () => {
    const { result } = renderHook(() => useCrewAvailability(null))

    await settle()

    expect(mocked).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(result.current.busy.size).toBe(0)
  })

  it('waits for the dispatcher to pause, then loads who is busy', async () => {
    mocked.mockResolvedValue(answer(MORNING, [busyHorse('TRP-0038')]))
    const { result } = renderHook(() => useCrewAvailability(MORNING))

    expect(result.current.status).toBe('loading')
    expect(mocked).not.toHaveBeenCalled()
    await settle()

    expect(mocked).toHaveBeenCalledWith(MORNING.startIso, MORNING.endIso)
    expect(result.current.status).toBe('ready')
    expect(result.current.busy.get('h-1')?.trip_reference).toBe('TRP-0038')
  })

  it('asks again when the times change, and shows nothing busy from the old window meanwhile', async () => {
    mocked.mockResolvedValueOnce(answer(MORNING, [busyHorse('TRP-OLD')]))
    mocked.mockResolvedValueOnce(answer(AFTERNOON, []))
    const { result, rerender } = renderHook(({ window }) => useCrewAvailability(window), {
      initialProps: { window: MORNING },
    })
    await settle()

    rerender({ window: AFTERNOON })

    expect(result.current.status).toBe('loading')
    expect(result.current.busy.size).toBe(0)
    await settle()
    expect(mocked).toHaveBeenLastCalledWith(AFTERNOON.startIso, AFTERNOON.endIso)
    expect(result.current.status).toBe('ready')
    expect(result.current.busy.size).toBe(0)
  })

  it('drops a slow answer for a window the dispatcher has since changed', async () => {
    let finishOld: (value: CrewAvailability) => void = () => {}
    mocked.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    mocked.mockResolvedValueOnce(answer(AFTERNOON, []))
    const { result, rerender } = renderHook(({ window }) => useCrewAvailability(window), {
      initialProps: { window: MORNING },
    })
    await settle()
    rerender({ window: AFTERNOON })
    await settle()

    await act(async () => { finishOld(answer(MORNING, [busyHorse('TRP-STALE')])) })

    expect(result.current.status).toBe('ready')
    expect(result.current.busy.size).toBe(0)
  })

  it('reports a failed check without greying anything out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocked.mockRejectedValue(new ApiError(502, 'down'))
    const { result } = renderHook(() => useCrewAvailability(MORNING))

    await settle()

    expect(result.current.status).toBe('error')
    expect(result.current.busy.size).toBe(0)
  })

  it('refetches the same window on demand', async () => {
    mocked.mockResolvedValueOnce(answer(MORNING, []))
    mocked.mockResolvedValueOnce(answer(MORNING, [busyHorse('TRP-RACE')]))
    const { result } = renderHook(() => useCrewAvailability(MORNING))
    await settle()

    await act(async () => { result.current.refetch() })
    await settle()

    expect(mocked).toHaveBeenCalledTimes(2)
    expect(result.current.busy.get('h-1')?.trip_reference).toBe('TRP-RACE')
  })
})
