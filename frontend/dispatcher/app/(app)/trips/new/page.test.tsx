import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }))
const toast = vi.hoisted(() => ({ notify: vi.fn() }))

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))
// TopBar mounts ForensicControls, which needs ForensicModeProvider, which reads the user.
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('@/lib/hooks/useDrivers', () => ({ useDrivers: vi.fn() }))
vi.mock('@/lib/hooks/useVehicles', () => ({ useVehicles: vi.fn() }))
vi.mock('@/lib/hooks/usePrecincts', () => ({ usePrecincts: vi.fn() }))
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  previewPPManifest: vi.fn(),
  createTripFromPPManifest: vi.fn(),
  createTrip: vi.fn(),
  findLiveTripForManifest: vi.fn(),
}))

import TripNewPage from './page'
import {
  ApiError, createTrip, createTripFromPPManifest, findLiveTripForManifest, previewPPManifest,
} from '@/lib/api/client'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { useVehicles } from '@/lib/hooks/useVehicles'
import { ROUTES } from '@/lib/constants/routes'
import { makePreview, makeWarning } from '@/lib/trips/__fixtures__/preview'
import { isoToLocalInput } from '@/lib/trips/manifest-form'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import {
  mockPrecincts, PRECINCT_CGY_JHB_ID, PRECINCT_FEDEX_DBN_ID, PRECINCT_FEDEX_JHB_ID,
} from '@shared/lib/mocks/precincts'
import { mockHorses } from '@shared/lib/mocks/vehicles'
import type { Trip } from '@shared/lib/types/trip'

const CTA = 'Create Trip + Lock to Blockchain'
const CONFIRM = 'Yes, create and lock trip'
const created = (id: string): Trip => ({ id }) as Trip   // the page reads only the id
const DRIVER_ID = mockDrivers[0].id
const HORSE_ID = mockHorses[0].id

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(useDrivers).mockReturnValue({ drivers: mockDrivers, isLoading: false, error: null, refetch: vi.fn() })
  vi.mocked(useVehicles).mockReturnValue({
    horses: mockHorses, trailers: [], all: mockHorses, isLoading: false, error: null, refetch: vi.fn(),
  })
  vi.mocked(usePrecincts).mockReturnValue({ precincts: mockPrecincts, isLoading: false, error: null, refetch: vi.fn() })
})

function renderPage(): void {
  render(
    <ForensicModeProvider>
      <TripNewPage />
    </ForensicModeProvider>,
  )
}

async function lookUp(manifestNumber = '81', display = 'The Courier Guy · CPT 81'): Promise<void> {
  fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: manifestNumber } })
  fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
  await screen.findByRole('region', { name: `Manifest ${display}` })
}

function pick(trigger: string, option: RegExp): void {
  fireEvent.click(screen.getByRole('button', { name: trigger }))
  fireEvent.click(screen.getByRole('button', { name: option }))
}

function chooseCrew(): void {
  pick('Assigned driver', /Sipho Dlamini/)
  pick('Horse', /GP 12-34 ZX/)
}

async function create(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: CTA }))
  fireEvent.click(await screen.findByRole('button', { name: CONFIRM }))
}

