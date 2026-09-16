import type { ReactNode } from 'react'

import { cn } from '@shared/lib/utils/cn'

export interface LegendItem {
  label: string
  color: string
  /** The key mirrors the mark: a small square for bars, a short stroke for lines. */
  mark: 'bar' | 'line'
  /** For status colours (warning, critical, confirmed, mismatch), which must never be told apart
   *  by colour alone. A small (12 px) icon. */
  icon?: ReactNode
}

interface ChartLegendProps {
  items: readonly LegendItem[]
  /** A short line after the keys, e.g. what the faded bars mean. */
  note?: string
}

/** HTML legend above a chart. Always present for two or more series, so identity never rests
 *  on colour alone. None for a single series: the title already names it. Text stays in
 *  text colours; only the key wears the series colour. */
export function ChartLegend({ items, note }: ChartLegendProps) {
  if (items.length === 0 && note === undefined) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-on-surf-v">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn(item.mark === 'bar' ? 'h-2.5 w-2.5 rounded-sm' : 'h-[2px] w-3.5 rounded-full')}
            style={{ backgroundColor: item.color }}
          />
          {item.icon !== undefined && <span aria-hidden="true" className="flex items-center">{item.icon}</span>}
          {item.label}
        </span>
      ))}
      {note !== undefined && <span>{note}</span>}
    </div>
  )
}
