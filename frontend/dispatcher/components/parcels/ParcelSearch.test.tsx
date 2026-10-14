import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api/client'
import { ParcelSearch } from './ParcelSearch'
import { ParcelJourneyView, ParcelCurrentState } from './ParcelJourneyView'
import { BARCODE, WAYBILL, makeJourney, makeTrace } from './__fixtures__/trace'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/lib/api/client', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
  return { api: { get: vi.fn() }, ApiError }
})
const get = vi.mocked(api.get)

beforeEach(() => { get.mockReset(); replace.mockReset() })

describe('Parcel Search', () => {
  it('starts with an accessible barcode form and rejects blank input', async () => {
    const user = userEvent.setup()
    render(<ParcelSearch initialBarcode="" initialWaybill="" />)
    expect(screen.getByText('Start with a barcode')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Search parcel' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a barcode')
    expect(get).not.toHaveBeenCalled()
  })

  it('preserves leading zeros and encodes the submitted search in the URL', async () => {
    const user = userEvent.setup()
    render(<ParcelSearch initialBarcode="" initialWaybill="" />)
    await user.type(screen.getByRole('textbox', { name: 'Parcel barcode' }), ` ${BARCODE} `)
    await user.click(screen.getByRole('button', { name: 'Search parcel' }))
    expect(replace).toHaveBeenCalledWith('/parcels?barcode=000123%2Fa', { scroll: false })
  })

  it('shows the summary, scan observations and grouped journey for a successful search', async () => {
    get.mockResolvedValueOnce({ barcode: BARCODE, items: [{ waybill_reference: WAYBILL, journey_count: 1 }], next_after: null }).mockResolvedValueOnce(makeTrace())
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    const state = await screen.findByRole('region', { name: 'Current recorded state' })
    expect(within(state).getByText(BARCODE)).toBeInTheDocument()
    expect(within(state).getByText('In transit — awaiting arrival attestation')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Custody leg from Origin Depot' })).toHaveTextContent('Inspection not yet recorded')
    expect(screen.getByRole('region', { name: 'Parcel scan observations' })).toHaveTextContent('Destination scan-in')
    expect(screen.getByRole('region', { name: 'Evidence summary' })).toHaveTextContent('not proof of loss')
    expect(screen.queryByText('Verified on blockchain')).not.toBeInTheDocument()
  })

  it('makes ambiguous waybills selectable without claiming one is the parcel journey', async () => {
    get.mockResolvedValueOnce({ barcode: BARCODE, items: [{ waybill_reference: 'WB-1', journey_count: 1 }, { waybill_reference: 'WB-2', journey_count: 2 }], next_after: null })
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    const choice = await screen.findByRole('button', { name: /WB-2/ })
    fireEvent.click(choice)
    expect(replace).toHaveBeenCalledWith('/parcels?barcode=000123%2Fa&waybill=WB-2', { scroll: false })
    expect(screen.queryByRole('region', { name: 'Current recorded state' })).not.toBeInTheDocument()
  })

  it('distinguishes no result from initial and network error states', async () => {
    get.mockResolvedValueOnce({ barcode: BARCODE, items: [], next_after: null })
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    expect(await screen.findByText('No matching parcel')).toBeInTheDocument()
    expect(screen.queryByText('Start with a barcode')).not.toBeInTheDocument()
  })

  it('retries a failed search and withdraws evidence when the input changes', async () => {
    get.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ barcode: BARCODE, items: [{ waybill_reference: WAYBILL, journey_count: 1 }], next_after: null }).mockResolvedValueOnce(makeTrace())
    render(<ParcelSearch initialBarcode={BARCODE} initialWaybill="" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByRole('region', { name: 'Current recorded state' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Parcel barcode' }), { target: { value: 'new' } })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Current recorded state' })).not.toBeInTheDocument())
  })
})

describe('parcel evidence presentation', () => {
  it('keeps unknown capture time distinct from the phase clock and shows SAST rollover', () => {
    render(<ParcelCurrentState trace={makeTrace()} />)
    expect(screen.getByText('Capture time not recorded')).toBeInTheDocument()
    expect(screen.getByText('08 Oct 2026, 00:30 SAST')).toBeInTheDocument()
    expect(screen.getByText(/not parcel GPS or live tracking/)).toBeInTheDocument()
  })

  it('retains every phase once when rendering custody bands and preserves return navigation', () => {
    const journey = makeJourney()
    render(<ParcelJourneyView journey={journey} returnTo="/parcels?barcode=000123%2Fa&waybill=WB-TRACE-01" />)
    expect(screen.getAllByText('Departure', { exact: true })).toHaveLength(1)
    expect(screen.getAllByText('Unloading', { exact: true })).toHaveLength(1)
    const details = screen.getByText('Departure', { exact: true }).closest('details')!
    fireEvent.click(details.querySelector('summary')!)
    details.open = true
    const link = within(details).getByRole('link', { name: 'Open phase evidence' })
    const url = new URL(link.getAttribute('href')!, 'https://example.test')
    expect(url.hash).toBe('#phase-phase-1')
    expect(url.searchParams.get('returnTo')).toBe('/parcels?barcode=000123%2Fa&waybill=WB-TRACE-01')
  })

  it('labels cancelled planned phases as not reached and archived membership as planned', () => {
    const journey = { ...makeJourney(), trip_status: 'cancelled' as const, membership_source: 'creation_manifest' as const }
    render(<ParcelJourneyView journey={journey} returnTo="/parcels" />)
    expect(screen.getAllByText('Not reached').length).toBeGreaterThan(0)
    expect(screen.getByText(/Historical manifest association/)).toBeInTheDocument()
  })
})
