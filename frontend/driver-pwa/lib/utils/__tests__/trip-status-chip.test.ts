// frontend/driver-pwa/lib/utils/__tests__/trip-status-chip.test.ts
import { describe, it, expect } from 'vitest'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import type { CoarseTripStatus } from '@shared/lib/types/phase'
import { tripStatusChip } from '../trip-status-chip'

describe('tripStatusChip', () => {
  it('maps a running trip to the live (green, pulsing) chip', () => {
    const { kind, label } = tripStatusChip('active')

    expect(kind).toBe('live')
    expect(label).toBe('Active')
  })

  it('keeps a closed trip visually distinct from a running one', () => {
    // Both live green: 'live' is a solid fill, 'success' the pale container. If these
    // ever collapse to the same kind, "in progress" and "finished" become the same
    // pill — the exact confusion the solid fill exists to prevent.
    expect(tripStatusChip('closed').kind).toBe('success')
    expect(tripStatusChip('closed').kind).not.toBe(tripStatusChip('active').kind)
  })

  it('leaves the non-running statuses on their existing kinds', () => {
    expect(tripStatusChip('created').kind).toBe('pending')
    expect(tripStatusChip('cancelled').kind).toBe('error')
    expect(tripStatusChip('exception_hold').kind).toBe('warning')
  })

  it('resolves a chip for every coarse trip status', () => {
    const statuses = Object.keys(TRIP_STATUS_META) as CoarseTripStatus[]

    for (const status of statuses) {
      expect(tripStatusChip(status).label).toBe(TRIP_STATUS_META[status].label)
    }
  })
})
