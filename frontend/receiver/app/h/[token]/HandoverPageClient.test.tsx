// app/h/[token]/HandoverPageClient.test.tsx
//
// "Skip the identity check" and "I agree, but I have no document" used to send the same
// consent request, so a refusal was stored as consent. What each handler sends is the
// behaviour under test.
//
// The later suites cover what the page must do when things go wrong: every failure used to
// read "this link is no longer valid", a failed confirm threw away the receiver's input,
// and the identity cross-check could be skipped on the way back from the vendor.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  confirmHandover: vi.fn(),
  fetchScan: vi.fn(),
  recordConsent: vi.fn(),
  recordConsentDecline: vi.fn(),
  resolveVerification: vi.fn(),
  startVerification: vi.fn(),
}))

vi.mock('@shared/lib/utils/render-attestation', async (importOriginal) => ({
  ...await importOriginal<typeof import('@shared/lib/utils/render-attestation')>(),
  renderAttestation: vi.fn(),
}))

import * as api from '@/lib/api'
import { consentPayloadText } from '@/lib/consent'
import {
  IDENTITY_STASH_KEY,
  readConfirmOutcome,
  readStashedIdentity,
  rememberConfirmOutcome,
  stashIdentity,
} from '@/lib/identity-stash'
import { ATTESTATION_SUBTITLE, renderAttestation } from '@shared/lib/utils/render-attestation'
import { HandoverPageClient } from './HandoverPageClient'

const TOKEN = 'tok123'
const OTHER_TOKEN = 'someone-elses-token'
const TYPED_NAME = 'Thandi Nkosi'
const TYPED_ID = '9202204720082'
const ATTESTATION_DATA_URL = 'data:image/png;base64,AAAA'

const SWIPE_LABEL = 'Swipe to confirm delivery'
const MINUTE_MS = 60_000

const UNVERIFIED_STATE = {
  status: 'unverified',
  tier: 'typed_only',
  unverified_reason: 'declined_consent',
  identity_match: null,
} as const

const VERIFIED_STATE = {
  status: 'verified',
  tier: 'document_and_face',
  unverified_reason: null,
  identity_match: true,
} as const

const CONFIRMED = { confirmed_at: '2026-01-01T10:00:00Z', trip_reference: 'FP-ABC123' }

function scanResponse(overrides: Partial<api.HandoverScan> = {}): api.HandoverScan {
  return {
    trip_reference: 'FP-ABC123',
    destination_name: 'Depot',
    waybill_references: [],
    expires_at: '2099-01-01T00:00:00Z',
    verification: null,
    ...overrides,
  }
}

async function reachConsentGate(
  scan: api.HandoverScan = scanResponse(),
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  vi.mocked(api.fetchScan).mockResolvedValue(scan)
  vi.mocked(api.recordConsent).mockResolvedValue(UNVERIFIED_STATE)
  vi.mocked(api.recordConsentDecline).mockResolvedValue(UNVERIFIED_STATE)

  render(<HandoverPageClient token={TOKEN} />)

  const [nameInput, idInput] = await screen.findAllByRole('textbox')
  await user.type(nameInput, TYPED_NAME)
  await user.type(idInput, TYPED_ID)
  return user
}

/** Through the consent gate by the "I have no ID" route, onto the screen with the swipe. */
async function reachReady(
  scan: api.HandoverScan = scanResponse(),
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = await reachConsentGate(scan)
  await user.click(await screen.findByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /don.t have my id/i }))
  await screen.findByLabelText(SWIPE_LABEL)
  return user
}

function swipeTrack(): HTMLElement {
  return screen.getByLabelText(SWIPE_LABEL)
}

