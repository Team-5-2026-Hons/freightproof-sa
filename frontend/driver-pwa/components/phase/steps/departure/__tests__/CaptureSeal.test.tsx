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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture }: { label: string; onCapture: (dataUrl: string) => void }) => (
    <button onClick={() => onCapture(`data:image/jpeg;base64,${label}`)}>{label}</button>
  ),
}))

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

const { mockReadSeal } = vi.hoisted(() => ({ mockReadSeal: vi.fn() }))
vi.mock('@/lib/ocr/readSeal', () => ({
  readSealFromPhoto: (...a: unknown[]) => mockReadSeal(...a),
  canReadSeals: () => true,
}))

beforeEach(() => {
  mockReadSeal.mockReset()
  mockReadSeal.mockResolvedValue({ kind: 'unavailable' })
})

function deferredRead() {
  let resolve: (r: SealReading) => void = () => {}
  const promise = new Promise<SealReading>((r) => { resolve = r })
  return { promise, resolve }
}

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

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sealPhotoDataUrl: 'data:image/jpeg;base64,Seal photo',
      sealPhotoArtifactId: null,
    }))

    await flushSealRead()
  })

  it('trims stray whitespace so the stored value matches what the format gate validated', () => {
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

  it('calls onComplete once the swipe completes while ready', () => {
    const onComplete = vi.fn()
    renderStep({
      draft: makeDraft({ sealNumber: 'AB-1234', sealPhotoDataUrl: 'data:image/jpeg;base64,x' }),
      onComplete,
    })

    const slider = screen.getByRole('slider', { name: 'Swipe to Save Seal' })
    fireEvent.keyDown(slider, { key: 'Enter' })
    fireEvent.keyDown(slider, { key: 'Enter' })
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DISPATCH_MS)
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
    expect(screen.getByText('Read from the photo. Check it matches the seal.')).toBeInTheDocument()
    expect(onUpdate).toHaveBeenCalledWith({ sealNumberOcr: 'AB-1234', sealNumber: 'AB-1234' })
  })

  it('never overwrites a number the driver typed', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSealNumber('CD-5678')
    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

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
    expect(screen.queryByText('Read from the photo. Check it matches the seal.')).not.toBeInTheDocument()
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
