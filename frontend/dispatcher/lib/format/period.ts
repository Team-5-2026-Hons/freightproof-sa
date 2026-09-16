// South African calendar dates for the fleet Analytics page (fleet analytics spec §3).
//
// Dates are "YYYY-MM-DD" strings throughout: zero-padded, so they also sort chronologically as
// plain strings. Arithmetic runs on Date objects at UTC midnight, used purely as a calendar, so
// no browser time-zone setting can shift a day. "Today" is read from the Africa/Johannesburg
// calendar by named zone, as lib/format/month.ts does.
//
// bucketStarts / bucketCount follow backend app/analytics/fleet/periods.py step for step, so a
// View-by option this page allows is always one the API accepts (at most MAX_TREND_BUCKETS bars).

import { MONTH_ABBREVIATIONS, addMonths } from '@/lib/format/month'
import type { Grain } from '@shared/lib/types/fleet-analytics'

const OPERATIONS_TIME_ZONE = 'Africa/Johannesburg'

/** Mirrors the backend's MAX_TREND_BUCKETS: one year of weeks. */
export const MAX_TREND_BUCKETS = 53
/** Below this many trips a chart still draws, with a "read with care" line (spec §7.6). */
export const LOW_SAMPLE_TRIPS = 5

/** Finest first, so "the next coarser grain" is the next entry. */
export const GRAINS: readonly Grain[] = ['week', 'month', 'year']

const DAYS_PER_WEEK = 7
const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const ISO_DATE_LENGTH = 10
// The trend presets end with the current bucket, so "Last 12 weeks" by week is exactly 12
// bars: this week and the 11 before it.
const PRESET_WEEKS = { last_4_weeks: 4, last_12_weeks: 12, last_26_weeks: 26 } as const
const PRESET_MONTHS = { last_3_months: 3, last_6_months: 6, last_12_months: 12 } as const
const PRESET_YEARS = { last_3_years: 3 } as const
const MONTHS_IN_A_YEAR = 12

const TODAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: OPERATIONS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export type PresetId =
  | 'last_4_weeks' | 'last_12_weeks' | 'last_26_weeks'
  | 'last_3_months' | 'last_6_months' | 'last_12_months'
  | 'this_year' | 'last_3_years' | 'all_time'

/** The Period presets each View by offers (D25): only ranges that make sense in that unit, so
 *  View by Year is never offered "Last 4 weeks", which would draw one part-year bar. */
export const PRESETS_BY_GRAIN: Record<Grain, readonly PresetId[]> = {
  week: ['last_4_weeks', 'last_12_weeks', 'last_26_weeks', 'this_year', 'all_time'],
  month: ['last_3_months', 'last_6_months', 'last_12_months', 'this_year', 'all_time'],
  year: ['this_year', 'last_3_years', 'all_time'],
}

/** For a period with no View by: Routes & sites and the busy patterns. */
export const GENERAL_PRESETS: readonly PresetId[] = ['last_4_weeks', 'last_12_weeks', 'last_12_months', 'this_year', 'all_time']

/** Where switching View by lands when the current preset isn't offered in the new unit. */
const DEFAULT_PRESET_BY_GRAIN: Record<Grain, PresetId> = { week: 'last_12_weeks', month: 'last_12_months', year: 'all_time' }

/** The period to keep after switching View by: unchanged if the new unit offers it (or it is a
 *  custom range), otherwise that unit's default. */
export function periodForGrain(selection: PeriodSelection, grain: Grain): PeriodSelection {
  if (selection.preset === 'custom' || PRESETS_BY_GRAIN[grain].includes(selection.preset)) return selection
  return { preset: DEFAULT_PRESET_BY_GRAIN[grain] }
}

/** What the dispatcher chose in the Period control. */
export type PeriodSelection =
  | { preset: PresetId }
  | { preset: 'custom'; start: string; end: string }

export interface ResolvedPeriod {
  /** null means All time: the API is sent no start and begins at the first trip (spec G11). */
  start: string | null
  end: string
}

/** The SAST calendar date at `now`. */
export function todaySast(now: Date = new Date()): string {
  const parts = TODAY_FORMATTER.formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((entry) => entry.type === type)?.value
  const year = part('year')
  const month = part('month')
  const day = part('day')
  if (!year || !month || !day) throw new Error('Unable to resolve the operations date')
  return `${year}-${month}-${day}`
}

function toDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function fromDate(value: Date): string {
  return value.toISOString().slice(0, ISO_DATE_LENGTH)
}

export function addDays(date: string, days: number): string {
  const value = toDate(date)
  value.setUTCDate(value.getUTCDate() + days)
  return fromDate(value)
}

/** The first day of the bucket containing `date`. Weeks start on Monday. */
export function bucketStart(date: string, grain: Grain): string {
  const [year, month] = date.split('-')
  if (grain === 'month') return `${year}-${month}-01`
  if (grain === 'year') return `${year}-01-01`
  // getUTCDay() is 0 on Sunday; shift so Monday is 0.
  const daysSinceMonday = (toDate(date).getUTCDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK
  return addDays(date, -daysSinceMonday)
}

export function nextBucketStart(start: string, grain: Grain): string {
  if (grain === 'week') return addDays(start, DAYS_PER_WEEK)
  if (grain === 'month') return addMonths(start, 1)
  return `${Number(start.split('-')[0]) + 1}-01-01`
}

/** From the bucket holding `start` to the bucket holding `end`, empty buckets included. */
export function bucketStarts(start: string, end: string, grain: Grain): string[] {
  const starts: string[] = []
  for (let current = bucketStart(start, grain); current <= end; current = nextBucketStart(current, grain)) {
    starts.push(current)
  }
  return starts
}

export function bucketCount(start: string, end: string, grain: Grain): number {
  return bucketStarts(start, end, grain).length
}

export function resolvePeriod(selection: PeriodSelection, today: string): ResolvedPeriod {
  switch (selection.preset) {
    case 'last_4_weeks':
    case 'last_12_weeks':
    case 'last_26_weeks':
      return {
        start: addDays(bucketStart(today, 'week'), -(PRESET_WEEKS[selection.preset] - 1) * DAYS_PER_WEEK),
        end: today,
      }
    case 'last_3_months':
    case 'last_6_months':
    case 'last_12_months':
      return { start: addMonths(bucketStart(today, 'month'), -(PRESET_MONTHS[selection.preset] - 1)), end: today }
    case 'last_3_years':
      return {
        start: addMonths(bucketStart(today, 'year'), -(PRESET_YEARS[selection.preset] - 1) * MONTHS_IN_A_YEAR),
        end: today,
      }
    case 'this_year':
      return { start: bucketStart(today, 'year'), end: today }
    case 'all_time':
      return { start: null, end: today }
    case 'custom':
      return { start: selection.start, end: selection.end }
  }
}

/** The first day a period really covers. For All time that is `allTimeStart` (from the
 *  tiles), never after the end; null while the tiles haven't loaded yet. */
export function effectiveStart(period: ResolvedPeriod, allTimeStart: string | null): string | null {
  if (period.start !== null) return period.start
  if (allTimeStart === null) return null
  return allTimeStart < period.end ? allTimeStart : period.end
}

/** Whether `grain` gives at most MAX_TREND_BUCKETS bars. An unknown start (All time before the
 *  tiles load) allows everything rather than blocking the dispatcher on a guess. */
export function isGrainAllowed(start: string | null, end: string, grain: Grain): boolean {
  return start === null || bucketCount(start, end, grain) <= MAX_TREND_BUCKETS
}

/** `grain` if it fits the period, otherwise the next coarser grain that does. */
export function fitGrain(grain: Grain, start: string | null, end: string): Grain {
  const coarser = GRAINS.slice(GRAINS.indexOf(grain))
  return coarser.find((candidate) => isGrainAllowed(start, end, candidate)) ?? 'year'
}

export interface TabQuery {
  /** null = All time. */
  start: string | null
  end: string
  /** The grain to request and draw: the chosen one, or the next coarser one that fits. */
  grain: Grain
  /** True when the chosen grain had too many bars for the period and `grain` replaced it. */
  grainAdjusted: boolean
  /** Grains with too many bars for this period: shown, but not selectable. */
  disabledGrains: Grain[]
}

/** Everything a tab needs to draw its controls and build its request, from what the
 *  dispatcher chose. Derived on every render rather than stored, so shortening the period
 *  again brings the dispatcher's own choice of grain straight back. */
export function resolveTabQuery(
  period: PeriodSelection, chosenGrain: Grain, today: string, allTimeStart: string | null,
): TabQuery {
  const resolved = resolvePeriod(period, today)
  const start = effectiveStart(resolved, allTimeStart)
  const grain = fitGrain(chosenGrain, start, resolved.end)
  return {
    start: resolved.start,
    end: resolved.end,
    grain,
    grainAdjusted: grain !== chosenGrain,
    disabledGrains: GRAINS.filter((candidate) => !isGrainAllowed(start, resolved.end, candidate)),
  }
}

/** Axis tick for a bucket (spec §7.7): a week is its Monday–Sunday range, "8–14 Sep", or
 *  "29 Jun–5 Jul" / "29 Dec–4 Jan" across a month or year end, never with the year, to keep
 *  ticks short. Months read "Sep 2026" and years "2026". */
export function fmtBucketLabel(start: string, grain: Grain): string {
  const [year, month, day] = start.split('-').map(Number)
  const monthName = MONTH_ABBREVIATIONS[month - 1]
  if (grain === 'month') return `${monthName} ${year}`
  if (grain === 'year') return String(year)
  const [, endMonth, endDay] = addDays(start, DAYS_PER_WEEK - 1).split('-').map(Number)
  return endMonth === month
    ? `${day}–${endDay} ${monthName}`
    : `${day} ${monthName}–${endDay} ${MONTH_ABBREVIATIONS[endMonth - 1]}`
}

/** A bucket's full name, with its year, for tooltip headers and tables, where there is room:
 *  "8–14 Sep 2026", "29 Jun – 5 Jul 2026", "29 Dec 2025 – 4 Jan 2026". Months and years are the
 *  same as their ticks. En dashes throughout; spaced only between two whole dates. */
export function fmtBucketRange(start: string, grain: Grain): string {
  if (grain !== 'week') return fmtBucketLabel(start, grain)
  const end = addDays(start, DAYS_PER_WEEK - 1)
  const [startYear, startMonth, startDay] = start.split('-').map(Number)
  const [endYear, endMonth, endDay] = end.split('-').map(Number)
  if (startYear !== endYear) return `${fmtDay(start)} – ${fmtDay(end)}`
  if (startMonth !== endMonth) {
    return `${startDay} ${MONTH_ABBREVIATIONS[startMonth - 1]} – ${endDay} ${MONTH_ABBREVIATIONS[endMonth - 1]} ${endYear}`
  }
  return `${startDay}–${endDay} ${MONTH_ABBREVIATIONS[endMonth - 1]} ${endYear}`
}

/** How long ago an ISO instant was: "20 min", "5 h", "2 d". */
export function fmtAge(fromIso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / MS_PER_MINUTE))
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `${hours} h`
  return `${Math.floor(hours / HOURS_PER_DAY)} d`
}

