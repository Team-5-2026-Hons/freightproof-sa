import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Basis } from '@shared/lib/types/analytics-chat'
import { BasisLine } from './BasisLine'

const ON_TIME: Basis = {
  tool: 'on_time', tab: 'on-time', label: 'On time',
  start: '2025-11-01', end: '2026-10-19', grain: 'month', closed_trip_count: 412,
}

describe('BasisLine', () => {
  it('says which tab, dates, View by and trip count an answer rests on', () => {
    render(<BasisLine basis={ON_TIME} onOpen={vi.fn()} />)

    expect(screen.getByText(/1 Nov 2025 – 19 Oct 2026 · by month · 412 trips/)).toBeInTheDocument()
  })

  it('opens that tab when its name is clicked', () => {
    const onOpen = vi.fn()
    render(<BasisLine basis={ON_TIME} onOpen={onOpen} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open On time with these dates' }))

    expect(onOpen).toHaveBeenCalledWith(ON_TIME)
  })

  it('leaves out View by for Routes & sites and says "trip" for one', () => {
    render(<BasisLine basis={{ ...ON_TIME, tool: 'routes_and_sites', tab: 'routes', label: 'Routes & sites', grain: null, closed_trip_count: 1 }} onOpen={vi.fn()} />)

    expect(screen.getByText(/19 Oct 2026 · 1 trip$/)).toBeInTheDocument()
    expect(screen.queryByText(/by /)).not.toBeInTheDocument()
  })

  it('shows "Right now" for the tiles, with nothing to open', () => {
    render(<BasisLine basis={{ tool: 'right_now', tab: null, label: 'Right now', start: null, end: null, grain: null, closed_trip_count: null }} onOpen={vi.fn()} />)

    expect(screen.getByText('Right now')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
