import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PRECINCT_GRID_CLASSES } from './PrecinctCard'
import { PrecinctCardGridSkeleton } from './PrecinctCardSkeleton'
import { PrecinctDetailSkeleton } from './PrecinctDetailSkeleton'

describe('PrecinctCardGridSkeleton', () => {
  it('announces the loading list and fills the grid with placeholder cards', () => {
    render(<PrecinctCardGridSkeleton />)

    const grid = screen.getByRole('status', { name: 'Loading precincts' })
    expect(grid).toHaveAttribute('aria-busy', 'true')
    expect(grid.children).toHaveLength(6)
  })

  it('uses the same grid as the loaded list, and keeps the map band at the real fixed height', () => {
    const { container } = render(<PrecinctCardGridSkeleton />)

    expect(screen.getByRole('status').className).toBe(PRECINCT_GRID_CLASSES)
    expect(container.querySelectorAll('.h-\\[150px\\]')).toHaveLength(6)
  })

  it('shows no text and no interactive card', () => {
    render(<PrecinctCardGridSkeleton />)

    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PrecinctDetailSkeleton', () => {
  it('announces the loading precinct and keeps the real 320px map and 256px side column', () => {
    const { container } = render(<PrecinctDetailSkeleton />)

    expect(screen.getByRole('status', { name: 'Loading precinct' })).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('.h-\\[320px\\]')).not.toBeNull()
    expect(container.querySelector('.lg\\:w-\\[256px\\]')).not.toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})
