import { describe, expect, it } from 'vitest'

import type { TripFormParams } from '@shared/lib/types/assistant'
import { buildPrefillHref, parsePrefill } from './prefill'

const DRIVER = '7e2cc10b-8d3d-4d53-8158-f4d885e5545f'
const HORSE = '59aeacf7-65c5-4cb8-b8d4-6aabd49fb53e'
const TRAILER = 'b75249a3-3bd6-4eb8-966b-e763057d1389'
const FROM = '0d8ad133-640c-47fe-83a1-cbaf96697831'
const TO = '939b839a-6904-4293-b1a0-e38b5385dd1b'

const EMPTY_LEG: TripFormParams = {
  mode: 'empty_leg', manifest_number: null, driver_id: DRIVER, horse_id: HORSE, trailer_ids: [TRAILER],
  origin_precinct_id: FROM, destination_precinct_id: TO, departure: '2026-10-22T17:00', arrival: '2026-10-23T06:00',
}

function query(href: string): URLSearchParams {
  return new URLSearchParams(href.split('?')[1])
}

describe('trip form prefill links', () => {
  it('round-trips an empty leg through the link', () => {
    const href = buildPrefillHref(EMPTY_LEG)

    expect(href.startsWith('/trips/new?')).toBe(true)
    expect(parsePrefill(query(href))).toEqual({
      mode: 'empty_leg', manifestNumber: null, driverId: DRIVER, horseId: HORSE, trailerIds: [TRAILER],
      originId: FROM, destinationId: TO, departure: '2026-10-22T17:00', arrival: '2026-10-23T06:00', dropped: [],
    })
  })

  it('carries a manifest number and leaves the rest out', () => {
    const href = buildPrefillHref({ ...EMPTY_LEG, mode: 'manifest', manifest_number: 81, driver_id: null, horse_id: null,
      trailer_ids: [], origin_precinct_id: null, destination_precinct_id: null, departure: null, arrival: null })

    expect(href).toBe('/trips/new?mode=manifest&manifest=81')
    expect(parsePrefill(query(href))?.manifestNumber).toBe(81)
  })

  it('never puts a name in the link', () => {
    expect(buildPrefillHref(EMPTY_LEG)).not.toMatch(/[A-Z][a-z]+ [A-Z][a-z]+/)
  })

  it('drops malformed values and says which', () => {
    const prefill = parsePrefill(new URLSearchParams('mode=empty_leg&driver=Tim&departure=tomorrow&trailers=x,' + TRAILER))

    expect(prefill?.driverId).toBeNull()
    expect(prefill?.departure).toBeNull()
    expect(prefill?.trailerIds).toEqual([TRAILER])
    expect(prefill?.dropped.sort()).toEqual(['departure', 'driver', 'trailers'])
  })

  it('an ordinary visit (no mode) is no prefill', () => {
    expect(parsePrefill(new URLSearchParams(''))).toBeNull()
    expect(parsePrefill(new URLSearchParams('mode=delete_everything'))).toBeNull()
  })
})
