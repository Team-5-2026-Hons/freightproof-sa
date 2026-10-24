import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncidentEvidence } from '@/lib/types/incident'
import { IncidentEvidencePanel } from './IncidentEvidencePanel'

const INCIDENT_ID = 'inc-1'

function evidence(overrides: Partial<IncidentEvidence> = {}): IncidentEvidence {
  return {
    incident_id: INCIDENT_ID,
    seals: [{
      phase_event_id: 'p1', phase_type: 'in_transit', precinct_name: 'Rondebosch', seal_number: 'S-1001',
      seal_condition: 'intact', completed_at: '2026-10-20T10:00:00Z', photo_ids: ['a', 'b'],
    }],
    counts: [{
      phase_event_id: 'p2', phase_type: 'loading', precinct_name: null,
      parcel_count_origin: 11, parcel_count_destination: null, driver_visual_count: 10,
    }],
    consignments: [
      { consignment_id: 'c1', reference: 'MFTWB8901', parcel_count_expected: 11, parcels_on_record: 11, scanned_out: 11, scanned_in: 9, no_scan_in_recorded: 2 },
      { consignment_id: 'c2', reference: 'MFTWB8902', parcel_count_expected: 4, parcels_on_record: 4, scanned_out: 4, scanned_in: 4, no_scan_in_recorded: 0 },
    ],
    trip_exceptions: [
      { exception_id: 'e1', exception_type: 'route_deviation', severity: 'warning', description: 'Phone outside the precinct', raised_at: '2026-10-20T18:44:00Z', review_status: 'needs_review', incident_id: null },
      { exception_id: 'e2', exception_type: 'driver_vehicle_separation', severity: 'warning', description: 'Phone and tracker apart', raised_at: '2026-10-20T18:45:00Z', review_status: 'needs_review', incident_id: INCIDENT_ID },
    ],
    last_known_position: { lat: -33.99347, lng: 18.44827, source: 'driver_phone', recorded_at: '2026-10-20T22:14:00Z', accuracy_metres: 12 },
    position_reference_time: '2026-10-21T07:46:00Z',
    coverage_gaps: [
      { start: '2026-10-20T18:44:00Z', end: '2026-10-20T21:12:00Z', minutes: 148 },
      { start: '2026-10-20T21:19:00Z', end: '2026-10-20T22:12:00Z', minutes: 53 },
    ],
    observations: [
      { code: 'phases_pending', level: 'attention', text: '2 of 8 phases resolved; 6 pending.', evidence_ids: [] },
      { code: 'fyi', level: 'info', text: 'Informational only.', evidence_ids: [] },
    ],
    ...overrides,
  }
}

const EMPTY: Partial<IncidentEvidence> = {
  seals: [], counts: [], consignments: [], trip_exceptions: [], last_known_position: null, coverage_gaps: [], observations: [],
}

function renderPanel(data: IncidentEvidence = evidence(), props: { closed?: boolean; onLinkException?: (id: string) => void } = {}) {
  const onLinkException = props.onLinkException ?? vi.fn()
  render(<IncidentEvidencePanel evidence={data} incidentId={INCIDENT_ID} closed={props.closed ?? false} onLinkException={onLinkException} />)
  return { onLinkException }
}

/** The collapsible section whose title is `title`. */
function section(title: string): HTMLDetailsElement {
  return screen.getByRole('heading', { name: title }).closest('details')!
}

const SECTION_TITLES = ['Scans', 'Seals', 'Counts', 'Last known position', 'Tracking gaps']

beforeEach(() => window.localStorage.clear())

describe('IncidentEvidencePanel — order', () => {
  it('puts what needs attention first, then exceptions, then the raw facts', () => {
    // Arrange / Act
    renderPanel()

    // Assert
    const headings = screen.getAllByRole('heading').map(h => h.textContent)
    expect(headings).toEqual(['Needs attention', 'Exceptions on this trip', ...SECTION_TITLES])
  })

  it('shows the attention items and leaves informational observations out', () => {
    // Arrange / Act
    renderPanel()

    // Assert
    expect(screen.getByText('2 of 8 phases resolved; 6 pending.')).toBeInTheDocument()
    expect(screen.queryByText('Informational only.')).not.toBeInTheDocument()
  })

  it('omits the attention block when nothing needs attention', () => {
    // Arrange / Act
    renderPanel(evidence({ observations: [] }))

    // Assert
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument()
  })
})

