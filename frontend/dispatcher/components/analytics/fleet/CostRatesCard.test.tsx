import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import type { CostProfile } from '@shared/lib/types/cost-analytics'
import { CostRatesCard } from './CostRatesCard'

vi.mock('@/lib/api/client', () => ({
  api: { patch: vi.fn() },
}))

let role: 'dispatcher' | 'admin_dispatcher' = 'admin_dispatcher'
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { role } }),
}))

const mockedPatch = vi.mocked(api.patch)
const PATH = '/api/v1/analytics/cost-profile'

const RATES: CostProfile = {
  diesel_price_per_litre: 33.29, litres_per_100km: 53, fuel_per_km: 17.6437, running_cost_per_km: 15.1,
  driver_cost_per_hour: 155, delay_cost_per_hour: 1100, fixed_cost_per_trip: 0, road_factor: 1.15,
  is_default: true, updated_at: null, updated_by_name: null,
}

function renderCard(onSaved = vi.fn()) {
  render(<CostRatesCard rates={RATES} onSaved={onSaved} />)
  return onSaved
}

function field(label: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: label }) as HTMLInputElement
}

beforeEach(() => {
  role = 'admin_dispatcher'
  mockedPatch.mockReset()
})

describe('CostRatesCard', () => {
  it('shows no Edit button to a dispatcher who is not an admin', () => {
    role = 'dispatcher'

    renderCard()

    expect(screen.getByText(/R\s33,29 \/ L/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit rates' })).not.toBeInTheDocument()
  })

  it('lets an admin change the diesel price and saves only what changed', async () => {
    mockedPatch.mockResolvedValue({ ...RATES, diesel_price_per_litre: 34.5, is_default: false })
    const onSaved = renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit rates' }))
    fireEvent.change(field('New diesel price'), { target: { value: '34.50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedPatch).toHaveBeenCalledWith(PATH, { diesel_price_per_litre: 34.5 }))
    expect(await screen.findByRole('status')).toHaveTextContent('Rates saved. Figures updated.')
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox', { name: 'New diesel price' })).not.toBeInTheDocument()
  })

  it('accepts a decimal comma, the way South African prices are written', async () => {
    mockedPatch.mockResolvedValue(RATES)
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit rates' }))
    fireEvent.change(field('New diesel price'), { target: { value: '34,10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedPatch).toHaveBeenCalledWith(PATH, { diesel_price_per_litre: 34.1 }))
  })

  it('shows what fuel per km becomes while the admin types', () => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit rates' }))
    fireEvent.change(field('New diesel price'), { target: { value: '40' } })

    // R40/L × 50 L/100 km would be R20; at 53 L/100 km it is R21,20.
    expect(screen.getByText(/R\s21,20 \/ km/)).toBeInTheDocument()
  })

  it.each([
    ['New road factor', '2.5', 'Must be at most 2.'],
    ['New road factor', '0.9', 'Must be at least 1.'],
    ['New consumption', '0', 'Must be more than 0.'],
    ['New diesel price', 'abc', 'Enter a number.'],
    ['New delay', '1100.555', 'Use at most 2 decimal places.'],
  ])('refuses %s of %s with a field error and blocks Save', (label, value, message) => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit rates' }))
    fireEvent.change(field(label), { target: { value } })

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(field(label)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('keeps Save disabled until a rate actually changes', () => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit rates' }))

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByText('Change a rate to save.')).toBeInTheDocument()
  })

  it('shows the server\'s message and keeps the typed values when a save fails', async () => {
    mockedPatch.mockRejectedValue(new Error('Rate limit reached, try again in a minute'))
    const onSaved = renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit rates' }))
    fireEvent.change(field('New delay'), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Rate limit reached, try again in a minute')
    expect(field('New delay').value).toBe('900')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('puts everything back on Cancel without saving', () => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit rates' }))
    fireEvent.change(field('New delay'), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockedPatch).not.toHaveBeenCalled()
    expect(screen.getByText(/R\s1\s100,00 \/ h/)).toBeInTheDocument()
  })

  it('says the starting rates apply until an admin saves, then who changed them', () => {
    const { rerender } = render(<CostRatesCard rates={RATES} />)
    expect(screen.getByText(/Starting rates from Bruce’s figures/)).toBeInTheDocument()

    rerender(<CostRatesCard rates={{ ...RATES, is_default: false, updated_at: '2026-10-15T08:30:00Z', updated_by_name: 'Tom Davis' }} />)

    const footer = screen.getByText(/Last changed/)
    expect(within(footer).getByText(/15 Oct 2026, 10:30 SAST by Tom Davis · All figures use today’s rates/)).toBeInTheDocument()
  })
})
