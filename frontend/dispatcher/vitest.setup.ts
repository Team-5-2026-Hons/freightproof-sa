// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument, etc.)
// for future component tests using @testing-library/react.
import '@testing-library/jest-dom/vitest'

// jsdom does not implement native dialog methods; browser checks cover focus trapping.
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

// jsdom does not implement matchMedia. Components that dock on a width query read it on
// first render, so it must exist before any of them mount. Defaults to NOT matching, which
// keeps tests on the narrow layout unless a test opts into the docked one.
window.matchMedia = window.matchMedia || function (query: string): MediaQueryList {
  return {
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList
}