function pressSwipe(): void {
  fireEvent.keyDown(swipeTrack(), { key: 'Enter' })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(renderAttestation).mockReturnValue(ATTESTATION_DATA_URL)
  sessionStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HandoverPageClient consent handlers', () => {
  it('sends a decline, not a consent, when the receiver skips the identity check', async () => {
    const user = await reachConsentGate()

    await user.click(await screen.findByRole('button', { name: /skip the identity check/i }))

    await waitFor(() => expect(api.recordConsentDecline).toHaveBeenCalledWith(TOKEN, consentPayloadText()))
    expect(api.recordConsent).not.toHaveBeenCalled()
  })

  it('still records consent, with no document, when the receiver agrees but has no ID', async () => {
    const user = await reachConsentGate()

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /don.t have my id/i }))

    await waitFor(() => expect(api.recordConsent).toHaveBeenCalledWith(TOKEN, consentPayloadText(), false))
    expect(api.recordConsentDecline).not.toHaveBeenCalled()
  })

  it('goes straight to confirming when the receiver has no ID — no selfie step', async () => {
    const user = await reachConsentGate()

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /don.t have my id/i }))

    expect(await screen.findByLabelText('Swipe to confirm delivery')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /identity check/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/selfie|photo of your face/i)).not.toBeInTheDocument()
  })
})

