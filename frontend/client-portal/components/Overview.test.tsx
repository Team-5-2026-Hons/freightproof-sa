import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildTimeline } from '@/lib/timeline'
import { makeIncident, makeManifest, makePhase, makeStop } from '@/test/factories'
import { AtAGlance, JourneyStrip } from './Overview'

describe('AtAGlance', () => {
  it('leads with the route, the cargo value and the incident', () => {
    const manifest = makeManifest({
      stops: [makeStop(1, { precinct_name: 'JHB Hub' }), makeStop(2, { precinct_name: 'Durban DC' })],
      incident: makeIncident({ first_exception_type: 'hijacking' }),
      consignments: [{
        consignment_id: 'c-1', parcel_perfect_reference: 'PP-1', client_name: null, declared_value: '125000.00',
        parcel_count_expected: 1, unit_count_expected: null, pickup_stop_id: null, delivery_stop_id: null,
        parcels: [{ barcode: 'B1', status: 'in_transit', pp_scan_out_at: null, pp_scan_in_at: null }],
      }],
    })

    render(<AtAGlance manifest={manifest} />)

    expect(screen.getByText('JHB Hub → Durban DC')).toBeInTheDocument()
    expect(screen.getByText('R 125,000.00')).toBeInTheDocument()
    expect(screen.getByText('1 consignment · 1 parcel')).toBeInTheDocument()
    expect(screen.getByText(/Hijacking reported 12 Sep 2026 13:00 SAST/)).toBeInTheDocument()
  })
})

describe('JourneyStrip', () => {
  const phases = [
    makePhase(0, 'trip_creation', { tier: 'anchored' }),
    makePhase(3, 'departure'),
    makePhase(4, 'in_transit', { status: 'pending', completed_at: null }),
  ]

  it('shows every phase in plan order with its state in words', () => {
    const manifest = makeManifest({ phases })

    render(<JourneyStrip manifest={manifest} items={buildTimeline(manifest)} />)

    const steps = within(screen.getByRole('list', { name: 'Custody journey' })).getAllByRole('listitem')
    expect(steps.map((s) => s.textContent)).toEqual([
      'P0Trip creationAnchored', 'P3DepartureRecorded', 'P4In transitPending',
    ])
  })

  it('says in words where the incident falls against the ledger', () => {
    const manifest = makeManifest({ phases, incident: makeIncident({ first_exception_type: 'hijacking' }) })

    render(<JourneyStrip manifest={manifest} items={buildTimeline(manifest)} />)

    expect(screen.getByText(/Red break: Hijacking reported 12 Sep 2026 13:00 SAST, after P3 was completed\./)).toBeInTheDocument()
  })

  it('draws no break for a trip without an incident', () => {
    const manifest = makeManifest({ phases })

    render(<JourneyStrip manifest={manifest} items={buildTimeline(manifest)} />)

    expect(screen.queryByText(/Red break/)).not.toBeInTheDocument()
  })
})
