import { describe, expect, it } from 'vitest'
import { fmtDateTime, fmtTime } from '@shared/lib/utils/datetime'
import type { AbsentAct, AnchorAct, CompletionAct, EvidenceAct, ExpectedAct } from './acts'
import {
  DEVICE_CLOCK, SERVER_CLOCK, absentLabel, anchorLabel, checksAwaitingLabel, completionTimeLine, completionTitle, completionValueLines,
  evidenceStateLabel, evidenceTimeLines, evidenceTitle, expectedLabel,
} from './act-wording'

function evidence(overrides: Partial<EvidenceAct> = {}): EvidenceAct {
  return {
    kind: 'evidence', key: 'p:evidence:a', role: 'seal_photo', artifactId: 'a', provenance: 'driver', state: 'uploaded',
    metadataAvailable: true, takenAt: '2026-01-01T10:00:00Z', receivedAt: '2026-01-01T10:00:30Z',
    receivedAfterCancellation: false, ...overrides,
  }
}

function completion(overrides: Partial<CompletionAct> = {}): CompletionAct {
  return {
    kind: 'completion', key: 'p:completion', outcome: 'completed', confirmedAt: '2026-01-01T10:00:00Z',
    recordedAt: '2026-01-01T10:00:20Z',
    values: { sealNumber: null, sealCondition: null, parcelsScanned: null, driverVisualCount: null },
    override: null, ...overrides,
  }
}

describe('evidenceTitle', () => {
  it.each([
    ['linehaul_photo', 'loading', 'Linehaul sheet photographed'],
    ['seal_photo', 'departure', 'Seal photographed'],
    ['seal_photo', 'arrival', 'Seal photographed on arrival'],
    ['pod_photo', 'confirmation', 'Proof-of-delivery photo taken'],
    ['waybill_photo', 'departure', 'Waybill copy photographed'],
  ] as const)('words %s on %s as "%s"', (role, phaseType, expected) => {
    expect(evidenceTitle(evidence({ role }), phaseType)).toBe(expected)
  })

  it('calls the receiver artifact the receiver\'s confirmation only when it is attributed to the receiver', () => {
    const receiver = evidence({ role: 'pod_signature', provenance: 'receiver' })

    expect(evidenceTitle(receiver, 'confirmation')).toBe('Receiver confirmed delivery · Attestation image')
    expect(evidenceTitle({ ...receiver, provenance: 'unknown' }, 'confirmation')).toBe('Submitted as receiver confirmation')
    expect(evidenceTitle({ ...receiver, provenance: 'driver' }, 'confirmation')).toBe('Submitted as receiver confirmation')
  })

  it('never writes Ed25519', () => {
    const all = ['linehaul_photo', 'seal_photo', 'waybill_photo', 'pod_photo', 'pod_signature'] as const
    for (const role of all) {
      expect(evidenceTitle(evidence({ role, provenance: 'receiver' }), 'confirmation')).not.toMatch(/ed25519/i)
    }
  })
})

describe('evidenceStateLabel', () => {
  it.each([
    ['uploaded', false, 'Uploaded'],
    ['submitted', false, 'Submitted at completion'],
    ['not_submitted', false, 'Not submitted'],
    ['after_close', false, 'Received after the phase closed'],
    ['trip_cancelled', false, 'Not submitted — trip cancelled'],
    ['trip_cancelled', true, 'Received after the trip was cancelled'],
  ] as const)('words %s (after cancellation: %s) as "%s"', (state, afterCancel, expected) => {
    expect(evidenceStateLabel(evidence({ state, receivedAfterCancellation: afterCancel }))).toBe(expected)
  })
})

describe('evidenceTimeLines', () => {
  it('labels the device clock and leaves the server time out when it is within two minutes', () => {
    const lines = evidenceTimeLines(evidence())

    expect(lines).toEqual([`Taken ${fmtDateTime('2026-01-01T10:00:00Z')} (device clock)`])
  })

  it('adds the server time when it differs from the device time by two minutes or more', () => {
    const lines = evidenceTimeLines(evidence({ receivedAt: '2026-01-01T10:09:00Z' }))

    expect(lines).toEqual([
      `Taken ${fmtDateTime('2026-01-01T10:00:00Z')} (device clock)`,
      `Received ${fmtDateTime('2026-01-01T10:09:00Z')} (server clock)`,
    ])
  })

  it('says the time is unavailable when the artifact metadata did not load', () => {
    expect(evidenceTimeLines(evidence({ metadataAvailable: false, takenAt: null, receivedAt: null }))).toEqual(['Time unavailable'])
  })

  it('shows the receiver\'s confirmation on the server clock only', () => {
    const lines = evidenceTimeLines(evidence({ role: 'pod_signature', provenance: 'receiver' }))

    expect(lines).toEqual([`Confirmed ${fmtDateTime('2026-01-01T10:00:30Z')} (server clock)`])
  })
})

describe('completionTitle', () => {
  it.each([
    ['activation', 'Driver confirmed arrival at Cape Town Depot'],
    ['loading', 'Driver confirmed loading'],
    ['departure', 'Driver confirmed departure'],
    ['in_transit', 'Arrived Johannesburg Depot'],
    ['arrival', 'Driver confirmed arrival'],
    ['unloading', 'Driver confirmed unloading'],
    ['confirmation', 'Driver confirmed delivery'],
  ] as const)('words %s as "%s"', (phaseType, expected) => {
    expect(completionTitle(completion(), phaseType, 'Cape Town Depot', 'Johannesburg Depot')).toBe(expected)
  })

  it('marks an exception variant and an override', () => {
    expect(completionTitle(completion({ outcome: 'exception' }), 'loading', 'x', 'y')).toBe('Driver confirmed loading — exception recorded')
    expect(completionTitle(completion({ outcome: 'overridden' }), 'loading', 'x', 'y')).toBe('Closed by dispatcher override')
  })
})