describe('HandoverPageClient scan failures', () => {
  it.each([0, 429, 500, 503])(
    'says it could not reach the server, with a retry, for a %i — not that the link is invalid',
    async (status) => {
      vi.mocked(api.fetchScan).mockRejectedValue(new api.HandoverError(status, 'Service Unavailable'))

      render(<HandoverPageClient token={TOKEN} />)

      expect(await screen.findByRole('heading', { name: /couldn.t reach the server/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
      expect(screen.queryByText(/no longer valid/i)).not.toBeInTheDocument()
    },
  )

  it('runs the scan again when "Try again" is pressed, and carries on if it now works', async () => {
    const user = userEvent.setup()
    vi.mocked(api.fetchScan)
      .mockRejectedValueOnce(new api.HandoverError(503, 'Service Unavailable'))
      .mockResolvedValueOnce(scanResponse())

    render(<HandoverPageClient token={TOKEN} />)
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findAllByRole('textbox')).toHaveLength(2)
    expect(api.fetchScan).toHaveBeenCalledTimes(2)
    expect(api.fetchScan).toHaveBeenLastCalledWith(TOKEN)
  })

  it('shows the generic invalid screen for a 404, with no retry and nothing about why', async () => {
    vi.mocked(api.fetchScan).mockRejectedValue(new api.HandoverError(404, 'Not found'))

    render(<HandoverPageClient token={TOKEN} />)

    expect(await screen.findByRole('heading', { name: 'This link is no longer valid' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.queryByText(/already swiped/i)).not.toBeInTheDocument()
    expect(screen.getByText(/same browser that first scanned it/i)).toBeInTheDocument()
  })
})

describe('HandoverPageClient remembered outcome', () => {
  it('shows "Delivery confirmed" when the link is gone but this device saw it succeed', async () => {
    rememberConfirmOutcome(TOKEN, 'confirmed')
    vi.mocked(api.fetchScan).mockRejectedValue(new api.HandoverError(404, 'Not found'))

    render(<HandoverPageClient token={TOKEN} />)

    expect(await screen.findByRole('heading', { name: 'Delivery confirmed' })).toBeInTheDocument()
    expect(screen.queryByText(/no longer valid/i)).not.toBeInTheDocument()
  })

  it('adds that it may already have worked when an attempt was made but never confirmed', async () => {
    rememberConfirmOutcome(TOKEN, 'attempted')
    vi.mocked(api.fetchScan).mockRejectedValue(new api.HandoverError(404, 'Not found'))

    render(<HandoverPageClient token={TOKEN} />)

    expect(await screen.findByRole('heading', { name: 'This link is no longer valid' })).toBeInTheDocument()
    expect(
      screen.getByText("If you already swiped, the delivery may have been confirmed — the driver's screen will show it."),
    ).toBeInTheDocument()
  })

  it('ignores an outcome recorded for a different delivery', async () => {
    rememberConfirmOutcome(OTHER_TOKEN, 'confirmed')
    vi.mocked(api.fetchScan).mockRejectedValue(new api.HandoverError(404, 'Not found'))

    render(<HandoverPageClient token={TOKEN} />)

    expect(await screen.findByRole('heading', { name: 'This link is no longer valid' })).toBeInTheDocument()
    expect(screen.queryByText(/already swiped/i)).not.toBeInTheDocument()
  })
})

describe('HandoverPageClient confirm failures', () => {
  it('keeps the typed details and lets the receiver swipe again after a dropped connection', async () => {
    await reachReady()
    vi.mocked(api.confirmHandover)
      .mockRejectedValueOnce(new api.HandoverError(0, 'The server could not be reached.'))
      .mockResolvedValueOnce(CONFIRMED)

    pressSwipe()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't reach the server. Check your connection and swipe again.",
    )
    expect(screen.getByDisplayValue(TYPED_NAME)).toBeInTheDocument()
    expect(screen.getByDisplayValue(TYPED_ID)).toBeInTheDocument()
    expect(api.confirmHandover).toHaveBeenCalledTimes(1)

    pressSwipe()

    await waitFor(() => expect(api.confirmHandover).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: 'Delivery confirmed' })).toBeInTheDocument()
  })

  it('treats a server fault the same way: stays on the form, nothing lost', async () => {
    await reachReady()
    vi.mocked(api.confirmHandover).mockRejectedValue(new api.HandoverError(503, 'Unavailable'))

    pressSwipe()

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t reach the server/i)
    expect(screen.getByDisplayValue(TYPED_NAME)).toBeInTheDocument()
    expect(screen.queryByText(/no longer valid/i)).not.toBeInTheDocument()
  })

  it.each([
    [7_000, 'Please wait 7 seconds and try again.'],
    [6_100, 'Please wait 7 seconds and try again.'],
    [1_000, 'Please wait 1 second and try again.'],
  ])('tells a rate-limited receiver how long to wait (%i ms)', async (retryAfterMs, expected) => {
    await reachReady()
    vi.mocked(api.confirmHandover).mockRejectedValue(new api.HandoverError(429, 'Too many', retryAfterMs))

    pressSwipe()

    expect(await screen.findByRole('alert')).toHaveTextContent(expected)
  })

  it('does not blame the connection for a rate limit that carried no Retry-After', async () => {
    await reachReady()
    vi.mocked(api.confirmHandover).mockRejectedValue(new api.HandoverError(429, 'Too many'))

    pressSwipe()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/too many attempts/i)
    expect(alert).not.toHaveTextContent(/connection/i)
  })

  it('shows the server message for another 4xx, such as a 422, and stays on the form', async () => {
    await reachReady()
    vi.mocked(api.confirmHandover).mockRejectedValue(
      new api.HandoverError(422, 'String should have at most 120 characters'),
    )

    pressSwipe()

    expect(await screen.findByRole('alert')).toHaveTextContent('String should have at most 120 characters')
    expect(screen.getByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(screen.queryByText(/no longer valid/i)).not.toBeInTheDocument()
  })

  it('moves to the invalid screen, with the "may have been confirmed" note, when the token is refused', async () => {
    await reachReady()
    vi.mocked(api.confirmHandover).mockRejectedValue(new api.HandoverError(404, 'Not found'))

    pressSwipe()

    expect(await screen.findByRole('heading', { name: 'This link is no longer valid' })).toBeInTheDocument()
    expect(screen.getByText(/the delivery may have been confirmed/i)).toBeInTheDocument()
  })

  it('records an attempt before sending and a confirmation after it succeeds', async () => {
    await reachReady()
    let outcomeWhileInFlight: ReturnType<typeof readConfirmOutcome> = null
    vi.mocked(api.confirmHandover).mockImplementation(async () => {
      outcomeWhileInFlight = readConfirmOutcome(TOKEN)
      return CONFIRMED
    })

    pressSwipe()

    expect(await screen.findByRole('heading', { name: 'Delivery confirmed' })).toBeInTheDocument()
    expect(outcomeWhileInFlight).toBe('attempted')
    expect(readConfirmOutcome(TOKEN)).toBe('confirmed')
  })

  it('stamps the signature as made on the receiver\'s own phone, not the driver\'s', async () => {
    await reachReady()
    vi.mocked(api.confirmHandover).mockResolvedValue(CONFIRMED)

    pressSwipe()

    await waitFor(() => expect(renderAttestation).toHaveBeenCalledTimes(1))
    expect(vi.mocked(renderAttestation).mock.calls[0][0].subtitle).toBe(ATTESTATION_SUBTITLE.receiverDevice)
  })

  it('sends the typed identity and no position when none is available', async () => {
    await reachReady()
    vi.mocked(api.confirmHandover).mockResolvedValue(CONFIRMED)

    pressSwipe()

    await waitFor(() => expect(api.confirmHandover).toHaveBeenCalledTimes(1))
    expect(api.confirmHandover).toHaveBeenCalledWith(TOKEN, {
      receiver_name: TYPED_NAME,
      receiver_id_number: TYPED_ID,
      signature_png_base64: ATTESTATION_DATA_URL,
      receiver_lat: null,
      receiver_lng: null,
      receiver_accuracy_m: null,
    })
  })
})

