import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ParcelJourney } from '@shared/lib/types/parcel-trace'
import { LINE_STYLE, NODE_STYLE } from '@/components/trips/PhaseTimelineItem'
import { ParcelTimeline } from './ParcelTimeline'
import type { HeadingLevel } from './trace-display'
import {
  BOUNDARIES_GAP, MANIFEST_GAP, MISSING_SCAN_GAP, makeBoundariesUnavailableJourney, makeDeliveredJourney, makeException, makeManifestOnlyJourney, makeJourney, makeMultiStopJourney, makeOverriddenArrivalJourney, makePhase, makeScan, makeUnknownRelevanceJourney, makeWayJourney,
} from './__fixtures__/trace'

const RETURN_TO = '/parcels?barcode=000123%2Fa&waybill=WB-TRACE-01'
const follows = (first: Element, second: Element): boolean => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)

function renderTimeline(journey: ParcelJourney, headingLevel?: HeadingLevel): HTMLElement {
  return render(<ParcelTimeline journey={journey} returnTo={RETURN_TO} headingLevel={headingLevel} />).container
}
const step = (container: HTMLElement, key: string): HTMLElement => container.querySelector<HTMLElement>(`[data-step-key="${key}"]`)!
const flat = (node: Element | null): string => {
  if (!node) return ''
  const copy = node.cloneNode(true) as Element
  copy.querySelectorAll('dt').forEach(label => label.append(': '))
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}
const exceptionLinks = (root: Element): HTMLAnchorElement[] => [...root.querySelectorAll<HTMLAnchorElement>('a[href^="/exceptions/"]')]
const exceptionIds = (root: Element): string[] => exceptionLinks(root).map(link => hrefOf(link).pathname.replace('/exceptions/', ''))
function expand(element: HTMLElement): HTMLElement {
  element.querySelector('details')!.open = true
  return element
}
const hrefOf = (link: HTMLElement): URL => new URL(link.getAttribute('href')!, 'https://example.test')

describe('ParcelTimeline order and structure', () => {
  it('reads heading, then steps in order, then the not-recorded line, then the ledger link', () => {
    const container = renderTimeline(makeWayJourney())

    const heading = screen.getByRole('heading', { name: 'What was recorded for this parcel' })
    const kinds = [...container.querySelectorAll('[data-step]')].map(item => item.getAttribute('data-step'))
    const notRecorded = container.querySelector('[data-not-recorded]')!
    const ledger = screen.getByRole('link', { name: 'View trip' })
    expect(kinds).toEqual(['scan-out', 'phase', 'phase', 'cancelled'])
    expect(follows(heading, container.querySelector('[data-step]')!)).toBe(true)
    expect(follows(step(container, 'cancelled'), notRecorded)).toBe(true)
    expect(follows(notRecorded, ledger)).toBe(true)
  })
  it('hides the heading visually but keeps it for assistive technology, at the level the caller gives it', () => {
    renderTimeline(makeWayJourney())
    expect(screen.getByRole('heading', { level: 3, name: 'What was recorded for this parcel' })).toHaveClass('sr-only')
  })
  it('uses the requested heading level so earlier-trip timelines stay sequential', () => {
    renderTimeline(makeWayJourney(), 5)
    expect(screen.getByRole('heading', { level: 5, name: 'What was recorded for this parcel' })).toBeInTheDocument()
  })
  it('renders every phase step as a collapsed native disclosure', () => {
    const container = renderTimeline(makeWayJourney())

    const disclosures = [...container.querySelectorAll('[data-step] details')]

    expect(disclosures).toHaveLength(3)
    expect(disclosures.every(details => !(details as HTMLDetailsElement).open)).toBe(true)
    expect(disclosures.every(details => details.firstElementChild?.tagName === 'SUMMARY')).toBe(true)
  })
  it('draws the cancellation as a plain step, since it has nothing to expand', () => {
    const container = renderTimeline(makeWayJourney())

    const cancelled = step(container, 'cancelled')

    expect(flat(cancelled)).toBe('Trip cancelledbefore arrival')
    expect(cancelled.querySelector('details')).toBeNull()
  })
})

