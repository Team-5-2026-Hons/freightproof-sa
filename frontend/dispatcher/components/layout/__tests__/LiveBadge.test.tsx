import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveBadge } from '@/components/layout/LiveBadge'
import { useRealtimeStatus } from '@/lib/realtime/RealtimeProvider'
import type { RealtimeStatus } from '@/lib/realtime/types'

vi.mock('@/lib/realtime/RealtimeProvider', () => ({ useRealtimeStatus: vi.fn() }))

function renderBadge(status: RealtimeStatus, compact = false) {
  vi.mocked(useRealtimeStatus).mockReturnValue(status)
  return render(<LiveBadge compact={compact} />)
}

describe('LiveBadge', () => {
  beforeEach(() => { vi.mocked(useRealtimeStatus).mockReset() })

  it.each<[RealtimeStatus, string]>([
    ['live', 'Live updates connected'],
    ['connecting', 'Connecting to live updates'],
    ['reconnecting', 'Reconnecting to live updates'],
  ])('names_the_stream_not_the_data_when_%s', (status, detail) => {
    renderBadge(status)

    expect(screen.getByRole('status')).toHaveAttribute('title', detail)
    expect(screen.getByRole('status')).toHaveTextContent(detail)
  })

  it('keeps_the_short_visible_label_and_the_full_wording_for_assistive_tech', () => {
    renderBadge('live')

    expect(screen.getByText('Live')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Live updates connected')).toHaveClass('sr-only')
  })

  it('shows_no_visible_label_in_the_collapsed_rail_but_still_names_the_stream', () => {
    renderBadge('live', true)

    expect(screen.queryByText('Live')).toBeNull()
    expect(screen.getByText('Live updates connected')).toHaveClass('sr-only')
  })
})
