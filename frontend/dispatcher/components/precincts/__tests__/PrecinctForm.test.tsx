import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PrecinctForm } from '../PrecinctForm'
import type { AddressSuggestion } from '@/lib/geocode/photon'
import type { OutlineCandidate } from '@/lib/geocode/overpass'
import type { LatLngPair, Precinct } from '@shared/lib/types/precinct'

// TopBar pulls in the auth chain and forensic-mode provider; neither is under test here.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))
vi.mock('@/components/ui/TopBar', () => ({
  TopBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: vi.fn() }),
}))
const mockPost = vi.fn()
const mockPatch = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}))

// The outline lookup goes to a third-party host: never from a test.
const mockFetchOutlineCandidates = vi.fn()
vi.mock('@/lib/geocode/overpass', () => ({
  fetchOutlineCandidates: (lat: number, lng: number, signal?: AbortSignal) => mockFetchOutlineCandidates(lat, lng, signal),
}))

// Leaflet needs a real layout engine; the map's own suite covers it. The stub surfaces
// what the form hands it (pin, outline) and lets a test click the map or drag a corner.
const EDITED: LatLngPair[] = [[-29.79, 30.98], [-29.79, 30.99], [-29.80, 30.99], [-29.80, 30.98]]
vi.mock('@/components/map/GeofenceMap', () => ({
  GeofenceMap: ({ latitude, longitude, polygon, showCircle, onPositionChange, onPolygonChange }: {
    latitude: number
    longitude: number
    polygon?: LatLngPair[] | null
    showCircle?: boolean
    onPositionChange?: (p: { latitude: number; longitude: number }) => void
    onPolygonChange?: (p: LatLngPair[]) => void
  }) => (
    <div>
      <div data-testid="map" data-corners={polygon?.length ?? 0} data-circle={String(showCircle ?? true)}>{`${latitude},${longitude}`}</div>
      <button type="button" onClick={() => onPositionChange?.({ latitude: -29.7941, longitude: 30.9821 })}>click map</button>
      <button type="button" onClick={() => onPolygonChange?.(EDITED)}>drag corner</button>
    </div>
  ),
}))

const PICK: AddressSuggestion = {
  id: 'W101', label: 'Sookhai Place', detail: 'Durban, KwaZulu-Natal', latitude: -29.7942, longitude: 30.982,
}

// A second, different site ~1.5 km away, for the "new search clears the old outline" case.
const PICK_2: AddressSuggestion = {
  id: 'W202', label: '9 Other Road', detail: 'Durban', latitude: -29.808, longitude: 30.982,
}

// The search component has its own suite; stubbed to buttons that "pick" one result each.
vi.mock('@/components/precincts/AddressSearch', () => ({
  AddressSearch: ({ onSelect }: { onSelect: (s: AddressSuggestion) => void }) => (
    <>
      <button type="button" onClick={() => onSelect(PICK)}>pick address</button>
      <button type="button" onClick={() => onSelect(PICK_2)}>pick second address</button>
    </>
  ),
}))

// ~100 m box around PICK.
const WAREHOUSE: OutlineCandidate = {
  id: 'way/1', label: 'Warehouse', detail: '1.0 ha · contains the pin', areaM2: 10_000, containsPin: true,
  polygon: [[-29.7937, 30.9815], [-29.7937, 30.9825], [-29.7947, 30.9825], [-29.7947, 30.9815]],
}
const ESTATE: OutlineCandidate = {
  id: 'way/2', label: 'Industrial site', detail: '40.0 ha · contains the pin', areaM2: 400_000, containsPin: true,
  polygon: [[-29.790, 30.978], [-29.790, 30.986], [-29.798, 30.986], [-29.798, 30.978], [-29.794, 30.976]],
}

const OUTLINE_PRECINCT = {
  id: 'p-1', name: 'FedEx DBN', principal_organization_id: 'org-1',
  address: 'Gate 3, Riverhorse Valley', latitude: -29.7942, longitude: 30.982,
  geofence_radius_metres: 200, geofence_polygon: WAREHOUSE.polygon,
  is_shared: false, created_at: '2026-10-01T00:00:00Z',
} as unknown as Precinct

function field(name: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
}

function corners(): string | null {
  return screen.getByTestId('map').getAttribute('data-corners')
}

async function autoFit(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Auto-fit outline' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Auto-fit outline' })).toBeEnabled())
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchOutlineCandidates.mockResolvedValue([])
  mockPost.mockResolvedValue({ id: 'new-id' })
  mockPatch.mockResolvedValue({})
})

