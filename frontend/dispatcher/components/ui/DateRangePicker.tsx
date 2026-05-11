'use client'

import { useState } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

export interface DateRange {
  from: string  // YYYY-MM-DD
  to: string
}

interface Preset { label: string; range: DateRange }

interface DateRangePickerProps {
  value: DateRange
  onChange: (range: DateRange) => void
  presets?: Preset[]
  className?: string
}

const today = new Date().toISOString().split('T')[0]

const DEFAULT_PRESETS: Preset[] = [
  { label: 'Today',        range: { from: today, to: today } },
  { label: 'Last 7 days',  range: { from: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],  to: today } },
  { label: 'Last 30 days', range: { from: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0], to: today } },
]

export function DateRangePicker({ value, onChange, presets = DEFAULT_PRESETS, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-surface-container-lowest border border-outline-variant/30 text-surface-on hover:bg-surface-container-low transition-colors shadow-ambient-sm"
      >
        <Calendar className="w-4 h-4 text-surface-on-variant" />
        <span>{value.from} → {value.to}</span>
        <ChevronDown className={cn('w-4 h-4 text-surface-on-variant transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 z-[10] bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/20 p-4 min-w-[280px]">
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => { onChange(preset.range); setOpen(false) }}
                  className="px-3 py-1 rounded-full text-xs font-bold bg-surface-container-low text-surface-on-variant hover:bg-secondary/10 hover:text-secondary transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">From</label>
              <input
                type="date"
                value={value.from}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/30 text-surface-on focus:outline-none focus:border-secondary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">To</label>
              <input
                type="date"
                value={value.to}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/30 text-surface-on focus:outline-none focus:border-secondary"
              />
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-full py-2 rounded-xl bg-primary text-primary-on text-sm font-bold uppercase tracking-wider"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
