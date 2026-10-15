import { describe, it, expect } from 'vitest'
import { formatPhoneForDisplay, groupNationalNumber } from '@/lib/utils/format-phone'

describe('groupNationalNumber', () => {
  it('test_groups_two_three_four_and_drops_the_trunk_zero', () => {
    expect(groupNationalNumber('0810463076')).toBe('81 046 3076')
  })

  it('test_short_input_groups_without_trailing_spaces', () => {
    expect(groupNationalNumber('812')).toBe('81 2')
  })
})

describe('formatPhoneForDisplay', () => {
  it('test_south_african_e164_reads_as_spoken', () => {
    expect(formatPhoneForDisplay('+27825550001')).toBe('+27 82 555 0001')
  })

  it('test_unknown_dial_code_is_returned_unchanged', () => {
    expect(formatPhoneForDisplay('+999123456')).toBe('+999123456')
  })

  it('test_non_numeric_input_is_returned_unchanged', () => {
    expect(formatPhoneForDisplay('not a number')).toBe('not a number')
  })

  it('test_empty_string_is_returned_unchanged', () => {
    expect(formatPhoneForDisplay('')).toBe('')
  })
})
