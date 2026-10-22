import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'
import type { CompletedSubstitutionDetail, SubstitutionConfirmationDetail } from '@shared/lib/types/driver-substitution'
import type { Trip } from '@shared/lib/types/trip'
import { mockTrips } from '@shared/lib/mocks/trips'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import { DriverTransferDetail } from './DriverTransferDetail'
import { correctSubstitution, getCompletedSubstitution } from '@/lib/api/driverSubstitutions'
import { ApiError } from '@/lib/api/client'
import { substitutionErrorFixtures } from '@shared/lib/mocks/driver-substitutions'

// Keep the real error-code reader and key generator; only the two calls that reach the network are faked.
vi.mock('@/lib/api/driverSubstitutions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/driverSubstitutions')>('@/lib/api/driverSubstitutions')
  return { ...actual, getCompletedSubstitution: vi.fn(), correctSubstitution: vi.fn() }
})
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))
vi.mock('@/components/blockchain/ForensicOnly', () => ({ ForensicOnly: () => null }))

const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-/
const ARRANGER = 'Anna Arranger'
const ATTESTER = 'Bongani Attester'

// The ids below are real UUIDs on purpose: a name that fails to resolve would leave one on screen.
const [horse, trailer] = pack.outgoingPending.vehicles
const trip: Trip = { ...mockTrips[0]!, id: pack.outgoingPending.trip_id as Trip['id'], horse: null, trailers: [], driver_substitutions: [pack.normalCompleted] }

const incomingCheck: SubstitutionConfirmationDetail = {
  id: 'f8300000-0000-4000-8000-0000000000c1', role: 'incoming', driver_id: pack.outgoingPending.incoming.id,
  captured_at: '2026-10-20T09:58:00Z', received_at: '2026-10-20T09:59:00Z',
  confirmed_vehicle_ids: [horse.id, trailer.id],
  seal_checks: [
    { vehicle_id: horse.id, condition: 'intact', seal_number: 'FP-1233', photo_artifact_ids: [], not_applicable_reason: null },
    { vehicle_id: trailer.id, condition: 'not_applicable', seal_number: null, photo_artifact_ids: [], not_applicable_reason: 'Empty trailer' },
  ],
  discrepancy_note: 'Seal looked scuffed', latitude: -26.1234567, longitude: 28.1234567, accuracy_metres: 8.4,
  location_observed_at: '2026-10-20T09:57:00Z', location_unavailable_reason: null, location_observation_committed: true,
  action_location_assessment: { proximity: 'unverified', reasons: ['missing_tracker'], separation_metres: null } as unknown as ActionLocationAssessment,
}

const detail: CompletedSubstitutionDetail = {
  substitution_id: 'completed-transfer', request_id: pack.normalCompleted.id, sequence_number: 1,
  outgoing: pack.outgoingPending.outgoing, incoming: pack.outgoingPending.incoming,
  effective_at: '2026-10-20T10:00:00Z', completion_mode: 'dispatcher_attested', anchor_status: 'pending',
  receipt_id: null, phase_context: { phase_event_id: 'f8300000-0000-4000-8000-0000000000d1', phase_type: 'loading' },
  request_format: 'immediate_v2', required_confirmation_roles: ['incoming'],
  confirmation_policy: 'incoming_acceptance_v2', reason: 'Fixture relief', confirmations: [incomingCheck], artifacts: [], corrections: [{
    id: 'f8300000-0000-4000-8000-0000000000e1', substitution_id: 'completed-transfer', recorded_by_user_id: 'f8300000-0000-4000-8000-0000000000a1',
    recorded_by_name: ARRANGER, recorded_at: '2026-10-20T11:00:00Z', reason: 'Gate misnamed', correction_note: 'It was the second gate.',
    anchor_status: 'pending', receipt_id: null,
  }],
  arranged_by_user_id: 'f8300000-0000-4000-8000-0000000000a1', arranged_by_name: ARRANGER,
  completion: { trigger: 'dispatcher_action', completed_by_driver_id: null, completed_by_user_id: 'f8300000-0000-4000-8000-0000000000a2', completed_by_name: ATTESTER },
  identity_attestation: { attested_by_user_id: 'f8300000-0000-4000-8000-0000000000a2', attested_by_name: ATTESTER, reason: 'IDVS down', attested_at: '2026-10-20T09:59:30Z' },
  declared_exchange_at: '2026-10-20T09:55:00Z',
  missing_confirmation_reason: null, custody_integrity: { status: 'pending', amendment_count: 1, pending_anchor_count: 1, findings: ['Receipt still owed'] },
  outgoing_notices: [{ id: 'notice', request_id: 'request', trip_id: 'trip', kind: 'completed', created_at: '2026-10-20T10:00:00Z', read_at: null }],
}

