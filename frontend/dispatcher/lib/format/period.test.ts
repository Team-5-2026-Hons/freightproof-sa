import { describe, expect, it } from 'vitest'

import {
  MAX_TREND_BUCKETS,
  addDays,
  bucketCount,
  bucketStart,
  bucketStarts,
  coversFullYear,
  daysInclusive,
  effectiveStart,
  fitGrain,
  fmtAge,
  fmtBucketLabel,
  fmtBucketRange,
  fmtDay,
  fmtSastDay,
  GENERAL_PRESETS,
  isGrainAllowed,
  partialLabel,
  periodForGrain,
  PRESETS_BY_GRAIN,
  resolvePeriod,
  resolveTabQuery,
  todaySast,
  weekdayName,
} from './period'

// A Wednesday. Fixed so every preset has a known answer.
const TODAY = '2026-09-16'
const MONDAY = '2026-09-07'

describe('todaySast', () => {
  it('reads the South African calendar, which is a day ahead after 22:00 UTC', () => {
    expect(todaySast(new Date('2026-09-14T22:30:00Z'))).toBe('2026-09-15')
    expect(todaySast(new Date('2026-09-14T21:59:00Z'))).toBe('2026-09-14')
  })
})

describe('buckets (same rules as the backend)', () => {
  it('starts weeks on Monday', () => {
    expect(bucketStart('2026-09-13', 'week')).toBe(MONDAY)
    expect(bucketStart(MONDAY, 'week')).toBe(MONDAY)
  })

  it('starts months and years on their first day', () => {
    expect(bucketStart('2026-09-15', 'month')).toBe('2026-09-01')
    expect(bucketStart('2026-09-15', 'year')).toBe('2026-01-01')
  })

  it('runs from the start bucket to the end bucket, empty ones included', () => {
    expect(bucketStarts('2026-09-02', '2026-09-15', 'week')).toEqual(['2026-08-31', MONDAY, '2026-09-14'])
    expect(bucketStarts('2025-11-20', '2026-01-05', 'month')).toEqual(['2025-11-01', '2025-12-01', '2026-01-01'])
  })

  it('counts exactly the maximum number of weeks the backend allows', () => {
    const end = addDays(MONDAY, MAX_TREND_BUCKETS * 7 - 1)

    expect(bucketCount(MONDAY, end, 'week')).toBe(MAX_TREND_BUCKETS)
    expect(bucketCount(MONDAY, addDays(end, 1), 'week')).toBe(MAX_TREND_BUCKETS + 1)
  })
})

describe('resolvePeriod', () => {
  it('ends the week presets with the current week', () => {
    expect(resolvePeriod({ preset: 'last_4_weeks' }, TODAY)).toEqual({ start: '2026-08-24', end: TODAY })
    expect(resolvePeriod({ preset: 'last_12_weeks' }, TODAY)).toEqual({ start: '2026-06-29', end: TODAY })
  })

  it('gives exactly 12 bars for Last 12 weeks by week', () => {
    const { start, end } = resolvePeriod({ preset: 'last_12_weeks' }, TODAY)

    expect(bucketCount(start ?? TODAY, end, 'week')).toBe(12)
  })

  it('ends the month and year presets with the current month', () => {
    expect(resolvePeriod({ preset: 'last_12_months' }, TODAY)).toEqual({ start: '2025-10-01', end: TODAY })
    expect(resolvePeriod({ preset: 'this_year' }, TODAY)).toEqual({ start: '2026-01-01', end: TODAY })
  })

  it('sends no start for All time', () => {
    expect(resolvePeriod({ preset: 'all_time' }, TODAY)).toEqual({ start: null, end: TODAY })
  })

  it('passes a custom range through unchanged', () => {
    expect(resolvePeriod({ preset: 'custom', start: '2026-08-01', end: '2026-08-31' }, TODAY))
      .toEqual({ start: '2026-08-01', end: '2026-08-31' })
  })

  it('resolves the presets added for each View by (D25)', () => {
    expect(resolvePeriod({ preset: 'last_26_weeks' }, TODAY)).toEqual({ start: '2026-03-23', end: TODAY })
    expect(resolvePeriod({ preset: 'last_3_months' }, TODAY)).toEqual({ start: '2026-07-01', end: TODAY })
    expect(resolvePeriod({ preset: 'last_6_months' }, TODAY)).toEqual({ start: '2026-04-01', end: TODAY })
    expect(resolvePeriod({ preset: 'last_3_years' }, TODAY)).toEqual({ start: '2024-01-01', end: TODAY })
  })

  it('gives exactly 26 bars for Last 26 weeks and 3 for Last 3 years', () => {
    const weeks = resolvePeriod({ preset: 'last_26_weeks' }, TODAY)
    const years = resolvePeriod({ preset: 'last_3_years' }, TODAY)

    expect(bucketCount(weeks.start ?? TODAY, weeks.end, 'week')).toBe(26)
    expect(bucketCount(years.start ?? TODAY, years.end, 'year')).toBe(3)
  })
})

