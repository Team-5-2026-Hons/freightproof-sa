'use client'

import { useId } from 'react'

import { Select } from '@/components/ui/Select'
import { GENERAL_PRESETS, resolvePeriod, type PeriodSelection, type PresetId } from '@/lib/format/period'
import { FLEET_COPY } from '../copy'

const COPY = FLEET_COPY.controls

const CUSTOM = 'custom'

interface PeriodControlProps {
  value: PeriodSelection
  onChange: (selection: PeriodSelection) => void
  /** SAST "YYYY-MM-DD". No period may end after it. */
  today: string
  /** Where All time starts (from the tiles); null until they load. */
  allTimeStart: string | null
  /** The presets to offer, in order: the View by's own list, or the general one for a period
   *  with no View by. The custom range always comes last. */
  presets?: readonly PresetId[]
  label?: string
}

/** The Period control. Built new rather than reusing DateRangePicker, which works out "today"
 *  in UTC, fixes its presets when the module loads, and cannot say "All time". A custom range
 *  is never inverted and never runs past today: the date the dispatcher just moved wins. */
export function PeriodControl({
  value, onChange, today, allTimeStart, presets = GENERAL_PRESETS, label = COPY.period,
}: PeriodControlProps) {
  const id = useId()

  function selectPreset(choice: string): void {
    if (choice === CUSTOM) {
      // Seed the custom range with what is on screen now, so choosing Custom alone changes
      // no chart until a date is edited.
      const current = resolvePeriod(value, today)
      onChange({ preset: CUSTOM, start: current.start ?? allTimeStart ?? today, end: current.end })
      return
    }
    const preset = presets.find((offered) => offered === choice)
    if (preset !== undefined) onChange({ preset })
  }

  function setStart(start: string): void {
    if (value.preset !== CUSTOM || start === '') return
    const clamped = start > today ? today : start
    onChange({ preset: CUSTOM, start: clamped, end: clamped > value.end ? clamped : value.end })
  }

  function setEnd(end: string): void {
    if (value.preset !== CUSTOM || end === '') return
    const clamped = end > today ? today : end
    onChange({ preset: CUSTOM, start: clamped < value.start ? clamped : value.start, end: clamped })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select id={`${id}-preset`} label={label} value={value.preset} onChange={(event) => selectPreset(event.target.value)}>
        {presets.map((preset) => (
          <option key={preset} value={preset}>{COPY.presets[preset]}</option>
        ))}
        <option value={CUSTOM}>{COPY.presets.custom}</option>
      </Select>
      {value.preset === CUSTOM && (
        <>
          <DateField id={`${id}-from`} label={COPY.from} value={value.start} max={today} onChange={setStart} />
          <DateField id={`${id}-to`} label={COPY.to} value={value.end} min={value.start} max={today} onChange={setEnd} />
        </>
      )}
    </div>
  )
}

interface DateFieldProps {
  id: string
  label: string
  value: string
  min?: string
  max: string
  onChange: (value: string) => void
}

function DateField({ id, label, value, min, max, onChange }: DateFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-bold uppercase tracking-wider text-on-surf-v">{label}</label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[44px] rounded-xl border border-outline-v/30 bg-surf-low px-4 text-sm font-medium text-on-surf transition-colors duration-150 focus:border-sec focus:bg-surf-lowest focus:outline-none"
      />
    </div>
  )
}
