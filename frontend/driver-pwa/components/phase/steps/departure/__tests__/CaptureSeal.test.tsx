// frontend/driver-pwa/components/phase/steps/departure/__tests__/CaptureSeal.test.tsx
//
// This suite used to be dominated by the guard-confirms-seal UI: a second input, a
// three-way match/mismatch/indeterminate banner, and the null-seal hazard that indicator
// carried. All of it was removed on 2026-08-05 (guards have no accounts; a number
// re-typed on the driver's own phone proves nothing the seal photograph does not), so the
// tests for it are gone with it rather than rewritten.
//
// What replaces them is a REGRESSION FENCE — the `describe` block below asserts the
// confirm field and both verdict banners stay absent. Without it, re-adding the step
// would break no test, and the backend change that pairs with this removal
// (guard_verified_seal is now Optional[bool], where a `False` still writes a CRITICAL
// seal_mismatch) means a silently-restored field could start flagging real trips.
import { useState } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CONFIRM_DISPATCH_MS } from '@/components/phase/SwipeToConfirm'
import { CaptureSeal } from '../CaptureSeal'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { DepartureEvidence } from '@/lib/types/evidence-draft'
import type { SealReading } from '@/lib/ocr/readSeal'
import type { PhaseEventId } from '@shared/lib/types/phase'

// StepHeader (rendered by the step) calls useRouter — stub it so the component mounts
// under jsdom, same as every other step-component test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// CameraCapture drives real native/browser camera APIs out of scope here — it has its
// own dedicated coverage (components/phase/__tests__/CameraCapture.test.tsx). Stubbed
// so this suite only exercises CaptureSeal's own seal-number logic, mirroring
// the same stub pattern CheckpointPageClient.test.tsx already uses.
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture }: { label: string; onCapture: (dataUrl: string) => void }) => (
    <button onClick={() => onCapture(`data:image/jpeg;base64,${label}`)}>{label}</button>
  ),
}))

// The hook is the seam under test here: what matters is the phase id and role each step
// hands it, not the upload itself (lib/hooks/__tests__/useArtifactUpload.test.ts).
const { mockUseArtifactUpload, mockUploadNow } = vi.hoisted(() => ({
  mockUseArtifactUpload: vi.fn(),
  mockUploadNow: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/hooks/useArtifactUpload', () => ({
  useArtifactUpload: (...args: unknown[]) => {
    mockUseArtifactUpload(...args)
    return { uploadNow: mockUploadNow }
  },
}))

// Seal OCR is mocked file-wide: 'unavailable' (the browser answer) unless a test says
// otherwise, so the older tests keep exercising typing exactly as before.
// canReadSeals is true (a native phone) so the read itself is what each test controls.
const { mockReadSeal } = vi.hoisted(() => ({ mockReadSeal: vi.fn() }))
vi.mock('@/lib/ocr/readSeal', () => ({
  readSealFromPhoto: (...a: unknown[]) => mockReadSeal(...a),
  canReadSeals: () => true,
}))

beforeEach(() => {
  // Reset, not just default: a test's mockResolvedValueOnce queue must not leak into the next.
  mockReadSeal.mockReset()
  mockReadSeal.mockResolvedValue({ kind: 'unavailable' })
})

// A read the test finishes by hand, to act while OCR is still running.
function deferredRead() {
  let resolve: (r: SealReading) => void = () => {}
  const promise = new Promise<SealReading>((r) => { resolve = r })
  return { promise, resolve }
}

// The step reads the seal (mocked) on every photo, and that read resolves after the
// click. Tests that stop at the click flush it so its state update lands inside act.
async function flushSealRead() {
  await act(async () => {})
}

function makeDraft(overrides: Partial<DepartureEvidence> = {}): DepartureEvidence {
  return {
    sealNumber: null,
    sealPhotoDataUrl: null,
    sealPhotoArtifactId: null,
    capturedAt: null,
    sealNumberOcr: null,
    ...overrides,
  }
}

function typeSealNumber(value: string) {
  fireEvent.change(screen.getByLabelText('Seal number'), { target: { value } })
}

