import { createRef } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ParcelTraceResponse } from '@shared/lib/types/parcel-trace'
import { ParcelOverview } from './ParcelOverview'
import { BARCODE, MANIFEST_GAP, MISSING_SCAN_GAP, WAYBILL, makeJourney, makeManifestOnlyJourney, makeScan, makeTrace, makeWayJourney } from './__fixtures__/trace'

const RETURN_TO = '/parcels?barcode=000123%2Fa&waybill=WB-TRACE-01'
const follows = (first: Element, second: Element): boolean => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
const flat = (node: Element | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()

const NOT_LOADING = { loadingMore: false, onLoadMore: (): void => undefined }

function renderOverview(trace: ParcelTraceResponse = makeTrace([makeWayJourney()])): HTMLElement {
  return render(<ParcelOverview trace={trace} returnTo={RETURN_TO} {...NOT_LOADING} />).container
}

describe('ParcelOverview header', () => {
  it('is the current recorded state region with a focusable barcode heading the results controller can reach', () => {
    const ref = createRef<HTMLHeadingElement>()
    render(<ParcelOverview trace={makeTrace([makeWayJourney()])} returnTo={RETURN_TO} headingRef={ref} {...NOT_LOADING} />)

    const heading = screen.getByRole('heading', { level: 2, name: BARCODE })

    expect(screen.getByRole('region', { name: 'Current recorded state' })).toContainElement(heading)
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(ref.current).toBe(heading)
  })
  it('names the barcode, the status badge, the waybill and the route', () => {
    renderOverview()

    const region = screen.getByRole('region', { name: 'Current recorded state' })

    expect(within(region).getByText('Trip cancelled after departure')).toBeInTheDocument()
    expect(within(region).getByText(`Waybill ${WAYBILL} · Origin Depot → Destination Depot`)).toBeInTheDocument()
  })
  it('lets the status badge wrap rather than overflow a narrow screen', () => {
    renderOverview()

    expect(screen.getByText('Trip cancelled after departure')).toHaveClass('!whitespace-normal')
  })
  // Cancellation is red everywhere else in the app (TRIP_STATUS_META.cancelled), so the badge keeps its own wording but takes that colour.
  it('colours a cancelled badge with the shared cancelled chip type, and other states with their own', () => {
    renderOverview()
    expect(screen.getByText('Trip cancelled after departure')).toHaveClass('bg-err-c')

    renderOverview(makeTrace([makeJourney()]))
    expect(screen.getByText('In transit — awaiting arrival attestation')).not.toHaveClass('bg-err-c')
  })
  it('says pickup or delivery is unknown rather than leaving the route blank', () => {
    renderOverview(makeTrace([makeWayJourney({ origin_name: null, destination_name: null })]))

    expect(screen.getByText(`Waybill ${WAYBILL} · Pickup unknown → Delivery unknown`)).toBeInTheDocument()
  })
  it('shows the status line for the latest journey', () => {
    const container = renderOverview()

    expect(flat(container.querySelector('[data-status-line]'))).toBe('Last recorded: departed Origin Depot under seal SEAL-WAY on 15 Oct, 12:10 SAST.')
  })
  it('leaves manifest-only wording to the API gap: the page adds no manifest sentence of its own', () => {
    renderOverview(makeTrace([makeManifestOnlyJourney()]))

    expect(screen.queryByText(/Planned manifest membership only/)).not.toBeInTheDocument()
    expect(screen.getAllByText(MANIFEST_GAP)).toHaveLength(1)
  })
})

const withEarlier = (extra: Partial<ParcelTraceResponse> = {}): ParcelTraceResponse => ({
  ...makeTrace([makeWayJourney(), makeJourney({ trip_id: 'trip-2', trip_reference: 'TRP-OLD-2', scans: [makeScan(2, { scan_out_at: '2026-09-01T10:00:00Z' })] })]), ...extra,
})

describe('ParcelOverview composition', () => {
  it('reads header, status line, steps, not-recorded line, view trip, then earlier trips', () => {
    const container = renderOverview(withEarlier())

    const heading = screen.getByRole('heading', { level: 2, name: BARCODE })
    const status = container.querySelector('[data-status-line]')!
    const firstStep = container.querySelector('[data-step]')!
    const notRecorded = container.querySelector('[data-not-recorded]')!
    const [viewTrip] = screen.getAllByRole('link', { name: 'View trip' })
    const earlier = screen.getByRole('heading', { level: 3, name: 'Earlier trips' })
    expect(follows(heading, status)).toBe(true)
    expect(follows(status, firstStep)).toBe(true)
    expect(follows(firstStep, notRecorded)).toBe(true)
    expect(follows(notRecorded, viewTrip)).toBe(true)
    expect(follows(viewTrip, earlier)).toBe(true)
  })
  it('is one card: a single timeline for the latest journey inside one region, with no nested card of its own', () => {
    const container = renderOverview()

    expect(container.querySelectorAll('[role="region"], section')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { name: 'What was recorded for this parcel' })).toHaveLength(1)
  })
  it('targets the trip page from the View trip button and keeps returnTo', () => {
    renderOverview()

    const url = new URL(screen.getByRole('link', { name: 'View trip' }).getAttribute('href')!, 'https://example.test')

    expect(url.pathname).toBe('/trips/trip-1')
    expect(url.searchParams.get('returnTo')).toBe(RETURN_TO)
  })
  it('keeps an earlier journey’s steps and scans out of the latest timeline, inside the collapsed earlier-trips section', () => {
    const container = renderOverview(withEarlier())

    const latestTimeline = container.querySelector('ol')!
    const row = container.querySelector<HTMLDetailsElement>('[data-trip-id="trip-2"]')!

    expect(latestTimeline).not.toHaveTextContent('01 Sep')
    expect(latestTimeline).not.toHaveTextContent('TRP-OLD-2')
    expect(row).toHaveTextContent('01 Sep')
    expect(row.open).toBe(false)
  })
  it('does not bring back the old summary tiles or sealed-leg caption', () => {
    renderOverview()

    expect(screen.queryByRole('heading', { name: 'Parcel scans' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Last recorded phase' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Sealed leg/ })).not.toBeInTheDocument()
  })
  it('shows the latest journey’s API gaps once, verbatim, inside the timeline', () => {
    renderOverview()

    expect(screen.getAllByText(MISSING_SCAN_GAP)).toHaveLength(1)
  })
})

describe('ParcelOverview wording limits (moved from the summary)', () => {
  it('reads a delivery override without saying delivered, and makes no live-location or Parcel Perfect claim', () => {
    const overridden = makeJourney({ progress: { position: 'after_delivery', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: true } })
    const container = renderOverview(makeTrace([overridden]))

    expect(container.textContent).toContain('Journey resolved with an override')
    expect(container.textContent).not.toMatch(/Delivery phase recorded|delivered|delivery confirmed/i)
    expect(container.textContent).not.toMatch(/current parcel location|parcel perfect/i)
  })
})

describe('ParcelOverview earlier trips', () => {
  it('puts a plain earlier-trips section at the bottom of the card, not a disclosure', () => {
    renderOverview(withEarlier())

    const region = screen.getByRole('region', { name: 'Current recorded state' })
    const heading = within(region).getByRole('heading', { level: 3, name: 'Earlier trips' })

    expect(heading.closest('details')).toBeNull()
    expect(within(region).getByText('1 loaded')).toBeInTheDocument()
    expect([...region.querySelectorAll('h3')].at(-1)).toBe(heading)
  })
  it('keeps one View trip button for the latest journey ahead of the earlier trips’ own', () => {
    renderOverview(withEarlier())

    const buttons = screen.getAllByRole('link', { name: 'View trip' })

    expect(buttons).toHaveLength(2)
    expect(new URL(buttons[0].getAttribute('href')!, 'https://example.test').pathname).toBe('/trips/trip-1')
    expect(new URL(buttons[1].getAttribute('href')!, 'https://example.test').pathname).toBe('/trips/trip-2')
  })
  it('has no earlier-trips section when there are none and nothing more to load', () => {
    renderOverview()

    expect(screen.queryByRole('heading', { name: 'Earlier trips' })).not.toBeInTheDocument()
  })
  it('passes the load-more handler through to the section', async () => {
    const user = userEvent.setup()
    const onLoadMore = vi.fn()
    render(<ParcelOverview trace={withEarlier({ next_cursor: 'cursor-1' })} returnTo={RETURN_TO} loadingMore={false} onLoadMore={onLoadMore} />)

    await user.click(screen.getByRole('button', { name: 'Load earlier journeys' }))

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
  it('has no earlier-trips section for a parcel with no journey', () => {
    renderOverview({ ...makeTrace([]), next_cursor: 'cursor-1' })

    expect(screen.queryByRole('heading', { name: 'Earlier trips' })).not.toBeInTheDocument()
  })
})

describe('ParcelOverview parcel record popover', () => {
  const LABEL = 'How to read this parcel record'
  const SCAN = 'Parcel scans are recorded against the barcode. They do not identify the source system or whether it was simulated.'
  const POSITION = 'Vehicle and phone positions are inherited from consignment evidence; they are not parcel GPS or live tracking.'
  const SEALED = 'The contents of a sealed leg are not observable.'

  it('is a labelled button beside the status badge, closed by default', () => {
    renderOverview()

    const button = screen.getByRole('button', { name: LABEL })

    expect(button.closest('header')).toContainElement(screen.getByText('Trip cancelled after departure'))
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: LABEL })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /About this chart/ })).not.toBeInTheDocument()
  })
  it('opens to show the question, the three caveats and the coverage note once', async () => {
    const user = userEvent.setup()
    renderOverview()

    await user.click(screen.getByRole('button', { name: LABEL }))

    const panel = screen.getByRole('region', { name: LABEL })
    expect(panel).toHaveTextContent(LABEL)
    expect(within(panel).getByText(SCAN)).toBeInTheDocument()
    expect(within(panel).getByText(POSITION)).toBeInTheDocument()
    expect(within(panel).getByText(SEALED)).toBeInTheDocument()
    expect(panel).toHaveTextContent(`Source: ${makeTrace().coverage_note}`)
    expect(screen.getAllByText(makeTrace().coverage_note)).toHaveLength(1)
  })
  it('closes on Escape and returns focus to the button', async () => {
    const user = userEvent.setup()
    renderOverview()
    const button = screen.getByRole('button', { name: LABEL })
    await user.click(button)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('region', { name: LABEL })).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })
  it('opens from the keyboard with Enter', async () => {
    const user = userEvent.setup()
    renderOverview()

    await user.tab()
    expect(screen.getByRole('button', { name: LABEL })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('region', { name: LABEL })).toBeInTheDocument()
  })
  // InfoPopover anchors its panel to the button's left edge and caps it at 280px. In a 320px card that runs off the screen, so
  // the panel is re-anchored to the header row's right edge and capped to the viewport (the popover itself is not edited).
  it('anchors the panel to the header row’s right edge and caps its width to the viewport', () => {
    renderOverview()

    const wrapper = screen.getByRole('button', { name: LABEL }).parentElement!.parentElement!
    const headerRow = wrapper.parentElement!.parentElement!

    expect(wrapper.className).toContain('[&>span]:static')
    expect(wrapper.className).toContain('[&_[role=region]]:left-auto')
    expect(wrapper.className).toContain('[&_[role=region]]:right-0')
    expect(wrapper.className).toContain('[&_[role=region]]:max-w-[min(280px,calc(100vw-4rem))]')
    expect(headerRow).toHaveClass('relative')
    expect(headerRow).toContainElement(screen.getByRole('heading', { level: 2, name: BARCODE }))
  })
  it('replaces the old how to read this disclosure', () => {
    const container = renderOverview()

    expect(screen.queryByText('How to read this')).not.toBeInTheDocument()
    expect([...container.querySelectorAll('details')].filter(details => !details.closest('[data-step]'))).toHaveLength(0)
  })
})

describe('ParcelOverview with no associated journey', () => {
  const none = (): ParcelTraceResponse => makeTrace([])

  it('keeps the focusable barcode heading and says so plainly, with no timeline, badge or View trip button', () => {
    const ref = createRef<HTMLHeadingElement>()
    render(<ParcelOverview trace={none()} returnTo={RETURN_TO} headingRef={ref} {...NOT_LOADING} />)

    expect(ref.current).toBe(screen.getByRole('heading', { level: 2, name: BARCODE }))
    expect(screen.getByText('No associated journey is recorded')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What was recorded for this parcel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View trip' })).not.toBeInTheDocument()
  })
  it('still carries the coverage note, in the popover, so the absence is explained', async () => {
    const user = userEvent.setup()
    renderOverview(none())

    await user.click(screen.getByRole('button', { name: 'How to read this parcel record' }))

    expect(screen.getAllByText(makeTrace().coverage_note)).toHaveLength(1)
  })
})
