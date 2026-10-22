import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AssistantCard, BookingRow, IncidentRow, RecordRef, TripRow } from '@shared/lib/types/assistant'
import { AssistantCardView } from './AssistantCardView'

const HORSE: RecordRef = { kind: 'vehicle', id: 'v-1', label: 'CA 123-456', detail: 'horse', is_active: true }
const DRIVER: RecordRef = { kind: 'driver', id: 'd-1', label: 'Timothy Gultig', detail: null, is_active: true }
const BOOKING: BookingRow = {
  trip_id: 't-1', trip_reference: 'FP-DEMO-ACTIVE-0001', status: 'active', origin: 'Epping', destination: 'Linbro',
  busy_from: '2026-07-30T06:00:00Z', busy_until: null, planned_until: '2026-07-30T16:00:00Z',
}
const TRIP: TripRow = {
  trip_id: 't-1', trip_reference: 'FP-DEMO-ACTIVE-0001', manifest: null, status: 'closed', trip_type: 'loaded',
  origin: 'Epping', destination: 'Linbro', driver_id: 'd-1', driver: 'Timothy Gultig', horse_id: 'v-1', horse: 'CA 123-456',
  trailers: [], planned_departure_at: '2026-10-20T06:00:00Z', planned_arrival_at: '2026-10-20T16:00:00Z',
  actual_departure_at: '2026-10-20T06:25:00Z', actual_arrival_at: '2026-10-20T16:00:00Z', current_phase: null,
  current_stop: null, phase_completed: 7, phase_total: 7, needs_review: { critical: 0, warning: 0, info: 0 }, overdue: false,
}
const INCIDENT: IncidentRow = {
  incident_id: 'i-1', reference: 'INC-1', incident_type: 'parcel_shortage', status: 'closed', trip_id: 't-1',
  trip_reference: 'FP-DEMO-ACTIVE-0001', received_at: '2026-10-20T17:00:00Z', investigated_by: 'Ciaran', outcome: 'cargo_recovered',
}

function show(card: AssistantCard, onChoose = vi.fn()) {
  render(<AssistantCardView card={card} onNavigate={vi.fn()} onChoose={onChoose} busy={false} />)
  return onChoose
}

