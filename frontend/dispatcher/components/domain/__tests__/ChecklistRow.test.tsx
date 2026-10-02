import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { ChecklistRow, type ColWidths } from '../ChecklistRow'
import type { TripChecklistItem } from '@shared/lib/types/trip'

const COL_WIDTHS: ColWidths = { createdAt: 60, tripId: 242, manifest: 155, driver: 150, route: 130, progress: 300, status: 120 }

function row(overrides: Partial<TripChecklistItem> = {}): TripChecklistItem {
  return {
    id: 'trip-1' as TripChecklistItem['id'],
    trip_reference: 'FP-20261001-AB12CD34',
    pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'JNB', number: 69, display: 'CGY Logistics · JNB 69' },
    status: 'created',
    driver: { full_name: 'Sipho Dlamini' },
    horse: { registration: 'GP 12-34 ZX' },
    origin_precinct_id: null,
    destination_precinct_id: null,
    needs_review_count: 0,
    created_at: '2026-10-01T08:00:00Z',
    current_phase: 'trip_creation',
    current_stop: 0,
    phase_total: 7,
    phase_completed: 1,
    ...overrides,
  }
}

describe('ChecklistRow manifest column', () => {
  it('shows the manifest key, with the client in the tooltip', () => {
    render(<ChecklistRow trip={row()} colWidths={COL_WIDTHS} precincts={[]} />)

    expect(screen.getByText('JNB 69')).toHaveAttribute('title', 'CGY Logistics · JNB 69')
  })

  it('says "Empty leg" for an active empty leg', () => {
    render(<ChecklistRow trip={row({ pp_manifest: null, trip_type: 'empty_leg' })} colWidths={COL_WIDTHS} precincts={[]} />)

    expect(screen.getByText('Empty leg')).toBeInTheDocument()
  })

  it('says "No manifest" for a history row, which carries no trip type', () => {
    render(<ChecklistRow trip={row({ pp_manifest: null })} colWidths={COL_WIDTHS} precincts={[]} />)

    expect(screen.getByText('No manifest')).toBeInTheDocument()
  })
})