describe('ParcelTimeline step summaries', () => {
  it('shows only the title, any pill and the subline for each step of the WAY0020001 shape', () => {
    const container = renderTimeline(makeWayJourney())

    const summary = (key: string): string => flat(step(container, key).querySelector('summary'))

    expect(summary('scan-out-parcel-1')).toBe('Scanned out at origin15 Oct, 11:58 SAST · parcel scan')
    expect(summary('phase-2')).toBe('Consignment loaded3 exceptions · 2 need review15 Oct, 11:30 SAST · Origin Depot · vehicle CA 123456')
    expect(summary('phase-3')).toBe('Departed, sealed SEAL-WAY3 exceptions · 1 needs review15 Oct, 12:10 SAST · Origin Depot')
  })
  it('never puts an exception link or description in a collapsed summary', () => {
    const container = renderTimeline(makeWayJourney())

    const summary = step(container, 'phase-3').querySelector('summary')!

    expect(within(summary).queryAllByRole('link')).toHaveLength(0)
    expect(summary).not.toHaveTextContent('Recorded exception')
  })
  it('shows at most one issue pill plus Overridden, and tags nothing else as an issue', () => {
    const journey = makeOverriddenArrivalJourney({ exceptions: [makeException(1, { phase_event_id: 'phase-5' })] })
    journey.phases = journey.phases.map(phase => phase.id === 'phase-5' ? { ...phase, location_verdict: 'mismatch' as const } : phase)
    const container = renderTimeline(journey)

    expect(flat(step(container, 'phase-5').querySelector('summary'))).toBe('Arrived at Destination Depot (overridden)Overridden1 exception · 1 needs review08 Oct, 00:30 SAST · Destination Depot')
  })
  it('lets the issue and overridden pills wrap rather than overflow a narrow card', () => {
    const container = renderTimeline(makeOverriddenArrivalJourney({ exceptions: [makeException(1, { phase_event_id: 'phase-5' })] }))

    const summary = step(container, 'phase-5').querySelector('summary')!

    expect(within(summary).getByText('Overridden')).toHaveClass('!whitespace-normal')
    expect(within(summary).getByText('1 exception · 1 needs review')).toHaveClass('!whitespace-normal')
  })
  it('uses the location verdict as the pill when a step has no exceptions', () => {
    const container = renderTimeline(makeJourney({ phases: [{ ...makePhase('loading', 0), location_verdict: 'mismatch' }] }))

    expect(flat(step(container, 'phase-0').querySelector('summary'))).toContain('Truck outside precinct tolerance')
  })
  it('tags a recorded unknown-relevance phase as relevance unknown in muted text, not as a pill', () => {
    const container = renderTimeline(makeUnknownRelevanceJourney())

    const tag = within(step(container, 'phase-3')).getByText('Relevance unknown')

    expect(tag).toHaveClass('text-on-surf-v')
    expect(within(step(container, 'phase-2')).queryByText('Relevance unknown')).not.toBeInTheDocument()
  })
  it('marks an in-progress step with a ring marker and the other states with their own marker', () => {
    const inProgress = renderTimeline(makeJourney({ phases: [{ ...makePhase('loading', 0), status: 'in_progress', completed_at: null }], scans: [] }))
    expect(step(inProgress, 'phase-0').querySelector('[data-marker]')).toHaveAttribute('data-marker', 'in_progress')

    const way = renderTimeline(makeWayJourney())
    expect(step(way, 'phase-2').querySelector('[data-marker]')).toHaveAttribute('data-marker', 'recorded')
    expect(step(way, 'cancelled').querySelector('[data-marker]')).toHaveAttribute('data-marker', 'warn')
    expect(way.querySelector('[data-not-recorded] [data-marker]')).toHaveAttribute('data-marker', 'not-recorded')
  })
})