describe('HandoverPageClient signing can never hang', () => {
  it('goes ahead without a position when the receiver ignores the location prompt', async () => {
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: vi.fn() } })
    await reachReady()
    vi.mocked(api.confirmHandover).mockResolvedValue(CONFIRMED)
    vi.useFakeTimers()

    pressSwipe()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(api.confirmHandover).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(api.confirmHandover).toHaveBeenCalledTimes(1)
    expect(api.confirmHandover).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ receiver_lat: null, receiver_lng: null, receiver_accuracy_m: null }),
    )
  })

  it('reports a throw while drawing the signature and leaves the receiver able to try again', async () => {
    await reachReady()
    vi.mocked(renderAttestation).mockImplementation(() => { throw new Error('canvas exploded') })

    pressSwipe()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The signature could not be generated on this device. Please try again.',
    )
    expect(api.confirmHandover).not.toHaveBeenCalled()
    expect(screen.getByLabelText(SWIPE_LABEL)).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByDisplayValue(TYPED_NAME)).toBeEnabled()
  })

  it('reports an unavailable canvas the same way', async () => {
    await reachReady()
    vi.mocked(renderAttestation).mockReturnValue(null)

    pressSwipe()

    expect(await screen.findByRole('alert')).toHaveTextContent(/signature could not be generated/i)
    expect(api.confirmHandover).not.toHaveBeenCalled()
  })
})

