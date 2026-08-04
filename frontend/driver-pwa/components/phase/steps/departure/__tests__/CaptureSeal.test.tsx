// frontend/driver-pwa/components/phase/steps/departure/__tests__/CaptureSeal.test.tsx
//
// CaptureSeal had NO test at all before this file — flagged in the parent plan as the
// single highest-risk file in the phase refactor (see the component's own header
// comment): the seal moved from `loading` to `departure`, and it now merges seal
// capture AND the gate guard's independent confirmation on one screen. The specific
// hazard under test throughout: `matches` must be null (indeterminate), never a false
// positive OR a false negative, whenever draft.sealNumber hasn't been captured yet —
// a silent NULL == NULL (or empty-string) comparison would raise nothing and fail no
// test, which is exactly the bug class this file exists to catch.
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CaptureSeal } from '../CaptureSeal'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { DepartureEvidence } from '@/lib/types/evidence-draft'

// StepHeader (rendered by the step) calls useRouter — stub it so the component mounts
// under jsdom, same as every other step-component test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// CameraCapture drives real native/browser camera APIs out of scope here — it has its
// own dedicated coverage (components/phase/__tests__/CameraCapture.test.tsx). Stubbed
// so this suite only exercises CaptureSeal's own seal-number/match logic, mirroring
// the same stub pattern CheckpointPageClient.test.tsx already uses.
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture }: { label: string; onCapture: (dataUrl: string) => void }) => (
    <button onClick={() => onCapture(`data:image/jpeg;base64,${label}`)}>{label}</button>
  ),
}))

const MATCH_BANNER = 'Seal matches'
const MISMATCH_BANNER = 'Mismatch — flagged as exception'
const NULL_REFERENCE_NOTE = 'Enter the seal number above before confirming it.'

function makeDraft(overrides: Partial<DepartureEvidence> = {}): DepartureEvidence {
  return {
    gpsLat: null,
    gpsLng: null,
    waybillPhotoDataUrl: null,
    sealNumber: null,
    sealPhotoDataUrl: null,
    sealNumberConfirmed: null,
    sealVerifiedMatch: null,
    capturedAt: null,
    ...overrides,
  }
}

function typeSealNumber(value: string) {
  fireEvent.change(screen.getByLabelText('Seal number'), { target: { value } })
}

function typeGuardConfirm(value: string) {
  fireEvent.change(screen.getByLabelText('Guard confirms seal number'), { target: { value } })
}

function renderStep(overrides: {
  draft?: DepartureEvidence
  onUpdate?: (patch: Partial<DepartureEvidence>) => void
  onComplete?: () => void
} = {}) {
  const { draft: initialDraft = makeDraft(), onUpdate = vi.fn(), onComplete = vi.fn() } = overrides

  // CaptureSeal is a CONTROLLED component: it reads `sealNumberConfirmed` straight off the
  // draft and reports every edit upward. A bare vi.fn() for onUpdate never feeds the value
  // back, so the guard field would stay empty and neither verdict banner could ever render
  // — and the "never shows a match banner" assertions above would then pass VACUOUSLY,
  // proving nothing about the null-seal hazard they exist to catch. The harness therefore
  // holds real state and applies each patch, exactly as the step page does in production.
  function Harness() {
    const [draft, setDraft] = useState<DepartureEvidence>(initialDraft)
    return (
      <CaptureSeal
        tripId="t1"
        phase={makePhase('departure')}
        stepIndex={1}
        draft={draft}
        onUpdate={(patch) => {
          onUpdate(patch)
          setDraft((prev) => ({ ...prev, ...patch }))
        }}
        onComplete={onComplete}
      />
    )
  }

  return render(<Harness />)
}

describe('CaptureSeal — capturing the seal number and photo', () => {
  it('uppercases a typed seal number and calls onUpdate', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSealNumber('ab-1234')

    expect(onUpdate).toHaveBeenCalledWith({ sealNumber: 'AB-1234' })
  })

  it('calls onUpdate with the captured photo data url', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    fireEvent.click(screen.getByText('Seal photo'))

    expect(onUpdate).toHaveBeenCalledWith({ sealPhotoDataUrl: 'data:image/jpeg;base64,Seal photo' })
  })

  it('shows the format hint once an invalid seal number has been typed, not before', () => {
    renderStep({ draft: makeDraft() })
    expect(screen.queryByText(/must look like AB-1234/)).not.toBeInTheDocument()

    const { unmount } = { unmount: () => {} }
    void unmount
    renderStep({ draft: makeDraft({ sealNumber: 'AB123' }) })
    expect(screen.getAllByText(/must look like AB-1234/).length).toBeGreaterThan(0)
  })
})

