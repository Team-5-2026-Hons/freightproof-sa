import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CreateTripSummary } from './CreateTripSummary'

const ROWS = [{ label: 'Driver', value: 'Sipho Dlamini' }, { label: 'Horse', value: 'GP 12-34 ZX', numeric: true }]

describe('CreateTripSummary', () => {
  it('lists what will be created and creates on click', () => {
    const onCreate = vi.fn()
    render(<CreateTripSummary rows={ROWS} canCreate busy={false} errorText={null} onCreate={onCreate} />)

    expect(screen.getByRole('complementary', { name: 'Trip summary' })).toHaveTextContent('Sipho Dlamini')
    fireEvent.click(screen.getByRole('button', { name: 'Create Trip + Lock to Blockchain' }))

    expect(onCreate).toHaveBeenCalled()
  })

  it('disables the CTA when the trip cannot be created, and says why after an attempt', () => {
    render(
      <CreateTripSummary
        rows={ROWS}
       
        canCreate={false}
        busy={false}
        errorText="Complete the highlighted fields before creating the trip."
        onCreate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Create Trip + Lock to Blockchain' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Complete the highlighted fields')
  })
})
