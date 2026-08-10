// frontend/driver-pwa/components/phase/steps/unloading/__tests__/VisualCount.test.tsx
//
// Rewritten 2026-08-08 for two changes landing together:
//
// 1. This step is now gated on the warehouse's own destination scan (backend
//    GATED_PHASES[UNLOADING] = ScanDirection.IN) — while `phase.blocked_on` is set, the
//    driver has nothing to act on, and the confirm control must not be shown at all
//    (the server 409s a blocked completion regardless, PhaseBlockedError). Mirrors
//    loading/Linehaul.tsx's own wait screen — see components/phase/steps/__tests__/
//    linehaul.test.tsx for the sibling coverage this suite is modelled on.
//
// 2. The count itself is now OPTIONAL: a blank entry submits as `null` and is a valid
//    confirm, not a blocked one. Optional-to-type must never mean optional-to-wait —
//    the scan gate above still applies regardless of what the driver typed or left blank.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VisualCount } from '../VisualCount'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { UnloadingEvidence } from '@/lib/types/evidence-draft'

// StepHeader (rendered by the step) calls useRouter — stub it so the component mounts
// under jsdom, matching every other step-component suite.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// The blocked branch now renders WarehouseWaitCard, which reads useTrip() directly
// (see components/phase/WarehouseWaitCard.tsx) — this suite renders VisualCount bare,
// with no TripProvider ancestor, so the real hook (which throws outside one) has to be
// stubbed the same way linehaul.test.tsx already stubs it.
vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => ({ refreshQuietly: vi.fn(), isRefreshing: false, lastRefreshedAt: null }),
}))

function makeDraft(overrides: Partial<UnloadingEvidence> = {}): UnloadingEvidence {
  return {
    waybillHandedOver: null,
    sealNumberAtDestination: null,
    sealIntactPhotoDataUrl: null,
    sealIntactPhotoArtifactId: null,
    driverVisualCount: null,
    capturedAt: null,
    ...overrides,
  }
}

function typeCount(value: string) {
  fireEvent.change(screen.getByLabelText('Your visual count at destination'), { target: { value } })
}

function renderStep(overrides: {
  draft?: UnloadingEvidence
  phase?: ReturnType<typeof makePhase>
  onUpdate?: (patch: Partial<UnloadingEvidence>) => void
  onComplete?: () => void
} = {}) {
  const {
    draft = makeDraft(),
    phase = makePhase('unloading'),
    onUpdate = vi.fn(),
    onComplete = vi.fn(),
  } = overrides
  return render(
    <VisualCount
      tripId="t1"
      phase={phase}
      stepIndex={1}
      draft={draft}
      onUpdate={onUpdate}
      onComplete={onComplete}
    />,
  )
}

