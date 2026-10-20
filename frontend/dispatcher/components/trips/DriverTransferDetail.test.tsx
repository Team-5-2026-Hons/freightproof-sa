import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CompletedSubstitutionDetail } from '@shared/lib/types/driver-substitution'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import { DriverTransferDetail } from './DriverTransferDetail'
import { getCompletedSubstitution } from '@/lib/api/driverSubstitutions'

vi.mock('@/lib/api/driverSubstitutions', () => ({ getCompletedSubstitution: vi.fn() }))
vi.mock('@/components/blockchain/ForensicOnly', () => ({ ForensicOnly: () => null }))

const detail: CompletedSubstitutionDetail = {
  substitution_id: 'completed-transfer', request_id: 'request', sequence_number: 1,
  outgoing: pack.outgoingPending.outgoing, incoming: pack.outgoingPending.incoming,
  effective_at: '2026-10-20T10:00:00Z', completion_mode: 'normal', anchor_status: 'pending',
  receipt_id: null, phase_context: null, request_format: 'immediate_v2', required_confirmation_roles: ['incoming'],
  confirmation_policy: 'incoming_acceptance_v2', reason: 'Fixture relief', confirmations: [], artifacts: [], corrections: [],
  arranged_by_user_id: 'dispatcher', completion: null, identity_attestation: null, declared_exchange_at: null,
  missing_confirmation_reason: null, custody_integrity: { status: 'pending', amendment_count: 1, pending_anchor_count: 1, findings: [] },
  outgoing_notices: [{ id: 'notice', request_id: 'request', trip_id: 'trip', kind: 'completed', created_at: '2026-10-20T10:00:00Z', read_at: null }],
}

beforeEach(() => vi.clearAllMocks())

it('shows_durable_notice_facts_separately_from_outgoing_consent_and_anchor_state', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  render(<DriverTransferDetail tripId="trip" substitutionId="completed-transfer" onChanged={vi.fn()} />)
  expect(await screen.findByText(/Outgoing completed notice recorded.*Unread/)).toBeVisible()
  expect(screen.getByText('Outgoing driver: Not requested — notification only.')).toBeVisible()
  expect(screen.getByText(/Anchor: pending/)).toBeVisible()
  expect(screen.getByText(/Notification delivery or read acknowledgement is not recorded as driver consent/)).toBeVisible()
})

it('retries_failed_detail_reads_and_keeps_missing_historical_notifications_explicit', async () => {
  vi.mocked(getCompletedSubstitution).mockRejectedValueOnce(new Error('Temporary outage'))
    .mockResolvedValueOnce({ ...detail, outgoing_notices: [] })
  render(<DriverTransferDetail tripId="trip" substitutionId="completed-transfer" onChanged={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Retry transfer detail' }))
  expect(await screen.findByText('Outgoing notification facts not recorded.')).toBeVisible()
  expect(getCompletedSubstitution).toHaveBeenCalledTimes(2)
})