describe('HandoverPageClient return from the identity vendor', () => {
  function verificationState(status: api.VerificationState['status']): api.VerificationState {
    return { status, tier: 'document_and_face', unverified_reason: null, identity_match: null }
  }

  it('cross-checks the stashed identity even when the vendor decision is already final', async () => {
    stashIdentity({ name: TYPED_NAME, idNumber: TYPED_ID, token: TOKEN })
    vi.mocked(api.fetchScan).mockResolvedValue(scanResponse({ verification: verificationState('verified') }))
    let release: (state: api.VerificationState) => void = () => {}
    vi.mocked(api.resolveVerification).mockReturnValue(
      new Promise<api.VerificationState>((resolve) => { release = resolve }),
    )

    render(<HandoverPageClient token={TOKEN} />)

    expect(await screen.findByText('Checking your identity result…')).toBeInTheDocument()
    expect(api.resolveVerification).toHaveBeenCalledWith(TOKEN, TYPED_NAME, TYPED_ID)
    expect(sessionStorage.getItem(IDENTITY_STASH_KEY)).toBeNull()

    await act(async () => { release(VERIFIED_STATE) })

    expect(await screen.findByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(screen.getByDisplayValue(TYPED_NAME)).toBeInTheDocument()
    expect(screen.getByDisplayValue(TYPED_ID)).toBeInTheDocument()
    expect(api.resolveVerification).toHaveBeenCalledTimes(1)
  })

  it('cross-checks a pending decision too, and clears the stash', async () => {
    stashIdentity({ name: TYPED_NAME, idNumber: TYPED_ID, token: TOKEN })
    vi.mocked(api.fetchScan).mockResolvedValue(scanResponse({ verification: verificationState('pending') }))
    vi.mocked(api.resolveVerification).mockResolvedValue(VERIFIED_STATE)

    render(<HandoverPageClient token={TOKEN} />)

    expect(await screen.findByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(api.resolveVerification).toHaveBeenCalledWith(TOKEN, TYPED_NAME, TYPED_ID)
    expect(readStashedIdentity()).toBeNull()
  })

  it('still resolves a pending decision when the stash is gone, with nothing typed to compare', async () => {
    vi.mocked(api.fetchScan).mockResolvedValue(scanResponse({ verification: verificationState('pending') }))
    vi.mocked(api.resolveVerification).mockResolvedValue(VERIFIED_STATE)

    render(<HandoverPageClient token={TOKEN} />)

    expect(await screen.findByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(api.resolveVerification).toHaveBeenCalledWith(TOKEN, '', '')
  })

  it('does not resolve an already-final decision on an ordinary reload with no stash', async () => {
    vi.mocked(api.fetchScan).mockResolvedValue(scanResponse({ verification: verificationState('verified') }))

    render(<HandoverPageClient token={TOKEN} />)

    expect(await screen.findByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(api.resolveVerification).not.toHaveBeenCalled()
  })

  it("clears and ignores another delivery's stash — its identity is never applied here", async () => {
    stashIdentity({ name: 'Somebody Else', idNumber: '1111111111111', token: OTHER_TOKEN })
    vi.mocked(api.fetchScan).mockResolvedValue(scanResponse({ verification: verificationState('verified') }))

    render(<HandoverPageClient token={TOKEN} />)

    expect(await screen.findByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(api.resolveVerification).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('Somebody Else')).not.toBeInTheDocument()
    expect(sessionStorage.getItem(IDENTITY_STASH_KEY)).toBeNull()
  })

  it('keeps the stashed identity through a failed scan and a retry', async () => {
    const user = userEvent.setup()
    stashIdentity({ name: TYPED_NAME, idNumber: TYPED_ID, token: TOKEN })
    vi.mocked(api.fetchScan)
      .mockRejectedValueOnce(new api.HandoverError(0, 'The server could not be reached.'))
      .mockResolvedValueOnce(scanResponse({ verification: verificationState('verified') }))
    vi.mocked(api.resolveVerification).mockResolvedValue(VERIFIED_STATE)

    render(<HandoverPageClient token={TOKEN} />)
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(api.resolveVerification).toHaveBeenCalledWith(TOKEN, TYPED_NAME, TYPED_ID)
  })

  it('carries on to the form, with a notice, when the cross-check call fails', async () => {
    stashIdentity({ name: TYPED_NAME, idNumber: TYPED_ID, token: TOKEN })
    vi.mocked(api.fetchScan).mockResolvedValue(scanResponse({ verification: verificationState('verified') }))
    vi.mocked(api.resolveVerification).mockRejectedValue(new api.HandoverError(500, 'Server error'))

    render(<HandoverPageClient token={TOKEN} />)

    expect(await screen.findByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/couldn.t finish the identity check/i)
  })
})

describe('HandoverPageClient vendor redirect', () => {
  const ORIGIN = window.location.origin

  function stubLocation(): ReturnType<typeof vi.fn> {
    const assign = vi.fn()
    vi.stubGlobal('location', { origin: ORIGIN, href: `${ORIGIN}/h/${TOKEN}`, assign })
    return assign
  }

  async function startIdentityCheck(sessionUrl: string | null): Promise<void> {
    const user = await reachConsentGate()
    vi.mocked(api.startVerification).mockResolvedValue({
      session_url: sessionUrl,
      tier: 'document_and_face',
      unverified_reason: null,
    })
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /i have my id with me/i }))
  }

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['plain http to another origin', 'http://verify.example.invalid/session/abc'],
    ['something that is not a URL at all', 'http://'],
  ])('does not follow %s, and says the identity check could not start', async (_label, sessionUrl) => {
    const assign = stubLocation()

    await startIdentityCheck(sessionUrl)

    expect(await screen.findByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(
      "We couldn't start the identity check. You can still confirm the delivery.",
    )
    expect(readStashedIdentity()).toBeNull()
  })

  it.each([
    ['an https vendor URL', 'https://verify.example.invalid/session/abc'],
    ['a same-origin path (the dev mock page)', '/mock-idvs/session-1'],
  ])('follows %s, after stashing the typed identity for the way back', async (_label, sessionUrl) => {
    const assign = stubLocation()

    await startIdentityCheck(sessionUrl)

    await waitFor(() => expect(assign).toHaveBeenCalledWith(sessionUrl))
    expect(readStashedIdentity()).toEqual({ name: TYPED_NAME, idNumber: TYPED_ID, token: TOKEN })
  })

  it('says so, rather than failing silently, when there is no session URL (a degraded tier)', async () => {
    const assign = stubLocation()

    await startIdentityCheck(null)

    expect(await screen.findByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(/couldn.t start the identity check/i)
  })

  it('returns to the identity choice when Back restores the page from the back/forward cache', async () => {
    stubLocation()
    await startIdentityCheck('https://verify.example.invalid/session/abc')
    await screen.findByText('Taking you to the identity check')

    const restored = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(restored, 'persisted', { value: true })
    act(() => { window.dispatchEvent(restored) })

    expect(await screen.findByRole('button', { name: /i have my id with me/i })).toBeInTheDocument()
    expect(screen.queryByText('Taking you to the identity check')).toBeNull()
    expect(readStashedIdentity()).toBeNull()
  })

  it('ignores an ordinary page show, which is not a restore', async () => {
    stubLocation()
    await startIdentityCheck('https://verify.example.invalid/session/abc')
    await screen.findByText('Taking you to the identity check')

    act(() => { window.dispatchEvent(new Event('pageshow')) })

    expect(screen.getByText('Taking you to the identity check')).toBeInTheDocument()
  })

  it('says so when starting the check fails outright', async () => {
    const user = await reachConsentGate()
    vi.mocked(api.startVerification).mockRejectedValue(new api.HandoverError(503, 'Unavailable'))

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /i have my id with me/i }))

    expect(await screen.findByLabelText(SWIPE_LABEL)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/couldn.t start the identity check/i)
  })
})

