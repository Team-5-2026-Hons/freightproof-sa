import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn() } },
  getAccessToken: vi.fn(),
}))

import { ApiError } from '@/lib/api/client'
import { classifyCreateError, classifyLookupError, isPreview } from './trip-api-errors'
import { makePreview } from './__fixtures__/preview'

describe('classifyLookupError', () => {
  it('names the number when no such manifest exists', () => {
    const failure = classifyLookupError(new ApiError(404, 'Manifest 999 not found'), 999)

    expect(failure.kind).toBe('not_found')
    expect(failure.message).toContain('999')
  })

  it('passes the 501 text through as unsupported', () => {
    const message = 'Manifest lookup is not available from the connected parcel system.'

    expect(classifyLookupError(new ApiError(501, message), 81)).toEqual({ kind: 'unsupported', message })
  })

  it('treats an unreachable parcel system and no response as retryable', () => {
    expect(classifyLookupError(new ApiError(502, 'The parcel system is unreachable. Try again shortly.'), 81).kind).toBe('retryable')
    expect(classifyLookupError(new ApiError(0, 'timed out'), 81).kind).toBe('retryable')
  })

  it('never shows a raw exception', () => {
    expect(classifyLookupError(new TypeError('boom'), 81)).toEqual({
      kind: 'rejected', message: 'Something went wrong. Please try again.',
    })
  })
})

describe('classifyCreateError', () => {
  it('reports no response for a client-side timeout', () => {
    expect(classifyCreateError(new ApiError(0, 'timed out'))).toEqual({ kind: 'no_response' })
  })

  it('carries the fresh preview of a changed manifest', () => {
    const fresh = makePreview({ snapshot_sha256: 'b'.repeat(64) })
    const err = new ApiError(409, 'Manifest 81 changed since it was previewed. Review it again.', {
      code: 'MANIFEST_CHANGED', message: 'Manifest 81 changed since it was previewed. Review it again.', preview: fresh,
    })

    expect(classifyCreateError(err)).toEqual({ kind: 'manifest_changed', message: err.message, preview: fresh })
  })

  it('does not trust a malformed changed-manifest preview', () => {
    const err = new ApiError(409, 'changed', { code: 'MANIFEST_CHANGED', message: 'changed', preview: { nope: true } })

    expect(classifyCreateError(err)).toEqual({ kind: 'rejected', message: 'changed' })
  })

  it('names the trip already holding the manifest', () => {
    const err = new ApiError(409, 'This manifest is already on trip FP-1.', {
      code: 'MANIFEST_ALREADY_ON_TRIP', message: 'This manifest is already on trip FP-1.', trip_id: 'trip-1', trip_reference: 'FP-1',
    })

    expect(classifyCreateError(err)).toEqual({
      kind: 'already_on_trip', message: err.message, tripId: 'trip-1', tripReference: 'FP-1',
    })
  })

  it('carries every crew clash of a 409 CREW_UNAVAILABLE, and drops a malformed one', () => {
    const clash = {
      resource_type: 'horse', resource_id: 'h-1', label: 'CA 441 892', trip_id: 't-1', trip_reference: 'TRP-0038',
      trip_status: 'created', busy_from: '2026-10-16T06:00:00Z', busy_until: '2026-10-16T14:00:00Z',
      planned_until: '2026-10-16T14:00:00Z',
    }
    const message = 'Horse CA 441 892 is on TRP-0038 until Fri 16 Oct, 16:00. Pick another horse, or move this departure.'
    const err = new ApiError(409, message, { code: 'CREW_UNAVAILABLE', message, clashes: [clash, { nonsense: true }] })

    expect(classifyCreateError(err)).toEqual({ kind: 'crew_unavailable', message, clashes: [clash] })
  })

  it('keeps a lost race whose winner rolled back as already_on_trip with no trip', () => {
    const err = new ApiError(409, 'This manifest is already on trip.', {
      code: 'MANIFEST_ALREADY_ON_TRIP', message: 'This manifest is already on trip.', trip_id: null, trip_reference: null,
    })

    expect(classifyCreateError(err)).toMatchObject({ kind: 'already_on_trip', tripId: null, tripReference: null })
  })

  it('shows the backend text for a held waybill and a 422', () => {
    const held = new ApiError(409, "Waybill 'WAY001' was scanned on another cancelled trip.", "Waybill 'WAY001' was scanned on another cancelled trip.")
    const unusable = new ApiError(422, 'Origin and destination must be different precincts.', {
      code: 'SAME_PRECINCT', message: 'Origin and destination must be different precincts.',
    })

    expect(classifyCreateError(held)).toEqual({ kind: 'rejected', message: held.message })
    expect(classifyCreateError(unusable)).toEqual({ kind: 'rejected', message: unusable.message })
  })
})

describe('isPreview', () => {
  it('accepts a preview', () => {
    expect(isPreview(makePreview())).toBe(true)
  })

  it('rejects what is not a preview', () => {
    expect(isPreview(null)).toBe(false)
    expect(isPreview('preview')).toBe(false)
    expect(isPreview({ nope: true })).toBe(false)
    expect(isPreview({ ...makePreview(), snapshot_sha256: null })).toBe(false)
    expect(isPreview({ ...makePreview(), warnings: undefined })).toBe(false)
  })
})