describe('Create Trip: from a manifest', () => {
  it('creates a loaded trip from a looked-up manifest and opens it', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    vi.mocked(createTripFromPPManifest).mockResolvedValue(created('trip-new'))
    renderPage()

    await lookUp()
    chooseCrew()
    const summary = screen.getByRole('complementary', { name: 'Trip summary' })
    expect(within(summary).getByText('Arrival')).toBeInTheDocument()
    expect(within(summary).queryAllByText('Not set')).toHaveLength(0)
    await create()

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(ROUTES.tripDetail('trip-new')))
    expect(createTripFromPPManifest).toHaveBeenCalledWith({
      manifest_number: 81,
      expected_snapshot_sha256: 'a'.repeat(64),
      driver_id: DRIVER_ID,
      horse_id: HORSE_ID,
      trailer_ids: [],
      planned_departure_at: null,   // untouched manifest times are never sent back (D2)
      planned_arrival_at: null,
      origin_precinct_id: null,
      destination_precinct_id: null,
    })
    expect(toast.notify).toHaveBeenCalledWith({ kind: 'success', title: 'Trip created · Journey lock anchored' })
  })

  it('asks only for what the manifest lacks', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview({
      destination: { hub_code: 'DUR', precinct_id: null, precinct_name: null },
      planned_departure_at: null,
      expected_arrival_at: null,
      warnings: [makeWarning('DESTINATION_HUB_UNLINKED'), makeWarning('NO_PLANNED_TIMES')],
    }))
    vi.mocked(createTripFromPPManifest).mockResolvedValue(created('trip-new'))
    renderPage()
    await lookUp()
    chooseCrew()

    fireEvent.click(screen.getByRole('button', { name: CTA }))

    expect(await screen.findByText('Choose the precinct for hub DUR.')).toBeInTheDocument()
    expect(screen.getByText('Enter a planned departure.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: CONFIRM })).not.toBeInTheDocument()
    // The CTA is in the sticky summary: the dispatcher is taken to the first field to fix.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Destination precinct' })).toHaveFocus())

    pick('Destination precinct', /Courier Guy JHB/)
    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T18:00' } })
    await create()

    await waitFor(() => expect(createTripFromPPManifest).toHaveBeenCalled())
    const payload = vi.mocked(createTripFromPPManifest).mock.calls[0][0]
    expect(payload.destination_precinct_id).toBe(PRECINCT_CGY_JHB_ID)
    expect(payload.origin_precinct_id).toBeNull()
    expect(payload.planned_departure_at).toBe(new Date('2026-10-02T18:00').toISOString())
  })

  it('refuses a blocked manifest and asks for nothing else', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview({
      can_create: false,
      warnings: [makeWarning('MANIFEST_ALREADY_ON_TRIP', {
        message: 'Manifest CPT 81 is already on trip FP-20261001-AAAA0001.',
        trip_id: 'trip-old', trip_reference: 'FP-20261001-AAAA0001',
      })],
    }))
    renderPage()

    await lookUp()

    expect(screen.getByRole('link', { name: /Open FP-20261001-AAAA0001/ })).toHaveAttribute('href', ROUTES.tripDetail('trip-old'))
    expect(screen.getByRole('button', { name: CTA })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Assigned driver' })).not.toBeInTheDocument()
  })

  it('clears the summary when the number is edited after a lookup', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    renderPage()
    await lookUp()

    fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: '82' } })

    expect(screen.queryByRole('region', { name: /Manifest The Courier Guy/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: CTA })).toBeDisabled()
  })

  it('refuses a number that is not one, without calling the server', () => {
    renderPage()

    fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: 'JNB 69' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))

    expect(screen.getByText('Enter the manifest number using digits only, e.g. 81.')).toBeInTheDocument()
    expect(previewPPManifest).not.toHaveBeenCalled()
  })

  it('shows the new summary when the manifest changed before create, and keeps the crew', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    // The client moved the departure in PP between preview and create.
    const fresh = makePreview({
      snapshot_sha256: 'b'.repeat(64), client_reference: 'PO-CGY-0081-REV', planned_departure_at: '2026-10-02T17:00:00Z',
    })
    const message = 'Manifest 81 changed since it was previewed. Review it again.'
    vi.mocked(createTripFromPPManifest)
      .mockRejectedValueOnce(new ApiError(409, message, { code: 'MANIFEST_CHANGED', message, preview: fresh }))
      .mockResolvedValueOnce(created('trip-new'))
    renderPage()
    await lookUp()
    chooseCrew()

    await create()

    expect(await screen.findByText(/The manifest changed since you looked it up/)).toBeInTheDocument()
    expect(screen.getByText('PO-CGY-0081-REV')).toBeInTheDocument()
    // The untouched departure follows the new manifest; it was never the dispatcher's own.
    expect(screen.getByLabelText(/Planned departure/)).toHaveValue(isoToLocalInput('2026-10-02T17:00:00Z'))

    await create()

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(ROUTES.tripDetail('trip-new')))
    const retry = vi.mocked(createTripFromPPManifest).mock.calls[1][0]
    expect(retry.expected_snapshot_sha256).toBe('b'.repeat(64))
    expect(retry.driver_id).toBe(DRIVER_ID)
    expect(retry.planned_departure_at).toBeNull()
  })

  it('keeps an edited time across a changed manifest', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    const fresh = makePreview({ snapshot_sha256: 'b'.repeat(64), planned_departure_at: '2026-10-02T17:00:00Z' })
    const message = 'Manifest 81 changed since it was previewed. Review it again.'
    vi.mocked(createTripFromPPManifest)
      .mockRejectedValueOnce(new ApiError(409, message, { code: 'MANIFEST_CHANGED', message, preview: fresh }))
      .mockResolvedValueOnce(created('trip-new'))
    renderPage()
    await lookUp()
    chooseCrew()
    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T20:00' } })

    await create()
    await screen.findByText(/The manifest changed since you looked it up/)
    await create()

    await waitFor(() => expect(createTripFromPPManifest).toHaveBeenCalledTimes(2))
    expect(vi.mocked(createTripFromPPManifest).mock.calls[1][0].planned_departure_at)
      .toBe(new Date('2026-10-02T20:00').toISOString())
  })

  it('links to the trip that already holds the manifest', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    const message = 'This manifest is already on trip FP-1. Cancel that trip before creating a new one.'
    vi.mocked(createTripFromPPManifest).mockRejectedValue(new ApiError(409, message, {
      code: 'MANIFEST_ALREADY_ON_TRIP', message, trip_id: 'trip-1', trip_reference: 'FP-1',
    }))
    renderPage()
    await lookUp()
    chooseCrew()

    await create()

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText(message).closest('[tabindex="-1"]')).toHaveFocus()
    expect(screen.getByRole('link', { name: /Open FP-1/ })).toHaveAttribute('href', ROUTES.tripDetail('trip-1'))
  })

  it('finds the trip after a timeout instead of saying "maybe"', async () => {
    const preview = makePreview()
    vi.mocked(previewPPManifest).mockResolvedValue(preview)
    vi.mocked(createTripFromPPManifest).mockRejectedValue(new ApiError(0, 'timed out'))
    vi.mocked(findLiveTripForManifest).mockResolvedValue({ id: 'trip-late' })
    renderPage()
    await lookUp()
    chooseCrew()

    await create()

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(ROUTES.tripDetail('trip-late')))
    expect(findLiveTripForManifest).toHaveBeenCalledWith(preview.pp_manifest)
  })

  it('says the trip was not created when the timeout lookup finds nothing', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    vi.mocked(createTripFromPPManifest).mockRejectedValue(new ApiError(0, 'timed out'))
    vi.mocked(findLiveTripForManifest).mockResolvedValue(null)
    renderPage()
    await lookUp()
    chooseCrew()

    await create()

    expect(await screen.findByText(/no trip was created for this manifest/)).toBeInTheDocument()
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('says so when even the timeout lookup fails, rather than claiming "not created"', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    vi.mocked(createTripFromPPManifest).mockRejectedValue(new ApiError(0, 'timed out'))
    vi.mocked(findLiveTripForManifest).mockRejectedValue(new ApiError(0, 'timed out'))
    renderPage()
    await lookUp()
    chooseCrew()

    await create()

    expect(await screen.findByText(/the check for the trip failed too/)).toBeInTheDocument()
  })

  it('offers an empty leg when the parcel system cannot look manifests up', async () => {
    vi.mocked(previewPPManifest).mockRejectedValue(
      new ApiError(501, 'Manifest lookup is not available from the connected parcel system.'),
    )
    renderPage()
    fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: '81' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Create an empty leg instead' }))

    expect(screen.getByRole('tab', { name: 'Empty leg (no manifest)' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Create Trip: kept and cleared entries', () => {
  it('keeps picks across a changed manifest', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview({
      destination: { hub_code: 'DUR', precinct_id: null, precinct_name: null },
      warnings: [makeWarning('DESTINATION_HUB_UNLINKED')],
    }))
    const fresh = makePreview({
      snapshot_sha256: 'b'.repeat(64),
      destination: { hub_code: 'DUR', precinct_id: null, precinct_name: null },
      warnings: [makeWarning('DESTINATION_HUB_UNLINKED')],
    })
    const message = 'Manifest 81 changed since it was previewed. Review it again.'
    vi.mocked(createTripFromPPManifest)
      .mockRejectedValueOnce(new ApiError(409, message, { code: 'MANIFEST_CHANGED', message, preview: fresh }))
      .mockResolvedValueOnce(created('trip-new'))
    renderPage()
    await lookUp()
    chooseCrew()
    pick('Destination precinct', /Courier Guy JHB/)

    await create()
    await screen.findByText(/The manifest changed since you looked it up/)
    await create()

    await waitFor(() => expect(createTripFromPPManifest).toHaveBeenCalledTimes(2))
    expect(vi.mocked(createTripFromPPManifest).mock.calls[1][0].destination_precinct_id).toBe(PRECINCT_CGY_JHB_ID)
  })

  it('clears route and times but keeps the crew when the mode switches', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Empty leg (no manifest)' }))
    pick('Origin precinct', /FedEx JHB/)
    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T18:00' } })
    chooseCrew()

    fireEvent.click(screen.getByRole('tab', { name: 'From manifest' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Empty leg (no manifest)' }))

    expect(screen.getByLabelText(/Planned departure/)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Origin precinct' })).toHaveTextContent('Select origin precinct…')
    expect(screen.getByRole('button', { name: 'Assigned driver' })).toHaveTextContent('Sipho Dlamini')
  })

  it('clears picks and times but keeps the crew when the manifest number is edited', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview({
      planned_departure_at: null,
      warnings: [makeWarning('NO_PLANNED_TIMES')],
    }))
    renderPage()
    await lookUp()
    chooseCrew()
    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T18:00' } })

    fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: '82' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
    await screen.findByRole('region', { name: /Manifest/ })

    expect(screen.getByLabelText(/Planned departure/)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Assigned driver' })).toHaveTextContent('Sipho Dlamini')
  })

  it('sends one request when confirm is clicked twice while a create is in flight', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    vi.mocked(createTripFromPPManifest).mockReturnValue(new Promise<Trip>(() => {}))
    renderPage()
    await lookUp()
    chooseCrew()

    fireEvent.click(screen.getByRole('button', { name: CTA }))
    const confirm = await screen.findByRole('button', { name: CONFIRM })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(createTripFromPPManifest).toHaveBeenCalledTimes(1)
  })
})

describe('Create Trip: empty leg', () => {
  it('creates an empty leg through POST /trips, with no order number', async () => {
    vi.mocked(createTrip).mockResolvedValue(created('trip-empty'))
    renderPage()

    fireEvent.click(screen.getByRole('tab', { name: 'Empty leg (no manifest)' }))
    pick('Origin precinct', /FedEx JHB/)
    pick('Destination precinct', /FedEx DBN/)
    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T18:00' } })
    chooseCrew()
    await create()

    await waitFor(() => expect(createTrip).toHaveBeenCalledWith({
      trip_type: 'empty_leg',
      driver_id: DRIVER_ID,
      horse_id: HORSE_ID,
      trailer_ids: [],
      origin_precinct_id: PRECINCT_FEDEX_JHB_ID,
      destination_precinct_id: PRECINCT_FEDEX_DBN_ID,
      consignments: [],
      planned_departure_at: new Date('2026-10-02T18:00').toISOString(),
      planned_arrival_at: null,
    }))
    expect(nav.push).toHaveBeenCalledWith(ROUTES.tripDetail('trip-empty'))
  })

  it('does not guess after an empty-leg timeout, and points to Active trips', async () => {
    vi.mocked(createTrip).mockRejectedValue(new ApiError(0, 'timed out'))
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Empty leg (no manifest)' }))
    pick('Origin precinct', /FedEx JHB/)
    pick('Destination precinct', /FedEx DBN/)
    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T18:00' } })
    chooseCrew()

    await create()

    expect(await screen.findByText(/not known whether the empty leg was created/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open Active trips/ })).toHaveAttribute('href', ROUTES.home)
    expect(findLiveTripForManifest).not.toHaveBeenCalled()
  })
})