const DAYS_IN_YEAR = 365
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** Monday = 0, as the API numbers weekdays. */
export function weekdayName(index: number): string {
  return WEEKDAY_NAMES[index] ?? ''
}

/** How many calendar days an inclusive range covers. */
export function daysInclusive(start: string, end: string): number {
  return Math.round((toDate(end).getTime() - toDate(start).getTime()) / (MS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY)) + 1
}

/** Whether a period is long enough to compare months with each other fairly (chart 1.3). */
export function coversFullYear(start: string, end: string): boolean {
  return daysInclusive(start, end) >= DAYS_IN_YEAR
}

/** Why a partial bucket is faded (spec §3): "so far" while it is still running, otherwise
 *  "part week" / "part month" / "part year" because the period cuts it. */
export function partialLabel(start: string, grain: Grain, today: string): string {
  const stillRunning = start <= today && today < nextBucketStart(start, grain)
  return stillRunning ? 'so far' : `part ${grain}`
}

/** "15 Sep 2026" for a "YYYY-MM-DD" date. */
export function fmtDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${day} ${MONTH_ABBREVIATIONS[month - 1]} ${year}`
}

/** The SAST calendar day of an ISO instant, as "15 Sep 2026". */
export function fmtSastDay(instant: string): string {
  return fmtDay(todaySast(new Date(instant)))
}
