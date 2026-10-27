import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ApiError } from '@/lib/api/client'
import { listAuditPackAccessEvents, listAuditPacks, revokeAuditPack } from '@/lib/api/auditPacks'
import type { AuditPack } from '@/lib/types/auditPack'
import { AuditPacksPanel } from './AuditPacksPanel'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api/auditPacks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auditPacks')>('@/lib/api/auditPacks')
  return {
    ...actual, listAuditPacks: vi.fn(), revokeAuditPack: vi.fn(), listAuditPackAccessEvents: vi.fn(),
    downloadIssuedPdf: vi.fn(), previewAuditPdf: vi.fn(),
  }
})

function pack(overrides: Partial<AuditPack> = {}): AuditPack {
  return {
    id: 'pack-1', pack_label: 'TRP-0042-AP1', trip_id: 'trip-1', consignment_id: null, purpose: 'insurance_claim',
    external_reference: 'CLM-88123', recipient_name: 'Jane Adjuster', recipient_organization: 'Santam Claims',
    recipient_email: null, include_location_trail: true, include_full_driver_id: false,
    manifest_sha256: 'ab'.repeat(32), pdf_sha256: 'cd'.repeat(32), pdf_size_bytes: 52000, anchor_status: 'anchored',
    hedera_topic_id: '0.0.2002', hedera_sequence_number: 4, hedera_tx_id: '0.0.1@1.0', hedera_consensus_at: null,
    issued_at: '2026-09-13T06:00:00Z', expires_at: '2026-10-13T06:00:00Z', revoked_at: null, status: 'active',
    view_count: 2, last_viewed_at: '2026-09-14T08:00:00Z', ...overrides,
  }
}

function renderPanel(onIssue = vi.fn()) {
  render(<ToastProvider><AuditPacksPanel tripId="trip-1" tripReference="TRP-0042" onIssue={onIssue} /></ToastProvider>)
  return { onIssue }
}

beforeEach(() => {
  vi.mocked(listAuditPacks).mockReset()
  vi.mocked(revokeAuditPack).mockReset()
  vi.mocked(listAuditPackAccessEvents).mockReset()
})

describe('AuditPacksPanel', () => {
  it('lists issued packs with recipient, seal and views', async () => {
    vi.mocked(listAuditPacks).mockResolvedValue([pack()])

    renderPanel()

    expect(await screen.findByText('TRP-0042-AP1')).toBeInTheDocument()
    expect(screen.getByText(/Jane Adjuster, Santam Claims/)).toBeInTheDocument()
    expect(screen.getByText(/Insurance claim · ref CLM-88123/)).toBeInTheDocument()
    expect(screen.getByText(/Sealed on Hedera/)).toBeInTheDocument()
    expect(screen.getByText(/2× · last/)).toBeInTheDocument()
    expect(screen.queryByText('0.0.1@1.0')).not.toBeInTheDocument()
  })

  it('opens with its own actions, carries no heading (the section supplies it) and no explainer', async () => {
    vi.mocked(listAuditPacks).mockResolvedValue([])
    renderPanel()

    await screen.findByText('No audit packs issued for this trip yet.')
    expect(screen.queryByRole('heading', { name: 'Audit packs' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Issue audit pack' })).toHaveClass('bg-surf-high')
    expect(screen.queryByText('How facts are labelled')).not.toBeInTheDocument()
  })

  it('shows skeleton rows, not a sentence, while packs load', () => {
    vi.mocked(listAuditPacks).mockReturnValue(new Promise(() => {}))
    renderPanel()

    expect(screen.getByRole('status', { name: 'Loading audit packs' })).toBeInTheDocument()
  })

  it('says when no packs exist yet', async () => {
    vi.mocked(listAuditPacks).mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText('No audit packs issued for this trip yet.')).toBeInTheDocument()
  })

  it('explains the admin requirement instead of a raw error', async () => {
    vi.mocked(listAuditPacks).mockRejectedValue(new ApiError(403, 'Admin dispatcher role required.'))
    renderPanel()
    expect(await screen.findByText('Only admin dispatchers can see and issue audit packs.')).toBeInTheDocument()
  })

  it('opens the issue dialog through its callback', async () => {
    vi.mocked(listAuditPacks).mockResolvedValue([])
    const { onIssue } = renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Issue audit pack' }))

    expect(onIssue).toHaveBeenCalledOnce()
  })

  it('revokes an active pack and refreshes the list', async () => {
    vi.mocked(listAuditPacks).mockResolvedValueOnce([pack()]).mockResolvedValueOnce([pack({ status: 'revoked', revoked_at: '2026-09-15T06:00:00Z' })])
    vi.mocked(revokeAuditPack).mockResolvedValue(pack({ status: 'revoked' }))
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke link' }))

    expect(revokeAuditPack).toHaveBeenCalledWith('pack-1')
    expect(await screen.findByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke link' })).not.toBeInTheDocument()
  })

  it('shows the access log with refused attempts highlighted', async () => {
    vi.mocked(listAuditPacks).mockResolvedValue([pack()])
    vi.mocked(listAuditPackAccessEvents).mockResolvedValue([
      { event_type: 'denied_revoked', client_ip: '41.0.0.9', user_agent: null, created_at: '2026-09-16T06:00:00Z' },
      { event_type: 'viewed', client_ip: '41.0.0.1', user_agent: null, created_at: '2026-09-14T06:00:00Z' },
    ])
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Access log' }))

    const log = await screen.findByRole('list', { name: 'Access log for TRP-0042-AP1' })
    expect(log).toHaveTextContent('Tried a revoked link')
    expect(log).toHaveTextContent('41.0.0.9')
    await waitFor(() => expect(screen.getByText('Tried a revoked link')).toHaveClass('text-err'))
  })

  it('labels the mailed-password events and highlights wrong passwords', async () => {
    vi.mocked(listAuditPacks).mockResolvedValue([pack()])
    vi.mocked(listAuditPackAccessEvents).mockResolvedValue([
      { event_type: 'denied_bad_password', client_ip: '41.0.0.9', user_agent: null, created_at: '2026-09-16T06:03:00Z' },
      { event_type: 'password_verified', client_ip: '41.0.0.1', user_agent: null, created_at: '2026-09-16T06:02:00Z' },
      { event_type: 'password_emailed', client_ip: '41.0.0.1', user_agent: null, created_at: '2026-09-16T06:01:00Z' },
      { event_type: 'denied_unverified', client_ip: '41.0.0.1', user_agent: null, created_at: '2026-09-16T06:00:00Z' },
    ])
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Access log' }))

    const log = await screen.findByRole('list', { name: 'Access log for TRP-0042-AP1' })
    expect(log).toHaveTextContent('Password emailed')
    expect(log).toHaveTextContent('Entered the mailed password')
    expect(log).toHaveTextContent('Opened without the password')
    await waitFor(() => expect(screen.getByText('Entered a wrong password')).toHaveClass('text-err'))
  })
})


describe('AuditPacksPanel — police details moved', () => {
  it('no longer renders police & notifications or asks for declarations', async () => {
    vi.mocked(listAuditPacks).mockResolvedValue([])
    renderPanel()

    await screen.findByText('No audit packs issued for this trip yet.')
    expect(screen.queryByRole('region', { name: 'Police and notifications' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record police details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Incident fact sheet' })).not.toBeInTheDocument()
  })
})
