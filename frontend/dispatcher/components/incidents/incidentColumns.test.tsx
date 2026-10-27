import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { computeColumnLayout } from '@/lib/hooks/useTableColumns'
import type { TableRenderContext } from '@/components/ui/Table'
import type { IncidentSummary } from '@/lib/types/incident'
import { buildIncidentColumns } from './incidentColumns'

const NOW = new Date('2026-10-22T12:00:00Z')
const NOTHING_HIDDEN: TableRenderContext = { hidden: new Set() }
const incident = { incident_id: 'i1', received_at: '2026-10-22T10:00:00Z' } as IncidentSummary

describe('incident columns', () => {
  it('shows_when_it_was_received_as_a_short_age_with_the_exact_time_on_hover', () => {
    const received = buildIncidentColumns(NOW).find(c => c.id === 'received')!

    render(<>{received.render(incident, NOTHING_HIDDEN)}</>)

    expect(screen.getByText('2 h ago')).toHaveAttribute('title', '22 Oct 2026, 12:00 SAST')
  })

  it('shows_a_dash_for_a_received_time_that_does_not_parse', () => {
    const received = buildIncidentColumns(NOW).find(c => c.id === 'received')!

    render(<>{received.render({ ...incident, received_at: 'not-a-date' }, NOTHING_HIDDEN)}</>)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it.each([800, 900, 1000, 1100, 1150, 1280, 1440])('fits_without_scrolling_sideways_at_a_%ipx_container', containerWidth => {
    const layout = computeColumnLayout(buildIncidentColumns(NOW), {}, containerWidth)

    expect(layout.tableWidth).toBe(containerWidth)
    expect(layout.hidden.has('received')).toBe(false)
  })

  it('gives_the_summary_the_widest_share_so_it_absorbs_a_wider_screen', () => {
    const { widths } = computeColumnLayout(buildIncidentColumns(NOW), {}, 1440)

    expect(Math.max(...Object.values(widths))).toBe(widths.summary)
  })
})
