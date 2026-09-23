// frontend/driver-pwa/components/phase/steps/arrival/__tests__/SealVerify.test.tsx
//
// Ported from the deleted components/phase/steps/unloading/__tests__/SealVerify.test.tsx
// (design note 2026-09-23): the seal-at-arrival check moved from unloading to its own
// arrival phase, so the seal is now photographed BEFORE the doors open, not after the
// warehouse breaks it. The blinding contract carries over unchanged — no reference card,
// no verdict, a neutral swipe label in every condition — plus new coverage for the
// tri-state seal_condition choice this component adds: 'missing' hides the number
// requirement but never relaxes the photo requirement.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SealVerify } from '../SealVerify'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { ArrivalEvidence } from '@/lib/types/evidence-draft'

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

function makeDraft(overrides: Partial<ArrivalEvidence> = {}): ArrivalEvidence {
  return {
    sealCondition: null,
    sealNumberAtArrival: null,
    // Defaulted to captured: most cases here exercise the condition/number logic, and an
    // absent photo would disable the swipe for reasons unrelated to what they assert.
    sealPhotoDataUrl: 'data:image/jpeg;base64,SEAL',
    sealPhotoArtifactId: null,
    capturedAt: null,
    ...overrides,
  }
}

function typeSeal(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Type the seal number you see'), {
    target: { value },
  })
}

function chooseCondition(label: 'Intact' | 'Damaged' | 'Missing') {
  fireEvent.click(screen.getByRole('radio', { name: label }))
}

function renderStep(overrides: {
  draft?: ArrivalEvidence
  onUpdate?: (patch: Partial<ArrivalEvidence>) => void
} = {}) {
  const { draft = makeDraft(), onUpdate = vi.fn() } = overrides
  return render(
    <SealVerify
      tripId="t1"
      phase={makePhase('arrival')}
      stepIndex={0}
      draft={draft}
      onUpdate={onUpdate}
      onComplete={vi.fn()}
    />,
  )
}

describe('arrival SealVerify — blind entry', () => {
  it('never shows the seal set at departure', () => {
    renderStep()

    expect(screen.queryByText('Seal set at departure')).not.toBeInTheDocument()
    expect(screen.queryByText('No seal on record')).not.toBeInTheDocument()
  })

  it('shows no verdict once a seal number has been typed', () => {
    renderStep()

    chooseCondition('Intact')
    typeSeal('AB-1234')

    // Neither direction: telling the driver they matched is as leaky as telling them
    // they did not, and "no seal on record" would leak that a reference exists at all.
    expect(screen.queryByText(/Seal matches/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Mismatch/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No seal is on record/)).not.toBeInTheDocument()
  })

  it('always offers the neutral "Swipe to submit" label, never "Swipe to flag"', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'AB-1234' }) })

    expect(screen.getByText('Swipe to submit')).toBeInTheDocument()
    expect(screen.queryByText('Swipe to flag')).not.toBeInTheDocument()
  })

  it('offers the same neutral label when the seal is damaged or missing', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'damaged', sealNumberAtArrival: 'AB-1234' }) })
    expect(screen.getByText('Swipe to submit')).toBeInTheDocument()

    renderStep({ draft: makeDraft({ sealCondition: 'missing', sealNumberAtArrival: null }) })
    expect(screen.getAllByText('Swipe to submit').length).toBeGreaterThan(0)
  })

  it('records only the number typed, with no client-side verdict alongside it', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSeal('ab-1234')

    // Uppercased on the way in (the backend's format check accepts only uppercase).
    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberAtArrival: 'AB-1234' })
  })

  it('trims stray whitespace so the submitted value matches what the format gate validated', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSeal(' ab-1234 ')

    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberAtArrival: 'AB-1234' })
  })
})

describe('arrival SealVerify — seal condition choice', () => {
  it('blocks the swipe until a condition is chosen', () => {
    renderStep({ draft: makeDraft({ sealCondition: null, sealNumberAtArrival: 'AB-1234' }) })

    expect(screen.getByRole('slider', { name: 'Swipe to submit' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('marks the chosen condition as checked and the others as not', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'damaged' }) })

    expect(screen.getByRole('radio', { name: 'Damaged' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Intact' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Missing' })).toHaveAttribute('aria-checked', 'false')
  })

  it('updates the condition on tap', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    chooseCondition('Damaged')

    expect(onUpdate).toHaveBeenCalledWith({ sealCondition: 'damaged' })
  })
})

describe('arrival SealVerify — seal number format gate', () => {
  it('shows the format hint once an invalid seal number has been typed', () => {
    renderStep()

    chooseCondition('Intact')
    typeSeal('nope')

    expect(screen.getByText(/must look like AB-1234/)).toBeInTheDocument()
  })

  it('blocks the swipe on a badly formatted seal number', () => {
    renderStep()

    chooseCondition('Intact')
    typeSeal('nope')

    expect(screen.getByRole('slider', { name: 'Swipe to submit' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('requires the number for a damaged seal, exactly as for an intact one', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'damaged', sealNumberAtArrival: null }) })

    expect(screen.getByRole('slider', { name: 'Swipe to submit' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('arrival SealVerify — missing seal', () => {
  it('hides the seal number input once "Missing" is chosen', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'missing' }) })

    expect(screen.queryByPlaceholderText('Type the seal number you see')).not.toBeInTheDocument()
  })

  it('clears any previously typed seal number when the driver switches to "Missing"', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate, draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'AB-1234' }) })

    chooseCondition('Missing')

    expect(onUpdate).toHaveBeenCalledWith({ sealCondition: 'missing', sealNumberAtArrival: null })
  })

  it('allows the swipe with no number once the seal is missing and the photo is present', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'missing', sealNumberAtArrival: null }) })

    expect(screen.getByRole('slider', { name: 'Swipe to submit' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('still requires the photo when the seal is missing', () => {
    renderStep({
      draft: makeDraft({ sealCondition: 'missing', sealNumberAtArrival: null, sealPhotoDataUrl: null }),
    })

    expect(screen.getByRole('slider', { name: 'Swipe to submit' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('tells the driver to photograph where the seal should be', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'missing' }) })

    expect(screen.getByText(/Photograph where the seal should be/)).toBeInTheDocument()
  })
})

// The photo satisfies ArrivalCompleteRequest.seal_photo_artifact_id, which is a required
// UUID in every condition (design note §4.2: a missing seal is photographed as a missing
// seal). Letting the driver past this step without it means a guaranteed 422.
describe('arrival SealVerify seal photo gate', () => {
  it('blocks the swipe when the seal number is valid but no photo has been taken', () => {
    renderStep({
      draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'AB-1234', sealPhotoDataUrl: null }),
    })

    expect(screen.getByRole('slider', { name: 'Swipe to submit' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('allows the swipe once condition, number and photo are all present', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'AB-1234' }) })

    expect(screen.getByRole('slider', { name: 'Swipe to submit' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('records the captured photo and clears any stale artifact id', () => {
    const onUpdate = vi.fn()
    renderStep({ draft: makeDraft({ sealPhotoDataUrl: null }), onUpdate })

    fireEvent.click(screen.getByText('Seal photo'))

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sealPhotoDataUrl: 'data:image/jpeg;base64,Seal photo',
      sealPhotoArtifactId: null,
    }))
  })

  it('tells the driver to photograph the seal as found, before the doors open', () => {
    renderStep()

    expect(screen.getByText(/Before anything is opened/)).toBeInTheDocument()
  })
})
