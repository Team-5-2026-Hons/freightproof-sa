// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument, etc.)
import '@testing-library/jest-dom/vitest'

// jsdom does not implement native dialog methods; browser checks cover focus trapping.
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

// jsdom doesn't implement matchMedia. Defaults to NOT matching, keeping tests on the
// narrow layout unless a test opts into the docked one.
window.matchMedia = window.matchMedia || function (query: string): MediaQueryList {
  return {
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList
}

// jsdom doesn't implement ResizeObserver, which Recharts' ResponsiveContainer needs on
// mount. A no-op is enough: chart tests never assert on measured SVG geometry.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || (ResizeObserverStub as unknown as typeof ResizeObserver)
