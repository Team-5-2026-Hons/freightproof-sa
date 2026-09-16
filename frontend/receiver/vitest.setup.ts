// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument, etc.).
//
// Mirrors frontend/dispatcher/vitest.setup.ts, minus its HTMLDialogElement and
// matchMedia stubs: this app has no <dialog> element and no width-query docking
// behaviour, so stubbing those platform APIs here would be dead code pointing at
// nothing. In their place, this file stubs the platform APIs Swipe.tsx's drag
// gesture depends on, none of which jsdom implements: ResizeObserver, the Pointer
// Events capture methods, and a measurable clientWidth. Browser checks cover the
// real gesture; these exist only so the drag math is exercisable under jsdom.
import '@testing-library/jest-dom/vitest'

let mockTrackClientWidthPx = 300

/** Sets the width every element reports via `clientWidth`, since jsdom's layout engine
    never computes real box sizes. Swipe.tsx measures its track this way — set this before
    rendering it to control how far the thumb can travel in a test. */
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
    // The entry's shape is irrelevant: Swipe.tsx reads clientWidth from its own closure
    // over the observed element rather than from the callback's entry parameter, so an
    // empty placeholder is enough to satisfy the callback's signature.
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
