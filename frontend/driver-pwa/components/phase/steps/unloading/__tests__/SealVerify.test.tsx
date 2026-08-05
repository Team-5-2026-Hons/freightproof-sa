// frontend/driver-pwa/components/phase/steps/unloading/__tests__/SealVerify.test.tsx
//
// Moved from components/handshake/steps/__tests__/H4SealVerify.test.tsx. h2SealNumber is
// renamed to referenceSealNumber (the seal now comes from `departure`, not a same-trip
// "H2" concept — D7/T5), and the on-screen label/note copy that said "loading" now says
// "departure" to match. The behavioral contract under test (null reference is
// indeterminate, never a false mismatch) is unchanged.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SealVerify } from '../SealVerify'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { UnloadingEvidence } from '@/lib/types/evidence-draft'

// StepHeader (rendered by the step) calls useRouter — stub it so the component mounts
// under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// CameraCapture drives real native/browser camera APIs and needs a ToastProvider it has
// no business requiring of this suite — stubbed exactly as departure/CaptureSeal.test.tsx
// does, so these tests exercise SealVerify's own gating logic. CameraCapture has its own
// coverage in components/phase/__tests__/CameraCapture.test.tsx.
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture }: { label: string; onCapture: (dataUrl: string) => void }) => (
    <button onClick={() => onCapture(`data:image/jpeg;base64,${label}`)}>{label}</button>
  ),
}))

const MISMATCH_BANNER = 'Mismatch — this discrepancy will be recorded for review.'
const NULL_REFERENCE_NOTE = 'No seal is on record from departure. The number you enter will be recorded.'
const MATCH_BANNER = 'Seal matches — integrity confirmed'

function makeDraft(overrides: Partial<UnloadingEvidence> = {}): UnloadingEvidence {
  return {
    waybillHandedOver: null,
    sealNumberAtDestination: null,
    sealVerifiedMatch: null,
    // Defaulted to captured: most cases here exercise the seal-number logic, and an
    // absent photo would disable the swipe for reasons unrelated to what they assert.
    sealIntactPhotoDataUrl: 'data:image/jpeg;base64,SEAL',
    sealIntactPhotoArtifactId: null,
    sealBrokenPhotoDataUrl: null,
    driverVisualCount: null,
    capturedAt: null,
    ...overrides,
  }
}

function typeSeal(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Type the seal number you see'), {
    target: { value },
  })
}

function renderStep(overrides: {
  draft?: UnloadingEvidence
  referenceSealNumber?: string | null
  onUpdate?: (patch: Partial<UnloadingEvidence>) => void
} = {}) {
  const { draft = makeDraft(), referenceSealNumber = null, onUpdate = vi.fn() } = overrides
  return render(
    <SealVerify
      tripId="t1"
      phase={makePhase('unloading')}
      stepIndex={1}
      draft={draft}
      referenceSealNumber={referenceSealNumber}
      onUpdate={onUpdate}
      onComplete={vi.fn()}
    />,
  )
}

describe('SealVerify with a null reference seal', () => {
  it('does not show the mismatch banner', () => {
    renderStep()

    typeSeal('ABC123')

    expect(screen.queryByText(MISMATCH_BANNER)).not.toBeInTheDocument()
  })

  it('shows an informational note instead of flagging the driver', () => {
    renderStep()

    typeSeal('ABC123')

    expect(screen.getByText(NULL_REFERENCE_NOTE)).toBeInTheDocument()
  })

  it('persists sealVerifiedMatch as null (indeterminate), not false', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSeal('ABC123')

    expect(onUpdate).toHaveBeenLastCalledWith({
      sealNumberAtDestination: 'ABC123',
      sealVerifiedMatch: null,
    })
  })

  it('offers the non-punitive "Swipe to submit" label', () => {
    renderStep({ draft: makeDraft({ sealNumberAtDestination: 'ABC123' }) })

    expect(screen.getByText('Swipe to submit')).toBeInTheDocument()
  })

  it('renders the reference card without jargon or bold "Unknown", and calls it "departure"', () => {
    renderStep()

    expect(screen.getByText('Seal set at departure')).toBeInTheDocument()
    expect(screen.getByText('No seal on record')).toBeInTheDocument()
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  })
})

describe('SealVerify with a real reference seal', () => {
  it('confirms a match and keeps the submit label', () => {
    const onUpdate = vi.fn()
    renderStep({ referenceSealNumber: 'S1', onUpdate })

    typeSeal('S1')

    expect(screen.getByText(MATCH_BANNER)).toBeInTheDocument()
    expect(screen.getByText('Swipe to submit')).toBeInTheDocument()
    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberAtDestination: 'S1', sealVerifiedMatch: true })
  })

  it('flags a true mismatch with the flag label and records it', () => {
    const onUpdate = vi.fn()
    renderStep({ referenceSealNumber: 'S1', onUpdate })

    typeSeal('ABC123')

    expect(screen.getByText(MISMATCH_BANNER)).toBeInTheDocument()
    expect(screen.getByText('Swipe to flag')).toBeInTheDocument()
    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberAtDestination: 'ABC123', sealVerifiedMatch: false })
  })
})

// The intact seal photo satisfies UnloadingCompleteRequest.gate_photo_artifact_id, which
// is a required UUID. Letting the driver past this step without it means a guaranteed 422
// three steps later — by which point the seal is broken and the photo is unobtainable.
describe('SealVerify intact seal photo gate', () => {
  it('blocks the swipe when the seal number is valid but no photo has been taken', () => {
    renderStep({
      draft: makeDraft({ sealNumberAtDestination: 'AB-1234', sealIntactPhotoDataUrl: null }),
    })

    typeSeal('AB-1234')

    expect(screen.getByRole('slider', { name: 'Swipe to submit' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('allows the swipe once both the seal number and the photo are present', () => {
    renderStep({ draft: makeDraft({ sealNumberAtDestination: 'AB-1234' }) })

    typeSeal('AB-1234')

    expect(screen.getByRole('slider', { name: 'Swipe to submit' })).toHaveAttribute('aria-disabled', 'false')
  })

  // A mismatch is a recorded discrepancy, not a blocked submission — but it is still an
  // unloading, so it needs the same photographic evidence a clean one does.
  it('blocks the flag path too when the photo is missing', () => {
    renderStep({
      referenceSealNumber: 'AB-9999',
      draft: makeDraft({ sealIntactPhotoDataUrl: null }),
    })

    typeSeal('AB-1234')

    expect(screen.getByRole('slider', { name: 'Swipe to flag' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('tells the driver to photograph the seal before it is broken', () => {
    renderStep()

    expect(screen.getByText(/before the warehouse breaks it/)).toBeInTheDocument()
  })
})
