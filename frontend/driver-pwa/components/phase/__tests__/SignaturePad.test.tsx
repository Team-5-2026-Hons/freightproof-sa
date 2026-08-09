// Task F2 (audit-fix plan 2026-07-19): a rotation / keyboard / split-view resize
// used to erase the receiver's signature (assigning canvas.width wipes the bitmap,
// and the old run-once sizing effect never re-ran). Strokes are now stored as
// normalized data and replayed by a ResizeObserver — these tests lock in that the
// store survives a resize, coordinates remap to the new box, and the store never
// disagrees with the "signed" UI state.
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { SignaturePad } from '../SignaturePad'

const MOCK_PNG_DATA_URL = 'data:image/png;base64,c2lnbmF0dXJl'
const MOCK_DPR = 2

// jsdom has no ResizeObserver — this mock fires the callback synchronously on
// observe() (mirroring the real API's initial observation, which the component
// relies on for its first backing-store sizing) and records instances so tests
// can fire resize notifications on demand.
const roInstances: MockResizeObserver[] = []

class MockResizeObserver {
  readonly callback: ResizeObserverCallback
  observe = vi.fn(() => {
    this.callback([], this as unknown as ResizeObserver)
  })
  unobserve = vi.fn()
  disconnect = vi.fn()
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    roInstances.push(this)
  }
}

function fireResize(): void {
  act(() => {
    for (const ro of roInstances) ro.callback([], ro as unknown as ResizeObserver)
  })
}

// jsdom ships no 2D canvas either (node-canvas isn't installed). A recorded stub
// context doubles as the assertion surface: the redraw path's beginPath/moveTo/
// lineTo calls ARE the evidence that the stroke store survived and was remapped.
function makeStubCtx() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    lineWidth: 0,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    strokeStyle: '' as string | CanvasGradient | CanvasPattern,
  }
}
let stubCtx = makeStubCtx()

function clearCtxCalls(): void {
  stubCtx.setTransform.mockClear()
  stubCtx.clearRect.mockClear()
  stubCtx.beginPath.mockClear()
  stubCtx.moveTo.mockClear()
  stubCtx.lineTo.mockClear()
  stubCtx.stroke.mockClear()
}

// The layout box the canvas reports. Tests mutate it and then fire the observer —
// exactly the sequence a real rotation produces (layout change, then RO callback).
const box = { width: 300, height: 160 }

function renderPad(onCapture: (dataUrl: string) => void): HTMLCanvasElement {
  const { container } = render(
    <SignaturePad label="Receiver signature" dataUrl={null} onCapture={onCapture} />,
  )
  const canvas = container.querySelector('canvas')
  expect(canvas).not.toBeNull()
  return canvas as HTMLCanvasElement
}

function drawStroke(canvas: HTMLCanvasElement, points: Array<{ x: number; y: number }>): void {
  const [first, ...rest] = points
  fireEvent.pointerDown(canvas, { clientX: first.x, clientY: first.y })
  for (const p of rest) fireEvent.pointerMove(canvas, { clientX: p.x, clientY: p.y })
  fireEvent.pointerUp(canvas)
}

