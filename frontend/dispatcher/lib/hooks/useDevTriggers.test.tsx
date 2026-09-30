import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDevTriggers } from './useDevTriggers'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error { status = 500 },
}))

const post = vi.mocked(api.post)

beforeEach(() => { post.mockReset() })

describe('useDevTriggers activity log', () => {
  it('logs a rig scenario with its label, the check summary and its findings, newest first', async () => {
    post.mockResolvedValueOnce({
      trip_id: 't', scenario: 'trailer_uncoupled', label: 'Trailer TRL 222 uncoupled on the road', readings: [], skipped_reason: null,
      findings: [{ exception_type: 'trailer_separated_in_transit', severity: 'critical', vehicle_id: 'v', description: 'd', newly_recorded: true }],
    })
    post.mockResolvedValueOnce({ trip_id: 't', readings: [], findings: [], skipped_reason: null })
    const { result } = renderHook(() => useDevTriggers())

    await act(async () => { await result.current.runRigScenario({ trip_id: 't', scenario: 'trailer_uncoupled', vehicle_id: 'v' }) })
    await act(async () => { await result.current.runRoadCheck('t') })

    expect(result.current.activity.map(e => e.text)).toEqual([
      'Tracker check: nothing new.',
      'Trailer TRL 222 uncoupled on the road. Tracker check: 1 new finding (Trailer separated on the road).',
    ])
    expect(result.current.activity[1].findings).toHaveLength(1)
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/dev/tracker/scenario', { trip_id: 't', scenario: 'trailer_uncoupled', vehicle_id: 'v' })
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/dev/tracker/check', { trip_id: 't' })
  })

  it('logs a failure as an error entry', async () => {
    post.mockRejectedValueOnce(new Error('The trip is not on the road.'))
    const { result } = renderHook(() => useDevTriggers())

    await act(async () => { await result.current.runRigScenario({ trip_id: 't', scenario: 'en_route' }) })

    expect(result.current.activity[0]).toMatchObject({ tone: 'error', text: 'The trip is not on the road.' })
  })
})
