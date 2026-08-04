// frontend/driver-pwa/lib/utils/__tests__/is-queueable-failure.test.ts
//
// Relocated from the old handshake step page's __tests__/isQueueableFailure.test.ts —
// content unchanged, only the import path moved along with the function itself.
import { describe, it, expect } from 'vitest'
import { isQueueableFailure } from '../is-queueable-failure'
import { ApiError } from '@/lib/api/client'

describe('isQueueableFailure', () => {
  it('queues a TypeError (native fetch network failure)', () => {
    expect(isQueueableFailure(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('queues an ApiError with status 0', () => {
    expect(isQueueableFailure(new ApiError(0, 'no response'))).toBe(true)
  })

  it('queues an ApiError with a 5xx status', () => {
    expect(isQueueableFailure(new ApiError(500, 'internal error'))).toBe(true)
    expect(isQueueableFailure(new ApiError(503, 'service unavailable'))).toBe(true)
  })

  it('does not queue an ApiError with a 4xx status', () => {
    expect(isQueueableFailure(new ApiError(400, 'bad request'))).toBe(false)
    expect(isQueueableFailure(new ApiError(422, 'invalid evidence'))).toBe(false)
    expect(isQueueableFailure(new ApiError(409, 'conflict'))).toBe(false)
  })

  it('does not queue a local validation Error (submitPhase pre-network guard)', () => {
    expect(isQueueableFailure(new Error('Activation evidence incomplete — GPS is required.'))).toBe(false)
  })

  it('does not queue an arbitrary non-Error thrown value', () => {
    expect(isQueueableFailure('some string')).toBe(false)
    expect(isQueueableFailure(undefined)).toBe(false)
    expect(isQueueableFailure({ message: 'not an Error instance' })).toBe(false)
  })
})
