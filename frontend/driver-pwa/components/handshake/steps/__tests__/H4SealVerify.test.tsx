// frontend/driver-pwa/components/handshake/steps/__tests__/H4SealVerify.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { H4SealVerify } from '../H4SealVerify'
import type { H4Evidence } from '@/lib/types/evidence-draft'

// StepHeader (rendered by the step) calls useRouter and useParams — stub both so the
// component mounts under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ h: '4', slug: '3-seal-verify' }),
}))

// Task 2a: a null H2 reference seal (a data gap at loading, not the driver's fault) must not
// render the red "Mismatch" flag against every entry. It should record the driver's number as
// indeterminate (sealVerifiedMatch: null) and offer a non-punitive submit path.

const MISMATCH_BANNER = 'Mismatch — this discrepancy will be recorded for review.'
const NULL_REFERENCE_NOTE = 'No seal is on record from loading. The number you enter will be recorded.'
const MATCH_BANNER = 'Seal matches — integrity confirmed'

function makeDraft(overrides: Partial<H4Evidence> = {}): H4Evidence {
  return {
    gpsLat: null,
    gpsLng: null,
    gatePhotoDataUrl: null,
    sealNumberAtDestination: null,
    sealVerifiedMatch: null,
    capturedAt: null,
    ...overrides,
  }
}

function typeSeal(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Type the seal number you see'), {
    target: { value },
  })
}

describe('H4SealVerify with a null reference seal', () => {
  it('does not show the mismatch banner', () => {
    render(
      <H4SealVerify tripId="t1" draft={makeDraft()} h2SealNumber={null} onUpdate={vi.fn()} onComplete={vi.fn()} />,
    )

    typeSeal('ABC123')

    expect(screen.queryByText(MISMATCH_BANNER)).not.toBeInTheDocument()
  })

  it('shows an informational note instead of flagging the driver', () => {
    render(
      <H4SealVerify tripId="t1" draft={makeDraft()} h2SealNumber={null} onUpdate={vi.fn()} onComplete={vi.fn()} />,
    )

    typeSeal('ABC123')

    expect(screen.getByText(NULL_REFERENCE_NOTE)).toBeInTheDocument()
  })

  it('persists sealVerifiedMatch as null (indeterminate), not false', () => {
    const onUpdate = vi.fn()
    render(
      <H4SealVerify tripId="t1" draft={makeDraft()} h2SealNumber={null} onUpdate={onUpdate} onComplete={vi.fn()} />,
    )

    typeSeal('ABC123')

    expect(onUpdate).toHaveBeenLastCalledWith({
      sealNumberAtDestination: 'ABC123',
      sealVerifiedMatch: null,
    })
  })

  it('offers the non-punitive "Hold to submit" label', () => {
    render(
      <H4SealVerify tripId="t1" draft={makeDraft({ sealNumberAtDestination: 'ABC123' })} h2SealNumber={null} onUpdate={vi.fn()} onComplete={vi.fn()} />,
    )

    expect(screen.getByText('Hold to submit')).toBeInTheDocument()
  })

  it('renders the reference card without jargon or bold "Unknown"', () => {
    render(
      <H4SealVerify tripId="t1" draft={makeDraft()} h2SealNumber={null} onUpdate={vi.fn()} onComplete={vi.fn()} />,
    )

    expect(screen.getByText('Seal set at loading')).toBeInTheDocument()
    expect(screen.getByText('No seal on record')).toBeInTheDocument()
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  })
})

describe('H4SealVerify with a real reference seal', () => {
  it('confirms a match and keeps the submit label', () => {
    const onUpdate = vi.fn()
    render(
      <H4SealVerify tripId="t1" draft={makeDraft()} h2SealNumber="S1" onUpdate={onUpdate} onComplete={vi.fn()} />,
    )

    typeSeal('S1')

    expect(screen.getByText(MATCH_BANNER)).toBeInTheDocument()
    expect(screen.getByText('Hold to submit')).toBeInTheDocument()
    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberAtDestination: 'S1', sealVerifiedMatch: true })
  })

  it('flags a true mismatch with the flag label and records it', () => {
    const onUpdate = vi.fn()
    render(
      <H4SealVerify tripId="t1" draft={makeDraft()} h2SealNumber="S1" onUpdate={onUpdate} onComplete={vi.fn()} />,
    )

    typeSeal('ABC123')

    expect(screen.getByText(MISMATCH_BANNER)).toBeInTheDocument()
    expect(screen.getByText('Hold to flag')).toBeInTheDocument()
    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberAtDestination: 'ABC123', sealVerifiedMatch: false })
  })
})
