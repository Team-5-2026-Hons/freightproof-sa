import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api/client'
import { ParcelSearch } from './ParcelSearch'
import { BARCODE, MISSING_SCAN_GAP, WAYBILL, makeJourney, makeScan, makeTrace } from './__fixtures__/trace'

const replace = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push }) }))
vi.mock('@/lib/api/client', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
  return { api: { get: vi.fn() }, ApiError }
})
const get = vi.mocked(api.get)
const INTRO = 'Search an exact barcode to see what is recorded, where the consignment travelled, and which evidence supports the journey.'

beforeEach(() => { get.mockReset(); replace.mockReset(); push.mockReset() })

describe('Parcel Search', () => {
  it('starts with an accessible barcode form and rejects blank input', async () => {
    const user = userEvent.setup()
    render(<ParcelSearch initialBarcode="" initialWaybill="" />)
    expect(screen.getByText(INTRO)).toBeInTheDocument()
    expect(screen.queryByText('Start with a barcode')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Search parcel' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a barcode')
    expect(get).not.toHaveBeenCalled()
  })

  it('preserves leading zeros and encodes the submitted search in the URL', async () => {
    const user = userEvent.setup()
    render(<ParcelSearch initialBarcode="" initialWaybill="" />)
    await user.type(screen.getByRole('textbox', { name: 'Parcel barcode' }), ` ${BARCODE} `)
    await user.click(screen.getByRole('button', { name: 'Search parcel' }))
    expect(push).toHaveBeenCalledWith('/parcels?barcode=000123%2Fa', { scroll: false })
    expect(replace).not.toHaveBeenCalled()
  })

  it('shows the barcode, status, status line and timeline of what was recorded for a successful search', async () => {
    get.mockResolvedValueOnce({ barcode: BARCODE, items: [{ waybill_reference: WAYBILL, journey_count: 1 }], next_after: null }).mockResolvedValueOnce(makeTrace())
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    const state = await screen.findByRole('region', { name: 'Current recorded state' })
    expect(within(state).getByText(BARCODE)).toBeInTheDocument()
    expect(state).toHaveTextContent('In transit — awaiting arrival attestation')
    expect(state).toHaveTextContent('Last recorded: departed Origin Depot under seal SEAL-001')
    expect(within(state).getByText('Scanned out at origin')).toBeInTheDocument()
    expect(within(state).getByText('Consignment loaded')).toBeInTheDocument()
    expect(state.querySelector('[data-not-recorded]')).toHaveTextContent('Not recorded: in transit, arrival, unloading, seal check, destination scan')
    expect(within(state).getByText(MISSING_SCAN_GAP)).toBeInTheDocument()
    expect(screen.queryByText('Verified on blockchain')).not.toBeInTheDocument()
  })

  it('makes ambiguous waybills selectable without claiming one is the parcel journey', async () => {
    get.mockResolvedValueOnce({ barcode: BARCODE, items: [{ waybill_reference: 'WB-1', journey_count: 1 }, { waybill_reference: 'WB-2', journey_count: 2 }], next_after: null })
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    const choice = await screen.findByRole('button', { name: /WB-2/ })
    fireEvent.click(choice)
    expect(push).toHaveBeenCalledWith('/parcels?barcode=000123%2Fa&waybill=WB-2', { scroll: false })
    expect(replace).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Current recorded state' })).not.toBeInTheDocument()
  })

  it('distinguishes no result from initial and network error states', async () => {
    get.mockResolvedValueOnce({ barcode: BARCODE, items: [], next_after: null })
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    expect(await screen.findByText('No matching parcel')).toBeInTheDocument()
    expect(screen.queryByText('Start with a barcode')).not.toBeInTheDocument()
  })

  it('retries a failed search using the submitted query', async () => {
    get.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ barcode: BARCODE, items: [{ waybill_reference: WAYBILL, journey_count: 1 }], next_after: null }).mockResolvedValueOnce(makeTrace())
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByRole('region', { name: 'Current recorded state' })
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/parcels/lookup?barcode=000123%2Fa')
  })
})

