import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { mockHorses, mockTrailers } from '@shared/lib/mocks/vehicles'
import { busyById, NOBODY_BUSY } from '@/lib/trips/crew-availability'
import { EMPTY_CREW } from '@/lib/trips/manifest-form'
import { trailerCombo } from '@/lib/trips/trailer-combo'
import type { BusyEntry } from '@shared/lib/types/availability'
import { CrewFields, type CrewFieldsProps } from './CrewFields'

// 14:00 UTC is 16:00 in SAST.
const FREE_AT = '2026-10-16T14:00:00Z'

function busy(resourceId: string, overrides: Partial<BusyEntry> = {}): BusyEntry {
  return {
    resource_type: 'horse', resource_id: resourceId, label: 'X', trip_id: 't-1', trip_reference: 'TRP-0038',
    trip_status: 'created', busy_from: '2026-10-16T06:00:00Z', busy_until: FREE_AT, planned_until: FREE_AT,
    ...overrides,
  }
}

function renderCrew(overrides: Partial<CrewFieldsProps> = {}): CrewFieldsProps {
  const props: CrewFieldsProps = {
    crew: EMPTY_CREW, onChange: vi.fn(), drivers: mockDrivers, horses: mockHorses, trailers: mockTrailers,
    combo: trailerCombo([]), errors: {}, busy: NOBODY_BUSY, availability: 'ready', ...overrides,
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

  it('greys out a busy horse with when it is free, and does not let it be picked', () => {
    const props = renderCrew({ busy: busyById([busy(mockHorses[0].id)]) })

    fireEvent.click(screen.getByRole('button', { name: 'Horse' }))
    const option = screen.getByRole('button', { name: /GP 12-34 ZX/ })
    fireEvent.click(option)

    expect(option).toBeDisabled()
    expect(option).toHaveTextContent('On TRP-0038 · free after Fri 16 Oct, 16:00')
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('says a horse on a live, overrunning trip is free only when that trip closes', () => {
    renderCrew({ busy: busyById([busy(mockHorses[0].id, { trip_status: 'active', busy_until: null })]) })

    fireEvent.click(screen.getByRole('button', { name: 'Horse' }))

    expect(screen.getByRole('button', { name: /GP 12-34 ZX/ })).toHaveTextContent('under way, free when it closes')
  })

  it('greys out a busy driver', () => {
    renderCrew({ busy: busyById([busy(mockDrivers[0].id, { resource_type: 'driver' })]) })

    fireEvent.click(screen.getByRole('button', { name: 'Assigned driver' }))

    expect(screen.getByRole('button', { name: /Sipho Dlamini/ })).toBeDisabled()
  })

  it('disables a busy trailer and says when it is free', () => {
    renderCrew({ busy: busyById([busy(mockTrailers[0].id, { resource_type: 'trailer' })]) })

    const box = screen.getByRole('checkbox', { name: new RegExp(mockTrailers[0].registration) })

    expect(box).toBeDisabled()
    expect(box.closest('label')).toHaveTextContent('On TRP-0038 · free after Fri 16 Oct, 16:00')
  })

  it('lets an already-ticked trailer that turned out busy be unticked', () => {
    const props = renderCrew({
      crew: { ...EMPTY_CREW, trailerIds: [mockTrailers[0].id] },
      busy: busyById([busy(mockTrailers[0].id, { resource_type: 'trailer' })]),
    })

    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(mockTrailers[0].registration) }))

    expect(props.onChange).toHaveBeenCalledWith({ ...EMPTY_CREW, trailerIds: [] })
  })

  it('asks for both times before it can say who is free', () => {
    renderCrew({ availability: 'idle' })

    expect(screen.getByText('Enter departure and arrival to see who is free.')).toBeInTheDocument()
  })

  it('says when the check failed, and that creating still refuses a clash', () => {
    renderCrew({ availability: 'error' })

    expect(screen.getByText("Couldn't check who is free. Creating will still refuse a clash.")).toBeInTheDocument()
  })
})
