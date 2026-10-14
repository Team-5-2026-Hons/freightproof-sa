// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument, etc.), and stubs
// the platform APIs Swipe.tsx's drag gesture depends on that jsdom doesn't implement:
// ResizeObserver, Pointer Events capture methods, and a measurable clientWidth.
import '@testing-library/jest-dom/vitest'

let mockTrackClientWidthPx = 300

/** Sets the width every element reports via `clientWidth` — jsdom never computes real box sizes. */
export function setMockTrackClientWidthPx(px: number): void {
  mockTrackClientWidthPx = px
}

Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get(): number {
    return mockTrackClientWidthPx
  },
})

class MockResizeObserver {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(): void {
    // Entry shape is irrelevant: Swipe.tsx reads clientWidth from its own closure, not the entry.
    this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver)
  }

  unobserve(): void {}
  disconnect(): void {}
}

if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
}

if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
}

if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
  HTMLElement.prototype.setPointerCapture = function setPointerCapture(): void {}
  HTMLElement.prototype.releasePointerCapture = function releasePointerCapture(): void {}
  HTMLElement.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false
  }
}
