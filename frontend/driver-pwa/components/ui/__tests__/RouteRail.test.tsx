import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RouteRail, type RouteStop } from '../RouteRail'

const STOPS: RouteStop[] = [
  { id: 'a', eyebrow: 'Departed 10:02', name: 'FedEx JHB', detail: 'Linbro Park', reached: true },
  { id: 'b', eyebrow: 'Due 19:30', name: 'FedEx DBN', detail: 'Riverhorse Valley', reached: false },
]

describe('RouteRail', () => {
  it('test_lists_stops_in_order_as_an_ordered_list', () => {
    render(<RouteRail stops={STOPS} />)

    const items = within(screen.getByRole('list', { name: 'Route' })).getAllByRole('listitem')

    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('FedEx JHB')
    expect(items[1]).toHaveTextContent('FedEx DBN')
  })

  it('test_marks_the_last_stop_as_the_destination', () => {
    const { container } = render(<RouteRail stops={STOPS} />)

    const markers = container.querySelectorAll('[data-route-marker]')

    expect(markers[0]).toHaveAttribute('data-route-marker', 'stop')
    expect(markers[1]).toHaveAttribute('data-route-marker', 'destination')
  })

  it('test_fills_reached_stops_and_leaves_the_rest_hollow', () => {
    const { container } = render(<RouteRail stops={STOPS} />)

    const markers = container.querySelectorAll('[data-route-marker]')

    expect(markers[0]).toHaveAttribute('data-reached', 'true')
    expect(markers[1]).toHaveAttribute('data-reached', 'false')
  })

  it('test_says_reached_to_screen_readers_not_just_with_a_fill', () => {
    // Nothing conveyed by colour alone (HIG accessibility.md).
    render(<RouteRail stops={STOPS} />)

    expect(screen.getByText('Reached:', { exact: false })).toHaveClass('sr-only')
  })

  it('test_renders_middle_stops_for_a_multi_stop_trip', () => {
    const multi: RouteStop[] = [STOPS[0], { id: 'x', name: 'Cross-dock', reached: false }, STOPS[1]]
    const { container } = render(<RouteRail stops={multi} />)

    const markers = container.querySelectorAll('[data-route-marker]')

    expect(markers).toHaveLength(3)
    expect(markers[1]).toHaveAttribute('data-route-marker', 'stop')
  })
})
