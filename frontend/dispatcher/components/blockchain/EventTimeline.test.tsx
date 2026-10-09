import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EventTimeline } from './EventTimeline'
import type { VehicleEvent } from '@shared/lib/types/blockchain'

// The forensic badge is not what these tests are about.
vi.mock('./ForensicOnly', () => ({ ForensicOnly: () => null }))

function event(overrides: Partial<VehicleEvent> = {}): VehicleEvent {
  return {
    id: 'evt-1',
    vehicle_id: 'veh-1',
    event_type: 'created',
    changed_fields: {},
    changed_by_user_id: 'user-1',
    blockchain_receipt_id: null,
    created_at: '2026-09-05T14:30:00Z',
    ...overrides,
  } as VehicleEvent
}

describe('EventTimeline timestamps', () => {
  it('shows each event in SAST with the same wording as every other date in the app', () => {
    render(<EventTimeline events={[event()]} receipts={[]} />)

    // 14:30Z is 16:30 SAST; "Sep", not the "Sept" some browsers' locale data would print.
    expect(screen.getByText('05 Sep 2026, 16:30 SAST')).toBeInTheDocument()
  })

  it('shows a dash rather than "Invalid Date" for an unreadable timestamp', () => {
    render(<EventTimeline events={[event({ created_at: 'garbage' })]} receipts={[]} />)

    expect(screen.queryByText(/Invalid Date/)).toBeNull()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('says so when there are no events', () => {
    render(<EventTimeline events={[]} receipts={[]} />)

    expect(screen.getByText('No events recorded yet.')).toBeInTheDocument()
  })
})
