// frontend/driver-pwa/components/phase/steps/loading/__tests__/Linehaul.scan.test.tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Linehaul } from '../Linehaul'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { LoadingEvidence } from '@/lib/types/evidence-draft'

const { mockScan, mockBuildPdf, mockUploadNow, mockIsNative } = vi.hoisted(() => ({
  mockScan: vi.fn(),
  mockBuildPdf: vi.fn(),
  mockUploadNow: vi.fn(),
  mockIsNative: vi.fn(),
}))

// StepLayout's header calls useRouter, as in every step suite.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mockIsNative() } }))
vi.mock('@/lib/scan/scanLinehaulSheet', () => ({ scanLinehaulSheet: () => mockScan() }))
vi.mock('@/lib/scan/buildLinehaulPdf', () => ({ buildLinehaulPdf: (...a: unknown[]) => mockBuildPdf(...a) }))
vi.mock('@/lib/hooks/useArtifactUpload', () => ({ useArtifactUpload: () => ({ uploadNow: mockUploadNow }) }))
// CameraCapture stubbed as in the seal suites, but it honours nativeSource so the
// scanner wiring is what the test exercises.
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture, nativeSource }: {
    label: string; onCapture: (d: string) => void; nativeSource?: () => Promise<string | null>
  }) => (
    <button onClick={() => {
      void (nativeSource ? nativeSource() : Promise.resolve(`data:image/jpeg;base64,${label}`))
        .then((d) => { if (d !== null) onCapture(d) })
    }}>{label}</button>
  ),
}))

const LINEHAUL = {
  trip_id: 'trip-1', vehicle_registration: 'ABC123GP', vehicle_type: 'horse',
  driver_full_name: 'Test Driver', consolidated_unit_count: 4,
  origin_scan_complete: true, pulled_at: '2026-08-05T10:00:00Z',
}

const EMPTY_DRAFT: LoadingEvidence = {
  linehaulPhotoDataUrl: null, linehaulPhotoArtifactId: null,
  linehaulPdfDataUrl: null, linehaulPdfArtifactId: null, capturedAt: null,
}

function renderUnblocked(onUpdate: (patch: Partial<LoadingEvidence>) => void) {
  render(
    <Linehaul
      tripId="trip-1"
      phase={makePhase('loading', { blocked_on: null })}
      stepIndex={0}
      linehaul={LINEHAUL}
      draft={EMPTY_DRAFT}
      onUpdate={onUpdate}
      onComplete={vi.fn()}
    />,
  )
}

// Holds the draft the way the step page does, so the swipe sees each patch.
function LiveDraft({ onUpdate }: { onUpdate: (patch: Partial<LoadingEvidence>) => void }) {
  const [draft, setDraft] = useState<LoadingEvidence>(EMPTY_DRAFT)
  return (
    <Linehaul
      tripId="trip-1"
      phase={makePhase('loading', { blocked_on: null })}
      stepIndex={0}
      linehaul={LINEHAUL}
      draft={draft}
      onUpdate={(patch) => { onUpdate(patch); setDraft((d) => ({ ...d, ...patch })) }}
      onComplete={vi.fn()}
    />
  )
}

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function swipe(): HTMLElement {
  return screen.getByRole('slider', { name: 'Confirm Linehaul' })
}

