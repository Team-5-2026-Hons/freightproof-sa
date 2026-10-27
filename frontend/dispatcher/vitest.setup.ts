// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument, etc.)
import '@testing-library/jest-dom/vitest'

HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

window.matchMedia = window.matchMedia || function (query: string): MediaQueryList {
  return {
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || (ResizeObserverStub as unknown as typeof ResizeObserver)
