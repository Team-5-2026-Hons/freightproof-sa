// Tests for the step that replaced PodSignature (FP-155).
//
// The behaviour worth defending here is negative: the driver must have NO way past this
// step until the receiver has actually confirmed on their own device. That is the entire
// security property of the feature — if the driver can walk past a QR nobody scanned, the
// confirmation is back on the driver's phone and the ticket bought nothing.
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiverHandover } from '../ReceiverHandover'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

// StepHeader calls useRouter — stub it so the component mounts under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// Stubbed to a plain button, so these tests assert the GATE rather than
// SwipeToConfirm's pointer-drag internals (which have their own suite).
vi.mock('@/components/phase/SwipeToConfirm', () => ({
  SwipeToConfirm: ({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) => (
    <button onClick={onConfirm} disabled={disabled}>{label}</button>
  ),
}))

vi.mock('@/lib/hooks/useRotatingHandover', () => ({ useRotatingHandover: vi.fn() }))
vi.mock('@/components/ui/QrCode', () => ({
  QrCode: ({ value }: { value: string | null }) => <div data-testid="qr">{value ?? 'none'}</div>,
}))

const { useRotatingHandover } = await import('@/lib/hooks/useRotatingHandover')

const PHASE = {
  phase_event_id: 'event-1',
  trip_id: 'trip-1',
  phase_type: 'confirmation',
  trip_stop_id: 'stop-1',
  stop_sequence: 1,
  sequence_number: 6,
  status: 'pending',
  anchor_status: 'pending',
  step_recipe: ['1-pod-photo', '2-receiver-handover', '3-reconciliation', '4-closed'],
  dispatcher_override_user_id: null,
  dispatcher_override_note: null,
  driver_phone_lat: null,
  driver_phone_lng: null,
  horse_gps_lat: null,
  horse_gps_lng: null,
  pulsit_geofence_confirmed: null,
} as unknown as PhaseDescriptor

function makeDraft(overrides: Partial<ConfirmationEvidence> = {}): ConfirmationEvidence {
  return {
    podPhotoDataUrl: 'data:image/jpeg;base64,POD',
    podPhotoArtifactId: 'pod-photo',
    podSignatureArtifactId: null,
    receiverConfirmedAt: null,
    driverVisualCount: null,
    reconciliationNote: null,
    capturedAt: null,
    ...overrides,
  }
}

function mockHook(overrides: Partial<ReturnType<typeof useRotatingHandover>> = {}) {
  vi.mocked(useRotatingHandover).mockReturnValue({
    scanUrl: 'https://r.test/h/aaa',
    receiverOpened: false,
    signatureArtifactId: null,
    confirmedAt: null,
    error: null,
    isIssuing: false,
    forceNewCode: vi.fn(),
    ...overrides,
  })
}

function renderStep(draft: ConfirmationEvidence, onUpdate = vi.fn(), onComplete = vi.fn()) {
  render(
    <ReceiverHandover
      tripId="trip-1" phase={PHASE} stepIndex={1}
      draft={draft} onUpdate={onUpdate} onComplete={onComplete}
    />,
  )
  return { onUpdate, onComplete }
}

beforeEach(() => vi.clearAllMocks())

describe('ReceiverHandover', () => {
  it('shows the QR while waiting for the receiver', () => {
    mockHook()
    renderStep(makeDraft())

    expect(screen.getByTestId('qr')).toHaveTextContent('https://r.test/h/aaa')
    expect(screen.getByText(/waiting for the receiver/i)).toBeInTheDocument()
  })

  it('offers no way forward until the receiver has confirmed', () => {
    // The load-bearing assertion. No swipe, no button, no link out of this step.
    mockHook()
    renderStep(makeDraft())

    expect(screen.queryByRole('button', { name: /^continue$/i })).not.toBeInTheDocument()
  })

  it('tells the driver once the receiver has opened the link', () => {
    mockHook({ receiverOpened: true })
    renderStep(makeDraft())

    expect(screen.getByText(/has opened the link/i)).toBeInTheDocument()
    expect(screen.getByText(/stopped changing/i)).toBeInTheDocument()
  })

  it('writes the artifact into the draft once the receiver confirms', async () => {
    mockHook({ signatureArtifactId: 'art-1', confirmedAt: '2026-09-13T10:05:00.000Z' })
    const { onUpdate } = renderStep(makeDraft())

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({
      podSignatureArtifactId: 'art-1',
      receiverConfirmedAt: '2026-09-13T10:05:00.000Z',
    }))
  })

  it('shows the confirmed state from the DRAFT, not from the hook', () => {
    // A driver who backgrounds the app mid-handover comes back to a freshly mounted hook
    // with no confirmation in it. The draft is what persists, so it is what decides —
    // otherwise the driver is sent back to a QR for a delivery already confirmed.
    mockHook({ signatureArtifactId: null, confirmedAt: null })
    renderStep(makeDraft({
      podSignatureArtifactId: 'art-1', receiverConfirmedAt: '2026-09-13T10:05:00.000Z',
    }))

    expect(screen.getByText(/receiver confirmed the delivery/i)).toBeInTheDocument()
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument()
  })

  it('offers the retry affordance when issuing failed', () => {
    mockHook({ error: 'Could not refresh the code. Check your signal.' })
    renderStep(makeDraft())

    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('hides the stranded-receiver escape hatch until the link is open', () => {
    mockHook({ receiverOpened: false })
    renderStep(makeDraft())

    expect(screen.queryByText(/show a new code/i)).not.toBeInTheDocument()
  })

  it('shows the escape hatch when the receiver has the link open', () => {
    mockHook({ receiverOpened: true })
    renderStep(makeDraft())

    expect(screen.getByRole('button', { name: /show a new code/i })).toBeInTheDocument()
  })
})