describe('presets per View by (D25)', () => {
  it('offers only periods that suit the View by', () => {
    expect(PRESETS_BY_GRAIN.week).toEqual(['last_4_weeks', 'last_12_weeks', 'last_26_weeks', 'this_year', 'all_time'])
    expect(PRESETS_BY_GRAIN.month).toEqual(['last_3_months', 'last_6_months', 'last_12_months', 'this_year', 'all_time'])
    expect(PRESETS_BY_GRAIN.year).toEqual(['this_year', 'last_3_years', 'all_time'])
  })

  it('keeps the general list for a tab with no View by', () => {
    expect(GENERAL_PRESETS).toEqual(['last_4_weeks', 'last_12_weeks', 'last_12_months', 'this_year', 'all_time'])
  })

  it('keeps a period the new View by offers, and a custom range always', () => {
    expect(periodForGrain({ preset: 'this_year' }, 'year')).toEqual({ preset: 'this_year' })
    expect(periodForGrain({ preset: 'last_26_weeks' }, 'week')).toEqual({ preset: 'last_26_weeks' })
    const custom = { preset: 'custom', start: '2026-08-01', end: '2026-08-31' } as const
    expect(periodForGrain(custom, 'year')).toBe(custom)
  })

  it('swaps a period the new View by does not offer for that View by\'s default', () => {
    expect(periodForGrain({ preset: 'last_4_weeks' }, 'year')).toEqual({ preset: 'all_time' })
    expect(periodForGrain({ preset: 'last_4_weeks' }, 'month')).toEqual({ preset: 'last_12_months' })
    expect(periodForGrain({ preset: 'last_6_months' }, 'week')).toEqual({ preset: 'last_12_weeks' })
  })
})

describe('grain limits', () => {
  it('uses the first trip day for All time, never after the end', () => {
    expect(effectiveStart({ start: null, end: TODAY }, '2026-06-20')).toBe('2026-06-20')
    expect(effectiveStart({ start: null, end: '2026-06-01' }, '2026-06-20')).toBe('2026-06-01')
    expect(effectiveStart({ start: null, end: TODAY }, null)).toBeNull()
  })

  it('allows every grain while the All time start is unknown', () => {
    expect(isGrainAllowed(null, TODAY, 'week')).toBe(true)
  })

  it('moves to the next coarser grain when there are too many bars', () => {
    const twoYearsAgo = '2024-09-16'

    expect(fitGrain('week', twoYearsAgo, TODAY)).toBe('month')
    expect(fitGrain('month', twoYearsAgo, TODAY)).toBe('month')
    expect(fitGrain('week', '2026-07-01', TODAY)).toBe('week')
  })

  it('reports the adjusted grain and the disabled ones for a tab', () => {
    const query = resolveTabQuery({ preset: 'all_time' }, 'week', TODAY, '2024-09-16')

    expect(query).toEqual({
      start: null, end: TODAY, grain: 'month', grainAdjusted: true, disabledGrains: ['week'],
    })
  })

  it('keeps the chosen grain when it fits', () => {
    const query = resolveTabQuery({ preset: 'last_12_weeks' }, 'week', TODAY, null)

    expect(query.grain).toBe('week')
    expect(query.grainAdjusted).toBe(false)
    expect(query.disabledGrains).toEqual([])
  })
})

describe('labels', () => {
  it('labels buckets by grain', () => {
    expect(fmtBucketLabel(MONDAY, 'week')).toBe('7–13 Sep')
    expect(fmtBucketLabel('2026-09-01', 'month')).toBe('Sep 2026')
    expect(fmtBucketLabel('2026-01-01', 'year')).toBe('2026')
  })

  it('shows an age in minutes, hours, then days', () => {
    const now = new Date('2026-09-16T12:00:00Z')

    expect(fmtAge('2026-09-16T11:40:00Z', now)).toBe('20 min')
    expect(fmtAge('2026-09-16T07:00:00Z', now)).toBe('5 h')
    expect(fmtAge('2026-09-14T10:00:00Z', now)).toBe('2 d')
  })
})

describe('partial buckets and days', () => {
  it('says "so far" for the bucket still running and "part …" for one the period cuts', () => {
    expect(partialLabel('2026-09-14', 'week', TODAY)).toBe('so far')
    expect(partialLabel('2026-08-24', 'week', TODAY)).toBe('part week')
    expect(partialLabel('2026-09-01', 'month', TODAY)).toBe('so far')
    expect(partialLabel('2026-06-01', 'month', TODAY)).toBe('part month')
  })

  it('counts the days of an inclusive range and whether it spans a year', () => {
    expect(daysInclusive('2026-09-01', '2026-09-30')).toBe(30)
    expect(coversFullYear('2025-09-17', TODAY)).toBe(true)
    expect(coversFullYear('2025-09-18', TODAY)).toBe(false)
  })

  it('formats days in South African time', () => {
    expect(fmtDay('2026-09-05')).toBe('5 Sep 2026')
    expect(fmtSastDay('2026-09-14T22:30:00Z')).toBe('15 Sep 2026')
    expect(weekdayName(0)).toBe('Monday')
  })
})

describe('week labels (spec §7.7)', () => {
  it('shows a week inside one month as a day range', () => {
    expect(fmtBucketLabel('2026-09-07', 'week')).toBe('7–13 Sep')
  })

  it('names both months when a week crosses a month end', () => {
    expect(fmtBucketLabel('2026-06-29', 'week')).toBe('29 Jun–5 Jul')
  })

  it('never shows the year on the tick, even across a year end', () => {
    expect(fmtBucketLabel('2025-12-29', 'week')).toBe('29 Dec–4 Jan')
  })

  it('gives tooltips and tables the full range with the year', () => {
    expect(fmtBucketRange('2026-09-07', 'week')).toBe('7–13 Sep 2026')
    expect(fmtBucketRange('2026-06-29', 'week')).toBe('29 Jun – 5 Jul 2026')
    expect(fmtBucketRange('2025-12-29', 'week')).toBe('29 Dec 2025 – 4 Jan 2026')
  })

  it('leaves month and year names as they were', () => {
    expect(fmtBucketRange('2026-09-01', 'month')).toBe('Sep 2026')
    expect(fmtBucketRange('2026-01-01', 'year')).toBe('2026')
  })
})