describe('ParcelTimeline expanded step detail', () => {
  it('shows each exception as one compact link: icon, time, type, severity and review state, carrying returnTo', () => {
    const journey = makeJourney({
      phases: [makePhase('loading', 0)],
      exceptions: [
        makeException(1, { phase_event_id: 'phase-0', exception_type: 'gps_mismatch', severity: 'warning' }),
        makeException(2, { phase_event_id: 'phase-0', exception_type: 'tracker_silent', severity: 'critical', review_status: 'reviewed' }),
      ],
    })
    const body = expand(step(renderTimeline(journey), 'phase-0'))

    const [first, second] = exceptionLinks(body)

    expect(flat(first)).toBe('08 Oct, 01:00 SAST · GPS mismatch · Warning · Needs review')
    expect(flat(second)).toBe('08 Oct, 01:00 SAST · Tracker silent · Critical · Reviewed')
    expect(first.querySelector('svg')).not.toBeNull()
    expect(first).not.toHaveTextContent('Recorded exception 1')
    for (const link of [first, second]) {
      expect(hrefOf(link).pathname).toMatch(/^\/exceptions\/exception-\d$/)
      expect(hrefOf(link).searchParams.get('returnTo')).toBe(RETURN_TO)
    }
  })
  it('keeps the description in the link’s accessible name, after the visible text, so nothing is lost to assistive technology', () => {
    const journey = makeJourney({ phases: [makePhase('loading', 0)], exceptions: [makeException(1, { phase_event_id: 'phase-0', exception_type: 'gps_mismatch', severity: 'warning', description: 'Driver phone and vehicle tracker were 7.9 km apart at this handshake and beyond the geofence' })] })
    const link = exceptionLinks(expand(step(renderTimeline(journey), 'phase-0')))[0]

    expect(link.getAttribute('aria-label')).toBe('08 Oct, 01:00 SAST · GPS mismatch · Warning · Needs review. Driver phone and vehicle tracker were 7.9 km…')
  })
  it('has no group headers, no ×n counts and no scope wording inside a step', () => {
    const body = expand(step(renderTimeline(makeWayJourney()), 'phase-2'))

    expect(body.querySelector('[data-exception-group]')).toBeNull()
    expect(flat(body)).not.toContain('×')
    expect(flat(body)).not.toMatch(/Whole trip|This consignment/)
  })
  it('draws the line like the trip page’s compact exception rows, not as a blue underlined link', () => {
    const body = expand(step(renderTimeline(makeWayJourney()), 'phase-2'))

    const link = exceptionLinks(body)[0]

    expect(link).toHaveClass('min-h-8', 'hover:bg-sec-c/40', 'before:absolute', 'before:-inset-y-1.5')
    expect(link).not.toHaveClass('text-sec')
    expect(link).not.toHaveClass('underline')
  })
  it('shows an unexpected severity as it arrives', () => {
    const journey = makeJourney({ phases: [makePhase('loading', 0)], exceptions: [makeException(1, { phase_event_id: 'phase-0', severity: 'high' })] })

    expect(flat(exceptionLinks(expand(step(renderTimeline(journey), 'phase-0')))[0])).toContain('· high ·')
  })
  it('keeps every exception of a step reachable, in order', () => {
    const body = expand(step(renderTimeline(makeWayJourney()), 'phase-2'))

    expect(exceptionIds(body)).toEqual(['exception-4', 'exception-5', 'exception-6'])
  })
  it('links to the phase evidence with the phase fragment and a returnTo that stays out of the hash', () => {
    const body = expand(step(renderTimeline(makeWayJourney()), 'phase-3'))

    const url = hrefOf(within(body).getByRole('link', { name: /Open phase evidence/ }))

    expect(url.pathname).toBe('/trips/trip-1')
    expect(url.hash).toBe('#phase-phase-3')
    expect(url.searchParams.get('returnTo')).toBe(RETURN_TO)
  })
  it('states the position with its source, capture time and phase-record time only on the phase it was captured for', () => {
    const container = renderTimeline(makeWayJourney())

    const departure = flat(expand(step(container, 'phase-3')))
    const loading = flat(expand(step(container, 'phase-2')))

    expect(departure).toContain('Vehicle recorded at Origin Depot')
    expect(departure).toContain('Position source: Vehicle tracker')
    expect(departure).toContain('Position captured: 15 Oct 2026, 12:09 SAST')
    expect(departure).toContain('Phase recorded: 15 Oct 2026, 12:10 SAST')
    expect(departure).toContain('not parcel GPS or live tracking')
    expect(loading).not.toContain('Position source')
    expect(loading).not.toContain('parcel GPS')
  })
  it('says so when the position capture time or the phase time is unavailable', () => {
    const journey = makeWayJourney()
    journey.last_recorded_location = { ...journey.last_recorded_location!, captured_at: null, phase_completed_at: null, source: 'driver_phone' }

    const departure = flat(expand(step(renderTimeline(journey), 'phase-3')))

    expect(departure).toContain('Position source: Driver phone')
    expect(departure).toContain('Position captured: Capture time not recorded')
    expect(departure).toContain('Phase recorded: Time unavailable')
  })
  it('shows the phase’s own location label, device capture time and recorded seal', () => {
    const journey = makeWayJourney()
    journey.phases = journey.phases.map(phase => phase.id === 'phase-3' ? { ...phase, driver_captured_at: '2026-10-15T10:08:00Z', seal_condition: 'intact' } : phase)

    const departure = flat(expand(step(renderTimeline(journey), 'phase-3')))
    const loading = flat(expand(step(renderTimeline(journey), 'phase-2')))

    expect(departure).toContain('Location: No recorded tracker confirmation')
    expect(departure).toContain('Device capture: 15 Oct 2026, 12:08 SAST')
    expect(departure).toContain('Recorded seal: SEAL-WAY · intact')
    expect(loading).toContain('Device capture: Not recorded')
    expect(loading).not.toContain('Recorded seal')
  })
  it('says contents of a sealed load are not observable on a departure inside a sealed window, and nowhere else', () => {
    const container = renderTimeline(makeWayJourney())
    const unsealed = renderTimeline(makeJourney({ phases: [makePhase('departure', 1)], seal_windows: [] }))

    expect(flat(expand(step(container, 'phase-3')))).toContain('Contents of a sealed load are not observable')
    expect(flat(expand(step(container, 'phase-2')))).not.toContain('not observable')
    expect(flat(expand(step(unsealed, 'phase-1')))).not.toContain('not observable')
  })
  it('shows the override note on an overridden step', () => {
    const body = expand(step(renderTimeline(makeOverriddenArrivalJourney()), 'phase-5'))

    expect(flat(body)).toContain('Override note: Arrival accepted by dispatcher')
  })
  it('words each anchor state without ever calling a phase verified', () => {
    const container = renderTimeline(makeMultiStopJourney())

    const pending = flat(expand(step(container, 'phase-4')))
    const failed = flat(expand(step(container, 'phase-5')))
    const anchored = flat(expand(step(container, 'phase-2')))

    expect(pending).toContain('Phase anchor is pending.')
    expect(failed).toContain('Phase anchor failed; the event is still recorded.')
    expect(anchored).toContain('An anchor is recorded for this phase. Verify it in trip evidence.')
    expect(`${pending} ${failed} ${anchored}`).not.toMatch(/\bverified\b/i)
  })
  it('describes a scan step as recorded against the barcode, source unidentified, with the stored status', () => {
    const container = renderTimeline(makeWayJourney())

    const body = flat(expand(step(container, 'scan-out-parcel-1')))

    expect(body).toContain('Recorded against the barcode; source system not identified.')
    expect(body).toContain('Stored scan status: scanned out')
  })
  it('keeps a recorded scan-in as a final step with the same wording rules', () => {
    const container = renderTimeline(makeDeliveredJourney())

    const last = [...container.querySelectorAll('[data-step]')].at(-1)!

    expect(last).toHaveAttribute('data-step', 'scan-in')
    expect(flat(last.querySelector('summary'))).toBe('Scanned in at destination16 Oct, 10:00 SAST · parcel scan')
    expect(flat(expand(last as HTMLElement))).toContain('Stored scan status: scanned in')
  })
  it('never uses the words delivered or verified for a fully recorded journey', () => {
    const container = renderTimeline(makeDeliveredJourney())

    for (const details of container.querySelectorAll('details')) details.open = true

    expect(flat(container)).not.toMatch(/\b(delivered|verified|intact|safe|lost)\b/i)
  })
})