describe('HandoverPageClient expiry', () => {
  it('shows when the code is valid until', async () => {
    await reachConsentGate(scanResponse({ expires_at: new Date(Date.now() + 5 * MINUTE_MS).toISOString() }))

    expect(screen.getByText(/this code is valid until \d{2}[:.]\d{2}/i)).toBeInTheDocument()
    expect(screen.queryByText(/may have expired/i)).not.toBeInTheDocument()
  })

  it('warns, without blocking the swipe, once the expiry has passed', async () => {
    const expired = scanResponse({ expires_at: new Date(Date.now() - 10 * MINUTE_MS).toISOString() })

    await reachReady(expired)

    expect(await screen.findByText(
      'This code may have expired. If the confirmation is refused, ask the driver for a fresh one.',
    )).toBeInTheDocument()
    expect(swipeTrack()).toHaveAttribute('aria-disabled', 'false')
    vi.mocked(api.confirmHandover).mockResolvedValue(CONFIRMED)
    pressSwipe()
    await waitFor(() => expect(api.confirmHandover).toHaveBeenCalledTimes(1))
  })

  it('allows a minute of clock skew before warning', async () => {
    await reachConsentGate(scanResponse({ expires_at: new Date(Date.now() - 10_000).toISOString() }))

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })

    expect(screen.queryByText(/may have expired/i)).not.toBeInTheDocument()
  })
})

