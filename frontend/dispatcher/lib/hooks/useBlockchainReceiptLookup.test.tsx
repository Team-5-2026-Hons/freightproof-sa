import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import { useBlockchainReceiptLookup } from './useBlockchainReceiptLookup'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)
const HASH = 'a'.repeat(64)
const SUBJECT_ID = '123e4567-e89b-42d3-a456-426614174000'

function receipt(id: string): BlockchainReceipt {
  return {
    id,
    subject_type: 'phase_event',
    subject_id: SUBJECT_ID,
    receipt_type: 'pickup',
    data_hash: HASH,
    hedera_topic_id: '0.0.1234',
    hedera_sequence_number: 42,
    hedera_consensus_timestamp: '2026-09-08T10:11:12Z',
    hedera_tx_id: '0.0.1234@1788862272.000000001',
    created_at: '2026-09-08T10:11:10Z',
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (reason: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

beforeEach(() => {
  mockedGet.mockReset()
})

afterEach(() => vi.restoreAllMocks())

describe('useBlockchainReceiptLookup', () => {
  it('does not request receipts on mount', () => {
    const { result } = renderHook(() => useBlockchainReceiptLookup())

    expect(mockedGet).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({
      results: [],
      loading: false,
      error: null,
      searched: false,
    })
  })

  it('trims and URL-encodes a Hedera transaction ID', async () => {
    mockedGet.mockResolvedValue([])
    const { result } = renderHook(() => useBlockchainReceiptLookup())

    await act(async () => {
      await result.current.lookup({
        type: 'hedera_tx_id',
        identifier: '  0.0.1234@1788862272.000000001  ',
      })
    })

    expect(mockedGet).toHaveBeenCalledWith(
      '/api/v1/blockchain/receipts/lookup?hedera_tx_id=0.0.1234%401788862272.000000001',
    )
    expect(result.current.searched).toBe(true)
  })

  it('omits a blank optional subject ID', async () => {
    mockedGet.mockResolvedValue([])
    const { result } = renderHook(() => useBlockchainReceiptLookup())

    await act(async () => {
      await result.current.lookup({
        type: 'data_hash',
        identifier: `  ${HASH}  `,
        subjectId: '   ',
      })
    })

    expect(mockedGet).toHaveBeenCalledWith(
      `/api/v1/blockchain/receipts/lookup?data_hash=${HASH}`,
    )
  })

  it('includes and trims a supplied subject ID', async () => {
    mockedGet.mockResolvedValue([])
    const { result } = renderHook(() => useBlockchainReceiptLookup())

    await act(async () => {
      await result.current.lookup({
        type: 'data_hash',
        identifier: HASH,
        subjectId: `  ${SUBJECT_ID}  `,
      })
    })

    expect(mockedGet).toHaveBeenCalledWith(
      `/api/v1/blockchain/receipts/lookup?data_hash=${HASH}&subject_id=${SUBJECT_ID}`,
    )
  })

  it.each([
    { kind: 'permission', message: 'You do not have permission to view these receipts.' },
    { kind: 'network', message: `Request to /api/v1/blockchain/receipts/lookup?data_hash=${HASH} failed: Failed to fetch` },
  ])('reports a $kind failure and clears it on a successful retry', async ({ message }) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error(message)
    const retry = deferred<BlockchainReceipt[]>()
    mockedGet
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(() => retry.promise)
    const { result } = renderHook(() => useBlockchainReceiptLookup())

    await act(async () => {
      await result.current.lookup({ type: 'data_hash', identifier: HASH })
    })

    expect(result.current).toMatchObject({
      results: [],
      loading: false,
      error: message,
      searched: true,
    })
    expect(errorSpy).toHaveBeenCalledWith('Blockchain receipt lookup failed', failure)

    let retryLookup!: Promise<void>
    act(() => {
      retryLookup = result.current.lookup({ type: 'data_hash', identifier: HASH })
    })
    expect(result.current).toMatchObject({
      results: [],
      loading: true,
      error: null,
      searched: true,
    })

    await act(async () => {
      retry.resolve([receipt('retried')])
      await retryLookup
    })

    expect(result.current).toMatchObject({
      results: [receipt('retried')],
      loading: false,
      error: null,
      searched: true,
    })
    expect(mockedGet).toHaveBeenCalledTimes(2)
  })

  it('ignores an older rejection while a newer lookup is still loading', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const older = deferred<BlockchainReceipt[]>()
    const newer = deferred<BlockchainReceipt[]>()
    mockedGet
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)
    const { result } = renderHook(() => useBlockchainReceiptLookup())

    let olderLookup!: Promise<void>
    let newerLookup!: Promise<void>
    act(() => {
      olderLookup = result.current.lookup({ type: 'data_hash', identifier: HASH })
      newerLookup = result.current.lookup({
        type: 'hedera_tx_id',
        identifier: '0.0.1234@1788862272.000000001',
      })
    })

    await act(async () => {
      older.reject(new Error('Older lookup failed'))
      await olderLookup
    })

    expect(result.current).toMatchObject({
      results: [],
      loading: true,
      error: null,
      searched: true,
    })
    expect(errorSpy).not.toHaveBeenCalled()

    await act(async () => {
      newer.resolve([receipt('newer')])
      await newerLookup
    })

    expect(result.current).toMatchObject({
      results: [receipt('newer')],
      loading: false,
      error: null,
      searched: true,
    })
  })

  it('ignores an older response that resolves after a newer lookup', async () => {
    const older = deferred<BlockchainReceipt[]>()
    const newer = deferred<BlockchainReceipt[]>()
    mockedGet
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)
    const { result } = renderHook(() => useBlockchainReceiptLookup())

    let olderLookup!: Promise<void>
    act(() => {
      olderLookup = result.current.lookup({ type: 'data_hash', identifier: HASH })
    })
    await waitFor(() => expect(result.current.loading).toBe(true))

    let newerLookup!: Promise<void>
    act(() => {
      newerLookup = result.current.lookup({
        type: 'hedera_tx_id',
        identifier: '0.0.1234@1788862272.000000001',
      })
    })

    await act(async () => {
      newer.resolve([receipt('newer')])
      await newerLookup
    })
    expect(result.current.results.map(item => item.id)).toEqual(['newer'])
    expect(result.current.loading).toBe(false)

    await act(async () => {
      older.resolve([receipt('older')])
      await olderLookup
    })
    expect(result.current.results.map(item => item.id)).toEqual(['newer'])
    expect(result.current.loading).toBe(false)
  })

  it('clears state and prevents an in-flight request from restoring stale results', async () => {
    const pending = deferred<BlockchainReceipt[]>()
    mockedGet.mockImplementationOnce(() => pending.promise)
    const { result } = renderHook(() => useBlockchainReceiptLookup())

    let lookupPromise!: Promise<void>
    act(() => {
      lookupPromise = result.current.lookup({ type: 'data_hash', identifier: HASH })
    })
    await waitFor(() => expect(result.current.loading).toBe(true))

    act(() => result.current.clear())
    expect(result.current).toMatchObject({
      results: [],
      loading: false,
      error: null,
      searched: false,
    })

    await act(async () => {
      pending.resolve([receipt('stale')])
      await lookupPromise
    })
    expect(result.current.results).toEqual([])
    expect(result.current.searched).toBe(false)
  })
})
