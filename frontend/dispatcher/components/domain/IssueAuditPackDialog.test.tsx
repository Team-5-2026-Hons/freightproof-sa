import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ApiError } from '@/lib/api/client'
import { issueAuditPack } from '@/lib/api/auditPacks'
import type { AuditPackIssued } from '@/lib/types/auditPack'
import { IssueAuditPackDialog } from './IssueAuditPackDialog'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api/auditPacks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auditPacks')>('@/lib/api/auditPacks')
  return { ...actual, issueAuditPack: vi.fn() }
})

const ISSUED: AuditPackIssued = {
  pack: {
    id: 'pack-1', pack_label: 'TRP-0042-AP1', trip_id: 'trip-1', consignment_id: null, purpose: 'insurance_claim',
    external_reference: null, recipient_name: 'Jane Adjuster', recipient_organization: 'Santam Claims', recipient_email: null,
    include_location_trail: true, include_full_driver_id: false, manifest_sha256: 'ab', pdf_sha256: 'cd', pdf_size_bytes: 1,
    anchor_status: 'anchored', hedera_topic_id: null, hedera_sequence_number: null, hedera_tx_id: null,
    hedera_consensus_at: null, issued_at: '2026-09-13T06:00:00Z', expires_at: '2026-10-13T06:00:00Z', revoked_at: null,
    status: 'active', view_count: 0, last_viewed_at: null,
  },
  share_token: 'tok', share_url: 'https://portal.freightproof.co.za/p/tok', verify_url: 'https://portal.freightproof.co.za/v/pack-1',
}

function renderDialog(onIssued = vi.fn()) {
  render(
    <ToastProvider>
      <IssueAuditPackDialog tripId="trip-1" consignments={[]} open onClose={vi.fn()} onIssued={onIssued} />
    </ToastProvider>,
  )
  return { onIssued }
}

async function fillRecipient() {
  await userEvent.type(screen.getByLabelText('Recipient name'), 'Jane Adjuster')
  await userEvent.type(screen.getByLabelText('Recipient organisation'), 'Santam Claims')
}

beforeEach(() => {
  vi.mocked(issueAuditPack).mockReset()
})

describe('IssueAuditPackDialog', () => {
  it('keeps Issue disabled until a recipient is named', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'Issue pack' })).toBeDisabled()
  })

  it('sends private-by-default choices and shows the share link once', async () => {
    // Arrange
    vi.mocked(issueAuditPack).mockResolvedValue(ISSUED)
    const { onIssued } = renderDialog()
    await fillRecipient()

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Issue pack' }))

    // Assert
    expect(issueAuditPack).toHaveBeenCalledWith('trip-1', expect.objectContaining({
      recipient_name: 'Jane Adjuster', purpose: 'insurance_claim', include_full_driver_id: false,
      include_location_trail: true, expires_in_days: 30, recipient_email: null, external_reference: null,
    }))
    expect(await screen.findByTestId('share-url')).toHaveTextContent('https://portal.freightproof.co.za/p/tok')
    expect(screen.getByText(/It is shown only now/)).toBeInTheDocument()
    expect(onIssued).toHaveBeenCalledOnce()
  })

  it('explains a missing admin role', async () => {
    // Arrange
    vi.mocked(issueAuditPack).mockRejectedValue(new ApiError(403, 'Admin dispatcher role required.'))
    renderDialog()
    await fillRecipient()

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Issue pack' }))

    // Assert
    expect(await screen.findByText('Only admin dispatchers can issue audit packs.')).toBeInTheDocument()
  })
})
