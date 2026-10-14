import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Precinct } from '@shared/lib/types/precinct'
import { mockPrecincts } from '@shared/lib/mocks'
import { CHECK_WORDING, type PhaseCheck } from '@/lib/phase/checks'
import { VIEW_ON_MAP_LABEL } from '../LocationEvidencePanel'
import { PhaseChecks, type PhaseChecksProps } from '../PhaseChecks'
import { makePhase } from './testFixtures'
import { line } from './textLine'

// The map modal pulls in Leaflet, which these tests never open.
vi.mock('@/components/map/LocationComparisonMap', () => ({ LocationComparisonMap: () => null }))

const PRECINCT: Precinct = mockPrecincts[0]!

function check(key: PhaseCheck['key'], result: PhaseCheck['result'], title: string, detail: string): PhaseCheck {
  return { key, result, title, detail }
}

function props(overrides: Partial<PhaseChecksProps> = {}): PhaseChecksProps {
  return { phase: makePhase('loading', { status: 'completed' }), checks: [], zone: 'checks', precinct: PRECINCT, slotTime: null, ...overrides }
}

describe('PhaseChecks', () => {
  it('shows one line per check with an icon and words, and the detail under it', () => {
    const checks = [
      check('parcels', 'pass', 'All parcels scanned', '7 scanned of 7 expected'),
      check('truck_geofence', 'pass', 'Truck within precinct tolerance', 'inside the boundary'),
      check('driver_proximity', 'flag', 'Driver separated from truck', 'further apart than the limit'),
    ]

    render(<PhaseChecks {...props({ checks })} />)

    const region = screen.getByRole('region', { name: 'Checked' })
    const lines = within(region).getAllByRole('listitem')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toHaveTextContent('All parcels scanned')
    expect(lines[0]).toHaveTextContent('7 scanned of 7 expected')
    expect(lines[2]).toHaveTextContent('Driver separated from truck')
    expect(lines.map(line => line.getAttribute('data-check-result'))).toEqual(['pass', 'pass', 'flag'])
  })

  it('applies the numeric rule to the counts and seal numbers in a check\'s title and detail', () => {
    const checks = [
      check('seal_number', 'flag', 'Seal number differs from departure', 'Recorded FP-1234 at departure and FP-9999 at arrival.'),
      check('counts', 'flag', '1 parcel unaccounted for', '7 scanned out at origin, 6 scanned in at destination'),
    ]

    render(<PhaseChecks {...props({ checks })} />)

    expect(screen.getByText('FP-1234')).toHaveClass('tabular-nums', 'font-semibold')
    expect(screen.getByText('FP-9999')).toHaveClass('tabular-nums')
    expect(screen.getAllByText('7')[0]).toHaveClass('tabular-nums')
    expect(screen.getAllByText('1')[0]).toHaveClass('tabular-nums')
  })

  it('makes the "Location details" summary a 44 px touch target', () => {
    const phase = makePhase('activation', { status: 'completed' })

    render(<PhaseChecks {...props({ phase })} />)

    expect(screen.getByText('Location details').closest('summary')).toHaveClass('min-h-11')
  })

  it('shows the truck geofence and the driver proximity as separate lines, never as "Location verified"', () => {
    const checks = [
      check('truck_geofence', 'pass', 'Truck within precinct tolerance', 'a'),
      check('driver_proximity', 'pass', 'Driver with truck', 'b'),
    ]

    render(<PhaseChecks {...props({ checks })} />)

    expect(screen.getByText('Truck within precinct tolerance')).toBeInTheDocument()
    expect(screen.getByText('Driver with truck')).toBeInTheDocument()
    expect(screen.queryByText(/Location verified/)).not.toBeInTheDocument()
  })

  it('says when the checks will appear, with the per-phase verb, and shows the live scan as in progress', () => {
    const live = check('parcels', 'in_progress', 'Scan in progress', '3 of 7 parcels scanned onto the truck so far. This count may still change.')

    render(<PhaseChecks {...props({ zone: 'awaiting', checks: [live] })} />)

    expect(screen.getByText('Checks appear when the driver confirms loading')).toBeInTheDocument()
    expect(screen.getByText('Scan in progress')).toBeInTheDocument()
    expect(screen.getByText(/This count may still change/)).toBeInTheDocument()
    expect(screen.getByText('Scan in progress').closest('li')).toHaveAttribute('data-check-result', 'in_progress')
  })

  it('uses the delivery verb for confirmation', () => {
    render(<PhaseChecks {...props({ zone: 'awaiting', phase: makePhase('confirmation') })} />)

    expect(screen.getByText('Checks appear when the driver confirms delivery')).toBeInTheDocument()
  })

  it('renders nothing for a phase with no Checked zone', () => {
    const { container } = render(<PhaseChecks {...props({ zone: 'none' })} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('states the driver\'s blind count note under Checked on a confirmation that recorded one', () => {
    const phase = makePhase('confirmation', { status: 'completed', driver_visual_count: 6 })

    render(<PhaseChecks {...props({ phase, checks: [check('counts', 'pass', 'Counts agree', 'x')] })} />)

    expect(screen.getByText(CHECK_WORDING.counts.blindCountNote)).toBeInTheDocument()
  })

  it('leaves the blind count note out when the driver recorded no count', () => {
    const phase = makePhase('confirmation', { status: 'completed', driver_visual_count: null })

    render(<PhaseChecks {...props({ phase, checks: [check('counts', 'pass', 'Counts agree', 'x')] })} />)

    expect(screen.queryByText(CHECK_WORDING.counts.blindCountNote)).not.toBeInTheDocument()
  })

  it('keeps location details closed until the reader opens them', () => {
    const phase = makePhase('loading', {
      status: 'completed', driver_phone_lat: -33.9249, driver_phone_lng: 18.4241, horse_gps_lat: -33.9251, horse_gps_lng: 18.4243,
      pulsit_geofence_confirmed: true,
    })

    render(<PhaseChecks {...props({ phase, checks: [check('truck_geofence', 'pass', 'Truck within precinct tolerance', 'a')] })} />)

    const details = screen.getByText('Location details').closest('details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Location details'))
    expect(details).toHaveAttribute('open')
    expect(within(details!).getByText('Driver phone capture time')).toBeInTheDocument()
    expect(within(details!).getByText('Horse tracker capture time')).toBeInTheDocument()
    expect(within(details!).getByText('Driver–truck separation')).toBeInTheDocument()
    expect(within(details!).getByText('Boundary')).toBeInTheDocument()
    expect(within(details!).getByRole('button', { name: VIEW_ON_MAP_LABEL })).toBeInTheDocument()
  })

  it('offers no "Location details" for a phase that recorded no location at all', () => {
    render(<PhaseChecks {...props({ checks: [check('parcels', 'pass', 'All parcels scanned', 'x')] })} />)

    expect(screen.queryByText('Location details')).not.toBeInTheDocument()
  })

  it('puts the expected precinct, address and slot time of an activation behind "Location details"', () => {
    const phase = makePhase('activation', { status: 'completed' })

    render(<PhaseChecks {...props({ phase, slotTime: '2026-01-01T08:00:00Z' })} />)

    const details = screen.getByText('Location details').closest('details')!
    expect(within(details).getByText('Precinct')).toBeInTheDocument()
    expect(within(details).getByText(PRECINCT.name)).toBeInTheDocument()
    expect(within(details).getByText('Address')).toBeInTheDocument()
    expect(within(details).getByText('Slot time')).toBeInTheDocument()
  })

  it('never writes "Arrived" for an activation (the header already says when)', () => {
    render(<PhaseChecks {...props({ phase: makePhase('activation', { status: 'completed' }) })} />)

    expect(screen.queryByText('Arrived')).not.toBeInTheDocument()
  })
})

describe('PhaseChecks: in_transit', () => {
  const transit = makePhase('in_transit', { status: 'pending' })

  it('shows the standing seal line, the named absence, and the no-verdict line with no checks that can pass', () => {
    const seal = check('seal_inspection', 'not_checked', 'Seal not inspected yet', 'Sealed FP-6390 at departure. The seal is first inspected at Arrival.')

    render(<PhaseChecks {...props({ phase: transit, checks: [seal], zone: 'checks' })} />)

    expect(screen.getByText('Seal not inspected yet')).toBeInTheDocument()
    expect(screen.getByText('Only recorded journey events are shown. A tracker check appears here only when it raises an exception.')).toBeInTheDocument()
    expect(screen.getByText('No location verdict is recorded for transit legs')).toBeInTheDocument()
    expect(screen.queryByText(/Checks appear when/)).not.toBeInTheDocument()
    expect(screen.queryByText('Location details')).not.toBeInTheDocument()
  })

  it('keeps the recorded arrival fix behind "Location details" once the leg has one', () => {
    const arrived = makePhase('in_transit', { status: 'completed', driver_phone_lat: -33.9, driver_phone_lng: 18.4, horse_gps_lat: -33.9, horse_gps_lng: 18.4 })

    render(<PhaseChecks {...props({ phase: arrived, checks: [], zone: 'checks', precinct: undefined })} />)

    const details = screen.getByText('Location details').closest('details')!
    expect(within(details).getByText('Recorded location at arrival')).toBeInTheDocument()
    expect(within(details).getByText('Driver phone capture time')).toBeInTheDocument()
  })
})