beforeEach(() => vi.clearAllMocks())

function renderDetail(onChanged = vi.fn(), tripProp: Trip = trip) {
  render(<DriverTransferDetail trip={tripProp} substitutionId="completed-transfer" onChanged={onChanged} />)
}

it('prints_no_id_anywhere_and_names_every_person_and_vehicle', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  renderDetail()
  await screen.findByText(/Identity attested by/)

  expect(document.body.textContent).not.toMatch(UUID_SHAPE)
  expect(screen.getByText(`Identity attested by ${ATTESTER} at`, { exact: false })).toBeVisible()
  expect(screen.getByText('Arranged by').nextSibling).toHaveTextContent(ARRANGER)
  expect(screen.getByText('Completed by').nextSibling).toHaveTextContent(ATTESTER)
  expect(screen.getByText(/Anna Arranger ·/)).toBeVisible()
  expect(screen.getByText('Vehicles checked').nextSibling).toHaveTextContent(`${horse.registration}, ${trailer.registration}`)
  expect(screen.getByText(`Seal · ${horse.registration}`).nextSibling).toHaveTextContent('Intact · FP-1233')
  expect(screen.getByText(`Seal · ${trailer.registration}`).nextSibling).toHaveTextContent('No seal (empty leg) · Empty trailer')
})

it('names_the_incoming_driver_in_their_own_check_by_matching_the_id', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  renderDetail()

  const check = await screen.findByRole('region', { name: 'Incoming driver’s check' })

  expect(within(check).getByText('Driver').nextSibling).toHaveTextContent(detail.incoming.full_name)
})

it('writes_the_completion_phase_location_and_identity_in_plain_english', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  renderDetail()
  await screen.findByText(/Identity attested by/)

  expect(screen.getByText(/Completed by dispatcher/)).toBeVisible()
  expect(screen.getByText('During loading')).toBeVisible()
  expect(screen.getByText('Unable to compare: the truck tracker location was not available')).toBeVisible()
  expect(screen.getByText('Incoming driver’s identity').nextSibling).toHaveTextContent('Verified')
  expect(screen.queryByText(/dispatcher_attested|missing_tracker|unverified/)).toBeNull()
})

it('says_the_driver_was_not_asked_to_confirm_and_when_the_outgoing_notice_was_recorded', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  renderDetail()

  expect(await screen.findByText('Not requested — notification only')).toBeVisible()
  expect(screen.getByText(/Transfer completed, recorded .* · Unread/)).toBeVisible()
  expect(screen.getByText(/Notification delivery or read acknowledgement is not recorded as driver consent/)).toBeVisible()
})

it('shows_the_seal_state_the_integrity_chip_and_any_finding_in_red', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  renderDetail()

  const integrity = await screen.findByRole('region', { name: 'Record integrity' })

  expect(within(integrity).getByText('Sealing pending')).toBeVisible()
  expect(within(integrity).getByText('Anchoring pending')).toBeVisible()
  expect(within(integrity).getByText('Receipt still owed')).toHaveClass('text-err')
})

it('lists_clarifications_by_the_name_of_who_recorded_them', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  renderDetail()

  const section = await screen.findByRole('region', { name: 'Clarifications' })

  expect(within(section).getByText('Gate misnamed')).toBeVisible()
  expect(within(section).getByText('It was the second gate.')).toBeVisible()
})

it('falls_back_to_a_plain_word_when_a_name_is_not_available', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue({
    ...detail, arranged_by_name: null, completion: { ...detail.completion!, completed_by_name: null },
    identity_attestation: { ...detail.identity_attestation!, attested_by_name: null },
  })
  renderDetail()
  await screen.findByText(/Identity attested by/)

  expect(screen.getByText('Arranged by').nextSibling).toHaveTextContent('A dispatcher')
  expect(screen.getByText(/Identity attested by a dispatcher at/)).toBeVisible()
  expect(document.body.textContent).not.toMatch(UUID_SHAPE)
})

