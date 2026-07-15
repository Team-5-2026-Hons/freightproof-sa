// frontend/driver-pwa/app/(app)/trip/handshake/[h]/step/[slug]/__tests__/isQueueableFailure.test.ts
//
// Objective 2: submitAndAdvance's final catch branch used to enqueue every non-4xx
// failure as offline evidence — including local validation Errors thrown by
// submitHandshake BEFORE any network call (e.g. "H1 evidence incomplete — …"), which can
// never succeed on retry and produced a misleading "evidence stored on this device"
// receipt. isQueueableFailure is the extracted, pure enqueue-decision: only a failure
// that's plausibly transient (a network-level TypeError, or an ApiError with status 0
// or >= 500) should ever be queued.
import { describe, it, expect } from 'vitest'
import { isQueueableFailure } from '../HandshakeStepPageClient'
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

  it('does not queue a local validation Error (submitHandshake pre-network guard)', () => {
    expect(isQueueableFailure(new Error('H1 evidence incomplete — GPS and gate photo are required.'))).toBe(false)
  })

  it('does not queue an arbitrary non-Error thrown value', () => {
    expect(isQueueableFailure('some string')).toBe(false)
    expect(isQueueableFailure(undefined)).toBe(false)
    expect(isQueueableFailure({ message: 'not an Error instance' })).toBe(false)
  })
})
