import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Tabs } from '../Tabs'

describe('Tabs', () => {
  it('renders labels without baked-in count parentheses', () => {
    render(
      <Tabs
        tabs={[
          { id: 'active', label: 'Active', count: 1 },
          { id: 'past', label: 'Past', count: 3 },
        ]}
        active="active"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText(/Active \(/)).not.toBeInTheDocument()
  })

  it('renders counts as separate badge spans', () => {
    render(
      <Tabs
        tabs={[
          { id: 'active', label: 'Active', count: 1 },
          { id: 'past', label: 'Past', count: 3 },
        ]}
        active="active"
        onChange={vi.fn()}
      />,
    )

    // Badge text is separate from the label, so the raw count is queryable on its own.
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('omits the badge when a tab has no count', () => {
    render(
      <Tabs
        tabs={[{ id: 'a', label: 'Alpha' }]}
        active="a"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('calls onChange with the tab id when clicked', () => {
    const onChange = vi.fn()
    render(
      <Tabs
        tabs={[
          { id: 'active', label: 'Active', count: 1 },
          { id: 'past', label: 'Past', count: 3 },
        ]}
        active="active"
        onChange={onChange}
      />,
    )

    // @radix-ui/react-tabs activates a trigger on mousedown (for perceived
    // responsiveness), not on click — fireEvent.click alone never reaches
    // Radix's selection handler, so fire the fuller pointer sequence a real
    // click produces.
    fireEvent.mouseDown(screen.getByText('Past'))
    fireEvent.click(screen.getByText('Past'))

    expect(onChange).toHaveBeenCalledWith('past')
  })
})