it('names_a_vehicle_the_trip_no_longer_carries_without_printing_its_id', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  renderDetail(vi.fn(), { ...trip, driver_substitutions: [] })
  await screen.findByText(/Identity attested by/)

  expect(screen.getAllByText(/Vehicle not on this trip/).length).toBeGreaterThan(0)
  expect(document.body.textContent).not.toMatch(UUID_SHAPE)
  expect(screen.getByText('Incoming driver’s identity').nextSibling).toHaveTextContent('Not recorded')
})

it('retries_failed_detail_reads_and_keeps_missing_historical_notifications_explicit', async () => {
  vi.mocked(getCompletedSubstitution).mockRejectedValueOnce(new Error('Temporary outage'))
    .mockResolvedValueOnce({ ...detail, outgoing_notices: [] })
  renderDetail()
  await userEvent.click(await screen.findByRole('button', { name: 'Retry transfer detail' }))
  expect(await screen.findByText('Outgoing notification facts not recorded.')).toBeVisible()
  expect(getCompletedSubstitution).toHaveBeenCalledTimes(2)
})

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function openClarificationForm() {
  await userEvent.click(await screen.findByRole('button', { name: 'Add clarification' }))
}

it('shows_a_skeleton_not_a_sentence_while_the_evidence_loads', () => {
  vi.mocked(getCompletedSubstitution).mockReturnValue(new Promise(() => {}))
  renderDetail()

  expect(screen.getByRole('status', { name: 'Loading transfer evidence' })).toBeInTheDocument()
})

it('moves_focus_to_the_first_field_when_the_clarification_form_opens', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  renderDetail()

  await openClarificationForm()

  expect(screen.getByLabelText('Reason')).toHaveFocus()
})

it('returns_focus_to_the_button_that_opened_the_form_when_it_is_closed_with_back', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  renderDetail()
  await openClarificationForm()

  await userEvent.click(screen.getByRole('button', { name: 'Back' }))

  expect(screen.getByRole('button', { name: 'Add clarification' })).toHaveFocus()
})

it('returns_focus_to_the_opening_button_after_a_clarification_is_saved', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  vi.mocked(correctSubstitution).mockResolvedValue(pack.clarification.pending)
  renderDetail()
  await openClarificationForm()
  fill('Reason', 'Label misspelt')
  fill('Clarification', 'It was the Engen.')

  await userEvent.click(screen.getByRole('button', { name: 'Add clarification' }))

  await waitFor(() => expect(screen.getByRole('button', { name: 'Add clarification' })).toHaveFocus())
})

it('posts_a_clarification_with_reason_and_note_then_refreshes_the_detail_and_the_trip', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  vi.mocked(correctSubstitution).mockResolvedValue(pack.clarification.pending)
  const onChanged = vi.fn()
  renderDetail(onChanged)
  await openClarificationForm()
  expect(screen.getByText(/It cannot change the drivers, the time or who holds the trip\./)).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Add clarification' })[0]).toBeDisabled()

  fill('Reason', 'Label misspelt')
  fill('Clarification', 'It was the Engen.')
  await userEvent.click(screen.getByRole('button', { name: 'Add clarification' }))

  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
  expect(correctSubstitution).toHaveBeenCalledWith(trip.id, 'completed-transfer', {
    client_request_id: expect.any(String), reason: 'Label misspelt', correction_note: 'It was the Engen.',
  })
  // The detail is read again, so the new clarification appears in its own list.
  await waitFor(() => expect(getCompletedSubstitution).toHaveBeenCalledTimes(2))
})

it('says_what_went_wrong_when_a_clarification_is_refused_and_keeps_the_form', async () => {
  vi.mocked(getCompletedSubstitution).mockResolvedValue(detail)
  const { body } = substitutionErrorFixtures.SUBSTITUTION_VERSION_CHANGED
  vi.mocked(correctSubstitution).mockRejectedValue(new ApiError(409, body.detail.message, body.detail))
  const onChanged = vi.fn()
  renderDetail(onChanged)
  await openClarificationForm()

  fill('Reason', 'Label misspelt')
  fill('Clarification', 'It was the Engen.')
  await userEvent.click(screen.getByRole('button', { name: 'Add clarification' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed this handover. It has been refreshed.')
  expect(screen.getByLabelText('Reason')).toHaveValue('Label misspelt')
  expect(onChanged).not.toHaveBeenCalled()
})
