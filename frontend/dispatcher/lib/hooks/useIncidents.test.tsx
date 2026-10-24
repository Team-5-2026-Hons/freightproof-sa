import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listIncidents } from '@/lib/api/incidents'
import { useRealtimeChannel } from '@/lib/realtime/RealtimeProvider'
import type { IncidentListFilters, IncidentSummary } from '@/lib/types/incident'
import { useIncidents } from './useIncidents'

vi.mock('@/lib/api/incidents', () => ({ listIncidents: vi.fn(), getIncident: vi.fn(), getIncidentEvidence: vi.fn() }))
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() } }))
vi.mock('@/lib/realtime/RealtimeProvider', () => ({ useRealtimeChannel: vi.fn() }))

const mockedList = vi.mocked(listIncidents)

function incident(id: string, status: IncidentSummary['status']): IncidentSummary {
  return { incident_id: id, status } as IncidentSummary
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve() }) }

beforeEach(() => {
  mockedList.mockReset()
  mockedList.mockResolvedValue([])
  vi.mocked(useRealtimeChannel).mockReturnValue({ status: 'live', subscribe: () => () => {}, reconnectNonce: 0 })
})

describe('useIncidents filters', () => {
  it('refetches_with_the_new_status_when_the_filters_change', async () => {
    const open = incident('open-1', 'open')
    const closed = incident('closed-1', 'closed')
    mockedList.mockImplementation(async (filters?: IncidentListFilters) => filters?.status === 'closed' ? [closed] : [open])
    const { result, rerender } = renderHook(
      ({ filters }: { filters: IncidentListFilters }) => useIncidents(filters),
      { initialProps: { filters: { status: 'open' } as IncidentListFilters } },
    )
    await flush()
    expect(result.current.data).toEqual([open])

    rerender({ filters: { status: 'closed' } })
    await flush()

    expect(mockedList).toHaveBeenLastCalledWith({ status: 'closed', incident_type: undefined, assigned_to: undefined })
    expect(result.current.data).toEqual([closed])
  })

  it('fetches_once_on_mount_and_not_again_on_a_rerender_with_the_same_filters', async () => {
    const { rerender } = renderHook(
      ({ filters }: { filters: IncidentListFilters }) => useIncidents(filters),
      { initialProps: { filters: { status: 'open' } as IncidentListFilters } },
    )
    await flush()

    rerender({ filters: { status: 'open' } })
    await flush()

    expect(mockedList).toHaveBeenCalledTimes(1)
  })

  it('shows_the_latest_filters_when_an_older_response_lands_late', async () => {
    const resolvers: Array<(rows: IncidentSummary[]) => void> = []
    mockedList.mockImplementation(() => new Promise<IncidentSummary[]>(resolve => { resolvers.push(resolve) }))
    const { result, rerender } = renderHook(
      ({ filters }: { filters: IncidentListFilters }) => useIncidents(filters),
      { initialProps: { filters: { status: 'open' } as IncidentListFilters } },
    )
    await flush()

    rerender({ filters: { status: 'closed' } })
    await flush()
    // The open request is still in flight, so the closed one waits behind it.
    expect(mockedList).toHaveBeenCalledTimes(1)

    await act(async () => { resolvers[0]!([incident('open-1', 'open')]) })
    await flush()
    await act(async () => { resolvers[1]!([incident('closed-1', 'closed')]) })
    await flush()

    expect(mockedList).toHaveBeenCalledTimes(2)
    expect(mockedList).toHaveBeenLastCalledWith({ status: 'closed', incident_type: undefined, assigned_to: undefined })
    expect(result.current.data.map(i => i.incident_id)).toEqual(['closed-1'])
  })
})