function renderStep(overrides: {
  draft?: DepartureEvidence
  onUpdate?: (patch: Partial<DepartureEvidence>) => void
  onComplete?: () => void
} = {}) {
  const { draft: initialDraft = makeDraft(), onUpdate = vi.fn(), onComplete = vi.fn() } = overrides

  // CaptureSeal is a CONTROLLED component: it reads the seal number straight off the
  // draft and reports every edit upward. The harness holds real state and applies each
  // patch, exactly as the step page does in production, so an assertion about what is on
  // screen after typing can never pass vacuously against a value that never fed back.
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

  it('calls onUpdate with the captured photo data url and clears any stale artifact id', async () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    // The artifact id is reset alongside the new data URL: a retake must not leave the
    // PREVIOUS photo's id in the draft, or the submit would send the discarded shot.
    // The id is filled in moments later, when the capture-time upload resolves.
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sealPhotoDataUrl: 'data:image/jpeg;base64,Seal photo',
      sealPhotoArtifactId: null,
    }))

    await flushSealRead()
  })

  it('trims stray whitespace so the stored value matches what the format gate validated', () => {
    // isValidSealFormat trims to validate; before SealInput used normalizeSeal it only
    // uppercased, so a leading/trailing space (near-guaranteed on a phone keyboard) could
    // pass the on-screen gate while still 422ing at the backend's untrimmed regex.
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSealNumber(' ab-1234 ')

    expect(onUpdate).toHaveBeenCalledWith({ sealNumber: 'AB-1234' })
  })

  it('shows the format hint once an invalid seal number has been typed, not before', () => {
    renderStep({ draft: makeDraft() })
    expect(screen.queryByText(/must look like AB-1234/)).not.toBeInTheDocument()

    renderStep({ draft: makeDraft({ sealNumber: 'AB123' }) })
    expect(screen.getAllByText(/must look like AB-1234/).length).toBeGreaterThan(0)
  })
})

describe('CaptureSeal — the guard confirmation is gone and must stay gone', () => {
  it('renders no guard confirmation field', () => {
    renderStep({ draft: makeDraft({ sealNumber: 'AB-1234' }) })

    expect(screen.queryByLabelText('Guard confirms seal number')).not.toBeInTheDocument()
  })

  it('renders no match or mismatch verdict, however complete the capture is', () => {
    renderStep({
      draft: makeDraft({ sealNumber: 'AB-1234', sealPhotoDataUrl: 'data:image/jpeg;base64,x' }),
    })

    expect(screen.queryByText(/Seal matches/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Mismatch/)).not.toBeInTheDocument()
  })

  it('never writes a guard-confirmation field into the draft', async () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSealNumber('AB-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    // Guards against a re-added field being persisted into the draft and reaching
    // lib/api/phases.ts, whose departure branch no longer sends either key.
    for (const [patch] of onUpdate.mock.calls) {
      expect(patch).not.toHaveProperty('sealNumberConfirmed')
      expect(patch).not.toHaveProperty('sealVerifiedMatch')
    }

    await flushSealRead()
  })
})

