// frontend/driver-pwa/lib/offline/retained-evidence.test.ts
//
// What the review screen is told about a capture kept because dispatch overrode its phase:
// the server's reason, no late-evidence route (that needs a former custody period) and no
// live "Try again" (the row stays overridden, so a resend is refused every time).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listRetainedEvidence } from './retained-evidence'
import { retainedAttention, PHASE_OVERRIDDEN_REASON } from './live-write-conflict'
import { __setIndexedDbForTests } from './exception-store'
import { __setSubstitutionIndexedDbForTests } from './substitution-store'
import { saveQueue, type PhaseQueueEntry } from './queue-storage'
import { createFakeIndexedDb } from './testing/fake-indexeddb'
import { authenticateTestDriver } from '@/lib/session/testing/custody'
import type { PhaseEventId } from '@shared/lib/types/phase'

const TRIP_ID = 'trip-1'

function retainedEntry(code: 'PHASE_OVERRIDDEN' | 'CUSTODY_CONTEXT_CHANGED'): PhaseQueueEntry {
  return {
    kind: 'phase', id: `entry-${code}`, tripId: TRIP_ID, phaseEventId: 'pe-loading' as PhaseEventId,
    phaseType: 'loading', evidence: { capturedAt: '2026-01-01T00:00:00Z' }, idempotencyKey: `entry-${code}`,
    position: null, driverCapturedAt: '2026-01-01T00:00:00Z', acknowledgement: null,
    enqueuedAt: '2026-01-01T00:00:01Z', actorId: 'driver-1', custodySequence: 1,
    status: 'needs-attention', attention: retainedAttention(code, 409, PHASE_OVERRIDDEN_REASON),
  }
}

beforeEach(() => {
  localStorage.clear()
  __setIndexedDbForTests(createFakeIndexedDb())
  __setSubstitutionIndexedDbForTests(createFakeIndexedDb())
  authenticateTestDriver(TRIP_ID, 1)
})

afterEach(() => {
  __setIndexedDbForTests(null)
  __setSubstitutionIndexedDbForTests(null)
})

describe('listRetainedEvidence — capture for an overridden phase', () => {
  it('shows the server reason with neither a late-evidence send nor a live retry', async () => {
    saveQueue([retainedEntry('PHASE_OVERRIDDEN')])

    const { items } = await listRetainedEvidence()

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: expect.stringContaining('evidence'),
      reason: PHASE_OVERRIDDEN_REASON,
      quarantined: false,
      canRetry: false,
      late: null,
    })
  })

  it('still offers a live retry for a refusal that is neither custody nor an override', async () => {
    const entry = retainedEntry('PHASE_OVERRIDDEN')
    saveQueue([{ ...entry, attention: retainedAttention(null, 422, 'invalid evidence') }])

    const { items } = await listRetainedEvidence()

    expect(items[0]).toMatchObject({ canRetry: true, reason: 'invalid evidence' })
  })
})