beforeEach(() => {
  roInstances.length = 0
  box.width = 300
  box.height = 160
  stubCtx = makeStubCtx()
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  vi.stubGlobal('devicePixelRatio', MOCK_DPR)
  // jsdom has no PointerEvent constructor, so fireEvent.pointerDown would fall
  // back to a bare Event and silently DROP clientX/clientY (every captured point
  // becomes NaN). MouseEvent honors coordinate init and is what browsers derive
  // PointerEvent from, so alias it for the pointer handlers under test.
  vi.stubGlobal('PointerEvent', window.MouseEvent)
  // getContext is overloaded (2d/webgl/…), which trips spyOn's inferred typing —
  // narrow the mock to the single shape these tests exercise.
  const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as
    MockInstance<(contextId: string) => CanvasRenderingContext2D | null>
  getContextSpy.mockImplementation(() => stubCtx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(MOCK_PNG_DATA_URL)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: box.width,
        bottom: box.height,
        width: box.width,
        height: box.height,
        toJSON: () => ({}),
      }) as DOMRect,
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SignaturePad — resize with stroke preservation', () => {
  it('re-sizes the backing store and replays both strokes remapped to the new box', () => {
    const onCapture = vi.fn()
    const canvas = renderPad(onCapture)

    // Initial observation sized the store at rect × dpr and set the DPR transform.
    expect(canvas.width).toBe(300 * MOCK_DPR)
    expect(canvas.height).toBe(160 * MOCK_DPR)
    expect(stubCtx.setTransform).toHaveBeenCalledWith(MOCK_DPR, 0, 0, MOCK_DPR, 0, 0)

    // Stroke 1: (30,16) → (150,80), normalized (0.1,0.1) → (0.5,0.5).
    drawStroke(canvas, [{ x: 30, y: 16 }, { x: 150, y: 80 }])
    // Stroke 2: (60,32) → (240,128), normalized (0.2,0.2) → (0.8,0.8).
    drawStroke(canvas, [{ x: 60, y: 32 }, { x: 240, y: 128 }])
    expect(onCapture).toHaveBeenCalledTimes(2)
    expect(onCapture).toHaveBeenLastCalledWith(MOCK_PNG_DATA_URL)

    // Rotate: the CSS box halves, then the observer fires.
    box.width = 150
    box.height = 80
    clearCtxCalls()
    fireResize()

    // Backing store re-sized at the new rect × dpr; old bitmap cleared in the
    // NEW box's CSS units (the DPR transform makes that cover it exactly).
    expect(canvas.width).toBe(150 * MOCK_DPR)
    expect(canvas.height).toBe(80 * MOCK_DPR)
    expect(stubCtx.clearRect).toHaveBeenCalledWith(0, 0, 150, 80)

    // The store retained BOTH strokes, replayed at the new geometry.
    expect(stubCtx.beginPath).toHaveBeenCalledTimes(2)
    expect(stubCtx.moveTo).toHaveBeenNthCalledWith(1, 15, 8) // (0.1,0.1) × 150×80
    expect(stubCtx.lineTo).toHaveBeenNthCalledWith(1, 75, 40) // (0.5,0.5) × 150×80
    expect(stubCtx.moveTo).toHaveBeenNthCalledWith(2, 30, 16) // (0.2,0.2) × 150×80
    expect(stubCtx.lineTo).toHaveBeenNthCalledWith(2, 120, 64) // (0.8,0.8) × 150×80
    expect(stubCtx.stroke).toHaveBeenCalledTimes(2)

    // The exported-PNG path is untouched and still yields a non-empty payload.
    expect(canvas.toDataURL('image/png')).not.toBe('')
    expect(canvas.toDataURL('image/png')).toBe(MOCK_PNG_DATA_URL)

    // A NEW stroke after the resize lands under the pointer in the new box.
    clearCtxCalls()
    drawStroke(canvas, [{ x: 75, y: 40 }, { x: 150, y: 80 }])
    expect(stubCtx.moveTo).toHaveBeenCalledWith(75, 40)
    expect(stubCtx.lineTo).toHaveBeenCalledWith(150, 80)
    expect(onCapture).toHaveBeenLastCalledWith(MOCK_PNG_DATA_URL)
  })

  it('keeps an in-flight stroke intact across a resize and composes its continuation', () => {
    const onCapture = vi.fn()
    const canvas = renderPad(onCapture)

    // Pen is DOWN and mid-stroke when the resize fires.
    fireEvent.pointerDown(canvas, { clientX: 30, clientY: 16 }) // (0.1, 0.1)
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 80 }) // (0.5, 0.5)

    box.width = 150
    box.height = 80
    clearCtxCalls()
    fireResize()

    // The partial stroke (2 points so far) was replayed at the new size.
    expect(stubCtx.beginPath).toHaveBeenCalledTimes(1)
    expect(stubCtx.moveTo).toHaveBeenCalledWith(15, 8)
    expect(stubCtx.lineTo).toHaveBeenCalledWith(75, 40)

    // The continuation starts from the SAME normalized last point (denormalized
    // in the new box) and ends under the new pointer position — no jump.
    clearCtxCalls()
    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 64 }) // (0.8, 0.8)
    expect(stubCtx.moveTo).toHaveBeenCalledWith(75, 40)
    expect(stubCtx.lineTo).toHaveBeenCalledWith(120, 64)

    fireEvent.pointerUp(canvas)
    expect(onCapture).toHaveBeenCalledWith(MOCK_PNG_DATA_URL)

    // Still ONE stroke (3 points) in the store — the resize must not split it.
    clearCtxCalls()
    fireResize()
    expect(stubCtx.beginPath).toHaveBeenCalledTimes(1)
    expect(stubCtx.lineTo).toHaveBeenCalledTimes(2)
  })

  it('Clear empties the stroke store, so a later resize repaints nothing', () => {
    const onCapture = vi.fn()
    const canvas = renderPad(onCapture)

    drawStroke(canvas, [{ x: 30, y: 16 }, { x: 150, y: 80 }])
    expect(screen.queryByText('Have the receiver sign above.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Clear'))
    expect(onCapture).toHaveBeenLastCalledWith('')
    expect(screen.getByText('Have the receiver sign above.')).toBeInTheDocument()

    // If Clear only wiped pixels but left the store, this resize would resurrect
    // the "cleared" signature — the exact bug class F2 guards against.
    clearCtxCalls()
    fireResize()
    expect(stubCtx.clearRect).toHaveBeenCalled()
    expect(stubCtx.beginPath).not.toHaveBeenCalled()
  })

  it('a tap with no movement neither signs nor leaves a stroke in the store', () => {
    const onCapture = vi.fn()
    const canvas = renderPad(onCapture)

    fireEvent.pointerDown(canvas, { clientX: 30, clientY: 16 })
    fireEvent.pointerUp(canvas)

    expect(onCapture).not.toHaveBeenCalled()
    expect(screen.getByText('Have the receiver sign above.')).toBeInTheDocument()

    // The degenerate single-point stroke was dropped, not replayed.
    clearCtxCalls()
    fireResize()
    expect(stubCtx.beginPath).not.toHaveBeenCalled()
  })

  it('ignores a 0×0 layout (display:none) and restores strokes when visible again', () => {
    const onCapture = vi.fn()
    const canvas = renderPad(onCapture)

    drawStroke(canvas, [{ x: 30, y: 16 }, { x: 150, y: 80 }])

    box.width = 0
    box.height = 0
    clearCtxCalls()
    fireResize()

    // Backing store untouched (no divide-by-zero, no 0×0 bitmap wipe).
    expect(canvas.width).toBe(300 * MOCK_DPR)
    expect(stubCtx.clearRect).not.toHaveBeenCalled()

    box.width = 300
    box.height = 160
    fireResize()
    expect(stubCtx.beginPath).toHaveBeenCalledTimes(1) // the stroke came back
  })

  it('disconnects its ResizeObserver on unmount', () => {
    const { unmount } = render(
      <SignaturePad label="Receiver signature" dataUrl={null} onCapture={vi.fn()} />,
    )

    expect(roInstances).toHaveLength(1)
    unmount()

    expect(roInstances[0].disconnect).toHaveBeenCalledTimes(1)
  })
})