describe('IncidentEvidencePanel — exceptions', () => {
  it('keeps exceptions visible with their row actions, not folded away', async () => {
    // Arrange
    const { onLinkException } = renderPanel()

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Group here' }))

    // Assert
    expect(screen.getByText('Phone outside the precinct')).toBeVisible()
    expect(screen.getByText('Grouped here')).toBeInTheDocument()
    expect(onLinkException).toHaveBeenCalledWith('e1')
  })

  it('offers no grouping on a closed incident', () => {
    // Arrange / Act
    renderPanel(evidence(), { closed: true })

    // Assert
    expect(screen.queryByRole('button', { name: 'Group here' })).not.toBeInTheDocument()
  })

  it('says so when the trip has no exceptions', () => {
    // Arrange / Act
    renderPanel(evidence({ trip_exceptions: [] }))

    // Assert
    expect(screen.getByText('No exceptions recorded.')).toBeInTheDocument()
  })
})

describe('IncidentEvidencePanel — raw facts', () => {
  it('starts every fact section collapsed', () => {
    // Arrange / Act
    renderPanel()

    // Assert
    for (const title of SECTION_TITLES) expect(section(title).open, title).toBe(false)
  })

  it('says what is inside each section in its summary line', () => {
    // Arrange / Act
    renderPanel()

    // Assert
    expect(within(section('Scans')).getByText(/2 consignments · 13 scanned in · 2 with no scan-in/)).toBeInTheDocument()
    expect(within(section('Seals')).getByText('1 reading · 2 photos')).toBeInTheDocument()
    expect(within(section('Counts')).getByText('1 phase counted')).toBeInTheDocument()
    expect(within(section('Last known position')).getByText(/^driver phone · /)).toBeInTheDocument()
    expect(within(section('Tracking gaps')).getByText('2 gaps · 201 min')).toBeInTheDocument()
  })

  it('says "none" in the summary rather than hiding an empty section', () => {
    // Arrange / Act
    renderPanel(evidence(EMPTY))

    // Assert
    expect(within(section('Scans')).getByText('no consignments on this trip')).toBeInTheDocument()
    expect(within(section('Seals')).getByText('none recorded')).toBeInTheDocument()
    expect(within(section('Counts')).getByText('none recorded')).toBeInTheDocument()
    expect(within(section('Last known position')).getByText('no fix before the reported time')).toBeInTheDocument()
    expect(within(section('Tracking gaps')).getByText('none recorded')).toBeInTheDocument()
  })

  it('opens a section on click', async () => {
    // Arrange
    renderPanel()

    // Act
    await userEvent.click(screen.getByRole('heading', { name: 'Seals' }))

    // Assert
    expect(section('Seals').open).toBe(true)
  })

  it('keeps every piece of evidence reachable once the sections are open', async () => {
    // Arrange
    renderPanel()

    // Act
    for (const title of SECTION_TITLES) await userEvent.click(screen.getByRole('heading', { name: title }))

    // Assert — scans table, with the no-scan-in column
    const scans = within(section('Scans'))
    expect(scans.getByRole('columnheader', { name: 'No scan-in recorded' })).toBeInTheDocument()
    expect(scans.getByRole('cell', { name: 'MFTWB8901' })).toBeInTheDocument()
    expect(scans.getByRole('cell', { name: 'MFTWB8902' })).toBeInTheDocument()
    expect(scans.getByText(/not a finding that a parcel was taken/)).toBeInTheDocument()
    // seals
    expect(within(section('Seals')).getByText(/S-1001/)).toBeInTheDocument()
    expect(within(section('Seals')).getByText(/intact/)).toBeInTheDocument()
    // the summary line and the reading itself both mention the photos
    expect(within(section('Seals')).getAllByText(/2 photos/)).toHaveLength(2)
    // counts
    expect(within(section('Counts')).getByText(/origin 11/)).toBeInTheDocument()
    expect(within(section('Counts')).getByText(/driver counted 10/)).toBeInTheDocument()
    // position, with the reference time it was read at
    expect(within(section('Last known position')).getByText(/-33\.99347, 18\.44827/)).toBeInTheDocument()
    expect(within(section('Last known position')).getByText(/Read at/)).toBeInTheDocument()
    // every tracking gap
    expect(within(section('Tracking gaps')).getByText(/148 min/)).toBeInTheDocument()
    expect(within(section('Tracking gaps')).getByText(/53 min/)).toBeInTheDocument()
  })

  it('still shows the reference time for the position when there is no fix', async () => {
    // Arrange
    renderPanel(evidence({ last_known_position: null }))

    // Act
    await userEvent.click(screen.getByRole('heading', { name: 'Last known position' }))

    // Assert
    expect(within(section('Last known position')).getByText('No position fix before the reported time.')).toBeInTheDocument()
    expect(within(section('Last known position')).getByText(/Read at/)).toBeInTheDocument()
  })
})
