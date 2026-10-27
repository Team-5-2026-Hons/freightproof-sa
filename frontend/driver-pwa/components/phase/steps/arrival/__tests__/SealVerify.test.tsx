// frontend/driver-pwa/components/phase/steps/arrival/__tests__/SealVerify.test.tsx
//
// Ported from the deleted components/phase/steps/unloading/__tests__/SealVerify.test.tsx:
// the seal-at-arrival check moved from unloading to its own arrival phase, so the seal is
// now photographed BEFORE the doors open, not after the
// warehouse breaks it. The blinding contract carries over unchanged — no reference card,
// no verdict, a neutral swipe label in every condition — plus new coverage for the
// tri-state seal_condition choice this component adds: 'missing' hides the number
// requirement but never relaxes the photo requirement.
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SealVerify } from '../SealVerify'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { ArrivalEvidence } from '@/lib/types/evidence-draft'
import type { SealReading } from '@/lib/ocr/readSeal'
import type { PhaseEventId } from '@shared/lib/types/phase'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const { cameraRenders } = vi.hoisted(() => ({ cameraRenders: { count: 0 } }))
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture }: { label: string; onCapture: (dataUrl: string) => void }) => {
    cameraRenders.count += 1
    return <button onClick={() => onCapture(`data:image/jpeg;base64,${label}`)}>{label}</button>
  },
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

const { mockReadSeal, mockCanReadSeals } = vi.hoisted(() => ({
  mockReadSeal: vi.fn(),
  mockCanReadSeals: vi.fn(),
}))
vi.mock('@/lib/ocr/readSeal', () => ({
  readSealFromPhoto: (...a: unknown[]) => mockReadSeal(...a),
  canReadSeals: () => mockCanReadSeals(),
}))

beforeEach(() => {
  mockReadSeal.mockReset()
  mockReadSeal.mockResolvedValue({ kind: 'unavailable' })
  mockCanReadSeals.mockReset()
  mockCanReadSeals.mockReturnValue(true)
})

function deferredRead() {
  let resolve: (r: SealReading) => void = () => {}
  const promise = new Promise<SealReading>((r) => { resolve = r })
  return { promise, resolve }
}

async function flushSealRead() {
  await act(async () => {})
}

function makeDraft(overrides: Partial<ArrivalEvidence> = {}): ArrivalEvidence {
  return {
    sealCondition: null,
    sealNumberAtArrival: null,
    sealNumberAtArrivalOcr: null,
    sealPhotoDataUrl: 'data:image/jpeg;base64,SEAL',
    sealPhotoArtifactId: null,
    capturedAt: null,
    ...overrides,
  }
}

