import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PackError } from '@/lib/api'
import { makeException, makeManifest, makePhase, makeView } from '@/test/factories'
import { PackViewer } from './PackViewer'

vi.mock('next/dynamic', () => ({ default: () => () => null }))

const fetchPack = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchPack: (token: string) => fetchPack(token),
}))

beforeEach(() => {
  fetchPack.mockReset()
  Element.prototype.scrollIntoView = vi.fn()
})

describe('PackViewer', () => {
  it('shows the pack, its recipient and the observations', async () => {
    // Arrange
    fetchPack.mockResolvedValue(makeView(makeManifest({
      observations: [{ code: 'seal.continuity', level: 'info', text: 'Seal SEAL-001 applied at departure matched.', evidence_ids: [] }],
    })))

    // Act
    render(<PackViewer token="tok" />)

    // Assert
    expect(await screen.findByRole('heading', { name: 'FP-AUDIT-AP1' })).toBeInTheDocument()
    expect(screen.getByText(/issued to Jane Adjuster, Santam Claims/)).toBeInTheDocument()
    expect(screen.getByText('Seal SEAL-001 applied at departure matched.')).toBeInTheDocument()
    expect(fetchPack).toHaveBeenCalledWith('tok')
  })

  it('explains a revoked or expired link', async () => {
    // Arrange
    fetchPack.mockRejectedValue(new PackError(410, 'This audit pack link has expired.'))

    // Act
    render(<PackViewer token="old" />)

    // Assert
    expect(await screen.findByRole('heading', { name: 'This link is no longer active' })).toBeInTheDocument()
    expect(screen.getByText('This audit pack link has expired.')).toBeInTheDocument()
  })

  it('shows an event’s detail when it is picked on the timeline', async () => {
    // Arrange
    const user = userEvent.setup()
    fetchPack.mockResolvedValue(makeView(makeManifest({
      phases: [makePhase(3, 'departure', { seal_number: 'SEAL-001', tier: 'anchored' })],
      exceptions: [makeException('panic_button', 'critical', { description: 'Panic held' })],
    })))
    render(<PackViewer token="tok" />)
    const timeline = await screen.findByRole('list', { name: 'Trip timeline' })

    // Act
    await user.click(within(timeline).getByRole('button', { name: /P3 · Departure/ }))

    // Assert
    expect(screen.getByText('SEAL-001')).toBeInTheDocument()
    await waitFor(() => expect(within(timeline).getByRole('button', { name: /P3 · Departure/ })).toHaveAttribute('aria-current', 'true'))
  })
})

describe('PackViewer incident', () => {
  it('shows declared police facts under the Declared tier and offers the fact sheet', async () => {
    // Arrange
    const panic = makeException('panic_button', 'critical', { description: 'Panic held' })
    fetchPack.mockResolvedValue(makeView(makeManifest({
      exceptions: [panic],
      incident: {
        exception_ids: [panic.exception_id], first_exception_type: 'panic_button', first_raised_at: panic.raised_at,
        position: null, last_known_position: null, first_reviewed_at: null, minutes_to_first_review: null,
      },
      declarations: [{
        declaration_id: 'd-1', exception_id: null, saps_station: 'Harrismith SAPS', saps_cas_number: '123/09/2026',
        saps_officer: null, reported_to_saps_at: '2026-09-12T11:40:00Z', tracking_company_notified_at: null,
        insurer_notified_at: null, client_notified_at: null, insurer_claim_reference: null, note: null,
        declared_by_name: 'Ops Desk', declared_at: '2026-09-13T06:00:00Z', tier: 'declared',
      }],
    })))

    // Act
    render(<PackViewer token="tok" />)

    // Assert
    const incident = await screen.findByRole('region', { name: 'Incident summary' })
    expect(within(incident).getByText(/123\/09\/2026/)).toBeInTheDocument()
    expect(within(incident).getByText(/Harrismith SAPS/)).toBeInTheDocument()
    expect(within(incident).getAllByText('Declared').length).toBeGreaterThan(0)
    expect(within(incident).getByRole('link', { name: 'Download incident fact sheet' })).toHaveAttribute(
      'href', expect.stringContaining('/tok/incident-sheet.pdf'),
    )
  })
})
