// frontend/driver-pwa/components/phase/steps/in_transit/__tests__/Arrival.test.tsx
//
// Moved from components/handshake/steps/__tests__/H4ApproachDest.test.tsx. The
// draft shape shrank: the old H4Evidence carried sealNumberAtDestination/sealVerifiedMatch
// too, but this component only ever read/wrote gpsLat/gpsLng/capturedAt — those seal
// fields belonged to the OLD fixed model's single H4 handshake draft, not to this
// component's own behavior, and now live on UnloadingEvidence instead (a different phase's
// draft entirely). ArrivalDraft (in_transit's local type, see Arrival.tsx) reflects only
// what this component actually uses.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Arrival, type ArrivalDraft } from '../Arrival'
import { makePhase } from '@/components/phase/__tests__/testFixtures'

// StepHeader (rendered by the step) calls useRouter — stub it so the component mounts
// under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// Task 2b: raw lat/lng coordinates are noise to a driver — GpsCapture's "Location captured"
// receipt is the whole confirmation they need. Coordinates must remain in the draft (backend
// still needs them) but must not be printed as text on the step.

const GPS_LAT = -33.918861
const GPS_LNG = 18.4233

function makeDraft(overrides: Partial<ArrivalDraft> = {}): ArrivalDraft {
  return {
    gpsLat: null,
    gpsLng: null,
    capturedAt: null,
    ...overrides,
  }
}

describe('Arrival', () => {
  it('does not render raw GPS coordinates as text once captured', () => {
    render(
      <Arrival
        tripId="t1"
        phase={makePhase('in_transit')}
        stepIndex={0}
        draft={makeDraft({ gpsLat: GPS_LAT, gpsLng: GPS_LNG })}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText('Location captured')).toBeInTheDocument()
    expect(screen.queryByText(GPS_LAT.toFixed(5), { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText(GPS_LNG.toFixed(5), { exact: false })).not.toBeInTheDocument()
  })
})
