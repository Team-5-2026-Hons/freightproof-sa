import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { Trip } from '@shared/lib/types/trip'
import { DriverTransferController, transferActionFor } from './DriverTransferController'
vi.mock('@/lib/hooks/useDrivers', () => ({ useDrivers: () => ({ drivers: [] }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } }, getAccessToken: vi.fn() }))

it('header_action_opens_one_controller_with_sidebar_closed', async () => {
  const trip: Trip = { ...mockTrips[0]!, ...pack.noSubstitution, status: 'active', driver_substitutions_enabled: true }
  render(<DriverTransferController trip={trip} onChanged={vi.fn()}>{open => <button onClick={open}>Transfer driver</button>}</DriverTransferController>)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Transfer driver' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByLabelText('Incoming driver')).toBeInTheDocument()
})

it('pending_uses_view_transfer_and_flag_off_keeps_resolution', async () => {
  const trip: Trip = { ...mockTrips[0]!, status: 'active', pending_driver_substitution: pack.outgoingPending, driver_substitutions_enabled: false }
  const action = transferActionFor(trip, vi.fn())
  expect(action?.label).toBe('View transfer')
  expect(transferActionFor({ ...trip, pending_driver_substitution: null }, vi.fn())).toBeNull()
  render(<DriverTransferController trip={trip} onChanged={vi.fn()}>{open => <button onClick={open}>View transfer</button>}</DriverTransferController>)
  await userEvent.click(screen.getByRole('button', { name: 'View transfer' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument()
})
