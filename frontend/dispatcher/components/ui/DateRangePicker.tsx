"use client"

import { cn } from '@shared/lib/utils/cn'

export interface DateRange {
  from: string | null  // ISO date string YYYY-MM-DD
  to: string | null
}

interface Preset {
  label: string
  range: DateRange
}

interface DateRangePickerProps {
  value: DateRange
  onChange: (range: DateRange) => void
  presets?: Preset[]
  className?: string
}

export function DateRangePicker({ value, onChange, presets, className }: DateRangePickerProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map(preset => (
            <button
              key={preset.label}
              onClick={() => onChange(preset.range)}
              className={cn(
                'rounded-md border-2 border-outline px-3 py-1 text-[12px] font-semibold transition-colors duration-150',
                value.from === preset.range.from && value.to === preset.range.to
                  ? 'bg-primary text-primary-on'
                  : 'bg-surface-container-lowest text-surface-on hover:bg-surface-container-low',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[12px] font-medium text-surface-on-variant">From</label>
          <input
            type="date"
            value={value.from ?? ''}
            max={value.to ?? undefined}
            onChange={e => onChange({ ...value, from: e.target.value || null })}
            className="rounded-lg border-0 bg-surface-container-low px-3 py-2 text-[14px] text-surface-on outline-none focus:bg-surface-container-lowest focus:shadow-[inset_0_-2px_0_0] focus:shadow-secondary"
          />
        </div>
        <span className="mt-5 text-[12px] text-surface-on-variant">—</span>
        <div className="flex flex-col gap-1">
          <label className="text-[12px] font-medium text-surface-on-variant">To</label>
          <input
            type="date"
            value={value.to ?? ''}
            min={value.from ?? undefined}
            onChange={e => onChange({ ...value, to: e.target.value || null })}
            className="rounded-lg border-0 bg-surface-container-low px-3 py-2 text-[14px] text-surface-on outline-none focus:bg-surface-container-lowest focus:shadow-[inset_0_-2px_0_0] focus:shadow-secondary"
          />
        </div>
      </div>
    </div>
  )
}
