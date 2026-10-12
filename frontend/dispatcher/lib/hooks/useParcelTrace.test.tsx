import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api/client'
import { BARCODE, WAYBILL, makeTrace } from '@/components/parcels/__fixtures__/trace'
import { useParcelTrace } from './useParcelTrace'
import type { ParcelLookupResponse } from '@shared/lib/types/parcel-trace'

vi.mock('@/lib/api/client', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message) }
  }
  return { api: { get: vi.fn() }, ApiError }
})

const get = vi.mocked(api.get)
const found: ParcelLookupResponse = { barcode: BARCODE, items: [{ waybill_reference: WAYBILL, journey_count: 1 }], next_after: null }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => get.mockReset())

describe('parcel trace lookup', () => {
  it('waits for submission and automatically opens a unique exact match', async () => {
    get.mockResolvedValueOnce(found).mockResolvedValueOnce(makeTrace())
    const { result } = renderHook(() => useParcelTrace())
    expect(get).not.toHaveBeenCalled()
    await act(() => result.current.search(`  ${BARCODE}  `))
    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/parcels/lookup?barcode=000123%2Fa')
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/parcels/trace?barcode=000123%2Fa&waybill_reference=WB-TRACE-01')
    expect(result.current.trace?.barcode).toBe(BARCODE)
    expect(result.current.busy).toBeNull()
  })

  it('does not choose arbitrarily between waybills or incomplete lookup pages', async () => {
    get.mockResolvedValue({ ...found, next_after: WAYBILL })
    const { result } = renderHook(() => useParcelTrace())
    await act(() => result.current.search(BARCODE))
    expect(get).toHaveBeenCalledTimes(1)
    expect(result.current.trace).toBeNull()
  })

  it('returns an empty lookup without a trace request', async () => {
    get.mockResolvedValue({ ...found, items: [] })
    const { result } = renderHook(() => useParcelTrace())
    await act(() => result.current.search(BARCODE))
    expect(result.current.lookup?.items).toEqual([])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('ignores an older lookup that resolves after a newer search', async () => {
    const old = deferred<ParcelLookupResponse>()
    get.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...found, barcode: 'new', items: [] })
    const { result } = renderHook(() => useParcelTrace())
    let pending!: Promise<void>
    act(() => { pending = result.current.search('old') })
    await act(() => result.current.search('new'))
    await act(async () => { old.resolve(found); await pending })
    expect(result.current.lookup?.barcode).toBe('new')
    expect(result.current.trace).toBeNull()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('does not republish a trace after the input is cleared', async () => {
    const pending = deferred<ReturnType<typeof makeTrace>>()
    get.mockResolvedValueOnce(found).mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useParcelTrace())
    let request!: Promise<void>
    await act(async () => { request = result.current.search(BARCODE); await Promise.resolve() })
    act(() => result.current.clear())
    await act(async () => { pending.resolve(makeTrace()); await request })
    expect(result.current.lookup).toBeNull()
    expect(result.current.trace).toBeNull()
    expect(result.current.busy).toBeNull()
  })

  it('keeps old request failures from replacing new results', async () => {
    const old = deferred<ParcelLookupResponse>()
    get.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...found, items: [] })
    const { result } = renderHook(() => useParcelTrace())
    let request!: Promise<void>
    act(() => { request = result.current.search('old') })
    await act(() => result.current.search('new'))
    await act(async () => { old.reject(new Error('network')); await request })
    expect(result.current.error).toBeNull()
  })

  it('withdraws previously displayed evidence on a pagination authorization failure', async () => {
    get.mockResolvedValueOnce(found).mockResolvedValueOnce({ ...makeTrace(), next_cursor: 'cursor' }).mockRejectedValueOnce(new ApiError(403, 'Forbidden'))
    const { result } = renderHook(() => useParcelTrace())
    await act(() => result.current.search(BARCODE))
    await act(() => result.current.moreJourneys())
    expect(result.current.trace).toBeNull()
    expect(result.current.lookup).toBeNull()
    expect(result.current.error).toContain('unavailable to your account')
  })

  it('appends earlier journeys without replacing the latest state or duplicating trips', async () => {
    const trace = makeTrace()
    get.mockResolvedValueOnce(found).mockResolvedValueOnce({ ...trace, next_cursor: 'page 2' })
      .mockResolvedValueOnce({ ...trace, journeys: [trace.journeys[0], { ...trace.journeys[0], trip_id: 'older' }] })
    const { result } = renderHook(() => useParcelTrace())
    await act(() => result.current.search(BARCODE))
    await act(() => result.current.moreJourneys())
    expect(result.current.trace?.journeys.map(j => j.trip_id)).toEqual(['trip-1', 'older'])
    expect(get.mock.calls[2][0]).toContain('cursor=page+2')
  })

  it('opens an explicitly selected waybill restored from the URL', async () => {
    get.mockResolvedValueOnce({ ...found, items: [{ waybill_reference: 'OTHER', journey_count: 1 }, ...found.items] }).mockResolvedValueOnce(makeTrace())
    const { result } = renderHook(() => useParcelTrace())
    await act(() => result.current.search(BARCODE, WAYBILL))
    expect(result.current.trace?.waybill_reference).toBe(WAYBILL)
  })
})