describe('Parcel Search — stable form and query-scoped results', () => {
  const lookupFor = (barcode: string, waybill = WAYBILL) => ({ barcode, items: [{ waybill_reference: waybill, journey_count: 1 }], next_after: null })

  it('withdraws the previous evidence as soon as the submitted query changes', async () => {
    get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace()).mockReturnValueOnce(new Promise(() => undefined))
    const { rerender } = render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'Current recorded state' })

    rerender(<ParcelSearch initialBarcode="OTHER-1" initialWaybill="" />)

    expect(screen.queryByRole('region', { name: 'Current recorded state' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading parcel evidence')
  })

  it('ignores a delayed response that belongs to a superseded query', async () => {
    let resolveOld: (value: unknown) => void = () => undefined
    get.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve })).mockReturnValueOnce(new Promise(() => undefined))
    const { rerender } = render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    rerender(<ParcelSearch initialBarcode="OTHER-1" initialWaybill="" />)

    resolveOld(lookupFor(BARCODE))
    await Promise.resolve()

    expect(get).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('region', { name: 'Matching waybills' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Current recorded state' })).not.toBeInTheDocument()
  })
})

describe('Parcel Search — draft and navigation', () => {
  const lookupFor = (barcode: string) => ({ barcode, items: [{ waybill_reference: WAYBILL, journey_count: 1 }], next_after: null })
  const box = () => screen.getByRole('textbox', { name: 'Parcel barcode' })

  it('does not request anything while the draft is edited before a first submit', async () => {
    const user = userEvent.setup()
    render(<ParcelSearch initialBarcode="" initialWaybill="" />)

    await user.type(box(), 'WAY-1')

    expect(get).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('keeps the submitted result visible while the draft is edited and names what is shown', async () => {
    const user = userEvent.setup()
    get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace())
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'Current recorded state' })
    expect(screen.queryByText(/Showing results for/)).not.toBeInTheDocument()

    await user.type(box(), 'x')

    expect(screen.getByRole('region', { name: 'Current recorded state' })).toBeInTheDocument()
    expect(screen.getByText(`Showing results for ${BARCODE}`)).toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('drops the notice when the draft returns to the submitted barcode', async () => {
    const user = userEvent.setup()
    get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace())
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'Current recorded state' })

    await user.type(box(), 'x')
    await user.type(box(), '{Backspace}')

    expect(screen.queryByText(/Showing results for/)).not.toBeInTheDocument()
  })

  it('rejects an invalid submit on the field without touching the submitted query or its result', async () => {
    const user = userEvent.setup()
    get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace())
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'Current recorded state' })

    await user.clear(box())
    await user.click(screen.getByRole('button', { name: 'Search parcel' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a barcode')
    expect(box()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('region', { name: 'Current recorded state' })).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('pushes a trimmed, encoded history entry for a new search', async () => {
    const user = userEvent.setup()
    get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace())
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'Current recorded state' })

    await user.clear(box())
    await user.type(box(), '  000987/B  ')
    await user.click(screen.getByRole('button', { name: 'Search parcel' }))

    expect(push).toHaveBeenCalledExactlyOnceWith('/parcels?barcode=000987%2FB', { scroll: false })
    expect(replace).not.toHaveBeenCalled()
  })

  it('refetches a resubmitted identical query without adding history', async () => {
    const user = userEvent.setup()
    get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace()).mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace())
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'Current recorded state' })

    await user.click(screen.getByRole('button', { name: 'Search parcel' }))

    await waitFor(() => expect(get).toHaveBeenCalledTimes(4))
    await screen.findByRole('region', { name: 'Current recorded state' })
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('syncs the draft and result to a changed URL query as Back and Forward would', async () => {
    const user = userEvent.setup()
    get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace()).mockReturnValueOnce(new Promise(() => undefined))
    const { rerender } = render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'Current recorded state' })
    await user.type(box(), 'zz')

    rerender(<ParcelSearch initialBarcode="OTHER-9" initialWaybill="" />)

    expect(box()).toHaveValue('OTHER-9')
    expect(screen.queryByText(/Showing results for/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Current recorded state' })).not.toBeInTheDocument()
    expect(get).toHaveBeenLastCalledWith('/api/v1/parcels/lookup?barcode=OTHER-9')
  })

  it('clears the draft and replaces the URL with the bare parcels route', async () => {
    const user = userEvent.setup()
    get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace())
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'Current recorded state' })

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(replace).toHaveBeenCalledExactlyOnceWith('/parcels')
    expect(box()).toHaveValue('')
    expect(push).not.toHaveBeenCalled()
  })
})

