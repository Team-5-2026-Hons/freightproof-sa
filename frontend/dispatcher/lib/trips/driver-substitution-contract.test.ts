// FP-83 C0 — the fixture pack is the contract Tim builds against (docs/contracts/driver-substitution-v1.md).
//
// These tests pin that the pack covers every state the contract names, that each fixture
// obeys the invariants the wire types promise, and that the endpoint/status/code matrix is
// complete as DATA — every row maps to a status and a code, and every code is exercised —
// rather than just checking error text.
import { describe, expect, it } from 'vitest'

import {
  SUBSTITUTION_COMPLETION_BLOCKER_ORDER,
  SUBSTITUTION_ERROR_STATUS,
  type SubstitutionCompletionBlocker,
  type SubstitutionErrorCode,
  type SubstitutionRequestRead,
} from '@shared/lib/types/driver-substitution'
import {
  SUBSTITUTION_ENDPOINT_MATRIX,
  blockedConfirmationFixtures,
  substitutionErrorFixtures,
  substitutionFixturePack as pack,
} from '@shared/lib/mocks/driver-substitutions'
import { mockTrips } from '@shared/lib/mocks'

const ERROR_CODES = Object.keys(SUBSTITUTION_ERROR_STATUS) as SubstitutionErrorCode[]
const BLOCKERS: readonly SubstitutionCompletionBlocker[] = [
  'incoming_driver_inactive',
  'licence_invalid',
  'driver_unavailable',
  'identity_not_verified',
]

const REQUIRED_STATES = [
  'noSubstitution',
  'outgoingPending',
  'immediatePending',
  'incomingPendingNoActiveTrip',
  'oneConfirmation',
  'normalCompleted',
  'dispatcherAttestedCompleted',
  'identityUnavailableCompleted',
  'cancelled',
  'replaced',
  'formerParticipantHistory',
  'lateEvidence',
  'notApplicableSealReason',
  'identityFailed',
  'licenceMissing',
  'licenceExpired',
  'savedButBlocked',
  'contextWithFindings',
  'clarification',
  'custodyIntegrityPending',
  'custodyIntegrityFailed',
  'flagOffDetail',
] as const

function isRequestRead(value: unknown): value is SubstitutionRequestRead {
  return typeof value === 'object' && value !== null && 'permitted_actions' in value && 'missing_confirmations' in value
}

function collectRequests(value: unknown, found: SubstitutionRequestRead[] = []): SubstitutionRequestRead[] {
  if (isRequestRead(value)) found.push(value)
  if (Array.isArray(value)) value.forEach(item => collectRequests(item, found))
  else if (typeof value === 'object' && value !== null) Object.values(value).forEach(item => collectRequests(item, found))
  return found
}

describe('fixture pack coverage', () => {
  it('has a fixture for every state the contract names', () => {
    expect(Object.keys(pack).sort()).toEqual([...REQUIRED_STATES].sort())
  })

  it('uses UUID-shaped local test ids', () => {
    const ids = [...JSON.stringify(pack).matchAll(/"id":"([^"]+)"/g)].map(match => match[1])

    expect(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true)
  })

  it('exposes no identity number, licence number or verification vendor data to the other party', () => {
    const driverFacing = JSON.stringify([
      collectRequests(pack).map(request => [request.outgoing, request.incoming, request.identity]),
      pack.contextWithFindings,
      pack.formerParticipantHistory.history,
    ])

    expect(driverFacing).not.toMatch(/id_number|license_number|licence_number|vendor/)
    for (const request of collectRequests(pack)) {
      expect(Object.keys(request.outgoing).sort()).toEqual(['full_name', 'id', 'phone_number'])
      expect(Object.keys(request.incoming).sort()).toEqual(['full_name', 'id', 'phone_number'])
    }
  })
})

