import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { DriverSubstitutionFlow } from '../DriverSubstitutionFlow'
import { newCapture, useSubstitutionCapture } from '@/lib/hooks/useSubstitutionCapture'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
vi.mock('@/lib/hooks/useSubstitutionCapture', async (original) => ({ ...await original<typeof import('@/lib/hooks/useSubstitutionCapture')>(), useSubstitutionCapture: vi.fn() }))
vi.mock('@/lib/hooks/useDriverSubstitutions', () => ({ useDriverSubstitutions: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/phase/CameraCapture', () => ({ CameraCapture: () => null }))

test.each(['completed', 'cancelled'] as const)('fresh_completed_or_cancelled_context_beats_saved_pending (%s)', (terminal) => {
  const pending = pack.contextWithFindings
  const capture = newCapture(pending.incoming.id, pending, 'incoming')
  capture.status = 'saved'
  capture.result = pending
  const context = { ...pending, ...(terminal === 'completed' ? pack.normalCompleted : pack.cancelled), permitted_actions: [], confirmations: pending.confirmations }
  vi.mocked(useSubstitutionCapture).mockReturnValue({
    context, capture, role: 'incoming', submitted: null, problems: [], isLoading: false,
    loadError: null, isSending: false, storageError: false,
    update: vi.fn(), updateSealCheck: vi.fn(), addPhoto: vi.fn(), removePhoto: vi.fn(),
    submit: vi.fn(), retry: vi.fn(), refetch: vi.fn(),
  })
  render(<DriverSubstitutionFlow tripId={pending.trip_id} requestId={pending.id} actorId={pending.incoming.id} />)
  expect(screen.getAllByText(terminal === 'completed' ? /Handover complete/i : /cancelled/i).length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: /Confirm takeover/ })).not.toBeInTheDocument()
})