describe('Parcel Search — layout, focus and announcements', () => {
  const lookupFor = (barcode: string) => ({ barcode, items: [{ waybill_reference: WAYBILL, journey_count: 1 }], next_after: null })
  const box = () => screen.getByRole('textbox', { name: 'Parcel barcode' })
  const summary = () => screen.getByRole('heading', { level: 2, name: BARCODE })
  const loadsTrace = () => get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace())

  it('shows the centred intro only before a barcode is submitted and restores it after Clear', async () => {
    const { rerender } = render(<ParcelSearch initialBarcode="" initialWaybill="" />)
    expect(screen.getByText(INTRO)).toBeInTheDocument()

    get.mockReturnValue(new Promise(() => undefined))
    rerender(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    expect(screen.queryByText(INTRO)).not.toBeInTheDocument()

    rerender(<ParcelSearch initialBarcode="" initialWaybill="" />)
    expect(screen.getByText(INTRO)).toBeInTheDocument()
    expect(box()).toHaveValue('')
  })

  it('stays compact through no-match and failure outcomes', async () => {
    get.mockResolvedValueOnce({ barcode: BARCODE, items: [], next_after: null })
    const { rerender } = render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'No matching parcel' })
    expect(screen.queryByText(INTRO)).not.toBeInTheDocument()

    get.mockRejectedValueOnce(new Error('network'))
    rerender(<ParcelSearch initialBarcode="OTHER-1" initialWaybill="" />)
    await screen.findByRole('alert')
    expect(screen.queryByText(INTRO)).not.toBeInTheDocument()
  })

  it('keeps validation attached to the field', async () => {
    const user = userEvent.setup()
    render(<ParcelSearch initialBarcode="" initialWaybill="" />)

    await user.click(screen.getByRole('button', { name: 'Search parcel' }))

    expect(box()).toHaveAccessibleDescription('Enter a barcode of 1–100 characters.')
  })

  it('moves focus to the summary heading after an in-page search succeeds', async () => {
    loadsTrace()
    const { rerender } = render(<ParcelSearch initialBarcode="" initialWaybill="" />)

    rerender(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)

    await waitFor(() => expect(summary()).toHaveFocus())
  })

  it('leaves focus where the browser put it on a first load from a deep link', async () => {
    loadsTrace()
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'Current recorded state' })

    expect(summary()).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('moves focus to the chooser heading when a barcode matches several waybills', async () => {
    get.mockResolvedValueOnce({ barcode: BARCODE, items: [{ waybill_reference: 'WB-1', journey_count: 1 }, { waybill_reference: 'WB-2', journey_count: 2 }], next_after: null })
    const { rerender } = render(<ParcelSearch initialBarcode="" initialWaybill="" />)

    rerender(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Choose a matching waybill' })).toHaveFocus())
    expect(screen.getByRole('status')).toHaveTextContent('Several waybills match')
  })

  it('moves focus to the no-match outcome', async () => {
    get.mockResolvedValueOnce({ barcode: BARCODE, items: [], next_after: null })
    const { rerender } = render(<ParcelSearch initialBarcode="" initialWaybill="" />)

    rerender(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)

    await waitFor(() => expect(screen.getByRole('region', { name: 'No matching parcel' })).toHaveFocus())
  })

  it('moves focus to the failure heading, and to the summary after a successful retry', async () => {
    const user = userEvent.setup()
    get.mockRejectedValueOnce(new Error('network'))
    loadsTrace()
    const { rerender } = render(<ParcelSearch initialBarcode="" initialWaybill="" />)
    rerender(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Parcel evidence not loaded' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(summary()).toHaveFocus())
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/parcels/lookup?barcode=000123%2Fa')
  })

  it('does not move focus when a deep-linked search fails, until the user retries', async () => {
    const user = userEvent.setup()
    get.mockRejectedValueOnce(new Error('network'))
    loadsTrace()
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('alert')
    expect(document.body).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(summary()).toHaveFocus())
  })

  it('announces loading and completion through a single status region, not the evidence tree', async () => {
    loadsTrace()
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading parcel evidence')

    await screen.findByRole('region', { name: 'Current recorded state' })

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(`Parcel evidence loaded for ${BARCODE}`)
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(0)
  })
})

