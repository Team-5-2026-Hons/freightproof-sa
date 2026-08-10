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
//      permanently disabled "Close trip" swipe with nothing on screen explaining why —
//      a delivered trip that could never be closed.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Closed } from '../Closed'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

const TRIP_ID = '7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a1b'
const SWIPE_LABEL = 'Close trip'

// StepHeader calls useRouter — stub it so the component mounts under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// Stubbed to a plain button exposing `disabled`, so these tests assert the GATE rather
// than SwipeToConfirm's pointer-drag internals (which have their own suite).
vi.mock('@/components/phase/SwipeToConfirm', () => ({
  SwipeToConfirm: ({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) => (
    <button onClick={onConfirm} disabled={disabled}>{label}</button>
  ),
}))

// The blocked branch now renders WarehouseWaitCard, which reads useTrip() directly
// (see components/phase/WarehouseWaitCard.tsx) — this suite renders Closed bare, with no
// TripProvider ancestor, so the real hook (which throws outside one) has to be stubbed
// the same way linehaul.test.tsx already stubs it.
vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => ({ refreshQuietly: vi.fn(), isRefreshing: false, lastRefreshedAt: null }),
}))

function makeDraft(overrides: Partial<ConfirmationEvidence> = {}): ConfirmationEvidence {
  return {
    podPhotoDataUrl: 'data:image/jpeg;base64,POD',
    podPhotoArtifactId: null,
    podSignatureDataUrl: 'data:image/png;base64,SIG',
    podSignatureArtifactId: null,
    recipientName: 'Nomsa Dlamini',
    recipientIdNumber: '9202204720082',
    driverVisualCount: 31,
    reconciliationNote: null,
    capturedAt: null,
    ...overrides,
  }
}

function renderStep(draft: ConfirmationEvidence, blockedOn: string | null = null) {
  render(
    <Closed
      tripId={TRIP_ID}
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
    // The regression. `null` here is a legitimate value, not missing data.
    const swipe = renderStep(makeDraft({ driverVisualCount: null }))

    expect(swipe).toBeEnabled()
  })

  it('arms the swipe when a count of zero was recorded', () => {
    // Zero is a real, flaggable observation (a fully pilfered load) and must not read as
    // "absent" to a falsy check — the exact bug a `!draft.driverVisualCount` gate creates.
    const swipe = renderStep(makeDraft({ driverVisualCount: 0 }))

    expect(swipe).toBeEnabled()
  })
})

describe('Closed — POD evidence stays mandatory', () => {
  it('blocks closure without the delivery photo', () => {
    const swipe = renderStep(makeDraft({ podPhotoDataUrl: null }))

    expect(swipe).toBeDisabled()
  })

  it('blocks closure without the receiver signature', () => {
    const swipe = renderStep(makeDraft({ podSignatureDataUrl: null }))

    expect(swipe).toBeDisabled()
  })

  it('arms the swipe once both POD artifacts exist', () => {
    const swipe = renderStep(makeDraft())

    expect(swipe).toBeEnabled()
  })
})

// GATED_PHASES[CONFIRMATION] = ScanDirection.IN (orchestration/phase_gate.py). The server
// 409s a blocked completion whatever this renders; the point of these is that the driver
// is told, rather than discovering it by swiping at the customer's gate after capturing
// the POD photo, the signature and the reconciliation.
describe('Closed — blocked on the destination warehouse scan', () => {
  it('hides the swipe entirely while the warehouse is still scanning in', () => {
    render(
      <Closed
        tripId={TRIP_ID}
        phase={makePhase('confirmation', { blocked_on: 'warehouse_scan' })}
        stepIndex={3}
        draft={makeDraft()}
        onComplete={vi.fn()}
      />,
    )

    // Hidden, not disabled — same choice as loading/Linehaul.tsx and
    // unloading/VisualCount.tsx, so a blocked screen offers no control at all.
    expect(screen.queryByRole('button', { name: SWIPE_LABEL })).toBeNull()
    expect(screen.getByText('Waiting for the warehouse')).toBeInTheDocument()
  })

  it('does not claim the trip is complete while blocked', () => {
    // The success tick and "Trip Complete" would be two false statements on a trip the
    // server will refuse to close.
    render(
      <Closed
        tripId={TRIP_ID}
        phase={makePhase('confirmation', { blocked_on: 'warehouse_scan' })}
        stepIndex={3}
        draft={makeDraft()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.queryByText('Trip Complete')).toBeNull()
  })

  it('restores the swipe once the warehouse session closes', () => {
    // blocked_on comes back null on the next poll — nothing else about the draft changed.
    const swipe = renderStep(makeDraft(), null)

    expect(swipe).toBeEnabled()
  })
})
