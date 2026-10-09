// app/h/[token]/HandoverPageClient.test.tsx
//
// "Skip the identity check" and "I agree, but I have no document" used to send the same
// consent request, so a refusal was stored as consent. What each handler sends is the
// behaviour under test.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({
  confirmHandover: vi.fn(),
  fetchScan: vi.fn(),
  recordConsent: vi.fn(),
  recordConsentDecline: vi.fn(),
  resolveVerification: vi.fn(),
  startVerification: vi.fn(),
}))

import * as api from '@/lib/api'
import { consentPayloadText } from '@/lib/consent'
import { HandoverPageClient } from './HandoverPageClient'

const TOKEN = 'tok123'

const UNVERIFIED_STATE = {
  status: 'unverified',
  tier: 'typed_only',
  unverified_reason: 'declined_consent',
  identity_match: null,
} as const

async function reachConsentGate(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  vi.mocked(api.fetchScan).mockResolvedValue({
    trip_reference: 'FP-ABC123',
    destination_name: 'Depot',
    waybill_references: [],
    expires_at: '2099-01-01T00:00:00Z',
    verification: null,
  })
  vi.mocked(api.recordConsent).mockResolvedValue(UNVERIFIED_STATE)
  vi.mocked(api.recordConsentDecline).mockResolvedValue(UNVERIFIED_STATE)

  render(<HandoverPageClient token={TOKEN} />)

  const [nameInput, idInput] = await screen.findAllByRole('textbox')
  await user.type(nameInput, 'Thandi Nkosi')
  await user.type(idInput, '9202204720082')
  return user
}

describe('HandoverPageClient consent handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

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
})