describe('completionValueLines', () => {
  it('records the seal number on a departure and the count scanned onto the truck on loading', () => {
    const values = { sealNumber: 'FP-7204', sealCondition: null, parcelsScanned: 7, driverVisualCount: null }

    expect(completionValueLines(completion({ values }), 'departure')).toEqual(['Seal FP-7204'])
    expect(completionValueLines(completion({ values }), 'loading')).toEqual(['7 parcels scanned onto truck'])
  })

  it('records the seal read and its condition on an arrival', () => {
    const values = { sealNumber: 'FP-7204', sealCondition: 'damaged' as const, parcelsScanned: null, driverVisualCount: null }

    expect(completionValueLines(completion({ values }), 'arrival')).toEqual(['Seal read FP-7204', 'Seal found damaged'])
  })

  it('records the confirmation count and the driver\'s own count, each singular when it is one', () => {
    const values = { sealNumber: null, sealCondition: null, parcelsScanned: 1, driverVisualCount: 1 }

    expect(completionValueLines(completion({ values }), 'confirmation'))
      .toEqual(['1 parcel scanned in at destination', 'Driver counted 1 parcel'])
  })

  it('states that no seal number was recorded on a closed departure or arrival, never "No seal present"', () => {
    const none = completion()

    expect(completionValueLines(none, 'departure')).toEqual(['No seal number recorded'])
    expect(completionValueLines(none, 'arrival')).toEqual(['No seal number recorded'])
    expect(completionValueLines(none, 'loading')).toEqual([])
  })

  it('does not claim a seal absence on an overridden phase, and carries the note and who authorised it', () => {
    const overridden = completion({ outcome: 'overridden', override: { note: 'Driver phone lost', authorisedBy: 'user-1' } })

    expect(completionValueLines(overridden, 'departure')).toEqual(['Driver phone lost', 'Authorised by user-1'])
  })
})

describe('completionTimeLine', () => {
  it('shows the device time only when the recorded time is within two minutes', () => {
    expect(completionTimeLine(completion())).toBe(`Confirmed ${fmtDateTime('2026-01-01T10:00:00Z')} (device clock)`)
  })

  it('adds the recorded time when it differs by two minutes or more', () => {
    const line = completionTimeLine(completion({ recordedAt: '2026-01-01T11:00:00Z' }))

    expect(line).toBe(`Confirmed ${fmtDateTime('2026-01-01T10:00:00Z')} (device clock) · recorded ${fmtDateTime('2026-01-01T11:00:00Z')} (server clock)`)
  })

  it('shows only the server time when the device time is unknown', () => {
    expect(completionTimeLine(completion({ confirmedAt: null }))).toBe(`Recorded ${fmtDateTime('2026-01-01T10:00:20Z')} (server clock)`)
  })
})

describe('absent, anchor, expected and awaiting wording', () => {
  it('states an absent role as a recorded fact', () => {
    const absent: AbsentAct = { kind: 'absent', key: 'k', role: 'seal_photo' }

    expect(absentLabel(absent)).toBe('No seal photo submitted at completion')
  })

  it('words the anchor states', () => {
    const anchor = (status: AnchorAct['status'], consensusAt: string | null): AnchorAct => ({ kind: 'anchor', key: 'k', status, consensusAt })

    expect(anchorLabel(anchor('pending', null))).toBe('Anchoring pending')
    expect(anchorLabel(anchor('failed', null))).toBe('Anchoring failed')
    expect(anchorLabel(anchor('anchored', '2026-01-01T10:00:00Z'))).toBe(`Anchored ${fmtDateTime('2026-01-01T10:00:00Z')} (Hedera consensus)`)
    expect(anchorLabel(anchor('anchored', null))).toBe('Anchored')
  })

  it('words an expectation, never as something missing', () => {
    const expected = (role: ExpectedAct['role'], reason: ExpectedAct['reason']): ExpectedAct => ({ kind: 'expected', key: 'k', role, reason })

    expect(expectedLabel(expected('seal_photo', 'evidence'), 'departure', 'DBN', null)).toBe('Expected: seal photo')
    expect(expectedLabel(expected(null, 'driver_confirmation'), 'confirmation', 'DBN', null)).toBe('Waiting for the driver to confirm delivery')
    expect(expectedLabel(expected(null, 'driver_confirmation'), 'in_transit', 'DBN', null)).toBe('Waiting for the driver to confirm arrival')
    expect(expectedLabel(expected(null, 'warehouse_scan'), 'unloading', 'DBN', null)).toBe('Waiting for the warehouse scan to finish')
    expect(expectedLabel(expected(null, 'en_route'), 'in_transit', 'DBN', '2026-01-01T16:00:00Z')).toBe(`En route to DBN · expected ${fmtTime('2026-01-01T16:00:00Z')}`)
    expect(expectedLabel(expected(null, 'en_route'), 'in_transit', 'DBN', null)).toBe('En route to DBN')
    for (const label of [expectedLabel(expected('seal_photo', 'evidence'), 'departure', 'x', null)]) {
      expect(label).not.toMatch(/missing/i)
    }
  })

  it('says when the checks will appear, with the per-phase verb', () => {
    expect(checksAwaitingLabel('loading')).toBe('Checks appear when the driver confirms loading')
    expect(checksAwaitingLabel('confirmation')).toBe('Checks appear when the driver confirms delivery')
  })
})

describe('clock labels', () => {
  it('are exported once, for every row that names a clock', () => {
    expect(DEVICE_CLOCK).toBe('(device clock)')
    expect(SERVER_CLOCK).toBe('(server clock)')
  })
})
