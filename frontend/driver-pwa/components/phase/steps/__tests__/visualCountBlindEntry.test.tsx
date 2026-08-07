// frontend/driver-pwa/components/phase/steps/__tests__/visualCountBlindEntry.test.tsx
//
// The F1 fence, under test. F1 is a domain rule, not a styling preference: the driver must
// never be shown an expected or reference cargo count before committing their own, because
// a count entered while the expected number is on screen proves nothing about what the
// driver actually saw. The server reconciles the counts privately and returns only a verdict.
//
// unloading/VisualCount is a BLIND entry. The old H5VisualCount violated this — it took an
// `h2Count` prop and rendered a reference card plus a mismatch banner against it. That prop
// and banner were removed in the phase refactor, and this suite exists so they cannot come
// back unnoticed: a `PhaseDescriptor` carrying real counts is passed in, and the test fails
// if any of those numbers reaches the DOM.
//
// loading's own blind-entry half is gone (2026-08-05): loading/VisualCount.tsx was replaced
// by loading/Linehaul.tsx, a read-only review of the driver-safe linehaul document rather
// than a driver-entered count — see components/phase/steps/__tests__/linehaul.test.tsx for
// its equivalent "never shows per-parcel data" fence.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { VisualCount as UnloadingVisualCount } from '../unloading/VisualCount'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { UnloadingEvidence } from '@/lib/types/evidence-draft'

// StepHeader calls useRouter — stub it so the steps mount under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// Deliberately distinctive three-digit sentinels: high enough not to collide with step
// indices, sequence numbers, or anything in the fixture's ISO dates, so a match in the
// rendered output can only have come from a count being displayed.
const ORIGIN_COUNT = 417
const DESTINATION_COUNT = 419
const PRIOR_DRIVER_COUNT = 421

// A phase descriptor that KNOWS all three counts. If the component ever reads a count
// off the phase (or off a reintroduced reference prop) and renders it, these numbers appear.
const phaseWithCounts = () =>
  makePhase('unloading', {
    parcel_count_origin: ORIGIN_COUNT,
    parcel_count_destination: DESTINATION_COUNT,
    driver_visual_count: PRIOR_DRIVER_COUNT,
  })

const unloadingDraft: UnloadingEvidence = {
  waybillHandedOver: null,
  sealNumberAtDestination: null,
  sealIntactPhotoDataUrl: null,
  sealIntactPhotoArtifactId: null,
  driverVisualCount: null,
  capturedAt: null,
}

// Any digit sequence that would betray a leaked reference value.
const COUNT_SENTINELS = [ORIGIN_COUNT, DESTINATION_COUNT, PRIOR_DRIVER_COUNT]

// Phrases the old reference/mismatch UI used, plus the generic shapes a well-meaning
// future change might reach for.
const FORBIDDEN_REFERENCE_COPY = [
  /loaded at origin/i,
  /expected/i,
  /mismatch/i,
  /does not match/i,
  /parcel perfect/i,
  /scan[- ]?in/i,
]

function expectNoCountLeak() {
  const body = document.body.textContent ?? ''

  COUNT_SENTINELS.forEach((sentinel) => {
    expect(body).not.toContain(String(sentinel))
  })

  FORBIDDEN_REFERENCE_COPY.forEach((pattern) => {
    expect(screen.queryByText(pattern)).not.toBeInTheDocument()
  })
}

describe('F1 — unloading/VisualCount is a blind entry', () => {
  it('renders no reference count and no mismatch banner even when the phase carries every count', () => {
    render(
      <UnloadingVisualCount
        tripId="t1"
        phase={phaseWithCounts()}
        stepIndex={3}
        draft={unloadingDraft}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expectNoCountLeak()
  })

  it('still offers the driver their own destination count field', () => {
    render(
      <UnloadingVisualCount
        tripId="t1"
        phase={phaseWithCounts()}
        stepIndex={3}
        draft={unloadingDraft}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Your visual count at destination')).toBeInTheDocument()
  })
})