describe('CaptureSeal — submit readiness (SwipeToConfirm)', () => {
  it('is disabled until both the seal number and the seal photo are present', () => {
    renderStep({ draft: makeDraft() })

    expect(screen.getByRole('slider', { name: 'Swipe to Save Seal' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('is disabled when the seal photo is missing even though the number is valid', () => {
    renderStep({ draft: makeDraft({ sealNumber: 'AB-1234', sealPhotoDataUrl: null }) })

    expect(screen.getByRole('slider', { name: 'Swipe to Save Seal' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('is disabled when the seal number is not validly formatted', () => {
    renderStep({
      draft: makeDraft({ sealNumber: 'not-a-seal', sealPhotoDataUrl: 'data:image/jpeg;base64,x' }),
    })

    expect(screen.getByRole('slider', { name: 'Swipe to Save Seal' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('is enabled once the seal number is valid and the photo is captured', () => {
    renderStep({
      draft: makeDraft({ sealNumber: 'AB-1234', sealPhotoDataUrl: 'data:image/jpeg;base64,x' }),
    })

    expect(screen.getByRole('slider', { name: 'Swipe to Save Seal' })).toHaveAttribute('aria-disabled', 'false')
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
      draft: makeDraft({ sealNumber: 'AB-1234', sealPhotoDataUrl: 'data:image/jpeg;base64,x' }),
      onComplete,
    })

    const slider = screen.getByRole('slider', { name: 'Swipe to Save Seal' })
    fireEvent.keyDown(slider, { key: 'Enter' }) // arm
    fireEvent.keyDown(slider, { key: 'Enter' }) // confirm
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DISPATCH_MS) // SwipeToConfirm's delay before handing off
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

describe('CaptureSeal — evidence attribution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('captures with this phase and the step\'s role', async () => {
    const phase = makePhase('departure', { phase_event_id: 'phase-event-77' as PhaseEventId })
    render(
      <CaptureSeal
        tripId="t1"
        phase={phase}
        stepIndex={1}
        draft={makeDraft()}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    // By role: the redesign also names "Seal photo" in the Needed-to-continue list.
    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(mockUseArtifactUpload).toHaveBeenCalledWith('t1', 'phase-event-77')
    expect(mockUploadNow).toHaveBeenCalledWith(
      'data:image/jpeg;base64,Seal photo', 'photo', expect.any(String), 'seal_photo',
    )

    await flushSealRead()
  })
})

describe('CaptureSeal — reading the seal number from the photo', () => {
  it('puts the photo before the number', () => {
    renderStep()

    const photo = screen.getByRole('button', { name: 'Seal photo' })
    const input = screen.getByLabelText('Seal number')
    expect(photo.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('fills the number OCR read and asks the driver to check it', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(await screen.findByDisplayValue('AB-1234')).toBeInTheDocument()
    expect(screen.getByText('Read from the photo — check it matches the seal.')).toBeInTheDocument()
    expect(onUpdate).toHaveBeenCalledWith({ sealNumberOcr: 'AB-1234', sealNumber: 'AB-1234' })
  })

  it('never overwrites a number the driver typed', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSealNumber('CD-5678')
    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    // No OCR value recorded: the number that stands is the driver's own, so it is "typed".
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ sealNumberOcr: null }))
    expect(screen.getByDisplayValue('CD-5678')).toBeInTheDocument()
  })

  it('does not credit OCR when it read the same number the driver had already typed', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSealNumber('AB-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ sealNumberOcr: null }))
    expect(screen.queryByText('Read from the photo — check it matches the seal.')).not.toBeInTheDocument()
  })

  it('keeps a number the driver types while the read is still running', async () => {
    const read = deferredRead()
    mockReadSeal.mockReturnValue(read.promise)
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))
    typeSealNumber('CD-5678')
    await act(async () => { read.resolve({ kind: 'found', value: 'AB-1234' }) })

    expect(screen.getByLabelText('Seal number')).toHaveValue('CD-5678')
    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberOcr: null })
  })

  it('blocks the swipe until the read of a new photo has finished', async () => {
    const read = deferredRead()
    mockReadSeal.mockReturnValue(read.promise)
    renderStep({ draft: makeDraft({ sealNumber: 'AB-1234' }) })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    // Number valid and photo present, yet the swipe waits: a submit now would carry a
    // capture tag worked out from the previous photo's read.
    const slider = screen.getByRole('slider', { name: 'Swipe to Save Seal' })
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(slider).toHaveTextContent('Reading the seal…')

    await act(async () => { read.resolve({ kind: 'none' }) })

    expect(slider).toHaveAttribute('aria-disabled', 'false')
  })

  it('replaces an untouched earlier read when the seal is photographed again', async () => {
    mockReadSeal
      .mockResolvedValueOnce({ kind: 'found', value: 'AB-1234' })
      .mockResolvedValueOnce({ kind: 'found', value: 'AB-1284' })
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))
    await screen.findByDisplayValue('AB-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(await screen.findByDisplayValue('AB-1284')).toBeInTheDocument()
  })

  it('leaves the field for the driver when OCR is unavailable', async () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ sealNumberOcr: null })))
    expect(screen.getByLabelText('Seal number')).toHaveValue('')
  })
})
