import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Drawer } from '../Drawer'

// The panel keeps children mounted and slides off-canvas via CSS transform, so the
// only reliable handle on the panel element is walking up from the (always-mounted)
// children: children → content wrapper → panel root.
function getPanel(): HTMLElement {
  const content = screen.getByText('Panel body')
  const panel = content.parentElement?.parentElement
  if (!panel) throw new Error('drawer panel element not found')
  return panel
}

describe('Drawer accessibility-tree hygiene', () => {
  it('test_an_open_sheet_is_a_modal_dialog_named_by_its_title', () => {
    // Without this a screen reader was never told a sheet had opened over the page.
    render(
      <Drawer open onClose={vi.fn()} side="bottom" title="Appearance">
        <p>Panel body</p>
      </Drawer>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Appearance' })

    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('test_a_closed_sheet_is_not_announced_as_a_dialog', () => {
    render(
      <Drawer open={false} onClose={vi.fn()} side="bottom" title="Appearance">
        <p>Panel body</p>
      </Drawer>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('hides a closed drawer from assistive tech with aria-hidden and inert', () => {
    render(
      <Drawer open={false} onClose={vi.fn()} title="Driver Profile">
        <p>Panel body</p>
      </Drawer>,
    )

    const panel = getPanel()

    expect(panel).toHaveAttribute('aria-hidden', 'true')
    expect(panel).toHaveAttribute('inert')
  })

  it('keeps children mounted while closed', () => {
    render(
      <Drawer open={false} onClose={vi.fn()} title="Driver Profile">
        <p>Panel body</p>
      </Drawer>,
    )

    // The Profile sheets rely on the drawer never unmounting its children.
    expect(screen.getByText('Panel body')).toBeInTheDocument()
  })

  it('exposes an open drawer normally — no aria-hidden, no inert', () => {
    render(
      <Drawer open onClose={vi.fn()} title="Driver Profile">
        <p>Panel body</p>
      </Drawer>,
    )

    const panel = getPanel()

    expect(panel).not.toHaveAttribute('aria-hidden')
    expect(panel).not.toHaveAttribute('inert')
  })

  it('gives the close button a 44px hit area (touch-target minimum)', () => {
    render(
      <Drawer open onClose={vi.fn()} title="Driver Profile">
        <p>Panel body</p>
      </Drawer>,
    )

    const close = screen.getByRole('button', { name: 'Close drawer' })

    // Audit fix: was w-8 h-8 (32px), under the app's documented 44px touch-target
    // minimum (Button/IconButton/Switch). w-11 h-11 with -m-1.5 keeps the layout box
    // at its original 32px while the tappable area meets the minimum.
    expect(close.className).toContain('w-11')
    expect(close.className).toContain('h-11')
    expect(close.className).toContain('-m-1.5')
  })
})

// jsdom has no PointerEvent; this carries clientY so the drag maths actually run.
class PointerEventPolyfill extends MouseEvent {
  public readonly pointerId: number
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
    this.pointerId = params.pointerId ?? 0
  }
}

describe('Drawer as a bottom sheet (audit H9)', () => {
  const SHEET_HEIGHT_PX = 400

  let nowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Pin the clock: the sheet derives release velocity from performance.now() between
    // pointer events, so on a loaded machine a slow gap between the synthetic events read
    // as a flick and the short-drag case dismissed. A frozen clock means "no flick".
    nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000)
    // @ts-expect-error — installing a polyfill onto the jsdom window
    window.PointerEvent = PointerEventPolyfill
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: SHEET_HEIGHT_PX })
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
    // Reduce Motion: the sheet lands on its target at once, so the decision is what's
    // asserted rather than spring frames.
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    nowSpy.mockRestore()
  })

  function dragHandle(): HTMLElement {
    // The grabber + title strip is the drag handle; the title sits inside it.
    return screen.getByRole('heading', { name: 'Profile' }).parentElement!.parentElement!
  }

  it('shows a grabber, the iOS cue that the sheet can be dragged', () => {
    const { container } = render(
      <Drawer open onClose={vi.fn()} side="bottom" title="Profile"><p>Panel body</p></Drawer>,
    )

    expect(container.querySelector('.h-1\\.5.w-9.rounded-full')).not.toBeNull()
  })

  it('dismisses when dragged down past half its height', () => {
    // Arrange
    const onClose = vi.fn()
    render(<Drawer open onClose={onClose} side="bottom" title="Profile"><p>Panel body</p></Drawer>)

    // Act — 60% of the sheet's height, slowly (no flick).
    fireEvent.pointerDown(dragHandle(), { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(dragHandle(), { clientY: 100 + SHEET_HEIGHT_PX * 0.6, pointerId: 1 })
    fireEvent.pointerUp(dragHandle(), { clientY: 100 + SHEET_HEIGHT_PX * 0.6, pointerId: 1 })

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('springs back instead of closing on a short drag', () => {
    // Arrange
    const onClose = vi.fn()
    render(<Drawer open onClose={onClose} side="bottom" title="Profile"><p>Panel body</p></Drawer>)

    // Act — 20% of its height.
    fireEvent.pointerDown(dragHandle(), { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(dragHandle(), { clientY: 100 + SHEET_HEIGHT_PX * 0.2, pointerId: 1 })
    fireEvent.pointerUp(dragHandle(), { clientY: 100 + SHEET_HEIGHT_PX * 0.2, pointerId: 1 })

    // Assert
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open when the system cancels a drag that was past the dismiss point', () => {
    // Arrange
    const onClose = vi.fn()
    render(<Drawer open onClose={onClose} side="bottom" title="Profile"><p>Panel body</p></Drawer>)

    // Act — 60% down would dismiss on a release; here the OS takes the touch instead.
    fireEvent.pointerDown(dragHandle(), { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(dragHandle(), { clientY: 100 + SHEET_HEIGHT_PX * 0.6, pointerId: 1 })
    fireEvent.pointerCancel(dragHandle(), { clientY: 100 + SHEET_HEIGHT_PX * 0.6, pointerId: 1 })

    // Assert
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the scrim mounted while closed so it can fade out rather than vanish', () => {
    const { container } = render(
      <Drawer open={false} onClose={vi.fn()} side="bottom" title="Profile"><p>Panel body</p></Drawer>,
    )

    const scrim = container.firstElementChild as HTMLElement
    expect(scrim).toHaveClass('opacity-0', 'pointer-events-none')
  })
})

// Regressions found by driving the real app (Playwright, Oct 2026): the X inside the
// drag strip never closed a sheet, and the "scroll lock" wrote overflow:hidden onto
// <body>, which locked nothing on the trip page and was left behind on a stuck sheet.
describe('Drawer close button and scroll lock (profile scroll bug)', () => {
  beforeEach(() => {
    // @ts-expect-error — installing a polyfill onto the jsdom window
    window.PointerEvent = PointerEventPolyfill
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
  })

  it('test_tapping_the_close_button_does_not_start_a_drag_and_closes_the_sheet', () => {
    // Arrange
    const onClose = vi.fn()
    render(<Drawer open onClose={onClose} side="bottom" title="Appearance"><p>Panel body</p></Drawer>)
    const close = screen.getByRole('button', { name: 'Close drawer' })

    // Act — the sequence a finger produces on the X: pointerdown bubbles through the drag
    // strip, then the click lands on the button.
    fireEvent.pointerDown(close, { clientY: 120, pointerId: 1 })
    fireEvent.pointerUp(close, { clientY: 120, pointerId: 1 })
    fireEvent.click(close)

    // Assert — no pointer capture (which would have re-targeted the click to the strip).
    expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('test_a_drag_that_starts_on_the_grabber_still_captures_the_pointer', () => {
    render(<Drawer open onClose={vi.fn()} side="bottom" title="Appearance"><p>Panel body</p></Drawer>)
    const strip = screen.getByRole('heading', { name: 'Appearance' }).parentElement!.parentElement!

    fireEvent.pointerDown(strip, { clientY: 120, pointerId: 1 })

    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('test_an_open_sheet_never_writes_overflow_onto_body', () => {
    const { rerender } = render(<Drawer open onClose={vi.fn()} side="bottom" title="Appearance"><p>Panel body</p></Drawer>)

    expect(document.body.style.overflow).toBe('')

    rerender(<Drawer open={false} onClose={vi.fn()} side="bottom" title="Appearance"><p>Panel body</p></Drawer>)

    expect(document.body.style.overflow).toBe('')
  })

  it('test_a_touch_moving_on_a_short_sheet_never_scrolls_the_page_behind_it', () => {
    // jsdom lays nothing out, so the panel reads as not overflowing — exactly the short
    // sheet whose gesture the browser would otherwise hand to the page.
    render(<Drawer open onClose={vi.fn()} side="bottom" title="Appearance"><p>Panel body</p></Drawer>)
    const move = new Event('touchmove', { bubbles: true, cancelable: true })

    screen.getByText('Panel body').dispatchEvent(move)

    expect(move.defaultPrevented).toBe(true)
  })

  it('test_the_scrim_refuses_touch_scrolling_and_the_panel_contains_overscroll', () => {
    const { container } = render(<Drawer open onClose={vi.fn()} side="bottom" title="Appearance"><p>Panel body</p></Drawer>)

    expect(container.firstElementChild).toHaveClass('touch-none')
    expect(screen.getByRole('dialog')).toHaveClass('overscroll-contain')
  })
})

describe('Drawer focus management', () => {
  it('test_focus_moves_to_the_close_button_on_open_and_returns_on_close', () => {
    // Arrange — the row that opened the sheet holds focus.
    const { rerender } = render(
      <>
        <button type="button">Appearance row</button>
        <Drawer open={false} onClose={vi.fn()} side="bottom" title="Appearance"><p>Panel body</p></Drawer>
      </>,
    )
    const opener = screen.getByRole('button', { name: 'Appearance row' })
    opener.focus()

    // Act
    rerender(
      <>
        <button type="button">Appearance row</button>
        <Drawer open onClose={vi.fn()} side="bottom" title="Appearance"><p>Panel body</p></Drawer>
      </>,
    )

    // Assert
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close drawer' }))

    rerender(
      <>
        <button type="button">Appearance row</button>
        <Drawer open={false} onClose={vi.fn()} side="bottom" title="Appearance"><p>Panel body</p></Drawer>
      </>,
    )

    expect(document.activeElement).toBe(opener)
  })

  it('test_tab_wraps_inside_the_open_sheet', () => {
    render(
      <Drawer open onClose={vi.fn()} side="bottom" title="Sign out?">
        <button type="button">Sign Out</button>
        <button type="button">Cancel</button>
      </Drawer>,
    )
    const close = screen.getByRole('button', { name: 'Close drawer' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })

    cancel.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)
  })
})