function typeSeal(value: string) {
  fireEvent.change(screen.getByLabelText('Seal number you see'), {
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

function renderStateful(overrides: {
  draft?: ArrivalEvidence
  onUpdate?: (patch: Partial<ArrivalEvidence>) => void
} = {}) {
  const { draft: initialDraft = makeDraft(), onUpdate = vi.fn() } = overrides

  function Harness() {
    const [draft, setDraft] = useState<ArrivalEvidence>(initialDraft)
    return (
      <SealVerify
        tripId="t1"
        phase={makePhase('arrival')}
        stepIndex={0}
        draft={draft}
        onUpdate={(patch) => {
          onUpdate(patch)
          setDraft((prev) => ({ ...prev, ...patch }))
        }}
        onComplete={vi.fn()}
      />
    )
  }

  return render(<Harness />)
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

    expect(screen.queryByText(/Seal matches/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Mismatch/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No seal is on record/)).not.toBeInTheDocument()
  })

  it('always offers the neutral "Swipe to Record Seal" label, never "Swipe to flag"', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'AB-1234' }) })

    expect(screen.getByText('Swipe to Record Seal')).toBeInTheDocument()
    expect(screen.queryByText('Swipe to flag')).not.toBeInTheDocument()
  })

  it('offers the same neutral label when the seal is damaged or missing', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'damaged', sealNumberAtArrival: 'AB-1234' }) })
    expect(screen.getByText('Swipe to Record Seal')).toBeInTheDocument()

    renderStep({ draft: makeDraft({ sealCondition: 'missing', sealNumberAtArrival: null }) })
    expect(screen.getAllByText('Swipe to Record Seal').length).toBeGreaterThan(0)
  })

  it('records only the number typed, with no client-side verdict alongside it', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSeal('ab-1234')

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

    expect(screen.getByRole('slider', { name: 'Swipe to Record Seal' })).toHaveAttribute('aria-disabled', 'true')
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

    expect(screen.getByRole('slider', { name: 'Swipe to Record Seal' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('requires the number for a damaged seal, exactly as for an intact one', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'damaged', sealNumberAtArrival: null }) })

    expect(screen.getByRole('slider', { name: 'Swipe to Record Seal' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('arrival SealVerify — missing seal', () => {
  it('hides the seal number input once "Missing" is chosen', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'missing' }) })

    expect(screen.queryByLabelText('Seal number you see')).not.toBeInTheDocument()
  })

  it('clears any previously typed seal number when the driver switches to "Missing"', () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate, draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'AB-1234' }) })

    chooseCondition('Missing')

    expect(onUpdate).toHaveBeenCalledWith({
      sealCondition: 'missing', sealNumberAtArrival: null, sealNumberAtArrivalOcr: null,
    })
  })

  it('allows the swipe with no number once the seal is missing and the photo is present', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'missing', sealNumberAtArrival: null }) })

    expect(screen.getByRole('slider', { name: 'Swipe to Record Seal' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('still requires the photo when the seal is missing', () => {
    renderStep({
      draft: makeDraft({ sealCondition: 'missing', sealNumberAtArrival: null, sealPhotoDataUrl: null }),
    })

    expect(screen.getByRole('slider', { name: 'Swipe to Record Seal' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('tells the driver to photograph where the seal should be', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'missing' }) })

    expect(screen.getByText(/Photograph where it should be/)).toBeInTheDocument()
  })
})

describe('arrival SealVerify seal photo gate', () => {
  it('blocks the swipe when the seal number is valid but no photo has been taken', () => {
    renderStep({
      draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'AB-1234', sealPhotoDataUrl: null }),
    })

    expect(screen.getByRole('slider', { name: 'Swipe to Record Seal' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('allows the swipe once condition, number and photo are all present', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'AB-1234' }) })

    expect(screen.getByRole('slider', { name: 'Swipe to Record Seal' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('records the captured photo and clears any stale artifact id', async () => {
    const onUpdate = vi.fn()
    renderStep({ draft: makeDraft({ sealPhotoDataUrl: null }), onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sealPhotoDataUrl: 'data:image/jpeg;base64,Seal photo',
      sealPhotoArtifactId: null,
    }))

    await flushSealRead()
  })

  it('tells the driver to photograph the seal as found, before the doors open', () => {
    renderStep()

    expect(screen.getByText(/Before anything is opened/)).toBeInTheDocument()
  })
})

describe('arrival SealVerify — what is still needed', () => {
  it('lists condition, number and photo as needed on a fresh step', () => {
    renderStep()

    const list = screen.getByRole('list', { name: 'Needed to continue' })
    expect(list).toHaveTextContent('Seal condition')
    expect(list).toHaveTextContent('Seal number')
    expect(list).toHaveTextContent('Seal photo')
  })

  it('drops the seal number from the list once the seal is recorded as missing', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'missing' }) })

    const list = screen.getByRole('list', { name: 'Needed to continue' })
    expect(list).not.toHaveTextContent('Seal number')
    expect(list).toHaveTextContent('Seal photo')
  })
})

describe('SealVerify — the overhauled screen (8.1/8.2)', () => {
  it('test_tells_the_driver_to_read_the_seal_not_the_paperwork', () => {
    renderStep()

    expect(screen.getByText(/Don’t copy it from paperwork/)).toBeInTheDocument()
  })

  it('test_records_a_missing_seal_as_a_finding_not_a_failure', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'missing' }) })

    expect(screen.getByText('Recorded as a finding')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seal photo' })).toBeInTheDocument()
  })

  it('test_says_what_is_still_missing_on_the_waiting_swipe', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'missing', sealPhotoDataUrl: null }) })

    expect(screen.getByText('Add the photo first')).toBeInTheDocument()
  })
})

describe('arrival SealVerify evidence attribution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('captures with this phase and the step\'s role', async () => {
    const phase = makePhase('arrival', { phase_event_id: 'phase-event-88' as PhaseEventId })
    render(
      <SealVerify
        tripId="t1"
        phase={phase}
        stepIndex={0}
        draft={makeDraft({ sealPhotoDataUrl: null })}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(mockUseArtifactUpload).toHaveBeenCalledWith('t1', 'phase-event-88')
    expect(mockUploadNow).toHaveBeenCalledWith(
      'data:image/jpeg;base64,Seal photo', 'photo', expect.any(String), 'seal_photo',
    )

    await flushSealRead()
  })
})

