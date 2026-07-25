import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
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
