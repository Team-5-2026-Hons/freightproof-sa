import { describe, expect, it } from 'vitest'
import { sastInputToIso } from './sast'

describe('sastInputToIso', () => {
  it('pins a datetime-local value to SAST', () => {
    expect(sastInputToIso('2026-09-12T13:40')).toBe('2026-09-12T13:40:00+02:00')
  })

  it('keeps seconds when the input has them', () => {
    expect(sastInputToIso('2026-09-12T13:40:05')).toBe('2026-09-12T13:40:05+02:00')
  })

  it('returns null for an empty input', () => {
    expect(sastInputToIso('')).toBeNull()
  })

  it('means the same instant as the UTC time two hours earlier', () => {
    expect(new Date(sastInputToIso('2026-09-12T13:40')!).toISOString()).toBe('2026-09-12T11:40:00.000Z')
  })
})