describe('Parcel Search — parcel-first page', () => {
  const follows = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
  const lookupFor = (barcode: string) => ({ barcode, items: [{ waybill_reference: WAYBILL, journey_count: 1 }], next_after: null })
  const older = (n: number, overrides = {}) => makeJourney({ trip_id: `trip-${n}`, trip_reference: `TRP-OLD-${n}`, ...overrides })
  async function showTrace(trace: ReturnType<typeof makeTrace>): Promise<HTMLElement> {
    get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(trace)
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    return screen.findByRole('region', { name: 'Current recorded state' })
  }

  it('reads the timeline, then the earlier-trips section, inside the one overview card', async () => {
    const overview = await showTrace(makeTrace([makeJourney(), older(2)]))

    const earlier = screen.getByRole('heading', { level: 3, name: 'Earlier trips' })
    expect(overview).toContainElement(earlier)
    expect(follows(overview.querySelector('ol')!, earlier)).toBe(true)
    expect(within(overview).getAllByRole('heading', { level: 3, name: 'What was recorded for this parcel' })).toHaveLength(1)
  })

  // Moved from the evidence-note tests: the caveats now sit once in the parcel record popover, beside the status badge.
  it('shows the scan-source, vehicle-position and sealed-contents caveats and the coverage note once, in the popover', async () => {
    const user = userEvent.setup()
    const state = await showTrace(makeTrace())

    expect(screen.queryByRole('region', { name: 'About this evidence' })).not.toBeInTheDocument()
    expect(screen.queryByText('How to read this')).not.toBeInTheDocument()
    await user.click(within(state).getByRole('button', { name: 'How to read this parcel record' }))
    const panel = screen.getByRole('region', { name: 'How to read this parcel record' })
    expect(panel).toHaveTextContent('do not identify the source system or whether it was simulated')
    expect(panel).toHaveTextContent('not parcel GPS or live tracking')
    expect(panel).toHaveTextContent('The contents of a sealed leg are not observable')
    expect(screen.getAllByText(makeTrace().coverage_note)).toHaveLength(1)
  })

  it('has no evidence legend, since every marker is labelled where it is drawn', async () => {
    await showTrace(makeTrace())

    expect(screen.queryByLabelText('Evidence legend')).not.toBeInTheDocument()
  })

  it('shows the latest journey’s scan as a timeline step, with no separate scan block or summary tile', async () => {
    const state = await showTrace(makeTrace())

    expect(screen.queryByRole('region', { name: 'Recorded parcel scans' })).not.toBeInTheDocument()
    expect(within(state).queryByRole('heading', { name: 'Parcel scans' })).not.toBeInTheDocument()
    expect(within(state).getByText('Scanned out at origin')).toBeInTheDocument()
  })

  it('puts the latest journey’s View trip button first in the overview and does not repeat its identity in a card', async () => {
    const state = await showTrace(makeTrace([makeJourney(), older(2)]))

    const [latestLink] = within(state).getAllByRole('link', { name: 'View trip' })
    expect(new URL(latestLink.getAttribute('href')!, 'https://example.test').pathname).toBe('/trips/trip-1')
    expect(screen.queryByRole('article', { name: 'Trip TRP-TRACE-01' })).not.toBeInTheDocument()
    expect(within(state).queryByRole('region', { name: /Parcel spine for/ })).not.toBeInTheDocument()
  })

  it('keeps an earlier trip’s scans inside its own row, apart from the latest timeline', async () => {
    const state = await showTrace(makeTrace([makeJourney(), older(2, { scans: [makeScan(2, { scan_out_at: '2026-09-01T10:00:00Z' })] })]))

    expect(state.querySelector('ol')).not.toHaveTextContent('01 Sep')
    const row = state.querySelector<HTMLElement>('[data-trip-id="trip-2"]')!
    expect(within(row).getAllByText(/01 Sep/).length).toBeGreaterThan(0)
  })

  it('shows a cancelled latest association with its own empty scans, never borrowing an older record', async () => {
    const cancelled = makeJourney({ trip_status: 'cancelled', membership_source: 'creation_manifest', scans: [], progress: { position: 'cancelled', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: false } })
    const state = await showTrace(makeTrace([cancelled, older(2, { scans: [makeScan(2, { scan_out_at: '2026-09-01T10:00:00Z' })] })]))

    expect(state).toHaveTextContent('Trip cancelled after departure')
    expect(within(state.querySelector('ol')!).queryByText('Scanned out at origin')).not.toBeInTheDocument()
    expect(state.querySelector('[data-not-recorded]')).toHaveTextContent('destination scan')
    expect(state).not.toHaveTextContent('Planned manifest membership only')
    expect(state.querySelector('ol')).not.toHaveTextContent('01 Sep')
  })

  it('renders a focusable identity heading, an explicit message and the coverage note when no journey is associated', async () => {
    const user = userEvent.setup()
    get.mockResolvedValueOnce(lookupFor(BARCODE)).mockResolvedValueOnce(makeTrace([]))
    const { rerender } = render(<ParcelSearch initialBarcode="" initialWaybill="" />)

    rerender(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)

    const heading = await screen.findByRole('heading', { level: 2, name: BARCODE })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText('No associated journey is recorded')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What was recorded for this parcel' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'How to read this parcel record' }))
    expect(screen.getByText(makeTrace().coverage_note)).toBeInTheDocument()
  })
})

