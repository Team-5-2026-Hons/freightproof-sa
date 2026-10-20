import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import type { Driver } from '@shared/lib/types/driver'
import { ApiError } from '@/lib/api/client'
import { arrangeSubstitution, replaceSubstitution } from '@/lib/api/driverSubstitutions'
import { DriverSubstitutionDialog } from './DriverSubstitutionDialog'
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } }, getAccessToken: vi.fn() }))
vi.mock('@/lib/api/driverSubstitutions', async (original) => ({ ...await original<typeof import('@/lib/api/driverSubstitutions')>(), arrangeSubstitution: vi.fn(), replaceSubstitution: vi.fn() }))
const drivers: Driver[] = [{ ...pack.noSubstitution.driver!, id: 'driver-b' as Driver['id'], full_name: 'Fixture incoming' }]
const tripId = crypto.randomUUID()
function fill(label: string, value: string): void { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
function setup(replacing: typeof pack.outgoingPending | null = null): void {
  render(<DriverSubstitutionDialog tripId={tripId} open drivers={drivers} replacing={replacing} outgoingDriverName="Fixture outgoing" onClose={vi.fn()} onSaved={vi.fn()} />)
}
const submit = () => screen.getByRole('button', { name: 'Authorise transfer' })
beforeEach(() => { vi.mocked(arrangeSubstitution).mockReset(); vi.mocked(replaceSubstitution).mockReset() })

it('immediate_form_sends_only_agreed_fields', async () => {
  vi.mocked(arrangeSubstitution).mockResolvedValue(pack.outgoingPending)
  setup()
  expect(submit()).toBeDisabled()
  expect(screen.getByLabelText('Outgoing driver')).toHaveValue('Fixture outgoing')
  fill('Incoming driver', 'driver-b'); fill('Reason', '  Immediate relief  ')
  expect(screen.queryByLabelText('Exchange point')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  await userEvent.click(submit())
  expect(arrangeSubstitution).toHaveBeenCalledWith(tripId, {
    client_request_id: expect.any(String), request_format: 'immediate_v2', incoming_driver_id: 'driver-b', reason: 'Immediate relief',
  })
})

it('keeps_draft_and_key_for_transport_retry_but_changes_key_after_edit', async () => {
  vi.mocked(arrangeSubstitution).mockRejectedValue(new ApiError(503, 'Temporarily unavailable'))
  setup(); fill('Incoming driver', 'driver-b'); fill('Reason', 'Immediate relief')
  await userEvent.click(submit()); await screen.findByRole('alert')
  expect(screen.getByLabelText('Reason')).toHaveValue('Immediate relief')
  await userEvent.click(submit())
  await waitFor(() => expect(arrangeSubstitution).toHaveBeenCalledTimes(2))
  const keys = () => vi.mocked(arrangeSubstitution).mock.calls.map(call => call[1].client_request_id)
  expect(keys()[1]).toBe(keys()[0])
  fill('Reason', 'Revised relief'); await userEvent.click(submit())
  expect(keys()[2]).not.toBe(keys()[0])
})

it('replacement_has_fresh_v2_fields_and_requires_its_reason', async () => {
  vi.mocked(replaceSubstitution).mockResolvedValue(pack.cancelled)
  const replacing = { ...pack.outgoingPending, incoming: { ...pack.outgoingPending.incoming, id: 'driver-b' } }
  setup(replacing)
  const button = screen.getByRole('button', { name: 'Replace handover' })
  expect(button).toBeDisabled()
  fill('Why replace the current arrangement', 'Use immediate transfer')
  await userEvent.click(button)
  expect(replaceSubstitution).toHaveBeenCalledWith(tripId, replacing.id, {
    client_request_id: expect.any(String), request_format: 'immediate_v2', incoming_driver_id: 'driver-b',
    reason: replacing.reason, expected_version: replacing.version, replacement_reason: 'Use immediate transfer',
  })
})
