// frontend/driver-pwa/components/handshake/steps/__tests__/H4ApproachDest.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { H4ApproachDest } from '../H4ApproachDest'
import type { H4Evidence } from '@/lib/types/evidence-draft'

// StepHeader (rendered by the step) calls useRouter and useParams — stub both so the
// component mounts under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ h: '4', slug: '1-approach-dest' }),
}))

// Task 2b: raw lat/lng coordinates are noise to a driver — GpsCapture's "Location captured"
// receipt is the whole confirmation they need. Coordinates must remain in the draft (backend
// still needs them) but must not be printed as text on the step.

const GPS_LAT = -33.918861
const GPS_LNG = 18.4233

function makeDraft(overrides: Partial<H4Evidence> = {}): H4Evidence {
  return {
    gpsLat: null,
    gpsLng: null,
    sealNumberAtDestination: null,
    sealVerifiedMatch: null,
    capturedAt: null,
    ...overrides,
  }
}

describe('H4ApproachDest', () => {
  it('does not render raw GPS coordinates as text once captured', () => {
    render(
      <H4ApproachDest
        tripId="t1"
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
