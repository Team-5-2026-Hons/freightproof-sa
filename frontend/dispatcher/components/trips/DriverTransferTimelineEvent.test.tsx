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
  expect(screen.getByText('Completion mode not recorded · Anchor: not recorded')).toBeInTheDocument()
  expect(screen.getByText(/Effective/).getAttribute('dateTime')).toBe(event.effective_at)
})
