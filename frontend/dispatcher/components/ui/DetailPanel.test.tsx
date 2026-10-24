import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DetailPanel } from './DetailPanel'

const tabs = [{ id: 'information', label: 'Info' }] as const
const props = { tabs, active: 'information', onSelect: vi.fn(), title: 'Trip information',
  onClose: vi.fn(), overlayOpen: false, ariaLabel: 'Trip detail', children: <p>Supporting detail</p> }

afterEach(() => vi.restoreAllMocks())

function setDocked(matches: boolean): void {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ ...window.matchMedia(''), matches })
}

describe('DetailPanel responsive presentation', () => {
  it('keeps the responsive default docked on desktop', () => {
    setDocked(true)
    render(<DetailPanel {...props} />)
    expect(screen.getByRole('complementary', { name: 'Trip detail' })).toHaveTextContent('Supporting detail')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the responsive overlay closed until requested at narrow widths', () => {
    setDocked(false)
    const { rerender } = render(<DetailPanel {...props} />)
    expect(screen.queryByText('Supporting detail')).not.toBeInTheDocument()
    rerender(<DetailPanel {...props} overlayOpen />)
    expect(screen.getByRole('dialog', { name: 'Trip information' })).toHaveTextContent('Supporting detail')
  })

  it('is not itself a tab stop or a focus-ring target, so a closing modal cannot outline the whole panel', () => {
    setDocked(true)
    render(<DetailPanel {...props} />)

    const panel = screen.getByRole('tabpanel')
    expect(panel).not.toHaveAttribute('tabindex')
    expect(panel).toHaveClass('focus-visible:outline-none')
  })
})
