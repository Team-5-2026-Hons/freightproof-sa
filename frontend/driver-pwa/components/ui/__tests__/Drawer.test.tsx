import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

    // ProfilePanel's memoization relies on the drawer never unmounting its children.
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

  beforeEach(() => {
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

  it('keeps the scrim mounted while closed so it can fade out rather than vanish', () => {
    const { container } = render(
      <Drawer open={false} onClose={vi.fn()} side="bottom" title="Profile"><p>Panel body</p></Drawer>,
    )

    const scrim = container.firstElementChild as HTMLElement
    expect(scrim).toHaveClass('opacity-0', 'pointer-events-none')
  })
})
