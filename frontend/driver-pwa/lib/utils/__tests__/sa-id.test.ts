// frontend/driver-pwa/lib/utils/__tests__/sa-id.test.ts
//
// The property under test is mostly a NEGATIVE one: this module must never become a
// validator that can reject. A receiver presenting a passport number, or a driver
// fat-fingering a digit at a loading bay, produces evidence of what actually happened at
// the door, and refusing to store it destroys that record.
import { describe, it, expect } from 'vitest'
import { looksLikeSaIdNumber, hasRecipientIdentity } from '@shared/lib/utils/sa-id'

const VALID_SA_ID = '9202204720082'

describe('looksLikeSaIdNumber', () => {
  it('accepts a 13 digit number', () => {
    expect(looksLikeSaIdNumber(VALID_SA_ID)).toBe(true)
  })

  it('ignores surrounding whitespace from a phone keyboard', () => {
    expect(looksLikeSaIdNumber(`  ${VALID_SA_ID} `)).toBe(true)
  })

  it.each([
    ['too short', '920220472008'],
    ['too long', '92022047200821'],
    ['a passport number', 'A01234567'],
    ['digits with a separator', '920220-4720-082'],
    ['empty', ''],
  ])('reports %s as not SA-ID-shaped', (_case, value) => {
    expect(looksLikeSaIdNumber(value)).toBe(false)
  })

  it('does no checksum validation — a shape-valid but invalid ID still passes', () => {
    expect(looksLikeSaIdNumber('0000000000000')).toBe(true)
  })
})

describe('hasRecipientIdentity', () => {
  it('is satisfied by any two non-empty values, however malformed', () => {
    expect(hasRecipientIdentity('Nomsa Dlamini', 'A01234567')).toBe(true)
  })

  it.each([
    ['both null', null, null],
    ['no name', null, VALID_SA_ID],
    ['no ID', 'Nomsa Dlamini', null],
    ['whitespace name', '   ', VALID_SA_ID],
    ['whitespace ID', 'Nomsa Dlamini', '   '],
  ])('is not satisfied with %s', (_case, name, idNumber) => {
    expect(hasRecipientIdentity(name, idNumber)).toBe(false)
  })
})
