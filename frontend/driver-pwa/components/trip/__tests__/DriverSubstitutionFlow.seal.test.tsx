import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { DriverSubstitutionContextRead } from '@shared/lib/types/driver-substitution'
import type { PhaseType } from '@shared/lib/types/phase'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import { DriverSubstitutionFlow } from '../DriverSubstitutionFlow'
import { captureProblems, newCapture, useSubstitutionCapture } from '@/lib/hooks/useSubstitutionCapture'

vi.mock('@/lib/hooks/useSubstitutionCapture', async (original) => ({ ...await original<typeof import('@/lib/hooks/useSubstitutionCapture')>(), useSubstitutionCapture: vi.fn() }))
vi.mock('@/lib/hooks/useDriverSubstitutions', () => ({ useDriverSubstitutions: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/phase/CameraCapture', () => ({ CameraCapture: () => null }))

function renderTakeoverAt(phase: PhaseType | null) {
  const context: DriverSubstitutionContextRead = { ...pack.contextWithFindings, current_phase: phase }
  const capture = newCapture(context.incoming.id, context, 'incoming')
  vi.mocked(useSubstitutionCapture).mockReturnValue({
    context, capture, role: 'incoming', submitted: null, problems: captureProblems(capture, context.vehicles), isLoading: false,
    loadError: null, isSending: false, storageError: false,
    update: vi.fn(), updateSealCheck: vi.fn(), addPhoto: vi.fn(), removePhoto: vi.fn(),
    submit: vi.fn(), retry: vi.fn(), refetch: vi.fn(),
  })
  render(<DriverSubstitutionFlow tripId={context.trip_id} requestId={context.id} actorId={context.incoming.id} />)
}

describe('takeover seal check follows the ledger position', () => {
  test.each<PhaseType>(['activation', 'loading'])('before departure (%s): "no seal yet" is explained and pre-selected', (phase) => {
    renderTakeoverAt(phase)

    expect(screen.getByText('No seal to check yet')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'No seal yet' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('radio', { name: /empty leg/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Record the seal on/)).not.toBeInTheDocument()
    expect(screen.getByText(/Confirm every vehicle/)).toBeInTheDocument()
  })

  test.each<PhaseType>(['in_transit', 'unloading'])('after departure (%s): the seal must be read and the empty-leg option keeps its name', (phase) => {
    renderTakeoverAt(phase)

    expect(screen.queryByText('No seal to check yet')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'No seal (empty leg)' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Intact' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Record the seal on FIX 002 GP')).toBeInTheDocument()
  })

  test('departure still open: the driver is told to decide, nothing is pre-selected', () => {
    renderTakeoverAt('departure')

    expect(screen.getByText('Departure is still open')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'No seal yet' })).toHaveAttribute('aria-checked', 'false')
  })

  test('no ledger position: no claim is made either way', () => {
    renderTakeoverAt(null)

    expect(screen.queryByText('No seal to check yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Departure is still open')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'No seal (empty leg)' })).toHaveAttribute('aria-checked', 'false')
  })
})
