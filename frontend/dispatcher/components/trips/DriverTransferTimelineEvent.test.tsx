import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import { DriverTransferTimelineEvent } from './DriverTransferTimelineEvent'

const event: CompletedSubstitutionSummary = {
  substitution_id: 'completed-transfer', request_id: null, sequence_number: 1,
  outgoing: pack.outgoingPending.outgoing, incoming: pack.outgoingPending.incoming,
  effective_at: '2026-10-20T10:00:00Z', completion_mode: null, anchor_status: null,
  receipt_id: null, phase_context: null, request_format: null, required_confirmation_roles: null,
  confirmation_policy: null,
}

it('opens_the_completed_detail_from_the_keyboard_without_a_phase_action', async () => {
  const user = userEvent.setup()
  const open = vi.fn()
  render(<DriverTransferTimelineEvent event={event} onOpen={open} />)

  await user.tab()
  expect(screen.getByRole('button')).toHaveFocus()
  await user.keyboard('{Enter}')

  expect(open).toHaveBeenCalledExactlyOnceWith(event.substitution_id)
  expect(screen.getAllByRole('button')).toHaveLength(1)
})

it('keeps_legacy_unknown_facts_and_equal_times_explicit', () => {
  render(<DriverTransferTimelineEvent event={event} onOpen={vi.fn()} sameRecordedTime />)

  expect(screen.getByText('Same recorded time')).toBeInTheDocument()
  expect(screen.getByText('Not recorded · Not recorded')).toBeInTheDocument()
  const clock = screen.getByLabelText(/^Effective /)
  expect(clock.tagName).toBe('TIME')
  expect(clock.getAttribute('dateTime')).toBe(event.effective_at)
})

it('writes_the_mode_and_seal_in_plain_english', () => {
  render(<DriverTransferTimelineEvent event={{ ...event, completion_mode: 'dispatcher_attested', anchor_status: 'anchored' }} onOpen={vi.fn()} />)

  expect(screen.getByText('Completed by dispatcher · Sealed on Hedera')).toBeInTheDocument()
  expect(screen.queryByText(/dispatcher_attested|dispatcher attested|Anchor:/)).toBeNull()
})

it('tells_a_legacy_two_confirmation_transfer_from_an_incoming_only_acceptance', () => {
  const { rerender } = render(<DriverTransferTimelineEvent event={{ ...event, completion_mode: 'normal', anchor_status: 'anchored', request_format: 'planned_v1' }} onOpen={vi.fn()} />)
  expect(screen.getByText('Both drivers confirmed · Sealed on Hedera')).toBeInTheDocument()

  rerender(<DriverTransferTimelineEvent event={{ ...event, completion_mode: 'normal', anchor_status: 'anchored', request_format: 'immediate_v2' }} onOpen={vi.fn()} />)
  expect(screen.getByText('Driver accepted · Sealed on Hedera')).toBeInTheDocument()
})

it('describes_the_card_by_its_outcome_since_its_name_hides_the_text', () => {
  render(<DriverTransferTimelineEvent event={{ ...event, completion_mode: 'dispatcher_attested', anchor_status: 'anchored' }} onOpen={vi.fn()} />)

  expect(screen.getByRole('button')).toHaveAccessibleDescription('Completed by dispatcher · Sealed on Hedera')
})