describe('PrecinctForm address search', () => {
  it('test_picked_address_moves_the_pin_and_fills_the_address_without_drawing', () => {
    render(<PrecinctForm />)

    fireEvent.click(screen.getByRole('button', { name: 'pick address' }))

    expect(field('latitude').value).toBe('-29.79420')
    expect(field('longitude').value).toBe('30.98200')
    expect(field('address').value).toBe('Sookhai Place, Durban, KwaZulu-Natal')
    expect(screen.getByTestId('map')).toHaveTextContent('-29.7942,30.982')
    // Drawing waits for Auto-fit; no circle stands in for the fence meanwhile.
    expect(corners()).toBe('0')
    expect(screen.getByTestId('map')).toHaveAttribute('data-circle', 'false')
    expect(mockFetchOutlineCandidates).not.toHaveBeenCalled()
  })

  it('test_picked_address_replaces_the_address_and_clears_an_existing_outline', () => {
    render(<PrecinctForm precinct={OUTLINE_PRECINCT} />)
    expect(corners()).toBe('4')

    fireEvent.click(screen.getByRole('button', { name: 'pick address' }))

    expect(field('address').value).toBe('Sookhai Place, Durban, KwaZulu-Natal')
    expect(field('latitude').value).toBe('-29.79420')
    expect(corners()).toBe('0')
  })
})

describe('PrecinctForm property outline', () => {
  it('test_auto_fit_draws_the_best_mapped_shape_and_lists_the_rest', async () => {
    mockFetchOutlineCandidates.mockResolvedValue([WAREHOUSE, ESTATE])
    render(<PrecinctForm />)

    fireEvent.click(screen.getByRole('button', { name: 'pick address' }))
    await autoFit()

    expect(corners()).toBe('4')
    expect(screen.getByRole('button', { name: /Warehouse/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Industrial site/ }))
    expect(corners()).toBe('5')
  })

  it('test_falls_back_to_a_starter_square_when_osm_is_unreachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetchOutlineCandidates.mockRejectedValue(new Error('HTTP 429'))
    render(<PrecinctForm />)

    fireEvent.click(screen.getByRole('button', { name: 'pick address' }))
    await autoFit()

    expect(corners()).toBe('4')
    expect(screen.getByText(/couldn.t reach openstreetmap/i)).toBeInTheDocument()
    warn.mockRestore()
  })

  it('test_saves_the_edited_outline_with_the_precinct', async () => {
    mockFetchOutlineCandidates.mockResolvedValue([WAREHOUSE])
    render(<PrecinctForm />)
    fireEvent.change(field('name'), { target: { value: 'FedEx DBN' } })
    fireEvent.click(screen.getByRole('button', { name: 'pick address' }))
    await autoFit()
    expect(corners()).toBe('4')

    fireEvent.click(screen.getByRole('button', { name: 'drag corner' }))
    // The edited box is ~1 km across; the pin at -29.7941, 30.9821 is inside it.
    fireEvent.click(screen.getByRole('button', { name: 'click map' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Precinct' }))
    })

    expect(mockPost).toHaveBeenCalledWith('/api/v1/precincts', expect.objectContaining({ geofence_polygon: EDITED }))
  })

  it('test_save_without_an_outline_says_so_and_sends_nothing', async () => {
    render(<PrecinctForm />)
    fireEvent.change(field('name'), { target: { value: 'FedEx DBN' } })
    fireEvent.change(field('latitude'), { target: { value: '-29.7942' } })
    fireEvent.change(field('longitude'), { target: { value: '30.982' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Precinct' }))
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/pick a mapped shape or start from a square/i)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('test_switching_to_radius_saves_no_outline', async () => {
    render(<PrecinctForm precinct={OUTLINE_PRECINCT} />)

    fireEvent.click(screen.getByRole('button', { name: 'Radius' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })

    expect(mockPatch).toHaveBeenCalledWith('/api/v1/precincts/p-1', expect.objectContaining({ geofence_polygon: null }))
    expect(corners()).toBe('0')
  })

  it('test_moving_the_pin_keeps_an_existing_outline', () => {
    render(<PrecinctForm precinct={OUTLINE_PRECINCT} />)

    fireEvent.click(screen.getByRole('button', { name: 'click map' }))

    expect(corners()).toBe('4')
    expect(mockFetchOutlineCandidates).not.toHaveBeenCalled()
  })

  it('test_pin_far_from_the_outline_blocks_save_with_the_server_rule', async () => {
    render(<PrecinctForm precinct={OUTLINE_PRECINCT} />)

    fireEvent.change(field('latitude'), { target: { value: '-29.70' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/outside the outline/)
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('test_a_new_search_clears_the_previous_sites_square', async () => {
    render(<PrecinctForm />)
    fireEvent.click(screen.getByRole('button', { name: 'pick address' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start from a square' }))
    expect(corners()).toBe('4')

    fireEvent.click(screen.getByRole('button', { name: 'pick second address' }))

    expect(corners()).toBe('0')
    expect(field('address').value).toBe('9 Other Road, Durban')
    await autoFit()
    expect(mockFetchOutlineCandidates).toHaveBeenCalledWith(-29.808, 30.982, expect.any(AbortSignal))
    expect(corners()).toBe('4')
  })

  it('test_map_clicks_never_look_up_or_redraw_the_outline', () => {
    render(<PrecinctForm />)

    fireEvent.click(screen.getByRole('button', { name: 'click map' }))

    expect(mockFetchOutlineCandidates).not.toHaveBeenCalled()
    expect(corners()).toBe('0')
  })
})
