import { describe, expect, it } from 'vitest'
import { canReplaceWithOcr, sealNumberSource } from '../sealSource'

describe('sealNumberSource', () => {
  it('is ocr_confirmed when the driver kept what OCR read', () => {
    expect(sealNumberSource('AB-1234', 'AB-1234')).toBe('ocr_confirmed')
  })

  it('is ocr_corrected when the driver changed what OCR read', () => {
    expect(sealNumberSource('AB-1284', 'AB-1234')).toBe('ocr_corrected')
  })

  it('is typed when OCR read nothing', () => {
    expect(sealNumberSource(null, 'AB-1234')).toBe('typed')
  })
})

describe('canReplaceWithOcr', () => {
  it.each([
    [null, null, true],
    ['', null, true],
    ['  ', 'AB-1234', true],
    ['AB-1234', 'AB-1234', true],
    ['AB-9999', 'AB-1234', false],
    ['AB-9999', null, false],
  ] as const)('field %j after previous read %j -> %j', (current, previousOcr, expected) => {
    expect(canReplaceWithOcr(current, previousOcr)).toBe(expected)
  })
})
