'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface ColumnSpec {
  id: string
  width: number
  minWidth?: number
  hideBelow?: number
}

export const DEFAULT_MIN_COLUMN_WIDTH = 80
export const KEYBOARD_RESIZE_STEP = 16
const STORAGE_PREFIX = 'table-widths:v1:'

interface ResizeSnapshot {
  widths: Record<string, number>
  scale: number
  order: string[]
}

export interface ColumnLayout {
  visible: ColumnSpec[]
  widths: Record<string, number>
  tableWidth: number
  scale: number
  hidden: ReadonlySet<string>
}

const minOf = (column: ColumnSpec): number => column.minWidth ?? DEFAULT_MIN_COLUMN_WIDTH

/** Base width for a column: the user's dragged width if any, never below its minimum. */
export function baseWidth(column: ColumnSpec, overrides: Readonly<Record<string, number>>): number {
  return Math.max(minOf(column), overrides[column.id] ?? column.width)
}

/** Pure layout maths, kept apart from the hook so it can be tested without a browser
 *  layout engine. A container of 0 means "not measured yet": every column shows at base
 *  width rather than flashing hidden then visible. */
export function computeColumnLayout(
  columns: readonly ColumnSpec[],
  overrides: Readonly<Record<string, number>>,
  containerWidth: number,
): ColumnLayout {
  const visible = columns.filter(column => !column.hideBelow || containerWidth === 0 || containerWidth >= column.hideBelow)
  const hidden = new Set(columns.filter(column => !visible.includes(column)).map(column => column.id))
  const total = visible.reduce((sum, column) => sum + baseWidth(column, overrides), 0)
  const scale = containerWidth > total && total > 0 ? containerWidth / total : 1
  const widths = Object.fromEntries(visible.map(column => [column.id, baseWidth(column, overrides) * scale]))
  return { visible: [...visible], widths, tableWidth: Math.max(total, containerWidth), scale, hidden }
}

function readStored(key: string, columns: readonly ColumnSpec[]): Record<string, number> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const known = new Set(columns.map(column => column.id))
    return Object.fromEntries(
      Object.entries(value).filter(([id, width]) => known.has(id) && typeof width === 'number' && Number.isFinite(width) && width > 0),
    )
  } catch {
    return {}
  }
}

/** Forgets every table's dragged column widths, returning how many tables had any saved.
 *  Only the width keys are touched; other preferences stored beside them are left alone. A
 *  table already on screen keeps its widths until it remounts, which is fine for the one
 *  caller (Settings), where none is mounted. */
export function clearSavedColumnLayouts(): number {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key)
    }
    keys.forEach(key => localStorage.removeItem(key))
    return keys.length
  } catch (error) {
    console.warn('useTableColumns: could not clear saved column widths', error)
    return 0
  }
}

export interface TableColumnsApi extends ColumnLayout {
  /** Callback ref for the scrolling container whose width the columns fill. */
  containerRef: (el: HTMLDivElement | null) => void
  startResize: (id: string, clientX: number) => void
  /** Move one column by `deltaPx` rendered pixels (keyboard resize). */
  resizeBy: (id: string, deltaPx: number) => void
  resetColumn: (id: string) => void
}

/**
 * Width state for a resizable table: fill-the-screen scaling, drag/keyboard resize, optional
 * narrow-screen column hiding, and widths remembered per `tableId`.
 */
export function useTableColumns(tableId: string, columns: readonly ColumnSpec[]): TableColumnsApi {
  const storageKey = `${STORAGE_PREFIX}${tableId}`
  const [containerWidth, setContainerWidth] = useState(0)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [hydrated, setHydrated] = useState(false)
  const columnsRef = useRef(columns)
  const observerCleanup = useRef<(() => void) | null>(null)

  useEffect(() => { columnsRef.current = columns }, [columns])

  useEffect(() => {
    setOverrides(readStored(storageKey, columnsRef.current))
    setHydrated(true)
  }, [storageKey])

  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(storageKey, JSON.stringify(overrides)) } catch { }
  }, [hydrated, overrides, storageKey])

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    observerCleanup.current?.()
    observerCleanup.current = null
    if (!el) return
    const measure = (): void => setContainerWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observerCleanup.current = () => observer.disconnect()
  }, [])

  const layout = useMemo(() => computeColumnLayout(columns, overrides, containerWidth), [columns, overrides, containerWidth])

  const snapshotOf = useCallback((): ResizeSnapshot => ({ widths: layout.widths, scale: layout.scale, order: layout.visible.map(c => c.id) }), [layout])

  const applyResize = useCallback((id: string, delta: number, start: ResizeSnapshot): void => {
    const column = columnsRef.current.find(c => c.id === id)
    if (!column) return
    const width = start.widths[id]
    const nextId = start.order[start.order.indexOf(id) + 1]
    const next = columnsRef.current.find(c => c.id === nextId)
    if (start.scale > 1 && next) {
      const pair = width + start.widths[next.id]
      const resized = Math.max(minOf(column) * start.scale, Math.min(width + delta, pair - minOf(next) * start.scale))
      setOverrides(current => ({ ...current, [id]: resized / start.scale, [next.id]: (pair - resized) / start.scale }))
      return
    }
    setOverrides(current => ({ ...current, [id]: Math.max(minOf(column), (width + delta) / start.scale) }))
  }, [])

  const stopResize = useRef<(() => void) | null>(null)

  const startResize = useCallback((id: string, clientX: number): void => {
    stopResize.current?.()
    const start = snapshotOf()
    const onMove = (event: PointerEvent): void => applyResize(id, event.clientX - clientX, start)
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      stopResize.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    stopResize.current = stop
  }, [applyResize, snapshotOf])

  useEffect(() => () => stopResize.current?.(), [])

  const resizeBy = useCallback((id: string, deltaPx: number): void => {
    applyResize(id, deltaPx, snapshotOf())
  }, [applyResize, snapshotOf])

  const resetColumn = useCallback((id: string): void => {
    setOverrides(current => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  return { ...layout, containerRef, startResize, resizeBy, resetColumn }
}
