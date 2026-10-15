// Fixture shapes copied from a live Photon response (photon.komoot.io, 2026-10-14, query
// "12 Sookhai Place Durban"), trimmed to the properties the parser reads.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parsePhotonResponse, searchAddresses, ADDRESS_RESULT_LIMIT } from '../photon'

const STREET = {
  geometry: { coordinates: [30.9544015, -29.8291042] },
  properties: {
    osm_type: 'W', osm_id: 101, name: 'Sookhai Place', district: 'eThekwini Ward 24',
    city: 'Durban', state: 'KwaZulu-Natal', postcode: '4001', countrycode: 'ZA',
  },
}
const HOUSE = {
  geometry: { coordinates: [31.0396694, -29.7735045] },
  properties: {
    osm_type: 'W', osm_id: 102, housenumber: '12', street: 'Carnarvon Place',
    district: 'eThekwini Ward 36', city: 'Durban', state: 'KwaZulu-Natal', countrycode: 'ZA',
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parsePhotonResponse', () => {
  it('test_flips_geojson_lng_lat_into_latitude_longitude', () => {
    const [street] = parsePhotonResponse({ features: [STREET] })

    expect(street.latitude).toBe(-29.8291042)
    expect(street.longitude).toBe(30.9544015)
    expect(street.label).toBe('Sookhai Place')
    expect(street.detail).toBe('eThekwini Ward 24, Durban, KwaZulu-Natal')
  })

  it('test_builds_a_label_from_house_number_and_street_when_unnamed', () => {
    const [house] = parsePhotonResponse({ features: [HOUSE] })

    expect(house.label).toBe('12 Carnarvon Place')
    expect(house.id).toBe('W102')
  })

  it('test_drops_results_outside_south_africa_and_malformed_features', () => {
    const foreign = { ...STREET, properties: { ...STREET.properties, countrycode: 'NA', osm_id: 9 } }
    const noCoords = { properties: STREET.properties }
    const nameless = { geometry: STREET.geometry, properties: { countrycode: 'ZA' } }

    expect(parsePhotonResponse({ features: [foreign, noCoords, nameless, HOUSE] })).toHaveLength(1)
  })

  it('test_collapses_duplicate_street_segments', () => {
    const otherSegment = { ...STREET, properties: { ...STREET.properties, osm_id: 103 } }

    expect(parsePhotonResponse({ features: [STREET, otherSegment] })).toHaveLength(1)
  })

  it('test_returns_empty_for_a_non_geojson_body', () => {
    expect(parsePhotonResponse(null)).toEqual([])
    expect(parsePhotonResponse({ features: 'nope' })).toEqual([])
  })
})

describe('searchAddresses', () => {
  it('test_queries_photon_bounded_to_south_africa', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [STREET] })))
    vi.stubGlobal('fetch', fetchMock)

    const results = await searchAddresses('  Sookhai Place ')

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/api/')
    expect(url.searchParams.get('q')).toBe('Sookhai Place')
    expect(url.searchParams.get('bbox')).toBe('16.3,-34.9,33.0,-22.1')
    expect(url.searchParams.get('limit')).toBe(String(ADDRESS_RESULT_LIMIT))
    expect(results).toHaveLength(1)
  })

  it('test_skips_the_request_for_a_too_short_query', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await searchAddresses('ab')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test_throws_on_an_http_error_so_the_ui_can_say_unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('busy', { status: 503 })))

    await expect(searchAddresses('Sookhai Place')).rejects.toThrow('HTTP 503')
  })
})
