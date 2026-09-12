'use client'

import { useId } from 'react'
import { cn } from '@shared/lib/utils/cn'
import { Select } from './Select'
import { operationsMonth, parseMonth, toMonth } from '@/lib/format/month'
import type { MonthRange } from '@/lib/types/month-range'

export type { MonthRange }

interface MonthRangePickerProps {
  value: MonthRange
  onChange: (range: MonthRange) => void
  /** Latest selectable month, "YYYY-MM-01". Defaults to the current SAST month — a later
   *  month cannot hold closed trips yet. Injectable so tests do not depend on today. */
  latestMonth?: string
  className?: string
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

// Matches the history page's lower bound: it predates the platform, so no real trip is
// ever out of reach.
const EARLIEST_YEAR = 2020

type Bound = 'start' | 'end'

/** Month-only range control for the analytics screen: free start and end months, no
 *  presets. Month and year selects rather than <input type="month">, whose desktop
 *  browser support is patchy.
 *
 *  Two guarantees the API relies on: every emitted bound is a first-of-month date, and
 *  the range is never inverted — the bound the dispatcher just moved wins and the other
 *  follows it. */
export function MonthRangePicker({ value, onChange, latestMonth, className }: MonthRangePickerProps) {
  const latest = latestMonth ?? operationsMonth()
  const latestYear = parseMonth(latest).year
  const years = Array.from(
    { length: latestYear - EARLIEST_YEAR + 1 },
    (_, index) => latestYear - index,
  )

  function select(bound: Bound, month: string): void {
    // Plain string comparison is chronological for "YYYY-MM-01" (see lib/format/month).
    const chosen = month > latest ? latest : month
    onChange(
      bound === 'start'
        ? { start: chosen, end: chosen > value.end ? chosen : value.end }
        : { start: chosen < value.start ? chosen : value.start, end: chosen },
    )
  }

  return (
    <div className={cn('flex flex-wrap items-end gap-4', className)}>
      <BoundSelects
        label="From" month={value.start} latest={latest} years={years}
        onSelect={(month) => select('start', month)}
      />
      <BoundSelects
        label="To" month={value.end} latest={latest} years={years}
        onSelect={(month) => select('end', month)}
      />
    </div>
  )
}

interface BoundSelectsProps {
  label: string
  month: string
  latest: string
  years: number[]
  onSelect: (month: string) => void
}

function BoundSelects({ label, month, latest, years, onSelect }: BoundSelectsProps) {
  const id = useId()
  const current = parseMonth(month)
  const newest = parseMonth(latest)

  return (
    <div className="flex gap-2">
      <Select
        id={`${id}-month`}
        label={`${label} month`}
        value={current.month}
        onChange={(event) => onSelect(toMonth(current.year, Number(event.target.value)))}
      >
        {MONTH_LABELS.map((name, index) => {
          const monthNumber = index + 1
          return (
            <option
              key={name}
              value={monthNumber}
              disabled={current.year === newest.year && monthNumber > newest.month}
            >
              {name}
            </option>
          )
        })}
      </Select>
      <Select
        id={`${id}-year`}
        label={`${label} year`}
        value={current.year}
        onChange={(event) => onSelect(toMonth(Number(event.target.value), current.month))}
      >
        {years.map((year) => (
          <option key={year} value={year}>{year}</option>
        ))}
      </Select>
    </div>
  )
}