describe('SealVerify — reading the seal number from the photo', () => {
  it('fills the number read from the photo of the seal as found', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStateful({ draft: makeDraft({ sealCondition: 'intact' }), onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(await screen.findByDisplayValue('AB-1234')).toBeInTheDocument()
    expect(onUpdate).toHaveBeenCalledWith({ sealNumberAtArrivalOcr: 'AB-1234', sealNumberAtArrival: 'AB-1234' })
    expect(screen.getByText('Read from the photo. Check it matches the seal.')).toBeInTheDocument()
  })

  it('tells the driver to check a number that came from the photo', () => {
    renderStateful({ draft: makeDraft({
      sealCondition: 'intact', sealNumberAtArrival: 'AB-1234', sealNumberAtArrivalOcr: 'AB-1234',
    }) })

    expect(screen.getByText('Read from the photo. Check it matches the seal.')).toBeInTheDocument()
  })

  it('never overwrites a number the driver typed', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStateful({ draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'CD-5678' }), onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ sealNumberAtArrivalOcr: null }))
    expect(screen.getByLabelText('Seal number you see')).toHaveValue('CD-5678')
  })

  it('does not credit OCR when it read the same number the driver had already typed', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStateful({ draft: makeDraft({ sealCondition: 'intact' }), onUpdate })

    typeSeal('AB-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ sealNumberAtArrivalOcr: null }))
    expect(screen.queryByText('Read from the photo. Check it matches the seal.')).not.toBeInTheDocument()
  })

  it('keeps a number the driver types while the read is still running', async () => {
    const read = deferredRead()
    mockReadSeal.mockReturnValue(read.promise)
    const onUpdate = vi.fn()
    renderStateful({ draft: makeDraft({ sealCondition: 'intact' }), onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))
    typeSeal('CD-5678')
    await act(async () => { read.resolve({ kind: 'found', value: 'AB-1234' }) })

    expect(screen.getByLabelText('Seal number you see')).toHaveValue('CD-5678')
    expect(onUpdate).toHaveBeenLastCalledWith({ sealNumberAtArrivalOcr: null })
  })

  it('ignores a read that finishes after the seal was switched to missing', async () => {
    const read = deferredRead()
    mockReadSeal.mockReturnValue(read.promise)
    const onUpdate = vi.fn()
    renderStateful({ draft: makeDraft({ sealCondition: 'intact' }), onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))
    chooseCondition('Missing')
    onUpdate.mockClear()
    await act(async () => { read.resolve({ kind: 'found', value: 'AB-1234' }) })

    expect(onUpdate).not.toHaveBeenCalled()
    chooseCondition('Intact')
    expect(screen.getByLabelText('Seal number you see')).toHaveValue('')
  })

  it('refills the number from a retake while the driver has not touched it', async () => {
    mockReadSeal
      .mockResolvedValueOnce({ kind: 'found', value: 'AB-1234' })
      .mockResolvedValueOnce({ kind: 'found', value: 'AB-1284' })
    renderStateful({ draft: makeDraft({ sealCondition: 'intact' }) })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))
    await screen.findByDisplayValue('AB-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(await screen.findByDisplayValue('AB-1284')).toBeInTheDocument()
  })

  it('leaves the field for the driver in the browser, where nothing can be read', async () => {
    mockCanReadSeals.mockReturnValue(false)
    const onUpdate = vi.fn()
    renderStateful({ draft: makeDraft({ sealCondition: 'intact' }), onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ sealNumberAtArrivalOcr: null })))
    expect(mockReadSeal).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Seal number you see')).toHaveValue('')
    expect(screen.queryByText('Reading the seal…')).not.toBeInTheDocument()
  })

  it('blocks the swipe until the read of a new photo has finished', async () => {
    const read = deferredRead()
    mockReadSeal.mockReturnValue(read.promise)
    renderStateful({ draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'AB-1234' }) })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    const slider = screen.getByRole('slider', { name: 'Swipe to Record Seal' })
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(slider).toHaveTextContent('Reading the seal…')

    await act(async () => { read.resolve({ kind: 'none' }) })

    expect(slider).toHaveAttribute('aria-disabled', 'false')
  })

  it('does not read a photo of a missing seal', () => {
    renderStateful({ draft: makeDraft({ sealCondition: 'missing' }) })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(mockReadSeal).not.toHaveBeenCalled()
  })

  it('puts the photo before the number', () => {
    renderStateful({ draft: makeDraft({ sealCondition: 'intact' }) })

    const photo = screen.getByRole('button', { name: 'Seal photo' })
    const input = screen.getByLabelText('Seal number you see')
    expect(photo.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('arrival SealVerify — typing stays cheap', () => {
  it('does not re-render the photo tile on each keystroke of the seal number', () => {
    renderStateful({ draft: makeDraft({ sealCondition: 'intact' }) })
    const rendersBeforeTyping = cameraRenders.count

    typeSeal('A')
    typeSeal('AB')
    typeSeal('AB-1')

    expect(cameraRenders.count).toBe(rendersBeforeTyping)
    expect(screen.getByLabelText('Seal number you see')).toHaveValue('AB-1')
  })
})
