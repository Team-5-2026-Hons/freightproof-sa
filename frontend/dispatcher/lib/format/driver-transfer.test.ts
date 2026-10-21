import { describe, expect, it } from 'vitest'
import type { RequestFormat, SealCheck, SubstitutionCompletionMode } from '@shared/lib/types/driver-substitution'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'
import type { AnchorStatus } from '@shared/lib/types/phase'
import { ANCHOR_STATUS_LABELS, COMPLETION_MODE_LABELS, fmtAnchorStatus, fmtCompletionMode, fmtProximity, fmtSealCheck, fmtTransferOutcome } from './driver-transfer'

describe('driver transfer wording', () => {
  it.each<[SubstitutionCompletionMode, string]>([
    ['normal', 'Driver accepted'],
    ['dispatcher_attested', 'Completed by dispatcher'],
  ])('labels_completion_mode_%s', (mode, label) => {
    expect(fmtCompletionMode(mode, 'immediate_v2')).toBe(label)
    expect(COMPLETION_MODE_LABELS[mode]).toBe(label)
  })

  it.each<[RequestFormat | null | undefined]>([['planned_v1'], [null], [undefined]])('says_both_drivers_confirmed_for_a_normal_completion_of_a_legacy_request (%s)', format => {
    expect(fmtCompletionMode('normal', format)).toBe('Both drivers confirmed')
  })

  it('keeps_the_dispatcher_label_whatever_the_request_format', () => {
    expect(fmtCompletionMode('dispatcher_attested', 'planned_v1')).toBe('Completed by dispatcher')
    expect(fmtCompletionMode('dispatcher_attested', 'immediate_v2')).toBe('Completed by dispatcher')
  })

  it.each<[AnchorStatus, string]>([
    ['anchored', 'Sealed on Hedera'],
    ['pending', 'Sealing pending'],
    ['failed', 'Sealing failed'],
    ['not_required', 'Not sealed'],
  ])('labels_anchor_status_%s', (status, label) => {
    expect(fmtAnchorStatus(status)).toBe(label)
    expect(ANCHOR_STATUS_LABELS[status]).toBe(label)
  })

  it('prints_not_recorded_for_null_values', () => {
    expect(fmtCompletionMode(null)).toBe('Not recorded')
    expect(fmtAnchorStatus(null)).toBe('Not recorded')
    expect(fmtTransferOutcome(null, null)).toBe('Not recorded · Not recorded')
  })

  it('joins_mode_and_anchor_with_a_middle_dot', () => {
    expect(fmtTransferOutcome('dispatcher_attested', 'anchored')).toBe('Completed by dispatcher · Sealed on Hedera')
    expect(fmtTransferOutcome('normal', 'anchored', 'planned_v1')).toBe('Both drivers confirmed · Sealed on Hedera')
    expect(fmtTransferOutcome('normal', 'anchored', 'immediate_v2')).toBe('Driver accepted · Sealed on Hedera')
  })
})

describe('transfer evidence wording', () => {
  const check = (over: Partial<SealCheck>): SealCheck => ({
    vehicle_id: 'v', condition: 'intact', seal_number: 'FP-1233', photo_artifact_ids: [], not_applicable_reason: null, ...over,
  })

  it('writes_an_intact_seal_with_its_number', () => {
    expect(fmtSealCheck(check({}))).toBe('Intact · FP-1233')
  })

  it('writes_a_missing_seal_without_a_number', () => {
    expect(fmtSealCheck(check({ condition: 'missing', seal_number: null }))).toBe('Missing')
  })

  it('writes_an_empty_leg_with_the_reason_given', () => {
    expect(fmtSealCheck(check({ condition: 'not_applicable', seal_number: null, not_applicable_reason: 'Empty leg' })))
      .toBe('No seal (empty leg) · Empty leg')
  })

  const assessment = (over: Partial<ActionLocationAssessment>): ActionLocationAssessment => ({ proximity: 'within_limit', reasons: [], separation_metres: null, ...over } as ActionLocationAssessment)

  it('says_not_assessed_when_the_capture_stored_no_assessment', () => {
    expect(fmtProximity(null)).toBe('Not assessed')
    expect(fmtProximity(undefined)).toBe('Not assessed')
  })

  it('says_within_limit_plainly', () => {
    expect(fmtProximity(assessment({}))).toBe('Within limit')
  })

  it('says_how_far_apart_when_the_phone_and_truck_were_separated', () => {
    expect(fmtProximity(assessment({ proximity: 'separated', separation_metres: 412.4 }))).toBe('Outside limit · 412 m apart')
  })

  it('spells_out_every_reason_when_it_could_not_compare', () => {
    expect(fmtProximity(assessment({ proximity: 'unverified', reasons: ['missing_phone', 'stale_fix'] })))
      .toBe('Unable to compare: the driver’s phone location was not available; a location reading was too old')
  })

  it('never_prints_a_raw_reason_code', () => {
    expect(fmtProximity(assessment({ proximity: 'unverified', reasons: ['time_skew', 'future_fix', 'poor_accuracy'] }))).not.toMatch(/_/)
  })
})
