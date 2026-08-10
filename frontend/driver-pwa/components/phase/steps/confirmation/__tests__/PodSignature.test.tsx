// frontend/driver-pwa/components/phase/steps/confirmation/__tests__/PodSignature.test.tsx
//
// The step now records WHO received the delivery, not just that someone swiped. Two
// properties matter evidentially and are easy to break in opposite directions:
//
//   1. The swipe must not arm without a name and an ID number. An attestation that cannot
//      name its signer is the weakest possible proof of delivery.
//   2. A malformed ID number must NOT block. A receiver may present a passport or a
//      company registration number, and a mistyped digit is itself evidence of what was
//      produced at the door. The SA-ID shape check is advisory only — it renders as
//      helper text, never as a validation error, and never gates the swipe.
//
// Those two pull against each other, which is why both are fenced here.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PodSignature } from '../PodSignature'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

const TRIP_ID = '7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a1b'
const VALID_SA_ID = '9202204720082'
const RECIPIENT_NAME = 'Nomsa Dlamini'
const HINT = /not a 13 digit SA ID number/i
const SWIPE_LABEL = 'Swipe to digitally sign'

// StepHeader calls useRouter — stub it so the component mounts under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useArtifactUpload', () => ({
  useArtifactUpload: () => ({ uploadNow: vi.fn().mockResolvedValue(null) }),
}))
vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition: vi.fn().mockResolvedValue(null), recordHere: vi.fn() }),
}))
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: vi.fn() }),
}))

function makeDraft(overrides: Partial<ConfirmationEvidence> = {}): ConfirmationEvidence {
  return {
    podPhotoDataUrl: 'data:image/jpeg;base64,POD',
    podPhotoArtifactId: null,
    podSignatureDataUrl: null,
    podSignatureArtifactId: null,
    recipientName: null,
    recipientIdNumber: null,
    driverVisualCount: 31,
    reconciliationNote: null,
    capturedAt: null,
    ...overrides,
  }
}

function renderStep(draft: ConfirmationEvidence, onUpdate = vi.fn()) {
  render(
    <PodSignature
      tripId={TRIP_ID}
      phase={makePhase('confirmation')}
      stepIndex={1}
      draft={draft}
      onUpdate={onUpdate}
      onComplete={vi.fn()}
    />,
  )
  return { onUpdate }
}

describe('PodSignature — the receiver identity gate', () => {
  it('offers both identity fields before anything is signed', () => {
    renderStep(makeDraft())

    expect(screen.getByLabelText('Recipient full name')).toBeInTheDocument()
    expect(screen.getByLabelText('Recipient ID number')).toBeInTheDocument()
  })

  it('leaves the signing swipe disabled until both fields are filled', () => {
    renderStep(makeDraft({ recipientName: RECIPIENT_NAME }))

    expect(screen.getByRole('slider', { name: SWIPE_LABEL })).toHaveAttribute('aria-disabled', 'true')
  })

  it('arms the swipe once a name and an ID number are present', () => {
    renderStep(makeDraft({ recipientName: RECIPIENT_NAME, recipientIdNumber: VALID_SA_ID }))

    expect(screen.getByRole('slider', { name: SWIPE_LABEL })).toHaveAttribute('aria-disabled', 'false')
  })

  it('writes each field to the draft as it is typed, so a back-navigation keeps it', () => {
    const { onUpdate } = renderStep(makeDraft())

    fireEvent.change(screen.getByLabelText('Recipient full name'), { target: { value: RECIPIENT_NAME } })

    expect(onUpdate).toHaveBeenCalledWith({ recipientName: RECIPIENT_NAME })
  })
})

describe('PodSignature — the ID shape hint is advisory, never a block', () => {
  it('shows no hint for a well-formed SA ID number', () => {
    renderStep(makeDraft({ recipientName: RECIPIENT_NAME, recipientIdNumber: VALID_SA_ID }))

    expect(screen.queryByText(HINT)).toBeNull()
  })

  it('shows the hint for a passport number but still arms the swipe', () => {
    renderStep(makeDraft({ recipientName: RECIPIENT_NAME, recipientIdNumber: 'A01234567' }))

    expect(screen.getByText(HINT)).toBeInTheDocument()
    // The point of the whole module: a value that does not look like an SA ID is still
    // recorded. If this ever flips to disabled, evidence is being thrown away.
    expect(screen.getByRole('slider', { name: SWIPE_LABEL })).toHaveAttribute('aria-disabled', 'false')
  })

  it('says the value will be recorded as entered, rather than reading as a rejection', () => {
    renderStep(makeDraft({ recipientName: RECIPIENT_NAME, recipientIdNumber: '123' }))

    expect(screen.getByText(/still be recorded as entered/i)).toBeInTheDocument()
  })
})

describe('PodSignature — once signed', () => {
  it('replaces the identity fields with the attestation that already carries them', () => {
    renderStep(makeDraft({
      recipientName: RECIPIENT_NAME,
      recipientIdNumber: VALID_SA_ID,
      podSignatureDataUrl: 'data:image/png;base64,SIGNED',
    }))

    expect(screen.queryByLabelText('Recipient full name')).toBeNull()
    expect(screen.getByAltText('Digital proof of delivery')).toBeInTheDocument()
  })
})
