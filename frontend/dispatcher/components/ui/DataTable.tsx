import { ChevronUp, ChevronDown, PackageOpen, AlertCircle } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import { EmptyState } from './EmptyState'
import { Spinner } from './Spinner'
import { Button } from './Button'

export interface Column<T extends object> {
  key: keyof T
  label: string
  sortable?: boolean
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

interface DataTableProps<T extends object> {
  columns: Column<T>[]
  rows: T[]
  sort?: { key: keyof T; dir: 'asc' | 'desc' }
  onSort?: (key: keyof T) => void
  onRowClick?: (row: T) => void
  empty?: { title: string; body: string }
  className?: string
  isLoading?: boolean
  error?: string | null
  onRetry?: () => void
}

export function DataTable<T extends object>({
  columns, rows, sort, onSort, onRowClick, empty, className, isLoading, error, onRetry,
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={<AlertCircle />}
        title="Failed to load"
        body={error}
        cta={
          onRetry && (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Try again
            </Button>
          )
        }
      />
    )
  }

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
              onClick={() => onRowClick?.(row)}
              className={cn(
                'transition-colors duration-150 hover:bg-surface-container-low',
                i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/50',
                onRowClick && 'cursor-pointer',
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
