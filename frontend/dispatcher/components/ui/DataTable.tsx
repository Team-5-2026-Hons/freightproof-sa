"use client"

import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

export interface Column<T> {
  key: keyof T & string
  label: string
  sortable?: boolean
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[]
  rows: T[]
  sort?: { key: string; dir: 'asc' | 'desc' }
  onSort?: (key: string) => void
  empty?: React.ReactNode
  className?: string
}

export function DataTable<T extends Record<string, unknown>>({
  columns, rows, sort, onSort, empty, className,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) {
    return <div className={className}>{empty}</div>
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-outline">
            {columns.map(col => {
              const isSorted = sort?.key === col.key
              const dir = isSorted ? sort.dir : undefined
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={isSorted ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'px-4 py-3 text-left text-[12px] font-medium uppercase tracking-[0.08em] text-surface-on-variant',
                    col.sortable && 'cursor-pointer select-none hover:text-surface-on',
                  )}
                  onClick={col.sortable ? () => onSort?.(col.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && (
                      <span aria-hidden="true" className="inline-flex flex-col opacity-50">
                        <ChevronUp size={10} strokeWidth={2} className={cn(isSorted && dir === 'asc' && 'opacity-100')} />
                        <ChevronDown size={10} strokeWidth={2} className={cn(isSorted && dir === 'desc' && 'opacity-100')} />
                      </span>
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={cn(
                'border-b border-outline/20 transition-colors duration-150 hover:bg-surface-container-high',
                i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low',
              )}
            >
              {columns.map(col => (
                <td key={col.key} className="px-4 py-3 text-[14px] leading-5 text-surface-on">
                  {col.render
                    ? col.render(row[col.key], row)
                    : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
