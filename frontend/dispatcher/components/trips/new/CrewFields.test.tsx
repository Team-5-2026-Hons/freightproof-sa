import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { mockHorses, mockTrailers } from '@shared/lib/mocks/vehicles'
import { EMPTY_CREW } from '@/lib/trips/manifest-form'
import { trailerCombo } from '@/lib/trips/trailer-combo'
import { CrewFields, type CrewFieldsProps } from './CrewFields'

function renderCrew(overrides: Partial<CrewFieldsProps> = {}): CrewFieldsProps {
  const props: CrewFieldsProps = {
    crew: EMPTY_CREW, onChange: vi.fn(), drivers: mockDrivers, horses: mockHorses, trailers: mockTrailers,
    combo: trailerCombo([]), errors: {}, ...overrides,
  }
  render(<CrewFields {...props} />)
  return props
}

describe('CrewFields', () => {
  it('picks a driver', () => {
    const props = renderCrew()

    fireEvent.click(screen.getByRole('button', { name: 'Assigned driver' }))
    fireEvent.click(screen.getByRole('button', { name: /Sipho Dlamini/ }))

    expect(props.onChange).toHaveBeenCalledWith({ ...EMPTY_CREW, driverId: mockDrivers[0].id })
  })

  it('picks a horse', () => {
    const props = renderCrew()

    fireEvent.click(screen.getByRole('button', { name: 'Horse' }))
    fireEvent.click(screen.getByRole('button', { name: /GP 12-34 ZX/ }))

    expect(props.onChange).toHaveBeenCalledWith({ ...EMPTY_CREW, horseId: mockHorses[0].id })
  })

  it('adds a trailer', () => {
    const props = renderCrew()

    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(mockTrailers[0].registration) }))

    expect(props.onChange).toHaveBeenCalledWith({ ...EMPTY_CREW, trailerIds: [mockTrailers[0].id] })
  })

  it('disables further trailers at the limit', () => {
    renderCrew({ crew: { ...EMPTY_CREW, trailerIds: [mockTrailers[0].id, mockTrailers[1].id] } })

    expect(screen.getByRole('checkbox', { name: new RegExp(mockTrailers[2].registration) })).toBeDisabled()
  })

  it('marks an invalid picker for assistive tech and names it by its label', () => {
    renderCrew({ errors: { driver: 'Select a driver.' } })

    const driver = screen.getByRole('button', { name: 'Assigned driver' })
    expect(driver).toHaveAttribute('data-invalid', 'true')
    expect(driver).toHaveAccessibleDescription('Select a driver.')
    expect(driver.className).toContain('border-err')
    expect(driver.className).not.toContain('border-outline-v')
  })

  it('does not offer an inactive trailer', () => {
    const [retired, ...active] = mockTrailers
    renderCrew({ trailers: [{ ...retired, is_active: false }, ...active] })

    expect(screen.queryByRole('checkbox', { name: new RegExp(retired.registration) })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: new RegExp(active[0].registration) })).toBeInTheDocument()
  })

  it('shows field errors and announces the combination verdict', () => {
    renderCrew({
      errors: { driver: 'Select a driver.', trailers: 'Fix the trailer combination.' },
      combo: { valid: false, message: '12 m + 12 m exceeds the 18 m limit' },
    })

    expect(screen.getByText('Select a driver.')).toBeInTheDocument()
    expect(screen.getByText('Fix the trailer combination.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('exceeds the 18 m limit')
  })
})
