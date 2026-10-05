'use client'

import { Fragment, useCallback, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import { SkeletonBar } from './Skeleton'
import { KEYBOARD_RESIZE_STEP, useTableColumns, type ColumnSpec } from '@/lib/hooks/useTableColumns'

export interface TableRenderContext {
  /** Ids of columns hidden at this width, so a cell can absorb what a hidden one carried. */
  hidden: ReadonlySet<string>
}

export interface TableColumn<T> extends ColumnSpec {
  label: string
  /** Header becomes a button that calls `onSort`. The owner sorts; this table never reorders. */
  sortable?: boolean
  render: (row: T, context: TableRenderContext) => ReactNode
  /** What this column's cell looks like while loading. Omit for a generic bar. */
  skeleton?: ReactNode
}

export interface TableGroup<T> {
  id: string
  /** Receives the id of the body it controls, for `aria-controls`. */
  header: (bodyId: string) => ReactNode
  rows: T[]
  collapsed?: boolean
}

export interface TableSort { id: string; dir: 'asc' | 'desc' }

/** `comfortable`: roomy rows for multi-line content (the default). `compact`: the tighter,
 *  centred rows of a scannable list where each row is a record rather than a paragraph. */
export type TableDensity = 'comfortable' | 'compact'

interface TableProps<T> {
  /** Names the stored column widths; unique per table instance. */
  tableId: string
  /** Screen-reader name for the table (visually hidden). */
  caption: string
  columns: readonly TableColumn<T>[]
  /** A flat list… */
  rows?: readonly T[]
  /** …or sections, each with its own header row. */
  groups?: readonly TableGroup<T>[]
  getRowKey: (row: T) => string
  /** Replaces the row's default background and hover (e.g. to flash a changed row); undefined keeps them. */
  rowClassName?: (row: T) => string | undefined
  sort?: TableSort
  onSort?: (columnId: string) => void
  /** Initial load: show the real header over placeholder rows instead of data. Pass it only while
   *  there is nothing to show; a background refetch must keep the rows on screen. */
  isLoading?: boolean
  /** Announced to screen readers while loading, e.g. "Loading exceptions". */
  loadingLabel?: string
  /** How many placeholder rows to show while loading. */
  skeletonRows?: number
  /** Receives the scrolling element, for owners that restore scroll position. A callback,
   *  not a RefObject, because a component must not write to a ref it was handed. */
  onScroller?: (el: HTMLDivElement | null) => void
  density?: TableDensity
  className?: string
}

// Enough rows to fill a laptop screen, so the table doesn't visibly grow when data arrives.
const DEFAULT_SKELETON_ROWS = 6
const HEADER_CELL = 'sticky top-0 z-[1] bg-surf-low text-left text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v border-b border-outline-v/10'
const BODY_CELL = 'break-words border-b border-outline-v/10'
// A line between neighbouring columns, header and body alike. Padding is symmetric, so it sits
// centred between the text either side. On the cell, not the row: a <tr> takes no border in a
// border-separate table, and a group's full-width header cell must not get one.
const COLUMN_DIVIDER = '[&:not(:first-child)]:border-l [&:not(:first-child)]:border-l-outline/30'
const DENSITY_CLASSES: Record<TableDensity, { header: string; body: string }> = {
  // Compact also trims the side padding: with dividers every cell pays it twice, and a
  // dense list should spend that width on content.
  comfortable: { header: 'px-4 py-[10px]', body: 'px-4 py-4 align-top' },
  compact: { header: 'px-3 py-[7px]', body: 'px-3 py-3 align-middle' },
}

/** One table for every list page: fills the screen, columns drag (or arrow-key) to resize and
 *  remember their width, headers sort when the owner allows it. Real table semantics, so
 *  screen readers get row and column navigation without extra ARIA. */
export function Table<T>({
  tableId, caption, columns, rows, groups, getRowKey, rowClassName, sort, onSort, isLoading = false, loadingLabel = 'Loading', skeletonRows = DEFAULT_SKELETON_ROWS, onScroller, density = 'comfortable', className,
}: TableProps<T>) {
  const layout = useTableColumns(tableId, columns)
  const { visible, widths, hidden } = layout
  const context: TableRenderContext = { hidden }
  const byId = new Map(columns.map(column => [column.id, column]))
  const visibleColumns = visible.map(spec => byId.get(spec.id)).filter((column): column is TableColumn<T> => !!column)

  // The page needs the scroller (restoration) and the hook needs it too (width); one ref feeds both.
  const { containerRef } = layout
  const setContainer = useCallback((el: HTMLDivElement | null): void => {
    containerRef(el)
    onScroller?.(el)
  }, [containerRef, onScroller])

  const bodyCell = cn(BODY_CELL, DENSITY_CLASSES[density].body, COLUMN_DIVIDER)

  function onHandleKeyDown(event: KeyboardEvent<HTMLDivElement>, id: string): void {
    const delta = event.key === 'ArrowLeft' ? -KEYBOARD_RESIZE_STEP : event.key === 'ArrowRight' ? KEYBOARD_RESIZE_STEP : 0
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    layout.resizeBy(id, delta)
  }

  function onHandlePointerDown(event: PointerEvent<HTMLDivElement>, id: string): void {
    event.preventDefault()
    layout.startResize(id, event.clientX)
  }

  function renderRow(row: T): ReactNode {
    return (
      <tr key={getRowKey(row)} className={cn('relative text-[13px] focus-within:bg-surf-low', rowClassName?.(row) ?? 'bg-surf-lowest hover:bg-surf-low')}>
        {visibleColumns.map(column => <td key={column.id} className={bodyCell}>{column.render(row, context)}</td>)}
      </tr>
    )
  }

  function renderBodies(): ReactNode {
    if (isLoading) {
      // Decorative, so hidden from assistive tech: the status line above says what is happening.
      return (
        <tbody aria-hidden>
          {Array.from({ length: skeletonRows }, (_, index) => (
            <tr key={index} className="bg-surf-lowest">
              {visibleColumns.map(column => <td key={column.id} className={bodyCell}>{column.skeleton ?? <SkeletonBar className="h-3 w-3/4" />}</td>)}
            </tr>
          ))}
        </tbody>
      )
    }
    if (!groups) return <tbody>{(rows ?? []).map(renderRow)}</tbody>
    return groups.map(group => {
      const bodyId = `${tableId}-group-${group.id}`
      return (
        <Fragment key={group.id}>
          <tbody>
            <tr className="bg-surf-low/60">
              <td colSpan={visibleColumns.length} className="border-b border-outline-v/10 p-0">{group.header(bodyId)}</td>
            </tr>
          </tbody>
          <tbody id={bodyId} hidden={group.collapsed}>{group.rows.map(renderRow)}</tbody>
        </Fragment>
      )
    })
  }

  return (
    <div ref={setContainer} className={cn('w-full overflow-auto', className)}>
      {/* Always mounted: a live region added at the same moment as its text is often not announced. */}
      <p role="status" className="sr-only">{isLoading ? loadingLabel : ''}</p>
      {/* border-separate, not collapse: sticky header cells keep their own bottom border only this way. */}
      <table aria-busy={isLoading} className="border-separate border-spacing-0 text-left" style={{ tableLayout: 'fixed', width: layout.tableWidth }}>
        <caption className="sr-only">{caption}</caption>
        <colgroup>{visibleColumns.map(column => <col key={column.id} style={{ width: widths[column.id] }} />)}</colgroup>
        <thead>
          <tr>
            {visibleColumns.map(column => {
              const sorted = sort?.id === column.id ? sort.dir : null
              const sortable = !!column.sortable && !!onSort
              const labelId = `${tableId}-heading-${column.id}`
              return (
                <th
                  key={column.id}
                  scope="col"
                  // Named by its label only: the resize handle inside the cell has its own name,
                  // which would otherwise be read as part of every column heading.
                  aria-labelledby={labelId}
                  aria-sort={sortable ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined}
                  className={cn(HEADER_CELL, DENSITY_CLASSES[density].header, COLUMN_DIVIDER, 'relative')}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort?.(column.id)}
                      className="group inline-flex items-center gap-1 uppercase tracking-[0.1em] hover:text-on-surf focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec"
                    >
                      <span id={labelId}>{column.label}</span>
                      {sorted === 'asc' && <ArrowUp className="h-3 w-3" aria-hidden />}
                      {sorted === 'desc' && <ArrowDown className="h-3 w-3" aria-hidden />}
                      {sorted === null && <ArrowDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-40" aria-hidden />}
                    </button>
                  ) : <span id={labelId}>{column.label}</span>}
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${column.label} column`}
                    aria-valuenow={Math.round(widths[column.id])}
                    tabIndex={0}
                    title="Drag to resize, double-click to reset"
                    onPointerDown={event => onHandlePointerDown(event, column.id)}
                    onKeyDown={event => onHandleKeyDown(event, column.id)}
                    onDoubleClick={() => layout.resetColumn(column.id)}
                    className="group/handle absolute right-0 top-0 flex h-full w-4 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
                  >
                    <div className="h-3 w-[2px] rounded-full bg-outline-v/50 opacity-0 transition-opacity hover:opacity-100 group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100" />
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        {renderBodies()}
      </table>
    </div>
  )
}
