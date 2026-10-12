import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ApiError } from '@/lib/api/client'
import { incidentSheetPdf, listAuditPackAccessEvents, listAuditPacks, listIncidentDeclarations, revokeAuditPack } from '@/lib/api/auditPacks'
import type { AuditPack } from '@/lib/types/auditPack'
import { AuditPacksPanel } from './AuditPacksPanel'

// The API client builds a Supabase client at import time — mocked the same way the other
// panel tests do.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api/auditPacks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auditPacks')>('@/lib/api/auditPacks')
  return {
    ...actual, listAuditPacks: vi.fn(), revokeAuditPack: vi.fn(), listAuditPackAccessEvents: vi.fn(),
    downloadIssuedPdf: vi.fn(), previewAuditPdf: vi.fn(), listIncidentDeclarations: vi.fn(), incidentSheetPdf: vi.fn(),
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

function renderPanel(onIssue = vi.fn(), onDeclare = vi.fn()) {
  render(<ToastProvider><AuditPacksPanel tripId="trip-1" tripReference="TRP-0042" onIssue={onIssue} onDeclare={onDeclare} /></ToastProvider>)
  return { onIssue, onDeclare }
}

beforeEach(() => {
  vi.mocked(listAuditPacks).mockReset()
  vi.mocked(revokeAuditPack).mockReset()
  vi.mocked(listAuditPackAccessEvents).mockReset()
  vi.mocked(listIncidentDeclarations).mockReset().mockResolvedValue([])
  vi.mocked(incidentSheetPdf).mockReset()
})

describe('AuditPacksPanel', () => {
  it('lists issued packs with recipient, seal and views', async () => {
    // Arrange
    vi.mocked(listAuditPacks).mockResolvedValue([pack()])

    // Act
    renderPanel()

    // Assert
    expect(await screen.findByText('TRP-0042-AP1')).toBeInTheDocument()
    expect(screen.getByText(/Jane Adjuster, Santam Claims · Insurance claim · ref CLM-88123/)).toBeInTheDocument()
    expect(screen.getByText(/Sealed on Hedera/)).toBeInTheDocument()
    expect(screen.getByText(/opened 2×/)).toBeInTheDocument()
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
    // Arrange
    vi.mocked(listAuditPacks).mockResolvedValue([])
    const { onIssue } = renderPanel()

    // Act
    await userEvent.click(await screen.findByRole('button', { name: 'Issue audit pack' }))

    // Assert
    expect(onIssue).toHaveBeenCalledOnce()
  })

  it('revokes an active pack and refreshes the list', async () => {
    // Arrange
    vi.mocked(listAuditPacks).mockResolvedValueOnce([pack()]).mockResolvedValueOnce([pack({ status: 'revoked', revoked_at: '2026-09-15T06:00:00Z' })])
    vi.mocked(revokeAuditPack).mockResolvedValue(pack({ status: 'revoked' }))
    renderPanel()

    // Act
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke link' }))

    // Assert
    expect(revokeAuditPack).toHaveBeenCalledWith('pack-1')
    expect(await screen.findByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke link' })).not.toBeInTheDocument()
  })

  it('shows the access log with refused attempts highlighted', async () => {
    // Arrange
    vi.mocked(listAuditPacks).mockResolvedValue([pack()])
    vi.mocked(listAuditPackAccessEvents).mockResolvedValue([
      { event_type: 'denied_revoked', client_ip: '41.0.0.9', user_agent: null, created_at: '2026-09-16T06:00:00Z' },
      { event_type: 'viewed', client_ip: '41.0.0.1', user_agent: null, created_at: '2026-09-14T06:00:00Z' },
    ])
    renderPanel()

    // Act
    await userEvent.click(await screen.findByRole('button', { name: 'Access log' }))

    // Assert
    const log = await screen.findByRole('list', { name: 'Access log for TRP-0042-AP1' })
    expect(log).toHaveTextContent('Tried a revoked link')
    expect(log).toHaveTextContent('41.0.0.9')
    await waitFor(() => expect(screen.getByText('Tried a revoked link')).toHaveClass('text-err'))
  })
})


describe('AuditPacksPanel — police & notifications', () => {
  it('lists declared police details', async () => {
    // Arrange
    vi.mocked(listAuditPacks).mockResolvedValue([])
    vi.mocked(listIncidentDeclarations).mockResolvedValue([{
      declaration_id: 'd-1', exception_id: null, saps_station: 'Harrismith SAPS', saps_cas_number: '123/09/2026',
      saps_officer: null, reported_to_saps_at: null, tracking_company_notified_at: null, insurer_notified_at: null,
      client_notified_at: null, insurer_claim_reference: null, note: null, declared_by_name: 'Ops Desk',
      declared_at: '2026-09-13T06:00:00Z', tier: 'declared',
    }])

    // Act
    renderPanel()

    // Assert
    const section = await screen.findByRole('region', { name: 'Police and notifications' })
    expect(await within(section).findByText('CAS 123/09/2026')).toBeInTheDocument()
    expect(within(section).getByText(/Harrismith SAPS/)).toBeInTheDocument()
  })

  it('opens the declaration dialog through its callback', async () => {
    vi.mocked(listAuditPacks).mockResolvedValue([])
    const { onDeclare } = renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Record police details' }))
    expect(onDeclare).toHaveBeenCalledOnce()
  })

  it('explains a trip with no incident when the fact sheet is refused', async () => {
    // Arrange
    vi.mocked(listAuditPacks).mockResolvedValue([])
    vi.mocked(incidentSheetPdf).mockRejectedValue(new ApiError(409, 'This trip has no critical incident to report.'))
    renderPanel()

    // Act
    await userEvent.click(await screen.findByRole('button', { name: 'Incident fact sheet' }))

    // Assert
    expect(await screen.findByText('This trip has no critical incident to report.')).toBeInTheDocument()
  })
})
