import { describe, expect, it } from 'vitest'
import {
  NO_DATA,
  fmtHours,
  fmtMinutes,
  fmtOptionalCount,
  fmtRate,
  fmtRatio,
  fmtScheduleDelta,
} from './analytics'

describe('fmtRate', () => {
  it('shows the rate with the counts it came from', () => {
    expect(fmtRate(2 / 3, 2, 3)).toBe('67% (2/3)')
  })

  it('shows a real zero as 0%, still with its counts', () => {
    expect(fmtRate(0, 0, 3)).toBe('0% (0/3)')
  })

  it('shows no data as a dash, never 0%', () => {
    expect(fmtRate(null, 0, 0)).toBe(NO_DATA)
  })

  it('treats a zero denominator as no data even if a rate is present', () => {
    expect(fmtRate(0, 0, 0)).toBe(NO_DATA)
  })
})

describe('fmtRatio', () => {
  it('keeps decimals because a per-trip ratio can exceed 1', () => {
    expect(fmtRatio(1.5, 3, 2)).toBe('1.50 (3/2)')
  })

  it('shows no trips as a dash', () => {
    expect(fmtRatio(null, 0, 0)).toBe(NO_DATA)
  })
})

describe('fmtMinutes', () => {
  it('formats under an hour in minutes', () => {
    expect(fmtMinutes(45)).toBe('45 m')
  })

  it('formats hours and minutes', () => {
    expect(fmtMinutes(135)).toBe('2 h 15 m')
  })

  it('drops a zero minutes remainder on a whole hour', () => {
    expect(fmtMinutes(120)).toBe('2 h')
  })

  it('rounds to the nearest minute', () => {
    expect(fmtMinutes(29.6)).toBe('30 m')
  })

  it('shows no observations as a dash', () => {
    expect(fmtMinutes(null)).toBe(NO_DATA)
  })
})

describe('fmtHours', () => {
  it('formats fractional hours as hours and minutes', () => {
    expect(fmtHours(5.5)).toBe('5 h 30 m')
  })
})

describe('fmtScheduleDelta', () => {
  it('names the direction, positive being late', () => {
    expect(fmtScheduleDelta(20)).toBe('20 m late')
    expect(fmtScheduleDelta(-40)).toBe('40 m early')
  })

  it('reads a sub-minute delta as on time', () => {
    expect(fmtScheduleDelta(0.4)).toBe('On time')
    expect(fmtScheduleDelta(-0.3)).toBe('On time')
  })

  it('shows no planned trips as a dash', () => {
    expect(fmtScheduleDelta(null)).toBe(NO_DATA)
  })
})

describe('fmtOptionalCount', () => {
  it('shows an absent count as a dash', () => {
    expect(fmtOptionalCount(null)).toBe(NO_DATA)
  })

  it('shows a real zero as 0', () => {
    // Back-to-back incident trips give a genuine zero-length streak.
    expect(fmtOptionalCount(0)).toBe('0')
  })
})