describe('Parcel Search — history wiring', () => {
  const lookupFor = (barcode: string) => ({ barcode, items: [{ waybill_reference: WAYBILL, journey_count: 1 }], next_after: null })
  const older = (n: number) => makeJourney({ trip_id: `trip-${n}`, trip_reference: `TRP-OLD-${n}` })

  it('loads earlier journeys through the cursor and keeps opened rows open', async () => {
    const user = userEvent.setup()
    get.mockResolvedValueOnce(lookupFor(BARCODE))
      .mockResolvedValueOnce({ ...makeTrace([makeJourney(), older(2)]), next_cursor: 'cursor-1' })
      .mockResolvedValueOnce({ ...makeTrace([older(3)]), next_cursor: null })
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    await screen.findByRole('region', { name: 'Current recorded state' })
    expect(screen.getByText('1 loaded · more available')).toBeInTheDocument()
    const row = screen.getByText('TRP-OLD-2', { selector: 'summary *' }).closest('details')!
    await user.click(row.querySelector('summary')!)

    await user.click(screen.getByRole('button', { name: 'Load earlier journeys' }))

    await screen.findByText('TRP-OLD-3', { selector: 'summary *' })
    expect(get).toHaveBeenLastCalledWith('/api/v1/parcels/trace?barcode=000123%2Fa&waybill_reference=WB-TRACE-01&cursor=cursor-1')
    expect(screen.getByText('2 loaded')).toBeInTheDocument()
    expect(screen.getByText('TRP-OLD-2', { selector: 'summary *' }).closest('details')!.open).toBe(true)
    expect(screen.getByText('TRP-OLD-3', { selector: 'summary *' }).closest('details')!.open).toBe(false)
    expect(screen.queryByRole('button', { name: 'Load earlier journeys' })).not.toBeInTheDocument()
  })
})