describe('request fixtures obey the wire invariants', () => {
  const requests = collectRequests(pack)

  it('finds the request fixtures it is meant to check', () => {
    expect(requests.length).toBeGreaterThanOrEqual(10)
  })

  it.each(requests.map(request => [`${request.state} v${request.version} ${request.id.slice(-4)}`, request] as const))(
    '%s',
    (_label, request) => {
      const completionFacts = [request.completed_substitution_id, request.effective_at, request.completion_mode, request.completion]
      if (request.state === 'completed') {
        expect(completionFacts.every(fact => fact !== null)).toBe(true)
        expect(request.permitted_actions).toEqual([])
      } else {
        expect(completionFacts.every(fact => fact === null)).toBe(true)
      }
      if (request.completion_blocked_by !== null) expect(request.state).toBe('pending')
      if (request.replacement_request_id !== null) expect(request.state).toBe('cancelled')
      if (request.completion) {
        const { completed_by_driver_id: driver, completed_by_user_id: user, trigger } = request.completion
        expect([driver, user].filter(actor => actor !== null)).toHaveLength(1)
        expect(trigger === 'driver_confirmation').toBe(driver !== null)
      }
      expect(request.version).toBeGreaterThanOrEqual(1)
      expect(request.identity.driver_id).toBe(request.incoming.id)
    },
  )

  it('records the completion mode and trigger independently', () => {
    expect(pack.normalCompleted.completion_mode).toBe('normal')
    expect(pack.normalCompleted.completion?.trigger).toBe('driver_confirmation')
    expect(pack.dispatcherAttestedCompleted.completion_mode).toBe('dispatcher_attested')
    expect(pack.dispatcherAttestedCompleted.completion?.trigger).toBe('dispatcher_action')
  })

  it('never relabels an unavailable identity as verified', () => {
    expect(pack.identityUnavailableCompleted.identity.status).toBe('pending')
    expect(pack.identityUnavailableCompleted.completion_mode).toBe('dispatcher_attested')
    expect(pack.identityFailed.identity.status).toBe('failed')
  })

  it('keeps a cancelled request apart from its replacement', () => {
    expect(pack.replaced.old.state).toBe('cancelled')
    expect(pack.replaced.old.replacement_request_id).toBe(pack.replaced.replacement.id)
    expect(pack.replaced.replacement.state).toBe('pending')
    expect(pack.replaced.replacement.confirmations).toEqual([])
    expect(pack.cancelled.replacement_request_id).toBeNull()
  })

  it('gives an incoming driver with no active trip a pending arrangement', () => {
    expect(pack.incomingPendingNoActiveTrip.active_trip).toBeNull()
    expect(pack.incomingPendingNoActiveTrip.pending[0]?.permitted_actions).toContain('confirm_incoming')
  })

  it('shows relevant findings and driver-safe stops in the context read', () => {
    expect(pack.contextWithFindings.findings.length).toBeGreaterThan(0)
    expect(pack.contextWithFindings.remaining_stops.length).toBeGreaterThan(0)
    expect(pack.contextWithFindings.confirmations.some(c => c.seal_checks.length > 0)).toBe(true)
  })
})

describe('seal rules in the fixtures', () => {
  it('carries a per-vehicle not-applicable reason with no number', () => {
    const check = pack.notApplicableSealReason.seal_check

    expect(check.condition).toBe('not_applicable')
    expect(check.seal_number).toBeNull()
    expect((check.not_applicable_reason ?? '').trim().length).toBeGreaterThan(0)
  })

  it('has one seal check per vehicle in every confirmation body', () => {
    const body = pack.notApplicableSealReason.confirm_request
    const vehicles = body.seal_checks.map(check => check.vehicle_id)

    expect(new Set(vehicles).size).toBe(vehicles.length)
  })

  it('leaves coordinates null together when capture was unavailable', () => {
    const body = pack.notApplicableSealReason.no_position_request

    expect([body.latitude, body.longitude, body.accuracy_metres]).toEqual([null, null, null])
  })
})

describe('saved-but-blocked confirmations are success bodies, not errors', () => {
  it.each(BLOCKERS)('%s is a 200 pending request', blocker => {
    const fixture = blockedConfirmationFixtures[blocker]

    expect(fixture.http_status).toBe(200)
    expect(fixture.body.state).toBe('pending')
    expect(fixture.body.completion_blocked_by).toBe(blocker)
    expect(fixture.body.confirmations.length).toBeGreaterThan(0)
    expect('detail' in fixture.body).toBe(false)
  })

  it('never appears among the error-response fixtures', () => {
    for (const fixture of Object.values(substitutionErrorFixtures)) {
      expect('completion_blocked_by' in fixture.body).toBe(false)
    }
  })

  it('lists blockers in the contract precedence order', () => {
    expect(SUBSTITUTION_COMPLETION_BLOCKER_ORDER).toEqual(BLOCKERS)
  })
})