describe('ParcelTimeline not-recorded line', () => {
  it('lists what has no record, then the destination, then the API’s own gap wording', () => {
    const container = renderTimeline(makeWayJourney())

    const line = container.querySelector('[data-not-recorded]')!

    expect(flat(line)).toBe(`Not recorded: in transit, arrival, unloading, confirmation, seal check, destination scanDestination Depot${MISSING_SCAN_GAP}`)
  })
  it('shows the missing-scan gap exactly once, in the not-recorded row', () => {
    const container = renderTimeline(makeWayJourney())

    expect(screen.getAllByText(MISSING_SCAN_GAP)).toHaveLength(1)
    expect(container.querySelector('[data-not-recorded]')).toContainElement(screen.getByText(MISSING_SCAN_GAP))
    expect(container.querySelector('[data-gaps]')).toBeNull()
  })
  it('renders each gap verbatim as its own muted line with a warning icon, in the order given', () => {
    const container = renderTimeline(makeWayJourney({ gaps: ['First gap.', 'Second gap.'] }))

    const list = within(container.querySelector<HTMLElement>('[data-not-recorded]')!).getByRole('list', { name: 'Evidence gaps' })

    const items = within(list).getAllByRole('listitem')
    expect(items.map(item => item.textContent)).toEqual(['First gap.', 'Second gap.'])
    for (const item of items) {
      expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      expect(item).toHaveClass('text-on-surf-v')
    }
  })
  it('writes no sentence of its own about a missing scan', () => {
    const container = renderTimeline(makeWayJourney({ gaps: [] }))

    expect(flat(container.querySelector('[data-not-recorded]'))).toBe('Not recorded: in transit, arrival, unloading, confirmation, seal check, destination scanDestination Depot')
    expect(container.textContent).not.toMatch(/missing scan/i)
  })
  it('keeps the place as the subline and leaves it out when the destination is not recorded', () => {
    const line = renderTimeline(makeWayJourney({ destination_name: null, gaps: [] })).querySelector('[data-not-recorded]')!

    expect(flat(line)).toBe('Not recorded: in transit, arrival, unloading, confirmation, seal check, destination scan')
  })
  it('omits the line when nothing is unrecorded', () => {
    expect(renderTimeline(makeDeliveredJourney()).querySelector('[data-not-recorded]')).toBeNull()
  })
})

