// frontend/driver-pwa/components/phase/steps/confirmation/__tests__/Closed.test.tsx
//
// The last gate on the whole trip. Two properties pull against each other here, which is
// why both are fenced:
//
//   1. POD evidence is mandatory. A trip must not be closable without the delivery photo
//      and the receiver's signature — closing without them would record a delivery this
//      platform cannot actually evidence.
//   2. The driver's visual count is NOT mandatory, and must never gate this screen. Since
//      the scan-driven redesign (2026-08-08) the count is optional at unloading and at
//      confirmation, so `null` legitimately carries all the way to this step. It used to
//      be part of `isReady`, which meant a driver who skipped the count reached a
//      permanently disabled "Close Trip" swipe with nothing on screen explaining why —
//      a delivered trip that could never be closed.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Closed } from '../Closed'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

const SWIPE_LABEL = 'Swipe to Close Trip'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/components/phase/SwipeToConfirm', () => ({
  SwipeToConfirm: ({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) => (
    <button onClick={onConfirm} disabled={disabled}>{label}</button>
  ),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => ({ refreshQuietly: vi.fn(), isRefreshing: false, lastRefreshedAt: null }),
}))

function makeDraft(overrides: Partial<ConfirmationEvidence> = {}): ConfirmationEvidence {
  return {
    podPhotoDataUrl: 'data:image/jpeg;base64,POD',
    podPhotoArtifactId: null,
    podSignatureArtifactId: 'receiver-signature-artifact',
    receiverConfirmedAt: '2026-09-13T10:05:00.000Z',
    driverVisualCount: 31,
    reconciliationNote: null,
    capturedAt: null,
    ...overrides,
  }
}

function renderStep(draft: ConfirmationEvidence, blockedOn: string | null = null) {
  render(
    <Closed
      phase={makePhase('confirmation', { blocked_on: blockedOn })}
      stepIndex={3}
      draft={draft}
      onComplete={vi.fn()}
    />,
  )
  return screen.getByRole('button', { name: SWIPE_LABEL })
}

describe('Closed — the visual count must not gate trip closure', () => {
  it('arms the swipe when the driver skipped the visual count entirely', () => {
    const swipe = renderStep(makeDraft({ driverVisualCount: null }))

    expect(swipe).toBeEnabled()
  })

  it('arms the swipe when a count of zero was recorded', () => {
    const swipe = renderStep(makeDraft({ driverVisualCount: 0 }))

    expect(swipe).toBeEnabled()
  })
})

describe('Closed — POD evidence stays mandatory', () => {
  it('blocks closure without the delivery photo', () => {
    const swipe = renderStep(makeDraft({ podPhotoDataUrl: null }))

    expect(swipe).toBeDisabled()
  })

  it('blocks closure until the receiver has confirmed', () => {
    const swipe = renderStep(makeDraft({ podSignatureArtifactId: null }))

    expect(swipe).toBeDisabled()
  })

  it('arms the swipe once both POD artifacts exist', () => {
    const swipe = renderStep(makeDraft())

    expect(swipe).toBeEnabled()
  })
})

describe('Closed — blocked on the destination warehouse scan', () => {
  it('hides the swipe entirely while the warehouse is still scanning in', () => {
    render(
      <Closed
        phase={makePhase('confirmation', { blocked_on: 'warehouse_scan' })}
        stepIndex={3}
        draft={makeDraft()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: SWIPE_LABEL })).toBeNull()
    expect(screen.getByText('Waiting for the warehouse')).toBeInTheDocument()
  })

  it('does not claim the trip is complete while blocked', () => {
    render(
      <Closed
        phase={makePhase('confirmation', { blocked_on: 'warehouse_scan' })}
        stepIndex={3}
        draft={makeDraft()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.queryByText('Delivered')).toBeNull()
  })

  it('restores the swipe once the warehouse session closes', () => {
    const swipe = renderStep(makeDraft(), null)

    expect(swipe).toBeEnabled()
  })
})

describe('Closed — the delivered screen (overhaul 9.5)', () => {
  it('test_says_delivered_and_that_closing_finishes_the_trip', () => {
    renderStep(makeDraft())

    expect(screen.getByRole('heading', { level: 1, name: 'Delivered' })).toBeInTheDocument()
    expect(screen.getByText(/Close the trip to finish/)).toBeInTheDocument()
  })
})
