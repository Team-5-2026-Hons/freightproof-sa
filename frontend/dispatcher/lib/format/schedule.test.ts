import { describe, expect, it } from 'vitest'
import { delayMinutes, fmtDelay } from './schedule'

const PLANNED = '2026-08-12T19:32:00Z'

describe('delayMinutes', () => {
  it('is positive when the actual is after the plan', () => {
    expect(delayMinutes(PLANNED, '2026-08-12T21:47:00Z')).toBe(135)
  })

  it('is negative when the actual is before the plan', () => {
    // The real fixture: a trip that ran eight days before it was scheduled to.
    expect(delayMinutes(PLANNED, '2026-08-04T19:32:00Z')).toBe(-8 * 24 * 60)
  })

  it('is 0 for an exactly on-time leg', () => {
    expect(delayMinutes(PLANNED, PLANNED)).toBe(0)
  })

  it('is null when either end is missing rather than assuming now', () => {
    expect(delayMinutes(PLANNED, null)).toBeNull()
    expect(delayMinutes(null, PLANNED)).toBeNull()
    expect(delayMinutes(null, null)).toBeNull()
  })
})

describe('fmtDelay', () => {
  it('names the direction', () => {
    expect(fmtDelay(135)).toBe('2 h 15 m late')
    expect(fmtDelay(-40)).toBe('40 m early')
  })

  it('drops a zero minutes remainder on a whole hour', () => {
    expect(fmtDelay(120)).toBe('2 h late')
  })

  it('omits the hour component under an hour', () => {
    expect(fmtDelay(-5)).toBe('5 m early')
  })

  it('says On time rather than "0 m late"', () => {
    expect(fmtDelay(0)).toBe('On time')
  })
})