describe('CaptureSeal — the missing/null seal hazard (the highest-risk edit)', () => {
  it('never renders the match banner when no seal has been captured yet, however the guard field is filled', () => {
    // draft.sealNumber is null — nothing has been captured. Typing into the guard's
    // confirm field must NEVER read as a match, even if the guard types nothing at
    // all (empty string): a naive `'' === null` or `'' === ''` comparison would
    // silently report true here, which is exactly the bug this test guards against.
    renderStep({ draft: makeDraft({ sealNumber: null }) })

    typeGuardConfirm('AB-1234')

    expect(screen.queryByText(MATCH_BANNER, { exact: false })).not.toBeInTheDocument()
  })

  it('never renders the mismatch banner either — a null reference is indeterminate, not a false negative', () => {
    renderStep({ draft: makeDraft({ sealNumber: null }) })

    typeGuardConfirm('AB-1234')

    expect(screen.queryByText(MISMATCH_BANNER)).not.toBeInTheDocument()
  })

  it('shows the neutral "enter the seal number" note instead of either verdict', () => {
    renderStep({ draft: makeDraft({ sealNumber: null }) })

    typeGuardConfirm('AB-1234')

    expect(screen.getByText(NULL_REFERENCE_NOTE)).toBeInTheDocument()
  })

  it('persists sealVerifiedMatch as null (not false, not true) while sealNumber is unset', () => {
    const onUpdate = vi.fn()
    renderStep({ draft: makeDraft({ sealNumber: null }), onUpdate })

    typeGuardConfirm('AB-1234')

    expect(onUpdate).toHaveBeenLastCalledWith({
      sealNumberConfirmed: 'AB-1234',
      sealVerifiedMatch: null,
    })
  })
})

describe('CaptureSeal — the three-way match outcome once a seal is captured', () => {
  it('reports a match and shows the success banner', () => {
    const onUpdate = vi.fn()
    renderStep({ draft: makeDraft({ sealNumber: 'AB-1234' }), onUpdate })

    typeGuardConfirm('ab-1234') // guard's re-entry is uppercased the same way

    expect(screen.getByText(MATCH_BANNER)).toBeInTheDocument()
    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberConfirmed: 'AB-1234', sealVerifiedMatch: true })
  })

  it('reports a mismatch and shows the flagged-exception banner', () => {
    const onUpdate = vi.fn()
    renderStep({ draft: makeDraft({ sealNumber: 'AB-1234' }), onUpdate })

    typeGuardConfirm('CD-5678')

    expect(screen.getByText(MISMATCH_BANNER)).toBeInTheDocument()
    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberConfirmed: 'CD-5678', sealVerifiedMatch: false })
  })

  it('goes back to the neutral note if the guard field is cleared back to empty', () => {
    renderStep({ draft: makeDraft({ sealNumber: 'AB-1234', sealNumberConfirmed: 'CD-5678' }) })

    typeGuardConfirm('')

    expect(screen.queryByText(MATCH_BANNER)).not.toBeInTheDocument()
    expect(screen.queryByText(MISMATCH_BANNER)).not.toBeInTheDocument()
  })
})

describe('CaptureSeal — submit readiness (SwipeToConfirm)', () => {
  it('is disabled until the seal number, seal photo, and a validly-formatted guard confirmation are all present', () => {
    renderStep({ draft: makeDraft() })

    expect(screen.getByRole('slider', { name: 'Swipe to confirm' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('is disabled when the seal photo is missing even if both numbers are valid and matching', () => {
    renderStep({
      draft: makeDraft({ sealNumber: 'AB-1234', sealPhotoDataUrl: null, sealNumberConfirmed: 'AB-1234' }),
    })

    expect(screen.getByRole('slider', { name: 'Swipe to confirm' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('is disabled when the guard confirmation is not validly formatted', () => {
    renderStep({
      draft: makeDraft({
        sealNumber: 'AB-1234',
        sealPhotoDataUrl: 'data:image/jpeg;base64,x',
        sealNumberConfirmed: 'not-a-seal',
      }),
    })

    expect(screen.getByRole('slider', { name: 'Swipe to confirm' })).toHaveAttribute('aria-disabled', 'true')
  })

  // The mismatch itself must never block the driver — it's recorded as evidence and
  // flagged as an exception downstream, not something the driver can be stuck behind.
  it('is enabled on a genuine MISMATCH as long as format and photo requirements are met', () => {
    renderStep({
      draft: makeDraft({
        sealNumber: 'AB-1234',
        sealPhotoDataUrl: 'data:image/jpeg;base64,x',
        sealNumberConfirmed: 'CD-5678',
      }),
    })

    expect(screen.getByText(MISMATCH_BANNER)).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Swipe to confirm' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('is enabled once everything is valid and matching', () => {
    renderStep({
      draft: makeDraft({
        sealNumber: 'AB-1234',
        sealPhotoDataUrl: 'data:image/jpeg;base64,x',
        sealNumberConfirmed: 'AB-1234',
      }),
    })

    expect(screen.getByRole('slider', { name: 'Swipe to confirm' })).toHaveAttribute('aria-disabled', 'false')
  })
})

describe('CaptureSeal — completing the swipe', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // Driven via SwipeToConfirm's keyboard path (two Enter presses) rather than a real
  // pointer drag — this test only cares about the downstream onComplete call, and the
  // drag gesture itself has its own dedicated coverage in SwipeToConfirm.test.tsx.
  it('calls onComplete once the swipe completes while ready', () => {
    const onComplete = vi.fn()
    renderStep({
      draft: makeDraft({
        sealNumber: 'AB-1234',
        sealPhotoDataUrl: 'data:image/jpeg;base64,x',
        sealNumberConfirmed: 'AB-1234',
      }),
      onComplete,
    })

    const slider = screen.getByRole('slider', { name: 'Swipe to confirm' })
    fireEvent.keyDown(slider, { key: 'Enter' }) // arm
    fireEvent.keyDown(slider, { key: 'Enter' }) // confirm
    act(() => {
      vi.advanceTimersByTime(180) // SwipeToConfirm's settle delay before handing off
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