describe('error fixtures', () => {
  it('has one fixture per contract code, with the contract status', () => {
    expect(Object.keys(substitutionErrorFixtures).sort()).toEqual([...ERROR_CODES].sort())
    for (const code of ERROR_CODES) {
      const fixture = substitutionErrorFixtures[code]
      expect(fixture.http_status).toBe(SUBSTITUTION_ERROR_STATUS[code])
      expect(fixture.body.detail.code).toBe(code)
      expect(fixture.body.detail.message.length).toBeGreaterThan(0)
    }
  })

  it('maps only the permission and availability codes away from 409', () => {
    const others = ERROR_CODES.filter(code => SUBSTITUTION_ERROR_STATUS[code] !== 409)

    expect(others.sort()).toEqual(['IDENTITY_ATTESTATION_FORBIDDEN', 'SUBSTITUTIONS_DISABLED'])
  })

  it('carries the context each conflict needs', () => {
    expect(substitutionErrorFixtures.SUBSTITUTION_VERSION_CHANGED.body.detail.current_version).toBeGreaterThanOrEqual(1)
    expect(substitutionErrorFixtures.EVIDENCE_ALREADY_RECORDED.body.detail.evidence_id).toBeTruthy()
    expect(substitutionErrorFixtures.SUBSTITUTION_NOT_PENDING.body.detail.request_id).toBeTruthy()
  })
})

describe('endpoint/status/code matrix', () => {
  it('maps every endpoint/outcome row to a status and, for failures, a contract code', () => {
    expect(SUBSTITUTION_ENDPOINT_MATRIX.length).toBeGreaterThanOrEqual(20)
    for (const row of SUBSTITUTION_ENDPOINT_MATRIX) {
      expect(row.endpoint.length, row.outcome).toBeGreaterThan(0)
      expect(Number.isInteger(row.http_status), row.outcome).toBe(true)
      if (row.code === null) {
        expect(row.http_status, `${row.endpoint}: ${row.outcome}`).toBeGreaterThanOrEqual(200)
        expect(row.http_status, `${row.endpoint}: ${row.outcome}`).toBeLessThan(300)
      } else {
        expect(SUBSTITUTION_ERROR_STATUS[row.code], `${row.endpoint}: ${row.outcome}`).toBe(row.http_status)
      }
    }
  })

  it('exercises every contract code at least once', () => {
    const used = new Set(SUBSTITUTION_ENDPOINT_MATRIX.map(row => row.code).filter(code => code !== null))

    expect([...used].sort()).toEqual([...ERROR_CODES].sort())
  })

  it('distinguishes the 200 saved-but-blocked outcome from the 409 dispatcher completion', () => {
    const saved = SUBSTITUTION_ENDPOINT_MATRIX.find(row => row.outcome.includes('saved but completion blocked'))
    const refused = SUBSTITUTION_ENDPOINT_MATRIX.find(
      row => row.action === 'dispatcher_complete' && row.code === 'IDENTITY_NOT_VERIFIED',
    )

    expect([saved?.http_status, refused?.http_status]).toEqual([200, 409])
    expect(saved?.code).toBeNull()
  })

  it('returns 403 for a non-admin identity attestation and 503 for the disabled flag', () => {
    const forbidden = SUBSTITUTION_ENDPOINT_MATRIX.find(row => row.code === 'IDENTITY_ATTESTATION_FORBIDDEN')
    const disabled = SUBSTITUTION_ENDPOINT_MATRIX.find(row => row.code === 'SUBSTITUTIONS_DISABLED')

    expect([forbidden?.http_status, disabled?.http_status]).toEqual([403, 503])
  })
})

describe('trip-level custody fields', () => {
  it('give every ordinary mock trip compatible defaults', () => {
    for (const trip of mockTrips) {
      expect(trip.custody_sequence, trip.trip_reference).toBe(0)
      expect(trip.driver_substitutions, trip.trip_reference).toEqual([])
      expect(trip.pending_driver_substitution, trip.trip_reference).toBeNull()
      expect(trip.driver_substitutions_enabled, trip.trip_reference).toBe(false)
      expect(trip.driver_access, trip.trip_reference).toBeNull()
      expect(trip.original_driver?.id, trip.trip_reference).toBe(trip.driver?.id)
    }
  })

  it('shows the flag off while existing handovers still read', () => {
    expect(pack.flagOffDetail.driver_substitutions_enabled).toBe(false)
    expect(pack.flagOffDetail.pending_driver_substitution).not.toBeNull()
    expect(pack.flagOffDetail.driver_substitutions.length).toBeGreaterThan(0)
  })

  it('keeps the original driver apart from the derived current driver after a transfer', () => {
    expect(pack.flagOffDetail.original_driver?.id).not.toBe(pack.flagOffDetail.driver?.id)
    expect(pack.flagOffDetail.custody_sequence).toBeGreaterThan(0)
  })
})
