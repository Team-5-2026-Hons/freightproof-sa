// Element shapes copied from a live Overpass response (overpass-api.de, 2026-10-14, pin
// -29.7942, 30.982): ways with tags and a closed `geometry` ring of {lat, lon}.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildOutlineQuery, fetchOutlineCandidates, parseOverpassOutlines, MAX_CANDIDATES } from '../overpass'
import type { LatLngPair } from '@shared/lib/types/precinct'

const PIN: LatLngPair = [-29.7942, 30.982]

function way(id: number, tags: Record<string, string>, ring: LatLngPair[]) {
  const closed = [...ring, ring[0]]
  return { type: 'way', id, tags, geometry: closed.map(([lat, lon]) => ({ lat, lon })) }
}

const WAREHOUSE = way(1, { building: 'warehouse' }, [[-29.7937, 30.9815], [-29.7937, 30.9825], [-29.7947, 30.9825], [-29.7947, 30.9815]])
const ESTATE = way(2, { landuse: 'industrial', name: 'Riverhorse Valley' }, [[-29.790, 30.978], [-29.790, 30.986], [-29.798, 30.986], [-29.798, 30.978]])
const NEIGHBOUR = way(3, { building: 'yes' }, [[-29.7940, 30.9831], [-29.7940, 30.9836], [-29.7944, 30.9836], [-29.7944, 30.9831]])

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseOverpassOutlines', () => {
  it('test_orders_containing_shapes_smallest_first_then_nearby_buildings', () => {
    const result = parseOverpassOutlines({ elements: [NEIGHBOUR, ESTATE, WAREHOUSE] }, PIN)

    expect(result.map((c) => c.id)).toEqual(['way/1', 'way/2', 'way/3'])
    expect(result[0].containsPin).toBe(true)
    expect(result[2].containsPin).toBe(false)
  })

  it('test_opens_the_closed_osm_ring_and_labels_by_tag', () => {
    const [warehouse, estate] = parseOverpassOutlines({ elements: [WAREHOUSE, ESTATE] }, PIN)

    expect(warehouse.polygon).toHaveLength(4)
    expect(warehouse.label).toBe('Warehouse')
    expect(warehouse.detail).toMatch(/contains the pin$/)
    expect(estate.label).toBe('Riverhorse Valley (industrial site)')
  })

  it('test_drops_shapes_the_server_would_reject', () => {
    const tiny = way(4, { building: 'yes' }, [[-29.79420, 30.98200], [-29.79420, 30.98205], [-29.79425, 30.98205], [-29.79425, 30.98200]])
    const bowtie = { ...WAREHOUSE, id: 5, geometry: [0, 2, 1, 3, 0].map((i) => WAREHOUSE.geometry[i]) }
    const node = { type: 'node', id: 6, lat: -29.79, lon: 30.98 }

    expect(parseOverpassOutlines({ elements: [tiny, bowtie, node] }, PIN)).toEqual([])
  })

  it('test_caps_the_list', () => {
    const many = Array.from({ length: MAX_CANDIDATES + 3 }, (_, i) => ({ ...WAREHOUSE, id: 100 + i }))

    expect(parseOverpassOutlines({ elements: many }, PIN)).toHaveLength(MAX_CANDIDATES)
  })

  it('test_returns_empty_for_a_malformed_body', () => {
    expect(parseOverpassOutlines(null, PIN)).toEqual([])
    expect(parseOverpassOutlines({ elements: 'nope' }, PIN)).toEqual([])
  })
})

describe('fetchOutlineCandidates', () => {
  it('test_posts_the_query_for_buildings_near_and_areas_around_the_pin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [WAREHOUSE] })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchOutlineCandidates(PIN[0], PIN[1])

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect((init.body as URLSearchParams).get('data')).toBe(buildOutlineQuery(PIN[0], PIN[1]))
    expect(buildOutlineQuery(PIN[0], PIN[1])).toContain('is_in(-29.7942,30.982)')
    expect(result).toHaveLength(1)
  })

  it('test_throws_on_http_failure_so_the_form_can_offer_the_square', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('busy', { status: 429 })))

    await expect(fetchOutlineCandidates(PIN[0], PIN[1])).rejects.toThrow('HTTP 429')
  })
})
