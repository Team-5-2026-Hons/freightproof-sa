import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

// jsdom 25 does not implement window.PointerEvent, so fireEvent.pointerDown/Up/Cancel
// would otherwise dispatch a bare Event with no clientX/clientY/pointerId — the gesture
// bookkeeping under test here reads exactly those fields, so without this the pointer
// tests below would pass vacuously (no gesture ever recorded) rather than exercising the
// real logic. Polyfilled only when missing, so a future jsdom upgrade that adds real
// support keeps using it instead.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEvent extends MouseEvent {
    readonly pointerId: number
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEvent, writable: true, configurable: true })
}

afterEach(() => {
  vi.restoreAllMocks()
})

// jsdom's layout engine never runs, so a real element's getBoundingClientRect() always
// returns an all-zero rect — every "inside" vs "outside" pointer test below has to stub
// the dialog's own rect to give outsideDialog() something meaningful to compare against.
function stubDialogRect(dialog: HTMLElement, rect: { left: number; top: number; right: number; bottom: number }): void {
  const domRect: DOMRect = {
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON() {
      return this
    },
  }
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(domRect)
}

// Shared rect for every pointer test below: a 400x300 box with (200, 200) clearly inside
// and (50, 50) clearly outside on every edge.
const DIALOG_RECT = { left: 100, top: 100, right: 500, bottom: 400 }
const INSIDE = { x: 200, y: 200 }
const OUTSIDE_A = { x: 50, y: 50 }
const OUTSIDE_B = { x: 550, y: 450 }

it('names the dialog, returns focus and guards Escape during submission', () => {
  const close = vi.fn()
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const { rerender, unmount } = render(<Modal open title="Review evidence" onClose={close}><button>Inspect</button></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Review evidence' })
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(close).toHaveBeenCalledTimes(1)
  rerender(<Modal open title="Review evidence" onClose={close} closeDisabled><button>Inspect</button></Modal>)
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(close).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Close modal' })).toBeDisabled()
  unmount()
  expect(trigger).toHaveFocus()
  trigger.remove()
})

it('applies max-w-6xl for the xl size', () => {
  render(<Modal open title="Wide review" onClose={() => {}} size="xl"><p>Content</p></Modal>)
  expect(screen.getByRole('dialog', { name: 'Wide review' })).toHaveClass('max-w-6xl')
})

// Regression for the map-panning defect: a Leaflet drag that starts on content inside
// the dialog (e.g. the map) and is released over the backdrop still produces a native
// `click` targeting the `<dialog>` element itself, indistinguishable from a real
// backdrop click by target alone. Only a gesture that both started AND ended outside the
// dialog's own box may dismiss.
it('does not dismiss a gesture beginning inside the dialog', () => {
  const close = vi.fn()
  render(<Modal open title="Map" onClose={close}><div data-testid="map">Map</div></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Map' })
  stubDialogRect(dialog, DIALOG_RECT)

  fireEvent.pointerDown(screen.getByTestId('map'), { pointerId: 1, clientX: INSIDE.x, clientY: INSIDE.y })
  fireEvent.pointerUp(dialog, { pointerId: 1, clientX: OUTSIDE_A.x, clientY: OUTSIDE_A.y })
  fireEvent.click(dialog)

  expect(close).not.toHaveBeenCalled()
})

it('dismisses on a genuine backdrop click (down outside, up outside, same pointer)', () => {
  const close = vi.fn()
  render(<Modal open title="Map" onClose={close}><div data-testid="map">Map</div></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Map' })
  stubDialogRect(dialog, DIALOG_RECT)

  fireEvent.pointerDown(dialog, { pointerId: 1, clientX: OUTSIDE_A.x, clientY: OUTSIDE_A.y })
  fireEvent.pointerUp(dialog, { pointerId: 1, clientX: OUTSIDE_B.x, clientY: OUTSIDE_B.y })
  fireEvent.click(dialog)

  expect(close).toHaveBeenCalledTimes(1)
})

it('does not dismiss a gesture starting outside and released inside', () => {
  const close = vi.fn()
  render(<Modal open title="Map" onClose={close}><div data-testid="map">Map</div></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Map' })
  stubDialogRect(dialog, DIALOG_RECT)

  fireEvent.pointerDown(dialog, { pointerId: 1, clientX: OUTSIDE_A.x, clientY: OUTSIDE_A.y })
  fireEvent.pointerUp(dialog, { pointerId: 1, clientX: INSIDE.x, clientY: INSIDE.y })
  fireEvent.click(dialog)

  expect(close).not.toHaveBeenCalled()
})

it('clears the recorded gesture on pointercancel so a later click does not dismiss', () => {
  const close = vi.fn()
  render(<Modal open title="Map" onClose={close}><div data-testid="map">Map</div></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Map' })
  stubDialogRect(dialog, DIALOG_RECT)

  fireEvent.pointerDown(dialog, { pointerId: 1, clientX: OUTSIDE_A.x, clientY: OUTSIDE_A.y })
  fireEvent.pointerCancel(dialog, { pointerId: 1 })
  fireEvent.click(dialog)

  expect(close).not.toHaveBeenCalled()
})

it('ignores a pointerup from a different pointerId than the one that went down', () => {
  const close = vi.fn()
  render(<Modal open title="Map" onClose={close}><div data-testid="map">Map</div></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Map' })
  stubDialogRect(dialog, DIALOG_RECT)

  fireEvent.pointerDown(dialog, { pointerId: 1, clientX: OUTSIDE_A.x, clientY: OUTSIDE_A.y })
  fireEvent.pointerUp(dialog, { pointerId: 2, clientX: OUTSIDE_B.x, clientY: OUTSIDE_B.y })
  fireEvent.click(dialog)

  expect(close).not.toHaveBeenCalled()
})

it('does not dismiss a genuine backdrop click while closeDisabled', () => {
  const close = vi.fn()
  render(<Modal open title="Map" onClose={close} closeDisabled><div data-testid="map">Map</div></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Map' })
  stubDialogRect(dialog, DIALOG_RECT)

  fireEvent.pointerDown(dialog, { pointerId: 1, clientX: OUTSIDE_A.x, clientY: OUTSIDE_A.y })
  fireEvent.pointerUp(dialog, { pointerId: 1, clientX: OUTSIDE_B.x, clientY: OUTSIDE_B.y })
  fireEvent.click(dialog)

  expect(close).not.toHaveBeenCalled()
})

it('does not dismiss a plain click with no preceding pointer gesture', () => {
  const close = vi.fn()
  render(<Modal open title="Map" onClose={close}><div data-testid="map">Map</div></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Map' })
  stubDialogRect(dialog, DIALOG_RECT)

  fireEvent.click(dialog)

  expect(close).not.toHaveBeenCalled()
})

it('still closes via the close button and Escape', () => {
  const close = vi.fn()
  render(<Modal open title="Map" onClose={close}><div data-testid="map">Map</div></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Map' })

  fireEvent.click(screen.getByRole('button', { name: 'Close modal' }))
  expect(close).toHaveBeenCalledTimes(1)

  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(close).toHaveBeenCalledTimes(2)
})
