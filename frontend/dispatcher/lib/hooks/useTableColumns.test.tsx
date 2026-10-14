import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { computeColumnLayout, useTableColumns, KEYBOARD_RESIZE_STEP, type ColumnSpec } from './useTableColumns'

const COLUMNS: ColumnSpec[] = [
  { id: 'a', width: 200 },
  { id: 'b', width: 100, minWidth: 90 },
  { id: 'c', width: 100, hideBelow: 800 },
]

describe('computeColumnLayout', () => {
  it('keeps base widths and the total as table width when the container is narrower', () => {
    const layout = computeColumnLayout(COLUMNS, {}, 300)
    expect(layout.widths).toEqual({ a: 200, b: 100 })
    expect(layout.tableWidth).toBe(300)
    expect(layout.scale).toBe(1)
  })

  it('stretches every visible column proportionally to fill a wider container', () => {
    const layout = computeColumnLayout(COLUMNS, {}, 1000)
    expect(layout.widths.a + layout.widths.b + layout.widths.c).toBeCloseTo(1000)
    expect(layout.widths.a / layout.widths.b).toBeCloseTo(2)
    expect(layout.tableWidth).toBe(1000)
  })

  it('hides a column below its threshold and lets the others fill the space', () => {
    const layout = computeColumnLayout(COLUMNS, {}, 600)
    expect(layout.hidden.has('c')).toBe(true)
    expect(Object.keys(layout.widths)).toEqual(['a', 'b'])
    expect(layout.widths.a + layout.widths.b).toBeCloseTo(600)
  })

  it('shows every column before the container has been measured', () => {
    const layout = computeColumnLayout(COLUMNS, {}, 0)
    expect(layout.hidden.size).toBe(0)
  })

  it('never lets a dragged width fall below the column minimum', () => {
    const layout = computeColumnLayout(COLUMNS, { b: 10 }, 100)
    expect(layout.widths.b).toBe(90)
  })
})

// jsdom has no PointerEvent; the hook only reads clientX, which a MouseEvent of the same
// type supplies.
describe('useTableColumns', () => {
  const KEY = 'table-widths:v1:test'
  let containerWidth = 0

  beforeEach(() => {
    localStorage.clear()
    containerWidth = 400
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => containerWidth)
  })
  afterEach(() => { vi.restoreAllMocks() })

  function setup() {
    const hook = renderHook(() => useTableColumns('test', COLUMNS))
    act(() => { hook.result.current.containerRef(document.createElement('div')) })
    return hook
  }

  it('resizes one column by keyboard, respecting its minimum, and remembers it', () => {
    const { result } = setup()
    act(() => { result.current.resizeBy('b', -1000) })
    expect(result.current.widths.b).toBeGreaterThanOrEqual(90)
    act(() => { result.current.resizeBy('a', KEYBOARD_RESIZE_STEP) })
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toHaveProperty('a')
  })

  it('restores remembered widths after mount', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 500 }))
    containerWidth = 100
    const { result } = setup()
    expect(result.current.widths.a).toBe(500)
  })

  it('ignores corrupt storage and unknown columns', () => {
    localStorage.setItem(KEY, '{not json')
    expect(setup().result.current.widths.a).toBeGreaterThan(0)
    localStorage.setItem(KEY, JSON.stringify({ zzz: 400, a: 'wide', b: -5 }))
    const { result } = setup()
    expect(result.current.widths.a).toBeGreaterThan(0)
    expect(result.current.widths.zzz).toBeUndefined()
  })

  it('does not overwrite remembered widths with empty ones while mounting', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 500 }))
    setup()
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ a: 500 })
  })

  it('resets a single column to its base width', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 500 }))
    containerWidth = 100
    const { result } = setup()
    act(() => { result.current.resetColumn('a') })
    expect(result.current.widths.a).toBe(200)
  })

  it('drags a column with the pointer', () => {
    containerWidth = 100
    const { result } = setup()
    act(() => { result.current.startResize('a', 0) })
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50 })) })
    expect(result.current.widths.a).toBe(250)
    act(() => { window.dispatchEvent(new MouseEvent('pointerup')) })
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 })) })
    expect(result.current.widths.a).toBe(250)
  })

  it('ends a drag when the browser cancels the pointer, so later moves change nothing', () => {
    containerWidth = 100
    const { result } = setup()
    act(() => { result.current.startResize('a', 0) })
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50 })) })
    expect(result.current.widths.a).toBe(250)

    act(() => { window.dispatchEvent(new MouseEvent('pointercancel')) })
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 })) })

    expect(result.current.widths.a).toBe(250)
  })

  it('removes its window listeners when unmounted mid-drag, without throwing or warning', () => {
    containerWidth = 100
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const { result, unmount } = setup()
    act(() => { result.current.startResize('a', 0) })

    unmount()

    const removed = removeListener.mock.calls.map(([type]) => type)
    expect(removed).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']))
    expect(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }))).not.toThrow()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('replaces a drag in progress when a new one starts, so only the latest follows the pointer', () => {
    containerWidth = 100
    const { result } = setup()
    act(() => { result.current.startResize('a', 0) })
    act(() => { result.current.startResize('b', 0) })

    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50 })) })

    expect(result.current.widths.a).toBe(200)
    expect(result.current.widths.b).toBe(150)
  })

  describe('while the columns fill the container', () => {
    // a 200 + b 100 at container 600 (c is hidden below 800): scale 2, so a 400 and b 200.
    beforeEach(() => { containerWidth = 600 })

    it('moves width between a column and its right neighbour so the edge follows the pointer', () => {
      const { result } = setup()
      act(() => { result.current.startResize('a', 0) })
      act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 15 })) })
      expect(result.current.widths.a).toBeCloseTo(415)
      expect(result.current.widths.b).toBeCloseTo(185)
      expect(result.current.tableWidth).toBe(600)
    })

    it('stops the neighbour at its minimum instead of overflowing', () => {
      const { result } = setup()
      act(() => { result.current.startResize('a', 0) })
      act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5000 })) })
      // b may not go below its 90 px minimum, shown at scale 2.
      expect(result.current.widths.b).toBeCloseTo(180)
      expect(result.current.widths.a).toBeCloseTo(420)
    })

    it('resizes the last column on its own', () => {
      const { result } = setup()
      act(() => { result.current.resizeBy('b', -10) })
      // Only b gets a stored width (rendered 190 at scale 2 = base 95); a is untouched.
      expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ b: 95 })
    })
  })
})