describe('HandoverPageClient form fields', () => {
  it('limits and labels the inputs for what a receiver actually types', async () => {
    await reachConsentGate()

    const [nameInput, idInput] = screen.getAllByRole('textbox')

    expect(nameInput).toHaveAttribute('maxlength', '120')
    expect(nameInput).toHaveAttribute('autocapitalize', 'words')
    expect(nameInput).toHaveAttribute('spellcheck', 'false')
    expect(nameInput).toHaveAttribute('enterkeyhint', 'next')
    expect(idInput).toHaveAttribute('maxlength', '60')
    expect(idInput).toHaveAttribute('autocapitalize', 'characters')
    expect(idInput).toHaveClass('tabular-nums')
    expect(idInput).not.toHaveAttribute('inputmode')
  })

  it('accepts a passport number and links the shape hint to the field', async () => {
    const user = await reachConsentGate()
    const [, idInput] = screen.getAllByRole('textbox')

    await user.clear(idInput)
    await user.type(idInput, 'A1234567')

    const hint = screen.getByText(/not a 13 digit SA ID number/i)
    expect(idInput).toHaveValue('A1234567')
    expect(idInput).toHaveAttribute('aria-describedby', hint.id)
  })

  it('moves to the ID field when Enter is pressed in the name field', async () => {
    const user = await reachConsentGate()
    const [nameInput, idInput] = screen.getAllByRole('textbox')

    await user.click(nameInput)
    await user.keyboard('{Enter}')

    expect(idInput).toHaveFocus()
  })

  it('uses the same fields on the confirm screen', async () => {
    await reachReady()

    const [nameInput, idInput] = screen.getAllByRole('textbox')

    expect(nameInput).toHaveAttribute('maxlength', '120')
    expect(idInput).toHaveAttribute('maxlength', '60')
    expect(nameInput).toHaveValue(TYPED_NAME)
  })
})

describe('HandoverPageClient confirm screen content', () => {
  it('lists the first five waybills and offers the rest behind "Show all"', async () => {
    const user = userEvent.setup()
    const waybills = Array.from({ length: 8 }, (_, i) => `WB-${i + 1}`)
    await reachReady(scanResponse({ waybill_references: waybills }))

    expect(screen.getByText('WB-5')).toBeInTheDocument()
    expect(screen.queryByText('WB-6')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show all 8' }))

    expect(screen.getByText('WB-8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument()
  })

  it('shows a short waybill list in full with no toggle', async () => {
    await reachReady(scanResponse({ waybill_references: ['WB-1', 'WB-2'] }))

    expect(screen.getByText('WB-2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument()
  })

  it('lets a long unbroken destination wrap instead of widening the page', async () => {
    const destination = 'DEPOT'.repeat(40)
    await reachReady(scanResponse({ destination_name: destination }))

    const line = screen.getByText(new RegExp(destination))

    expect(line).toHaveClass('break-words')
    expect(line).toHaveClass('min-w-0')
  })

  it('states the signing terms as a real list, not typed bullet characters', async () => {
    await reachReady()

    expect(screen.getByText('The delivery was received').closest('ul')).toHaveClass('list-disc')
    expect(screen.queryByText(/^•/)).not.toBeInTheDocument()
  })

  it('shows "Confirming…" and ignores a second press while the confirm is in flight', async () => {
    await reachReady()
    let finish: (confirmed: typeof CONFIRMED) => void = () => {}
    vi.mocked(api.confirmHandover).mockReturnValue(
      new Promise<typeof CONFIRMED>((resolve) => { finish = resolve }),
    )

    pressSwipe()

    const busyTrack = await screen.findByLabelText('Confirming…')
    expect(busyTrack).toHaveAttribute('aria-busy', 'true')
    fireEvent.keyDown(busyTrack, { key: 'Enter' })
    expect(api.confirmHandover).toHaveBeenCalledTimes(1)

    await act(async () => { finish(CONFIRMED) })
    expect(await screen.findByRole('heading', { name: 'Delivery confirmed' })).toBeInTheDocument()
  })
})
