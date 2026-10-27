// A takeover must take its seal expectation from the trip's LEDGER position, never assume
// the previous driver had already activated, loaded and sealed. One case per position the
// user story named: before activation, during loading, in transit, at unloading.
import { describe, expect, test } from 'vitest'
import type { DriverSubstitutionContextRead } from '@shared/lib/types/driver-substitution'
import type { PhaseType } from '@shared/lib/types/phase'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import {
  NO_SEAL_YET_REASON,
  captureProblems,
  confirmationBody,
  newCapture,
  sealExpectation,
} from '../useSubstitutionCapture'

function contextAt(phase: PhaseType | null): DriverSubstitutionContextRead {
  return { ...pack.contextWithFindings, current_phase: phase }
}

describe('sealExpectation follows the ledger', () => {
  test.each<[PhaseType, ReturnType<typeof sealExpectation>]>([
    ['trip_creation', 'none-yet'],
    ['activation', 'none-yet'],
    ['loading', 'none-yet'],
    ['departure', 'possible'],
    ['in_transit', 'expected'],
    ['arrival', 'expected'],
    ['unloading', 'expected'],
    ['confirmation', 'expected'],
  ])('%s → %s', (phase, expected) => {
    expect(sealExpectation(contextAt(phase))).toBe(expected)
  })

  test('no position in the context assumes nothing', () => {
    expect(sealExpectation(contextAt(null))).toBe('unknown')
  })
})

describe('newCapture pre-fills seal checks from the ledger', () => {
  test('takeover before activation: every seal check is "no seal yet" with its reason', () => {
    const context = contextAt('activation')

    const capture = newCapture(context.incoming.id, context, 'incoming')

    expect(capture.sealChecks).toHaveLength(1)
    expect(capture.sealChecks[0]).toMatchObject({ condition: 'not_applicable', notApplicableReason: NO_SEAL_YET_REASON, photos: [] })
    expect(captureProblems(capture, context.vehicles)).toEqual([
      `Confirm every vehicle: ${context.vehicles.map((vehicle) => vehicle.registration).join(', ')}`,
    ])
  })

  test('takeover during loading: still no seal, and the wire body carries the reason', () => {
    const context = contextAt('loading')

    const capture = {
      ...newCapture(context.incoming.id, context, 'incoming'),
      confirmedVehicleIds: context.vehicles.map((vehicle) => vehicle.id),
      capturedAt: new Date().toISOString(),
    }

    expect(captureProblems(capture, context.vehicles)).toEqual([])
    expect(confirmationBody(capture).seal_checks).toEqual([
      expect.objectContaining({ condition: 'not_applicable', seal_number: null, not_applicable_reason: NO_SEAL_YET_REASON }),
    ])
  })

  test('takeover in transit: the seal must be read, nothing is pre-filled', () => {
    const context = contextAt('in_transit')

    const capture = newCapture(context.incoming.id, context, 'incoming')

    expect(capture.sealChecks[0]).toMatchObject({ condition: null, notApplicableReason: '' })
    expect(captureProblems(capture, context.vehicles)).toContain('Record the seal on FIX 002 GP')
  })

  test('takeover at unloading: the seal must be read, nothing is pre-filled', () => {
    const context = contextAt('unloading')

    const capture = newCapture(context.incoming.id, context, 'incoming')

    expect(capture.sealChecks[0]).toMatchObject({ condition: null, notApplicableReason: '' })
    expect(captureProblems(capture, context.vehicles)).toContain('Record the seal on FIX 002 GP')
  })

  test('departure still open: not pre-filled, the driver decides', () => {
    const context = contextAt('departure')

    const capture = newCapture(context.incoming.id, context, 'incoming')

    expect(capture.sealChecks[0].condition).toBeNull()
  })

  test('the pre-filled answer stays editable: a seal found anyway can be recorded', () => {
    const context = contextAt('loading')
    const capture = newCapture(context.incoming.id, context, 'incoming')

    const edited = { ...capture, sealChecks: capture.sealChecks.map((check) => ({ ...check, condition: 'intact' as const, sealNumber: 'AB-1234' })) }

    expect(captureProblems(edited, context.vehicles)).toContain('Photograph the seal on FIX 002 GP')
  })
})
