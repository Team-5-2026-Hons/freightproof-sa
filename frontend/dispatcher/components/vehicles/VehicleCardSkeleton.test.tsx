import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VehicleCardGridSkeleton } from './VehicleCardSkeleton'
import { VEHICLE_GRID_CLASSES } from './VehicleCard'

describe('VehicleCardGridSkeleton', () => {
  it('announces the loading list and fills the grid with placeholder cards', () => {
    render(<VehicleCardGridSkeleton />)

    const grid = screen.getByRole('status', { name: 'Loading vehicles' })
    expect(grid).toHaveAttribute('aria-busy', 'true')
    expect(grid.children).toHaveLength(8)
  })

  it('uses the same grid as the loaded list, so cards land where the placeholders were', () => {
    render(<VehicleCardGridSkeleton />)

    expect(screen.getByRole('status').className).toBe(VEHICLE_GRID_CLASSES)
  })

  it('shows no text and no interactive card', () => {
    render(<VehicleCardGridSkeleton />)

    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
