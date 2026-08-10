'use client'

import { useState } from 'react'
import { Calendar } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import { Ic } from './Ic'
import type { DateRange } from '@/lib/types/date-range'

export type { DateRange }

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
    <div className={cn('relative shrink-0', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 py-2 pl-3 pr-3 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
      >
        <Calendar className="w-[14px] h-[14px] text-outline-v shrink-0" />
        <span>{value.from} → {value.to}</span>
        <Ic n="chev" s={12} className={cn('shrink-0 text-on-surf-v transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-[10] bg-surf-lowest rounded-lg shadow-level-5 p-4 min-w-[280px]">
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => { onChange(preset.range); setOpen(false) }}
                  className="px-3 py-1 rounded-full text-[11px] font-[700] bg-surf-low text-on-surf-v hover:bg-sec-c hover:text-sec transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-[700] uppercase tracking-wider text-on-surf-v">From</label>
              <input
                type="date"
                value={value.from}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
                className="w-full rounded-md px-3 py-2 text-[13px] bg-surf-low border border-outline-v/30 text-on-surf outline-none focus:border-sec"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-[700] uppercase tracking-wider text-on-surf-v">To</label>
              <input
                type="date"
                value={value.to}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
                className="w-full rounded-md px-3 py-2 text-[13px] bg-surf-low border border-outline-v/30 text-on-surf outline-none focus:border-sec"
              />
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-full py-2 rounded-md bg-primary text-primary-on text-[13px] font-[700] uppercase tracking-wider"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
