import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ParcelTraceResponse } from '@shared/lib/types/parcel-trace'
import { ParcelHistory } from './ParcelHistory'
import { MANIFEST_GAP, MISSING_SCAN_GAP, makeJourney, makeScan, makeTrace } from './__fixtures__/trace'

const RETURN_TO = '/parcels?barcode=000123%2Fa&waybill=WB-TRACE-01'
const CANCELLED = { position: 'cancelled', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: false } as const
const follows = (first: Element, second: Element): boolean => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)

const earlier = (n: number, overrides = {}) => makeJourney({ trip_id: `trip-${n}`, trip_reference: `TRP-OLD-${n}`, ...overrides })
const manifestOnly = (n: number, overrides = {}) => earlier(n, { membership_source: 'creation_manifest', gaps: [MANIFEST_GAP, MISSING_SCAN_GAP], ...overrides })
const threeTrips = (): ParcelTraceResponse => makeTrace([makeJourney(), manifestOnly(2, { trip_status: 'cancelled', scans: [], progress: CANCELLED }), earlier(3, { scans: [makeScan(3, { scan_out_at: '2026-09-01T10:00:00Z' })] })])

function view(trace: ParcelTraceResponse, props: Partial<{ loadingMore: boolean; onLoadMore: () => void }> = {}) {
  return <ParcelHistory trace={trace} returnTo={RETURN_TO} loadingMore={props.loadingMore ?? false} onLoadMore={props.onLoadMore ?? vi.fn()} />
}
const rows = (container: HTMLElement): HTMLDetailsElement[] => [...container.querySelectorAll<HTMLDetailsElement>('details[data-trip-id]')]
const row = (container: HTMLElement, tripId: string): HTMLDetailsElement => container.querySelector<HTMLDetailsElement>(`details[data-trip-id="${tripId}"]`)!
const openAll = (container: HTMLElement): void => { rows(container).forEach(item => { item.open = true }) }
const flat = (node: Element | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()
const countOf = (container: HTMLElement): string => flat(container.querySelector('[data-earlier-count]'))

describe('ParcelHistory earlier-trips section', () => {
  it('renders only the earlier trips, each collapsed, and never the latest journey', () => {
    const { container } = render(view(threeTrips()))

    expect(container).not.toHaveTextContent('TRP-TRACE-01')
    expect(rows(container)).toHaveLength(2)
    expect(rows(container).every(item => !item.open)).toBe(true)
  })
  it('is a plain section with an Earlier trips heading, not a disclosure of its own', () => {
    const { container } = render(view(threeTrips()))

    const heading = screen.getByRole('heading', { level: 3, name: 'Earlier trips' })

    expect(heading.closest('details')).toBeNull()
    expect(container.querySelector('section')).toContainElement(heading)
  })
  it('renders nothing for a trace with no journeys', () => {
    expect(render(view(makeTrace([]))).container).toBeEmptyDOMElement()
  })
  it('renders nothing when there is only the latest journey and nothing more to load', () => {
    const { container } = render(view(makeTrace()))

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: 'Load earlier journeys' })).not.toBeInTheDocument()
  })
})

describe('ParcelHistory count wording', () => {
  it('counts the loaded earlier trips', () => {
    expect(countOf(render(view(threeTrips())).container)).toBe('2 loaded')
    expect(countOf(render(view(makeTrace([makeJourney(), earlier(2)]))).container)).toBe('1 loaded')
  })
  it('adds more available when a cursor remains, so the loaded count is never read as the total', () => {
    expect(countOf(render(view({ ...threeTrips(), next_cursor: 'cursor-1' })).container)).toBe('2 loaded · more available')
  })
  it('still shows the section when only the latest is loaded and more exist', () => {
    const { container } = render(view({ ...makeTrace(), next_cursor: 'cursor-1' }))

    expect(countOf(container)).toBe('0 loaded · more available')
    expect(screen.getByRole('button', { name: 'Load earlier journeys' })).toBeInTheDocument()
  })
  it('does not put planned manifest only in the section header', () => {
    const { container } = render(view(makeTrace([makeJourney(), manifestOnly(2), manifestOnly(3)])))

    expect(countOf(container)).toBe('2 loaded')
  })
})

