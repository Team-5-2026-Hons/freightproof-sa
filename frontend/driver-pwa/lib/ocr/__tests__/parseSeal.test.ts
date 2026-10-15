import { describe, expect, it } from 'vitest'
import { parseSealCandidates } from '../parseSeal'

describe('parseSealCandidates', () => {
  it.each([
    ['AB-1234', ['AB-1234']],
    ['seal no: ab 1234', ['AB-1234']],
    ['AB1234', ['AB-1234']],
  ])('reads %j as %j', (text, expected) => {
    expect(parseSealCandidates(text)).toEqual(expected)
  })

  it('maps look-alike digits on the letter side and look-alike letters on the number side', () => {
    expect(parseSealCandidates('8O-1O34')).toEqual(['BO-1034'])
    expect(parseSealCandidates('0S 5B1L')).toEqual(['OS-5811'])
  })

  it('accepts an en or em dash as the separator', () => {
    expect(parseSealCandidates('AB\u20131234')).toEqual(['AB-1234'])
    expect(parseSealCandidates('AB\u20141234')).toEqual(['AB-1234'])
  })

  // A letter half with no real letter in it is a run of digits (a date, a lot number),
  // and mapping every digit to a look-alike letter would turn it into a fake seal.
  it.each(['151025', 'LOT 001234', '05 5B1L'])('does not read the all-digit %j as a seal', (text) => {
    expect(parseSealCandidates(text)).toEqual([])
  })

  it('does not read the front of a longer dashed code as a seal', () => {
    expect(parseSealCandidates('AB-1234-5678')).toEqual([])
  })

  it('still reads the seal when a date sits beside it', () => {
    expect(parseSealCandidates('AB-1234\n151025')).toEqual(['AB-1234'])
  })

  it('returns every distinct number it can see, so the caller can refuse to guess', () => {
    expect(parseSealCandidates('AB-1234\nCD-5678')).toEqual(['AB-1234', 'CD-5678'])
  })

  it('counts the same number read twice once', () => {
    expect(parseSealCandidates('AB-1234 AB 1234')).toEqual(['AB-1234'])
  })

  it.each(['FREIGHTPROOF', 'AB-12345', '', 'A-1234'])('finds nothing in %j', (text) => {
    expect(parseSealCandidates(text)).toEqual([])
  })
})