describe('ParcelTimeline gaps without a not-recorded row', () => {
  it('renders the gaps as the final timeline row', () => {
    const container = renderTimeline(makeDeliveredJourney({ gaps: ['Custom gap one.', 'Custom gap two.'] }))

    const row = container.querySelector<HTMLElement>('[data-gaps]')!

    expect(container.querySelector('[data-not-recorded]')).toBeNull()
    expect([...container.querySelectorAll('ol > li')].at(-1)).toBe(row)
    expect(within(row).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Custom gap one.', 'Custom gap two.'])
  })
  it('draws no gaps row when the API reports none', () => {
    expect(renderTimeline(makeDeliveredJourney()).querySelector('[data-gaps]')).toBeNull()
  })
  it('shows a manifest-only journey’s own gap, verbatim', () => {
    renderTimeline(makeManifestOnlyJourney())

    expect(screen.getByText(MANIFEST_GAP)).toBeInTheDocument()
    expect(screen.getAllByText(MISSING_SCAN_GAP)).toHaveLength(1)
  })
})

describe('ParcelTimeline with no phase attributed to the consignment', () => {
  it('keeps pending consignment phases in Not recorded without denying their attribution', () => {
    const journey = makeJourney({
      phases: [{ ...makePhase('loading', 0), relevance: 'consignment', status: 'pending', completed_at: null }],
      scans: [], seal_windows: [],
    })

    const container = renderTimeline(journey)

    expect(container.querySelector('[data-step="phase"]')).toBeNull()
    expect(container.querySelector('[data-no-phases]')).toBeNull()
    expect(container.querySelector('[data-not-recorded]')).toHaveTextContent('loading')
  })
  it('shows one muted row saying so, then the gaps, when boundaries are unavailable', () => {
    const container = renderTimeline(makeBoundariesUnavailableJourney())

    const noPhases = container.querySelector<HTMLElement>('[data-no-phases]')!
    const tail = container.querySelector<HTMLElement>('[data-not-recorded]')!

    expect(container.querySelectorAll('[data-step="phase"]')).toHaveLength(0)
    expect(flat(noPhases)).toBe('No phases are attributed to this consignment. See the full trip ledger.')
    expect(noPhases.querySelector('p')).toHaveClass('text-on-surf-v')
    expect(container.querySelectorAll('[data-no-phases]')).toHaveLength(1)
    expect(follows(noPhases, within(tail).getByText(BOUNDARIES_GAP))).toBe(true)
    expect(within(tail).getByText(MISSING_SCAN_GAP)).toBeInTheDocument()
  })
  it('keeps the scan step ahead of the row, since the parcel scan is still recorded', () => {
    const container = renderTimeline(makeBoundariesUnavailableJourney())

    expect([...container.querySelectorAll('ol > li')].map(item => item.getAttribute('data-step') ?? (item.hasAttribute('data-no-phases') ? 'no-phases' : 'tail'))).toEqual(['scan-out', 'no-phases', 'tail'])
  })
  it('puts the gaps straight after the row when there is no not-recorded row', () => {
    const journey = makeBoundariesUnavailableJourney({ scans: [makeScan(1, { scan_in_at: '2026-10-08T05:00:00Z', status: 'scanned_in' })], gaps: [BOUNDARIES_GAP] })
    const container = renderTimeline(journey)

    expect(container.querySelector('[data-not-recorded]')).toBeNull()
    expect(follows(container.querySelector('[data-no-phases]')!, container.querySelector('[data-gaps]')!)).toBe(true)
    expect(within(container.querySelector<HTMLElement>('[data-gaps]')!).getByText(BOUNDARIES_GAP)).toBeInTheDocument()
  })
  it('says so with the gaps alone when a journey has no phase ledger and no scan', () => {
    const container = renderTimeline(makeJourney({ phases: [], seal_windows: [], scans: [], gaps: ['No phase ledger is recorded for this trip.'] }))

    expect(flat(container.querySelector('[data-no-phases]'))).toBe('No phases are attributed to this consignment. See the full trip ledger.')
    expect(screen.getByText('No phase ledger is recorded for this trip.')).toBeInTheDocument()
  })
  it('does not show the row when any phase is a step', () => {
    expect(renderTimeline(makeWayJourney()).querySelector('[data-no-phases]')).toBeNull()
  })
  it('does not show the row when the only phase steps are recorded with unknown relevance', () => {
    const journey = makeJourney({
      phases: [{ ...makePhase('loading', 0), relevance: 'unknown', status: 'completed', completed_at: '2026-10-08T05:00:00Z' }],
      scans: [], seal_windows: [],
    })

    const container = renderTimeline(journey)

    expect(container.querySelectorAll('[data-step="phase"]')).toHaveLength(1)
    expect(container.querySelector('[data-no-phases]')).toBeNull()
  })
})

describe('ParcelTimeline view trip button', () => {
  it('is a View trip button to the trip page with returnTo, and no longer a blue ledger link', () => {
    renderTimeline(makeWayJourney())

    const button = screen.getByRole('link', { name: 'View trip' })
    const url = new URL(button.getAttribute('href')!, 'https://example.test')

    expect(url.pathname).toBe('/trips/trip-1')
    expect(url.hash).toBe('')
    expect(url.searchParams.get('returnTo')).toBe(RETURN_TO)
    expect(screen.queryByText(/Full trip ledger/)).not.toBeInTheDocument()
  })
  it('uses the shared LinkButton look', () => {
    renderTimeline(makeWayJourney())

    const button = screen.getByRole('link', { name: 'View trip' })

    expect(button).toHaveClass('bg-surf-high', 'font-semibold', 'rounded-md')
    expect(button).not.toHaveClass('text-sec')
  })
  it('states the phase and trip-wide exception counts as one muted line beside the button', () => {
    renderTimeline(makeWayJourney())

    const counts = screen.getByText('8 phases · 4 trip-wide exceptions')

    expect(counts).toHaveClass('text-on-surf-v')
    expect(screen.getByRole('link', { name: 'View trip' }).parentElement).toContainElement(counts)
    expect(follows(screen.getByRole('link', { name: 'View trip' }), counts)).toBe(true)
  })
  it('omits the exceptions part when there are none, and uses the singular for one', () => {
    renderTimeline(makeDeliveredJourney())
    expect(screen.getByText('8 phases')).toBeInTheDocument()

    renderTimeline(makeJourney({ phases: [makePhase('loading', 0)], exceptions: [makeException(1, { phase_event_id: null })] }))
    expect(screen.getByText('1 phase · 1 trip-wide exception')).toBeInTheDocument()
  })
})

describe('ParcelTimeline with several parcel records', () => {
  it('keeps each record as its own suffixed step', () => {
    const journey = makeJourney({ scans: [makeScan(1), makeScan(2, { scan_in_at: '2026-10-08T05:00:00Z', status: 'scanned_in' })] })
    const container = renderTimeline(journey)

    expect(flat(step(container, 'scan-out-parcel-1').querySelector('summary'))).toContain('Scanned out at origin · parcel record 1')
    expect(flat(step(container, 'scan-out-parcel-2').querySelector('summary'))).toContain('Scanned out at origin · parcel record 2')
    expect(flat(step(container, 'scan-in-parcel-2').querySelector('summary'))).toContain('Scanned in at destination · parcel record 2')
    expect(step(container, 'scan-in-parcel-1')).toBeNull()
  })
})

describe('ParcelTimeline exceptions (moved from the spine)', () => {
  const withExceptions = (exceptions: ReturnType<typeof makeException>[]): HTMLElement => renderTimeline(makeMultiStopJourney({ exceptions }))
  const body = (container: HTMLElement, key: string): HTMLElement => expand(step(container, key))
  const lineFor = (root: HTMLElement, id: string): HTMLElement => root.querySelector<HTMLElement>(`a[href^="/exceptions/${id}?"]`)!

  it('labels needs_review and reviewed, and shows any other state verbatim', () => {
    const container = withExceptions([
      makeException(1, { phase_event_id: 'phase-2', review_status: 'needs_review' }),
      makeException(2, { phase_event_id: 'phase-2', review_status: 'reviewed' }),
      makeException(3, { phase_event_id: 'phase-2', review_status: 'escalated' }),
    ])
    const detail = body(container, 'phase-2')

    expect(lineFor(detail, 'exception-1')).toHaveTextContent('Needs review')
    expect(lineFor(detail, 'exception-2')).toHaveTextContent('Reviewed')
    expect(lineFor(detail, 'exception-3')).toHaveTextContent('escalated')
  })
  it('does not label a recorded exception as needing review, and shows no review count when nothing awaits it', () => {
    const container = withExceptions([makeException(1, { phase_event_id: 'phase-2', review_status: 'recorded' })])

    expect(lineFor(body(container, 'phase-2'), 'exception-1')).toHaveTextContent('Recorded')
    expect(lineFor(body(container, 'phase-2'), 'exception-1')).not.toHaveTextContent('Needs review')
    expect(flat(step(container, 'phase-2').querySelector('summary'))).toContain('1 exception')
    expect(flat(step(container, 'phase-2').querySelector('summary'))).not.toMatch(/needs? review/i)
  })
  it('counts every exception of a type but only needs_review as awaiting review', () => {
    const container = withExceptions([
      makeException(1, { phase_event_id: 'phase-2', review_status: 'needs_review' }), makeException(2, { phase_event_id: 'phase-2', review_status: 'recorded' }),
      makeException(3, { phase_event_id: 'phase-2', review_status: 'reviewed' }), makeException(4, { phase_event_id: 'phase-2', review_status: 'escalated' }),
    ])

    expect(flat(step(container, 'phase-2').querySelector('summary'))).toContain('4 exceptions · 1 needs review')
  })
  it('keeps repeated exceptions as separate links with return navigation', () => {
    const container = withExceptions([makeException(1, { phase_event_id: 'phase-5' }), makeException(2, { phase_event_id: 'phase-5' })])

    const links = exceptionLinks(body(container, 'phase-5'))

    expect(links.map(link => hrefOf(link).pathname)).toEqual(['/exceptions/exception-1', '/exceptions/exception-2'])
    expect(links.every(link => hrefOf(link).searchParams.get('returnTo') === RETURN_TO)).toBe(true)
  })
  it('attaches each exception to its own phase when a phase type repeats', () => {
    const container = withExceptions([makeException(1, { phase_event_id: 'phase-7' }), makeException(2, { phase_event_id: 'phase-3' })])

    expect(exceptionIds(body(container, 'phase-3'))).toEqual(['exception-2'])
    expect(exceptionIds(body(container, 'phase-7'))).toEqual(['exception-1'])
  })
  it('counts exceptions with no phase or an unmatched phase in the ledger counts instead of listing them, dropping none', () => {
    const journey = makeJourney({ exceptions: [makeException(1, { phase_event_id: null }), makeException(2, { phase_event_id: 'phase-ghost' }), makeException(3, { phase_event_id: 'phase-0' })] })
    const container = renderTimeline(journey)

    expect(screen.getByText('5 phases · 2 trip-wide exceptions')).toBeInTheDocument()
    expect(exceptionIds(expand(step(container, 'phase-0')))).toEqual(['exception-3'])
    expect(exceptionIds(container)).toEqual(['exception-3'])
  })
  it('shows no exception line and no exception wording when the journey has none', () => {
    const container = renderTimeline(makeDeliveredJourney())

    for (const details of container.querySelectorAll('details')) details.open = true

    expect(exceptionLinks(container)).toHaveLength(0)
    expect(flat(container)).not.toContain('×')
  })
})

describe('ParcelTimeline rows (moved from the spine)', () => {
  it('keeps repeated phase types as separate steps in ledger order', () => {
    const container = renderTimeline(makeMultiStopJourney())

    const titles = [...container.querySelectorAll('[data-step="phase"]')].map(item => flat(item.querySelector('summary > span > span > span')))

    expect(titles.filter(title => title.startsWith('Departed'))).toEqual(['Departed, sealed SEAL-A', 'Departed, sealed SEAL-B'])
    expect(titles.filter(title => title.startsWith('Arrived'))).toEqual(['Arrived at Cross-dock B', 'Arrived at Destination Depot (overridden)'])
  })
  it('keeps long explanations out of the collapsed summary and in the expanded detail', () => {
    const container = renderTimeline(makeDeliveredJourney())

    const loading = step(container, 'phase-2')

    expect(flat(loading.querySelector('summary'))).not.toContain('Truck within precinct tolerance')
    expect(flat(loading.querySelector('summary'))).not.toContain('Device capture')
    expect(flat(expand(loading))).toContain('Location: Truck within precinct tolerance')
    expect(flat(loading)).toContain('Device capture: Not recorded')
  })
  it('hides every marker from assistive technology, since the step text names the state', () => {
    const markers = [...renderTimeline(makeWayJourney()).querySelectorAll('[data-marker]')]

    expect(markers.length).toBeGreaterThan(0)
    for (const marker of markers) expect(marker).toHaveAttribute('aria-hidden', 'true')
  })
  it('does not style any timestamp with the link colour', () => {
    const container = renderTimeline(makeWayJourney())
    for (const details of container.querySelectorAll('details')) details.open = true

    const timed = [...container.querySelectorAll('.tabular-nums')].filter(node => /\d{2}:\d{2} SAST/.test(node.textContent ?? ''))

    expect(timed.length).toBeGreaterThan(0)
    for (const node of timed) {
      for (let ancestor: Element | null = node; ancestor && ancestor !== container; ancestor = ancestor.parentElement) expect(ancestor.classList.contains('text-sec')).toBe(false)
    }
  })
  it('gives every phase step a phase evidence link and an unrecorded phase none', () => {
    const container = renderTimeline(makeWayJourney())

    const linked = [...container.querySelectorAll<HTMLAnchorElement>('a[href*="#phase-"]')].map(link => decodeURIComponent(link.hash.replace('#phase-', '')))

    expect(linked).toEqual(['phase-2', 'phase-3'])
    expect(container.querySelector('[data-not-recorded] a')).toBeNull()
  })
  it('starts collapsed, is reachable by Tab, and toggles on activation', async () => {
    const user = userEvent.setup()
    const container = renderTimeline(makeJourney())
    const details = step(container, 'scan-out-parcel-1').querySelector('details')!
    const summary = details.querySelector('summary')!
    expect(details.open).toBe(false)

    summary.focus()
    expect(summary).toHaveFocus()
    await user.click(summary)
    expect(details.open).toBe(true)
    await user.click(summary)
    expect(details.open).toBe(false)
  })
  it('never calls several parcel records a latest or combined scan', () => {
    const journey = makeJourney({ scans: [makeScan(1), makeScan(2, { scan_in_at: '2026-10-08T05:00:00Z', status: 'scanned_in' })] })

    expect(flat(renderTimeline(journey))).not.toMatch(/latest scan|most recent scan|combined/i)
  })
})

describe('ParcelTimeline dots and rail match the trip page timeline', () => {
  const classesOf = (value: string): string[] => value.split(' ')
  const marker = (container: HTMLElement, selector: string): HTMLElement => container.querySelector<HTMLElement>(`${selector} [data-marker]`)!
  const rail = (container: HTMLElement, selector: string): HTMLElement | null => container.querySelector<HTMLElement>(`${selector} [data-rail]`)

  it('draws a recorded step as the trip page’s done node: 30px, same fill, with a check', () => {
    const container = renderTimeline(makeWayJourney())

    const dot = marker(container, '[data-step="scan-out"]')

    expect(dot).toHaveClass('h-[30px]', 'w-[30px]', 'rounded-full', ...classesOf(NODE_STYLE.done))
    expect(dot.querySelector('svg')).not.toBeNull()
  })
  it('maps an in-progress step to the active node and a cancellation to the warn node', () => {
    const inProgress = renderTimeline(makeJourney({ phases: [{ ...makePhase('loading', 0), status: 'in_progress', completed_at: null }], scans: [] }))
    const way = renderTimeline(makeWayJourney())

    expect(marker(inProgress, '[data-step="phase"]')).toHaveClass(...classesOf(NODE_STYLE.active))
    expect(marker(way, '[data-step="cancelled"]')).toHaveClass(...classesOf(NODE_STYLE.warn))
  })
  it('maps a not-recorded row to the pending node, keeping its dashed outline', () => {
    const container = renderTimeline(makeWayJourney())

    const dot = marker(container, '[data-not-recorded]')

    expect(dot).toHaveClass('h-[30px]', 'w-[30px]', ...classesOf(NODE_STYLE.pending), 'border-dashed')
  })
  it('draws the rail line at the trip page’s 2px weight, green under a recorded step and neutral otherwise', () => {
    const container = renderTimeline(makeWayJourney())

    const afterRecorded = rail(container, '[data-step="scan-out"]')!
    const afterCancelled = rail(container, '[data-step="cancelled"]')!

    expect(afterRecorded).toHaveClass('w-0.5', ...classesOf(LINE_STYLE.done))
    expect(afterCancelled).toHaveClass('w-0.5', ...classesOf(LINE_STYLE.warn))
    expect(rail(container, '[data-not-recorded]')).toBeNull()
  })
  it('keeps the dots decorative and the old small markers gone', () => {
    const container = renderTimeline(makeWayJourney())

    for (const dot of container.querySelectorAll('[data-marker]')) {
      expect(dot).toHaveAttribute('aria-hidden', 'true')
      expect(dot).not.toHaveClass('h-3', 'w-3')
    }
  })
})

describe('ParcelTimeline calmer step body', () => {
  it('shows location, device capture, seal and anchor as a label/value list rather than a sentence each', () => {
    const container = renderTimeline(makeWayJourney())

    const departure = [...expand(step(container, 'phase-3')).querySelectorAll('dt')].map(label => label.textContent)
    const loading = [...expand(step(container, 'phase-2')).querySelectorAll('dt')].map(label => label.textContent)

    expect(departure).toEqual(['Location', 'Position', 'Position source', 'Position captured', 'Phase recorded', 'Device capture', 'Recorded seal', 'Anchor'])
    expect(loading).toEqual(['Location', 'Device capture', 'Anchor'])
  })
  it('mutes the labels and keeps the values at body weight, so what is recorded stands apart from what it is called', () => {
    const body = expand(step(renderTimeline(makeWayJourney()), 'phase-2'))

    expect(body.querySelector('dt')).toHaveClass('text-on-surf-v')
    expect(body.querySelector('dd')).toHaveClass('text-on-surf')
  })
  it('puts the exception lines first, then the list, then the notes, then the phase evidence link', () => {
    const body = expand(step(renderTimeline(makeWayJourney()), 'phase-3'))

    const firstLine = exceptionLinks(body)[0]
    const list = body.querySelector('dl')!
    const sealedNote = within(body).getByText('Contents of a sealed load are not observable.')
    const phaseLink = within(body).getByRole('link', { name: /Open phase evidence/ })
    expect(follows(firstLine, list)).toBe(true)
    expect(follows(list, sealedNote)).toBe(true)
    expect(follows(sealedNote, phaseLink)).toBe(true)
  })
  it('draws the phase evidence link small, as navigation rather than a headline', () => {
    const body = expand(step(renderTimeline(makeWayJourney()), 'phase-3'))

    expect(within(body).getByRole('link', { name: /Open phase evidence/ })).toHaveClass('text-xs')
  })
  it('describes a scan step with the stored status as a label/value pair', () => {
    const body = expand(step(renderTimeline(makeWayJourney()), 'scan-out-parcel-1'))

    expect([...body.querySelectorAll('dt')].map(label => label.textContent)).toEqual(['Stored scan status'])
  })
})

describe('ParcelTimeline layout', () => {
  it('caps the timeline’s width so the chevron stays beside the text it belongs to', () => {
    const container = renderTimeline(makeWayJourney())

    expect(container.firstElementChild).toHaveClass('max-w-3xl')
  })
  it('gives every row room for the rail and ends each line just above the next node', () => {
    const container = renderTimeline(makeWayJourney())

    const rows = [...container.querySelectorAll('ol > li')]

    expect(rows.every(row => row.classList.contains('pb-2'))).toBe(true)
    expect(container.querySelector('[data-rail]')).toHaveClass('bottom-px')
  })
})

describe('ParcelTimeline step summary spacing and chevron', () => {
  it('puts the chevron right after the title and pills, in the title row, not at the far end of the summary', () => {
    const container = renderTimeline(makeWayJourney())

    const summary = step(container, 'phase-2').querySelector('summary')!
    const titleRow = summary.querySelector('span > span')!
    const chevron = summary.querySelector('svg')!

    expect(titleRow).toContainElement(chevron)
    expect(follows(within(titleRow as HTMLElement).getByText('Consignment loaded'), chevron)).toBe(true)
    expect(follows(within(titleRow as HTMLElement).getByText('3 exceptions · 2 need review'), chevron)).toBe(true)
    expect(summary.lastElementChild).not.toBe(chevron)
  })
  it('rotates the chevron when the step opens, and gives every expandable step one', () => {
    const container = renderTimeline(makeWayJourney())

    const chevrons = [...container.querySelectorAll('[data-step] details > summary svg')]

    expect(chevrons).toHaveLength(3)
    for (const chevron of chevrons) expect(chevron).toHaveClass('group-open:rotate-90')
    expect(step(container, 'cancelled').querySelector('details')).toBeNull()
  })
  it('leaves room under the title row so a pill does not sit on the subline', () => {
    const container = renderTimeline(makeWayJourney())

    const subline = within(step(container, 'phase-2')).getByText('15 Oct, 11:30 SAST · Origin Depot · vehicle CA 123456')

    expect(subline).toHaveClass('mt-1.5')
  })
})