describe('ParcelHistory compact rows', () => {
  it('summarises each trip on one line: reference, shared status chip and route', () => {
    const { container } = render(view(threeTrips()))
    const [cancelled, current] = rows(container).map(item => item.querySelector('summary')!)

    expect(cancelled).toHaveTextContent('TRP-OLD-2')
    expect(within(cancelled).getByText('Cancelled')).toBeInTheDocument()
    expect(cancelled).toHaveTextContent('Origin Depot → Destination Depot')
    expect(current).toHaveTextContent('TRP-OLD-3')
    expect(within(current).getByText('Active')).toBeInTheDocument()
    expect(current).toHaveTextContent('Origin Depot → Destination Depot')
  })
  // The same red as the trip list and trip page: TRIP_STATUS_META.cancelled.chipType is critical.
  it('colours the chip from the shared trip status meta, so cancelled is red as everywhere else', () => {
    const { container } = render(view(threeTrips()))
    const [cancelled, current] = rows(container).map(item => item.querySelector('summary')!)

    expect(within(cancelled).getByText('Cancelled')).toHaveClass('bg-err-c')
    expect(within(current).getByText('Active')).toHaveClass('bg-sec-c')
  })
  it('marks only a manifest-only trip, in muted text', () => {
    const { container } = render(view(threeTrips()))
    const [manifest, current] = rows(container).map(item => item.querySelector('summary')!)

    expect(within(manifest).getByText('Planned manifest only')).toHaveClass('text-on-surf-v')
    expect(current).not.toHaveTextContent('Planned manifest only')
  })
  it('keeps the long status wording and the scan summary out of the summary line', () => {
    const { container } = render(view(threeTrips()))

    const summary = rows(container)[0].querySelector('summary')!

    expect(summary).not.toHaveTextContent('Trip cancelled after departure')
    expect(summary).not.toHaveTextContent('No retained scan record')
  })
  it('says pickup or delivery is unknown rather than leaving the route blank', () => {
    const { container } = render(view(makeTrace([makeJourney(), earlier(2, { origin_name: null, destination_name: null })])))

    expect(rows(container)[0].querySelector('summary')).toHaveTextContent('Pickup unknown → Delivery unknown')
  })
  it('keeps the row summary free of interactive controls so the whole line is one disclosure', () => {
    const { container } = render(view(threeTrips()))

    for (const item of rows(container)) expect(item.querySelector('summary a, summary button')).toBeNull()
  })
  // Wrapping inside its own column keeps a long route or the manifest label under the reference, not back under the chevron.
  it('wraps the summary content in its own column beside the chevron, and indents the body to that column', () => {
    const { container } = render(view(threeTrips()))
    openAll(container)

    const first = rows(container)[0]
    const content = first.querySelector('summary > span')!

    expect(content).toHaveClass('min-w-0', 'flex-1')
    expect(content).toHaveTextContent('TRP-OLD-2')
    expect(content).toHaveTextContent('Planned manifest only')
    expect(first.querySelector('summary svg')!.parentElement).not.toBe(content)
    expect(first.querySelector(':scope > div')).toHaveClass('pl-[22px]')
  })
  it('keys each row by trip so two trips are never merged', () => {
    const { container } = render(view(threeTrips()))

    expect(rows(container).map(item => item.getAttribute('data-trip-id'))).toEqual(['trip-2', 'trip-3'])
  })
  it('lets the chip wrap rather than overflow a narrow screen', () => {
    const { container } = render(view(threeTrips()))

    expect(within(rows(container)[0].querySelector('summary')!).getByText('Cancelled')).toHaveClass('!whitespace-normal')
  })
})

