import { ChevronUp, ChevronDown, PackageOpen } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import { EmptyState } from './EmptyState'

export interface Column<T> {
  key: keyof T
  label: string
  sortable?: boolean
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[]
  rows: T[]
  sort?: { key: keyof T; dir: 'asc' | 'desc' }
  onSort?: (key: keyof T) => void
  empty?: { title: string; body: string }
  className?: string
}

export function DataTable<T extends Record<string, unknown>>({
  columns, rows, sort, onSort, empty, className,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<PackageOpen />}
        title={empty?.title ?? 'No results'}
        body={empty?.body ?? 'Nothing to show here yet.'}
      />
    )
  }

  return (
    <div className={cn('w-full overflow-x-auto rounded-xl shadow-ambient-sm', className)}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-surface-container-low">
            {columns.map((col) => (
              <th
                key={String(col.key)}
                scope="col"
                aria-sort={
                  sort?.key === col.key
                    ? sort.dir === 'asc' ? 'ascending' : 'descending'
                    : 'none'
                }
                onClick={() => col.sortable && onSort?.(col.key)}
                className={cn(
                  'px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-surface-on-variant',
                  'border-b border-outline-variant/20',
                  col.sortable && 'cursor-pointer select-none hover:text-surface-on',
                )}
              >
                <span className="flex items-center gap-1.5">
                  {col.label}
                  {col.sortable && sort?.key === col.key && (
                    sort.dir === 'asc'
                      ? <ChevronUp className="w-3 h-3" />
                      : <ChevronDown className="w-3 h-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={cn(
                'transition-colors duration-150 hover:bg-surface-container-low',
                i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/50',
              )}
            >
              {columns.map((col) => (
                <td
                  key={String(col.key)}
                  className="px-4 py-3 text-surface-on border-b border-outline-variant/10"
                >
                  {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