describe('Linehaul — scan and PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsNative.mockReturnValue(true)
    mockScan.mockResolvedValue('data:image/jpeg;base64,SCAN')
    mockBuildPdf.mockResolvedValue('data:application/pdf;base64,PDF')
    mockUploadNow.mockImplementation((_d: string, _t: string, _at: string, role: string) =>
      Promise.resolve(role === 'linehaul_pdf' ? 'pdf-artifact' : 'scan-artifact'))
  })

  it('scans on a phone, then uploads the scan and its PDF under their own roles', async () => {
    const onUpdate = vi.fn()
    renderUnblocked(onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Linehaul sheet' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ linehaulPdfArtifactId: 'pdf-artifact' }))
    expect(mockBuildPdf).toHaveBeenCalledWith('data:image/jpeg;base64,SCAN')
    expect(mockUploadNow).toHaveBeenCalledWith('data:image/jpeg;base64,SCAN', 'photo', expect.any(String), 'linehaul_photo')
    expect(mockUploadNow).toHaveBeenCalledWith('data:application/pdf;base64,PDF', 'document', expect.any(String), 'linehaul_pdf')
  })

  it('keeps the scan when the PDF cannot be built', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockBuildPdf.mockRejectedValue(new Error('embed failed'))
    const onUpdate = vi.fn()
    renderUnblocked(onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Linehaul sheet' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ linehaulPhotoArtifactId: 'scan-artifact' }))
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ linehaulPdfArtifactId: 'pdf-artifact' }))
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ linehaulPdfDataUrl: expect.any(String) }))
  })

  it('holds the swipe while the PDF is building, then releases it', async () => {
    const build = deferred<string>()
    mockBuildPdf.mockReturnValue(build.promise)
    render(<LiveDraft onUpdate={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Linehaul sheet' }))

    await waitFor(() => expect(mockBuildPdf).toHaveBeenCalled())
    expect(swipe()).toHaveAttribute('aria-disabled', 'true')
    expect(swipe()).toHaveTextContent('Preparing the PDF…')
    await act(async () => { build.resolve('data:application/pdf;base64,PDF') })
    expect(swipe()).toHaveAttribute('aria-disabled', 'false')
  })

  it('releases the swipe when the PDF build fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const build = deferred<string>()
    mockBuildPdf.mockReturnValue(build.promise)
    render(<LiveDraft onUpdate={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Linehaul sheet' }))

    await waitFor(() => expect(mockBuildPdf).toHaveBeenCalled())
    expect(swipe()).toHaveTextContent('Preparing the PDF…')
    await act(async () => { build.reject(new Error('embed failed')) })
    expect(swipe()).toHaveAttribute('aria-disabled', 'false')
  })

  it('never writes an earlier capture\'s PDF after a retake', async () => {
    const first = deferred<string>()
    mockScan.mockResolvedValueOnce('data:image/jpeg;base64,SCAN1').mockResolvedValueOnce('data:image/jpeg;base64,SCAN2')
    mockBuildPdf
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce('data:application/pdf;base64,PDF2')
    mockUploadNow.mockImplementation((d: string) => Promise.resolve(d.endsWith('PDF1') ? 'pdf-1' : d.endsWith('PDF2') ? 'pdf-2' : 'scan'))
    const onUpdate = vi.fn()
    render(<LiveDraft onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Linehaul sheet' }))
    await waitFor(() => expect(mockBuildPdf).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Linehaul sheet' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ linehaulPdfArtifactId: 'pdf-2' }))
    // The newest capture's PDF has settled, so the swipe is free even though the first build is not.
    expect(swipe()).toHaveAttribute('aria-disabled', 'false')
    await act(async () => { first.resolve('data:application/pdf;base64,PDF1') })

    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ linehaulPdfDataUrl: 'data:application/pdf;base64,PDF1' }))
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ linehaulPdfArtifactId: 'pdf-1' }))
    expect(mockUploadNow).not.toHaveBeenCalledWith('data:application/pdf;base64,PDF1', expect.anything(), expect.anything(), expect.anything())
    expect(swipe()).toHaveAttribute('aria-disabled', 'false')
  })

  it('does not use the scanner in the browser', async () => {
    mockIsNative.mockReturnValue(false)
    renderUnblocked(vi.fn())

    fireEvent.click(screen.getByRole('button', { name: 'Linehaul sheet' }))

    await waitFor(() => expect(mockBuildPdf).toHaveBeenCalledWith('data:image/jpeg;base64,Linehaul sheet'))
    expect(mockScan).not.toHaveBeenCalled()
  })
})

// Android recreates the WebView after the document scanner on a low-memory phone. The
// draft kept the scan (usePhaseDraft), but the PDF the step builds from it was lost with
// the JavaScript heap, so a returning driver would have submitted the loading without it.
describe('Linehaul PDF rebuilt on resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('test_a_resumed_draft_with_a_scan_but_no_pdf_rebuilds_and_uploads_the_pdf', async () => {
    // Arrange
    mockIsNative.mockReturnValue(false)
    mockBuildPdf.mockResolvedValue('data:application/pdf;base64,REBUILT')
    mockUploadNow.mockResolvedValue('pdf-artifact')
    const onUpdate = vi.fn()

    // Act
    render(
      <Linehaul
        tripId="trip-1"
        phase={makePhase('loading', { blocked_on: null })}
        stepIndex={0}
        linehaul={LINEHAUL}
        draft={{ ...EMPTY_DRAFT, linehaulPhotoDataUrl: 'data:image/jpeg;base64,SCAN', capturedAt: '2026-10-21T08:00:00Z' }}
        onUpdate={onUpdate}
        onComplete={vi.fn()}
      />,
    )

    // Assert
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ linehaulPdfDataUrl: 'data:application/pdf;base64,REBUILT' }))
    expect(mockBuildPdf).toHaveBeenCalledTimes(1)
    expect(mockBuildPdf).toHaveBeenCalledWith('data:image/jpeg;base64,SCAN')
    expect(mockUploadNow).toHaveBeenCalledWith('data:application/pdf;base64,REBUILT', 'document', '2026-10-21T08:00:00Z', 'linehaul_pdf')
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ linehaulPdfArtifactId: 'pdf-artifact' }))
  })

  it('test_a_draft_whose_pdf_already_exists_is_left_alone', () => {
    mockIsNative.mockReturnValue(false)

    render(
      <Linehaul
        tripId="trip-1"
        phase={makePhase('loading', { blocked_on: null })}
        stepIndex={0}
        linehaul={LINEHAUL}
        draft={{ ...EMPTY_DRAFT, linehaulPhotoDataUrl: 'data:image/jpeg;base64,SCAN', linehaulPdfDataUrl: 'data:application/pdf;base64,HAVE', capturedAt: '2026-10-21T08:00:00Z' }}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(mockBuildPdf).not.toHaveBeenCalled()
  })
})