describe('ParcelHistory expanded rows', () => {
  // The row chip and the timeline's own "Trip cancelled" step already say it; a third red chip repeated the same fact.
  it('does not repeat the status as a second chip in the expanded body', () => {
    const { container } = render(view(threeTrips()))
    openAll(container)

    const body = row(container, 'trip-2')

    expect(within(body).queryByText('Trip cancelled after departure')).not.toBeInTheDocument()
    expect(within(body).getByText('Trip cancelled')).toBeInTheDocument()
    expect(body.querySelectorAll('[class*="bg-err-c"]')).toHaveLength(1)
  })
  it('shows that journey’s own timeline with its own scans and gaps only', () => {
    const { container } = render(view(threeTrips()))
    openAll(container)

    const withScan = row(container, 'trip-3')
    const withoutScan = row(container, 'trip-2')

    expect(within(withScan).getByText('Scanned out at origin')).toBeInTheDocument()
    expect(withScan).toHaveTextContent('01 Sep, 12:00 SAST')
    expect(withScan).not.toHaveTextContent('08 Oct, 00:00 SAST · parcel scan')
    expect(withoutScan).not.toHaveTextContent('01 Sep')
    expect(within(withoutScan).queryByText('Scanned out at origin')).not.toBeInTheDocument()
    expect(within(withoutScan).getByText(MANIFEST_GAP)).toBeInTheDocument()
    expect(within(withScan).queryByText(MANIFEST_GAP)).not.toBeInTheDocument()
  })
  it('adds no manifest sentence of its own: the API gap is the statement', () => {
    const { container } = render(view(threeTrips()))
    openAll(container)

    expect(container).not.toHaveTextContent('Planned manifest membership only')
  })
  it('gives each trip a View trip button to its own trip page with returnTo', () => {
    const { container } = render(view(threeTrips()))
    openAll(container)

    const link = within(row(container, 'trip-3')).getByRole('link', { name: 'View trip' })
    const url = new URL(link.getAttribute('href')!, 'https://example.test')

    expect(url.pathname).toBe('/trips/trip-3')
    expect(url.searchParams.get('returnTo')).toBe(RETURN_TO)
  })
  it('does not repeat the trip reference or route that the row summary already shows', () => {
    const { container } = render(view(threeTrips()))
    openAll(container)

    const body = row(container, 'trip-2').querySelector(':scope > div')!

    expect(body).not.toHaveTextContent('TRP-OLD-2')
    expect(body).not.toHaveTextContent('Origin Depot →')
  })
  it('renders an expanded trip flat, without a card of its own', () => {
    const { container } = render(view(threeTrips()))
    openAll(container)

    expect(row(container, 'trip-2').className).not.toMatch(/shadow|rounded|overflow-hidden|bg-surf-lowest/)
    expect(row(container, 'trip-2').querySelector(':scope > div')!.className).not.toMatch(/shadow|rounded|overflow-hidden|bg-surf-lowest/)
  })
  // jsdom does not turn Enter or Space on a <summary> into a click (browsers do); the browser pass covers the real keys,
  // so this asserts the native contract: a <summary> that is focusable and toggles on activation.
  it('is a native summary that toggles on activation', async () => {
    const user = userEvent.setup()
    const { container } = render(view(threeTrips()))
    const first = rows(container)[0]
    const summary = first.querySelector('summary')!

    await user.click(summary)
    expect(first.open).toBe(true)
    await user.click(summary)
    expect(first.open).toBe(false)
  })
})

describe('ParcelHistory headings', () => {
  it('nests the section at h3, each reference at h4 and each trip’s timeline at h5, never h2', () => {
    const { container } = render(view(threeTrips()))
    openAll(container)

    expect(container.querySelectorAll('h2')).toHaveLength(0)
    expect(screen.getByRole('heading', { level: 3, name: 'Earlier trips' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: /TRP-OLD-2/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: /TRP-OLD-3/ })).toBeInTheDocument()
    expect(within(row(container, 'trip-2')).getByRole('heading', { level: 5, name: 'What was recorded for this parcel' })).toBeInTheDocument()
  })
})

describe('ParcelHistory continuation', () => {
  it('calls the continuation handler and disables the button while loading', () => {
    const onLoadMore = vi.fn()
    const trace = { ...threeTrips(), next_cursor: 'cursor-1' }
    const { rerender } = render(view(trace, { onLoadMore }))

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier journeys' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)

    rerender(view(trace, { onLoadMore, loadingMore: true }))
    expect(screen.getByRole('button', { name: /Load earlier journeys/ })).toBeDisabled()
  })
  it('offers no button once nothing more can be loaded', () => {
    render(view(threeTrips()))

    expect(screen.queryByRole('button', { name: 'Load earlier journeys' })).not.toBeInTheDocument()
  })
  it('keeps every opened row open across a load-more, and adds the new trips collapsed', () => {
    const first: ParcelTraceResponse = { ...threeTrips(), next_cursor: 'cursor-1' }
    const { container, rerender } = render(view(first))
    rows(container)[1].open = true

    rerender(view({ ...first, journeys: [...first.journeys, earlier(4), earlier(5)], next_cursor: null }))

    const after = rows(container)
    expect(after).toHaveLength(4)
    expect(after.map(item => item.open)).toEqual([false, true, false, false])
    expect(countOf(container)).toBe('4 loaded')
  })
})