describe('VisualCount — scan gate (blocked_on)', () => {
  it('shows the waiting panel and hides the confirm control while blocked', () => {
    renderStep({ phase: { ...makePhase('unloading'), blocked_on: 'warehouse_scan' } })

    expect(screen.getByText(/waiting for the warehouse/i)).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Your visual count at destination')).not.toBeInTheDocument()
  })

  it('tells the driver no action is needed and that it unlocks on its own', () => {
    renderStep({ phase: { ...makePhase('unloading'), blocked_on: 'warehouse_scan' } })

    expect(screen.getByText(/unlock on its own/i)).toBeInTheDocument()
    expect(screen.getByText(/no action is needed/i)).toBeInTheDocument()
  })

  it('renders the count field and the confirm control once unblocked', () => {
    renderStep({ phase: makePhase('unloading', { blocked_on: null }) })

    expect(screen.getByLabelText('Your visual count at destination')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Confirm count' })).toBeInTheDocument()
  })

  it('treats a fixture with no blocked_on key at all as unblocked, not permanently blocked', () => {
    // `blocked_on` is optional on PhaseDescriptor — `phase.blocked_on !== null` alone
    // would read `undefined !== null` (true) and lock every driver out forever. The
    // component must coalesce to null first.
    const phaseWithoutField = { ...makePhase('unloading') }
    delete phaseWithoutField.blocked_on

    renderStep({ phase: phaseWithoutField })

    expect(screen.queryByText(/waiting for the warehouse/i)).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Confirm count' })).toBeInTheDocument()
  })
})

describe('VisualCount — optional count', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function completeSwipe() {
    const slider = screen.getByRole('slider', { name: 'Confirm count' })
    fireEvent.keyDown(slider, { key: 'Enter' }) // arm
    fireEvent.keyDown(slider, { key: 'Enter' }) // confirm
    act(() => {
      vi.advanceTimersByTime(180) // SwipeToConfirm's settle delay before handing off
    })
  }

  it('submits the typed count when one is entered', () => {
    const onUpdate = vi.fn()
    const onComplete = vi.fn()
    renderStep({ onUpdate, onComplete })

    typeCount('14')
    completeSwipe()

    expect(onUpdate).toHaveBeenCalledWith({ driverVisualCount: 14 })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('allows confirming with the count left empty, submitting null', () => {
    const onUpdate = vi.fn()
    const onComplete = vi.fn()
    renderStep({ onUpdate, onComplete })

    // Field is left untouched — the empty string is its initial state.
    expect(screen.getByRole('slider', { name: 'Confirm count' })).toHaveAttribute('aria-disabled', 'false')

    completeSwipe()

    expect(onUpdate).toHaveBeenCalledWith({ driverVisualCount: null })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('accepts zero as a legitimate count, not treated as empty', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeCount('0')
    completeSwipe()

    expect(onUpdate).toHaveBeenCalledWith({ driverVisualCount: 0 })
  })

  it('rejects a negative count — the swipe stays disabled', () => {
    renderStep()

    typeCount('-3')

    expect(screen.getByRole('slider', { name: 'Confirm count' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('clearing a previously entered count back to empty re-enables the swipe as null, not blocked', () => {
    renderStep({ draft: makeDraft({ driverVisualCount: 9 }) })

    typeCount('')

    expect(screen.getByRole('slider', { name: 'Confirm count' })).toHaveAttribute('aria-disabled', 'false')
  })
})

// F1 fence, scoped to this component's own suite (the shared regression fence lives in
// components/phase/steps/__tests__/visualCountBlindEntry.test.tsx). This is a BLIND
// entry: no h2Count-style prop, no expected/reference count, no mismatch banner — the
// server reconciles privately and returns only a verdict, elsewhere.
describe('VisualCount — F1 blind-entry fence', () => {
  const ORIGIN_COUNT = 517
  const DESTINATION_COUNT = 519
  const PRIOR_COUNT = 521

  function phaseWithCounts() {
    return makePhase('unloading', {
      parcel_count_origin: ORIGIN_COUNT,
      parcel_count_destination: DESTINATION_COUNT,
      driver_visual_count: PRIOR_COUNT,
    })
  }

  it('renders no reference count and no mismatch copy while unblocked, even when the phase carries every count', () => {
    renderStep({ phase: phaseWithCounts() })

    const body = document.body.textContent ?? ''
    for (const sentinel of [ORIGIN_COUNT, DESTINATION_COUNT, PRIOR_COUNT]) {
      expect(body).not.toContain(String(sentinel))
    }
    expect(screen.queryByText(/expected/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/mismatch/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/loaded at origin/i)).not.toBeInTheDocument()
  })

  it('renders no reference count while blocked either', () => {
    renderStep({ phase: { ...phaseWithCounts(), blocked_on: 'warehouse_scan' } })

    const body = document.body.textContent ?? ''
    for (const sentinel of [ORIGIN_COUNT, DESTINATION_COUNT, PRIOR_COUNT]) {
      expect(body).not.toContain(String(sentinel))
    }
  })
})
