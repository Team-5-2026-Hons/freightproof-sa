// frontend/driver-pwa/lib/api/__tests__/driver-substitutions.test.ts
//
// The driver substitution wrappers must hit the contract's exact paths (docs/contracts/
// driver-substitution-v1.md, "Driver endpoints") through the shared transport, and the
// handed-over check must key on the coded detail — never on the 409 status alone, which
// several unrelated conflicts share.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { substitutionErrorFixtures } from '@shared/lib/mocks/driver-substitutions'

const mockGet = vi.fn()
const mockPost = vi.fn()
vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()
  return {
    ...actual,
    api: {
      get: (...args: unknown[]) => mockGet(...args),
      post: (...args: unknown[]) => mockPost(...args),
    },
  }
})

import { ApiError } from '../client'
import {
  fetchDriverParticipation,
  fetchDriverSubstitutionContext,
  fetchDriverSubstitutions,
  fetchSubstitutionNotices,
  isTripHandedOver,
  markSubstitutionNoticeRead,
} from '../driver-substitutions'

const TRIP_ID = crypto.randomUUID()
const REQUEST_ID = crypto.randomUUID()
const NOTICE_ID = crypto.randomUUID()

function codedError(code: keyof typeof substitutionErrorFixtures): ApiError {
  const fixture = substitutionErrorFixtures[code]
  return new ApiError(fixture.http_status, fixture.body.detail.message, undefined, {
    code: fixture.body.detail.code,
    requestId: null,
    currentVersion: null,
    evidenceId: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockResolvedValue([])
  mockPost.mockResolvedValue({})
})

describe('driver substitution API', () => {
  it('test_pending_list_uses_its_own_route_not_active_trip', async () => {
    await fetchDriverSubstitutions()

    expect(mockGet).toHaveBeenCalledWith('/api/v1/trips/me/driver-substitutions')
  })

  it('test_context_read_addresses_trip_and_request', async () => {
    await fetchDriverSubstitutionContext(TRIP_ID, REQUEST_ID)

    expect(mockGet).toHaveBeenCalledWith(`/api/v1/trips/me/${TRIP_ID}/driver-substitutions/${REQUEST_ID}`)
  })

  it('test_notices_default_to_unread_only', async () => {
    await fetchSubstitutionNotices()

    expect(mockGet).toHaveBeenCalledWith('/api/v1/trips/me/substitution-notices?unread_only=true')
  })

  it('test_mark_read_posts_without_a_body', async () => {
    await markSubstitutionNoticeRead(NOTICE_ID)

    expect(mockPost).toHaveBeenCalledWith(`/api/v1/trips/me/substitution-notices/${NOTICE_ID}/read`)
  })

  it('test_participation_uses_restricted_history_route', async () => {
    await fetchDriverParticipation(TRIP_ID)

    expect(mockGet).toHaveBeenCalledWith(`/api/v1/trips/me/${TRIP_ID}/participation`)
  })
})

describe('isTripHandedOver', () => {
  it('test_true_for_the_coded_handed_over_conflict', () => {
    expect(isTripHandedOver(codedError('TRIP_HANDED_OVER'))).toBe(true)
  })

  it('test_false_for_other_409_codes', () => {
    expect(isTripHandedOver(codedError('EVIDENCE_ALREADY_RECORDED'))).toBe(false)
    expect(isTripHandedOver(codedError('CUSTODY_CONTEXT_CHANGED'))).toBe(false)
  })

  it('test_false_for_an_uncoded_409_and_non_api_errors', () => {
    expect(isTripHandedOver(new ApiError(409, 'Phase already completed'))).toBe(false)
    expect(isTripHandedOver(new Error('TRIP_HANDED_OVER'))).toBe(false)
  })
})
