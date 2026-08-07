// frontend/driver-pwa/components/phase/steps/unloading/__tests__/SealVerify.test.tsx
//
// Rewritten 2026-08-05, when the step was BLINDED. It previously showed the seal set at
// departure as a reference card and rendered a live match / mismatch / indeterminate
// verdict; the whole suite was organised around that reference (null vs. real). Both the
// card and the verdict are gone, along with the referenceSealNumber prop and the
// lib/hooks/useSealReference carry-forward that supplied it.
//
// The old suite's central contract — "a null reference is indeterminate, never a false
// mismatch" — is not weakened, it is unreachable: there is no client-side comparison left
// to get wrong. The comparison lives server-side in advance_unloading, against the leg's
// own departure event, and is covered by backend/tests/unit/test_phase_service.py.
//
// What is tested here instead: the input and photo gate still work, and the blinding
// holds. The blinding assertions are a regression fence — re-adding a reference card or a
// verdict banner would otherwise break nothing, and it would quietly undo the point of
// the step, which is that a driver shown the expected number has not verified anything.
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

function makeDraft(overrides: Partial<UnloadingEvidence> = {}): UnloadingEvidence {
  return {
    waybillHandedOver: null,
    sealNumberAtDestination: null,
    // Defaulted to captured: most cases here exercise the seal-number logic, and an
    // absent photo would disable the swipe for reasons unrelated to what they assert.
    sealIntactPhotoDataUrl: 'data:image/jpeg;base64,SEAL',
    sealIntactPhotoArtifactId: null,
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
  onUpdate?: (patch: Partial<UnloadingEvidence>) => void
} = {}) {
  const { draft = makeDraft(), onUpdate = vi.fn() } = overrides
  return render(
    <SealVerify
      tripId="t1"
      phase={makePhase('unloading')}
      stepIndex={1}
      draft={draft}
      onUpdate={onUpdate}
      onComplete={vi.fn()}
    />,
  )
}

describe('SealVerify — blind entry', () => {
  it('never shows the seal set at departure', () => {
    renderStep()

    expect(screen.queryByText('Seal set at departure')).not.toBeInTheDocument()
    expect(screen.queryByText('No seal on record')).not.toBeInTheDocument()
  })

  it('shows no verdict once a seal number has been typed', () => {
    renderStep()

    typeSeal('AB-1234')

    // Neither direction: telling the driver they matched is as leaky as telling them
    // they did not, and "no seal on record" would leak that a reference exists at all.
    expect(screen.queryByText(/Seal matches/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Mismatch/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No seal is on record/)).not.toBeInTheDocument()
  })

  it('always offers the neutral "Swipe to submit" label, never "Swipe to flag"', () => {
    renderStep({ draft: makeDraft({ sealNumberAtDestination: 'AB-1234' }) })

    typeSeal('AB-1234')

    expect(screen.getByText('Swipe to submit')).toBeInTheDocument()
    expect(screen.queryByText('Swipe to flag')).not.toBeInTheDocument()
  })

  it('records only the number typed, with no client-side verdict alongside it', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSeal('ab-1234')

    // Uppercased on the way in (the backend's format check accepts only uppercase), and
    // sealVerifiedMatch is absent entirely — the field is gone from UnloadingEvidence.
    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberAtDestination: 'AB-1234' })
  })
})

describe('SealVerify — seal number format gate', () => {
  it('shows the format hint once an invalid seal number has been typed', () => {
    renderStep()

    typeSeal('nope')

    expect(screen.getByText(/must look like AB-1234/)).toBeInTheDocument()
  })

  it('blocks the swipe on a badly formatted seal number', () => {
    renderStep()

    typeSeal('nope')

    expect(screen.getByRole('slider', { name: 'Swipe to submit' })).toHaveAttribute('aria-disabled', 'true')
  })
})

// The intact seal photo satisfies UnloadingCompleteRequest.gate_photo_artifact_id, which
// is a required UUID. Letting the driver past this step without it means a guaranteed 422
// two steps later — by which point the seal is broken and the photo is unobtainable.
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

  it('records the captured photo and clears any stale artifact id', () => {
    const onUpdate = vi.fn()
    renderStep({ draft: makeDraft({ sealIntactPhotoDataUrl: null }), onUpdate })

    fireEvent.click(screen.getByText('Intact seal photo'))

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sealIntactPhotoDataUrl: 'data:image/jpeg;base64,Intact seal photo',
      sealIntactPhotoArtifactId: null,
    }))
  })

  it('tells the driver to photograph the seal before it is broken', () => {
    renderStep()

    expect(screen.getByText(/before the warehouse breaks it/)).toBeInTheDocument()
  })
})