describe('AssistantCardView', () => {
  it('bookings: says nothing booked, never "available"', () => {
    show({ type: 'bookings', who: DRIVER, window_start: '2026-10-21T12:00:00Z', window_end: '2026-11-04T12:00:00Z', bookings: [] })

    expect(screen.getByRole('link', { name: 'Timothy Gultig' })).toHaveAttribute('href', '/fleet/drivers/d-1')
    expect(screen.getByText('Nothing booked')).toBeInTheDocument()
    expect(screen.queryByText(/available/i)).not.toBeInTheDocument()
  })

  it('bookings: a live trip past its end is busy until closed, with when it was due', () => {
    show({ type: 'bookings', who: DRIVER, window_start: '2026-10-21T12:00:00Z', window_end: '2026-10-21T12:00:01Z', bookings: [BOOKING] })

    expect(screen.getByText('From 30 Jul, 08:00 SAST, until the trip is closed (was due 30 Jul, 18:00 SAST)')).toBeInTheDocument()
  })

  it('a long trip list points to the Dashboard for live trips and Trip History for finished ones, never a trips list', () => {
    const base = {
      type: 'trip_list' as const, title: 'Closed trips', total: 40, on_the_road: 0, booked: 0, on_hold: 0,
      window_start: null, window_end: null, rows: [], truncated: true,
    }
    const { unmount } = render(<AssistantCardView card={{ ...base, full_list: 'history' }} onNavigate={vi.fn()} onChoose={vi.fn()} busy={false} />)
    expect(screen.getByRole('link', { name: 'See them all in Trip History' })).toHaveAttribute('href', '/history')
    unmount()

    show({ ...base, title: 'Active trips', full_list: 'dashboard' })

    expect(screen.getByRole('link', { name: 'See them all on the Dashboard' })).toHaveAttribute('href', '/')
  })

  it('a whole-day window reads as the day', () => {
    show({
      type: 'trip_list', title: 'Active trips due to arrive', total: 0, on_the_road: 0, booked: 0, on_hold: 0,
      window_start: '2026-10-20T22:00:00Z', window_end: '2026-10-21T22:00:00Z', rows: [], truncated: false, full_list: 'dashboard',
    })

    expect(screen.getByText(/0 on the road · 0 booked · 0 on hold · 21 Oct 2026$/)).toBeInTheDocument()
  })

  it('choose: each option is a button that answers "which one?"', () => {
    const onChoose = show({ type: 'choose', what: 'driver', typed: 'Tim', options: [DRIVER], more: 2 })

    fireEvent.click(screen.getByRole('button', { name: /Timothy Gultig/ }))

    expect(screen.getByText('Which driver?')).toBeInTheDocument()
    expect(screen.getByText('and 2 more')).toBeInTheDocument()
    expect(onChoose).toHaveBeenCalledWith(DRIVER)
  })

  it('vehicle: keeps trip exceptions apart from the vehicle and says maintenance is not recorded', () => {
    show({
      type: 'vehicle', vehicle: HORSE, make: 'Volvo', model: 'FH16', year: 2021, length_m: null, gross_vehicle_mass_kg: 56000,
      licence_disc_expiry: '2027-05-21', disc_state: 'ok', on_trip_now: [],
      exceptions_to_review: { critical: 0, warning: 0, info: 0 }, exception_types: [],
      trip_exceptions_to_review: { critical: 0, warning: 47, info: 0 }, recent_breakdowns: 0, open_incidents: [],
    })

    expect(screen.getByText('Volvo FH16 2021 · 56000 kg GVM')).toBeInTheDocument()
    expect(screen.getByText('Disc valid · 21 May 2027')).toBeInTheDocument()
    expect(screen.getByText('About this vehicle:').parentElement).toHaveTextContent('nothing to review')
    expect(screen.getByText('On all its trips:').parentElement).toHaveTextContent('47 warnings to review')
    expect(screen.getByText('Maintenance history is not recorded in FreightProof.')).toBeInTheDocument()
  })

  it('expiry list: driver licences and vehicle discs together, expired ones marked', () => {
    show({
      type: 'expiry_list', within_days: 30, without_date: 1, truncated: false,
      rows: [
        { record: DRIVER, document: 'driver_licence', expiry: '2026-10-23', expired: false },
        { record: HORSE, document: 'vehicle_disc', expiry: '2026-10-01', expired: true },
      ],
    })

    expect(screen.getByText('Licences and discs expired or due within 30 days · 2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Timothy Gultig' })).toHaveAttribute('href', '/fleet/drivers/d-1')
    expect(screen.getByText('expires 23 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('expired 01 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('1 with no date recorded, so not checked.')).toBeInTheDocument()
  })

  it('route time: driving time, and past trips left out when faster than the road', () => {
    show({
      type: 'route_time', origin: { kind: 'precinct', id: 'p-1', label: 'Epping' },
      destination: { kind: 'precinct', id: 'p-2', label: 'Linbro' }, driving_minutes: 1269, distance_km: 1397,
      driving_unavailable: null, past_trip_count: 3, typical_minutes: null, slow_minutes: null, history_left_out: true,
      history_from: '2025-11-01', history_to: '2026-10-01',
    })

    expect(screen.getByText('Driving time: 21 h 9 min')).toBeInTheDocument()
    expect(screen.getByText(/faster than the road allows/)).toBeInTheDocument()
  })

  it('free crew: lists nothing-booked crew as links per group', () => {
    show({
      type: 'free_crew', window_start: '2026-10-23T22:00:00Z', window_end: '2026-10-25T22:00:00Z',
      groups: [{
        kind: 'horse', nothing_booked: [HORSE], truncated: false,
        booked: [{ who: { kind: 'vehicle', id: 'v-2', label: 'CY 234-901', detail: 'horse' }, bookings: [BOOKING] }],
      }],
    })

    expect(screen.getByText(/booked: FP-DEMO-ACTIVE-0001, until the trip is closed \(was due/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('until until')

    expect(screen.getByText('24 Oct 2026 – 25 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('Horses')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CA 123-456' })).toHaveAttribute('href', '/fleet/vehicles/v-1')
  })

  it('history: counts by status and lists the newest trips', () => {
    show({
      type: 'history', who: DRIVER, window_start: null, window_end: null,
      total: 4, completed: 2, cancelled: 1, live: 1, booked: 0,
      recent: [{ trip_id: 't-1', trip_reference: 'FP-DEMO-ACTIVE-0001', status: 'closed', origin: 'Epping', destination: 'Linbro', happened_at: '2026-10-18T10:00:00Z' }],
    })

    expect(screen.getByText('All time')).toBeInTheDocument()
    expect(screen.getByText('4 trips: 2 completed · 1 cancelled · 1 live · 0 booked')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'FP-DEMO-ACTIVE-0001' })).toHaveAttribute('href', '/trips/t-1')
  })

  it('form preview: what will be filled in, what you fill in, warnings, and that nothing is saved', () => {
    show({
      type: 'form_preview', mode: 'empty_leg', manifest_number: null, manifest_summary: null,
      driver: DRIVER, horse: HORSE, trailers: [], origin: null, destination: { kind: 'precinct', id: 'p-2', label: 'Linbro' },
      departure: '2026-10-22T15:00:00Z', arrival: null,
      warnings: ['Timothy Gultig is booked on FP-1 from 22 Oct, 06:00 until 22 Oct, 18:00.'],
    })

    expect(screen.getByText('The trip form will open with')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Timothy Gultig' })).toBeInTheDocument()
    expect(screen.getAllByText('you fill in')).toHaveLength(2)
    expect(screen.getByText('22 Oct, 17:00 SAST')).toBeInTheDocument()
    expect(screen.getByText(/is booked on FP-1/)).toBeInTheDocument()
    expect(screen.getByText('Nothing is saved until you press Create on the form.')).toBeInTheDocument()
  })

  it('parcel: links to the parcels page with the waybill and barcode', () => {
    show({ type: 'parcel', barcode: 'ABC123', waybill: 'WB-1', journeys: [] })

    expect(screen.getByRole('link', { name: 'Open in Parcels' })).toHaveAttribute('href', '/parcels?waybill=WB-1&barcode=ABC123')
  })

  it('review queue: the Exceptions page count with severities, claims and a link', () => {
    show({
      type: 'review_queue', total: 5, by_severity: { critical: 1, warning: 4, info: 0 }, claimed: 2, unclaimed: 3, on_finished_trips: 1,
    })

    expect(screen.getByText('Exceptions waiting for review · 5')).toBeInTheDocument()
    expect(screen.getByText('1 critical · 4 warnings to review')).toBeInTheDocument()
    expect(screen.getByText('2 claimed · 3 not claimed · 1 on trips already closed or cancelled')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the Exceptions page' })).toHaveAttribute('href', '/exceptions')
  })

  it('trip: delays, delivery, parcels and the stored integrity tally, never "verified"', () => {
    show({
      type: 'trip', trip: TRIP, stops: ['Epping', 'Linbro'], original_driver: null, open_incidents: [],
      delivery_confirmed_at: '2026-10-20T16:30:00Z', closed_at: '2026-10-20T17:00:00Z',
      departure_delay_minutes: 25, arrival_delay_minutes: 0, parcels_booked: 12, parcels_scanned_out: 12, parcels_scanned_in: 11,
      journey_lock_anchored: true, receipts_owed: 7, receipts_anchored: 6, receipts_failed: 1,
    })

    expect(screen.getByText('Left 25 min late · Arrived on time')).toBeInTheDocument()
    expect(screen.getByText('Delivery confirmed 20 Oct, 18:30 SAST')).toBeInTheDocument()
    expect(screen.getByText('Parcels: 12 booked · 12 scanned out · 11 scanned in')).toBeInTheDocument()
    expect(screen.getByText('Journey lock anchored on Hedera')).toBeInTheDocument()
    expect(screen.getByText(/6 of 7 phase receipts anchored/)).toBeInTheDocument()
    expect(screen.getByText(/1 failed/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/verified|untampered/i)
  })

  it('trip: an empty leg with nothing scanned has no parcels line', () => {
    show({
      type: 'trip', trip: { ...TRIP, trip_type: 'empty_leg' }, stops: ['Epping', 'Linbro'], original_driver: null,
      open_incidents: [], delivery_confirmed_at: null, closed_at: null, departure_delay_minutes: null, arrival_delay_minutes: null,
      parcels_booked: null, parcels_scanned_out: 0, parcels_scanned_in: 0,
      journey_lock_anchored: false, receipts_owed: 0, receipts_anchored: 0, receipts_failed: 0,
    })

    expect(screen.queryByText(/Parcels:/)).not.toBeInTheDocument()
    expect(screen.getByText('Journey lock not anchored yet')).toBeInTheDocument()
  })

  it('incidents: the card title, who investigates, the outcome, and a link when cut short', () => {
    show({ type: 'incident_list', title: 'Closed incidents', rows: [INCIDENT], truncated: true })

    expect(screen.getByText('Closed incidents · 1+')).toBeInTheDocument()
    expect(screen.getByText(/with Ciaran · cargo recovered/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See them all on the Incidents page' })).toHaveAttribute('href', '/incidents')
  })

  it('roster: active and inactive counts, names as links, depots with ours or shared', () => {
    show({
      type: 'roster',
      groups: [
        { kind: 'driver', active_total: 41, inactive_total: 2, records: [DRIVER], depots: [], truncated: true },
        {
          kind: 'depot', active_total: 1, inactive_total: null, records: [], truncated: false,
          depots: [{ depot: { kind: 'precinct', id: 'p-1', label: 'Epping' }, address: '1 Main Rd', owned: false }],
        },
      ],
    })

    expect(screen.getByText('Drivers · Depots')).toBeInTheDocument()
    expect(screen.getByText('41 active · 2 inactive')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Timothy Gultig' })).toHaveAttribute('href', '/fleet/drivers/d-1')
    expect(screen.getByRole('link', { name: 'See them all on the Drivers page' })).toHaveAttribute('href', '/fleet/drivers')
    expect(screen.getByRole('link', { name: 'Epping' })).toHaveAttribute('href', '/precincts/p-1')
    expect(screen.getByText('(shared with us)')).toBeInTheDocument()
  })
})
