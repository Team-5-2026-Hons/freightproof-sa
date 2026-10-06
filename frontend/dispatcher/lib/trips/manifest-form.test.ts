import { describe, expect, it } from 'vitest'
import {
  EMPTY_CREW, NO_OVERRIDES, NO_PICKS, NO_TIMES,
  buildEmptyLegPayload, buildFromManifestPayload, isoToSastInput, sastInputToIso,
  manifestGaps, manifestTimes, parseManifestNumber, shownTimes, validateCrew,
  validateEmptyLegRoute, validateManifestRoute, validateSchedule,
} from './manifest-form'
import { DESTINATION_ID, ORIGIN_ID, makePreview } from './__fixtures__/preview'

const CREW = { driverId: 'driver-1', horseId: 'horse-1', trailerIds: ['trailer-1'] }
const UNLINKED_DESTINATION = { hub_code: 'DUR', precinct_id: null, precinct_name: null }

describe('parseManifestNumber', () => {
  it('accepts a positive whole number, trimmed', () => {
    expect(parseManifestNumber(' 81 ')).toBe(81)
  })

  it('reads a padded number as the number', () => {
    expect(parseManifestNumber('081')).toBe(81)
  })

  it('refuses anything else', () => {
    for (const input of ['', '0', '000', '-3', '8.1', 'JNB 69', '1234567890']) {
      expect(parseManifestNumber(input)).toBeNull()
    }
  })
})

// Literal strings on purpose: the answer must be the same whatever zone the machine is in, which
// is also checked by running this file under TZ=UTC and TZ=America/New_York.
describe('SAST datetime inputs', () => {
  it('renders an instant as the SAST wall-clock time', () => {
    expect(isoToSastInput('2026-10-06T18:00:00Z')).toBe('2026-10-06T20:00')
  })

  it('rolls the SAST day over at 22:00Z', () => {
    expect(isoToSastInput('2026-10-05T21:59:00Z')).toBe('2026-10-05T23:59')
    expect(isoToSastInput('2026-10-05T22:00:00Z')).toBe('2026-10-06T00:00')
  })

  it('reads an input value as SAST, giving the UTC instant', () => {
    expect(sastInputToIso('2026-10-06T20:00')).toBe('2026-10-06T18:00:00.000Z')
  })

  it('round-trips an on-the-minute instant', () => {
    expect(sastInputToIso(isoToSastInput('2026-10-02T16:00:00Z'))).toBe('2026-10-02T16:00:00.000Z')
    expect(isoToSastInput(sastInputToIso('2026-10-02T18:00'))).toBe('2026-10-02T18:00')
  })
})

describe('manifestTimes and shownTimes', () => {
  it("uses the manifest's times, and '' where it has none", () => {
    expect(manifestTimes(makePreview()).departure).toBe(isoToSastInput('2026-10-02T16:00:00Z'))
    expect(manifestTimes(makePreview({ planned_departure_at: null, expected_arrival_at: null }))).toEqual(NO_TIMES)
  })

  it("shows the dispatcher's override over the source, including an emptied field", () => {
    const source = { departure: '2026-10-02T18:00', arrival: '2026-10-03T06:00' }

    expect(shownTimes(NO_OVERRIDES, source)).toEqual(source)
    expect(shownTimes({ departure: '2026-10-02T19:00', arrival: '' }, source)).toEqual({ departure: '2026-10-02T19:00', arrival: '' })
  })
})

describe('manifestGaps', () => {
  it('asks only for hubs PP could not link', () => {
    expect(manifestGaps(makePreview())).toEqual({ origin: false, destination: false })
    expect(manifestGaps(makePreview({ destination: UNLINKED_DESTINATION }))).toEqual({ origin: false, destination: true })
  })
})

describe('validation', () => {
  it('needs a driver, a horse and a legal trailer set', () => {
    expect(validateCrew(EMPTY_CREW, false)).toEqual({
      driver: 'Select a driver.', horse: 'Select a horse.', trailers: 'Fix the trailer combination.',
    })
    expect(validateCrew(CREW, true)).toEqual({})
  })

  it('always needs a planned departure', () => {
    expect(validateSchedule(NO_TIMES, NO_TIMES)).toEqual({ departure: 'Enter a planned departure.' })
  })

  it('refuses to drop an arrival the manifest supplies', () => {
    const source = { departure: '2026-10-02T18:00', arrival: '2026-10-03T06:00' }

    expect(validateSchedule({ departure: source.departure, arrival: '' }, source).arrival)
      .toMatch(/cannot be removed/)
  })

  it('needs the arrival after the departure', () => {
    expect(validateSchedule({ departure: '2026-10-02T18:00', arrival: '2026-10-02T17:00' }, NO_TIMES))
      .toEqual({ arrival: 'Must be after departure.' })
  })

  it('needs at least the 15 minutes the server requires between departure and arrival', () => {
    expect(validateSchedule({ departure: '2026-10-02T18:00', arrival: '2026-10-02T18:14' }, NO_TIMES))
      .toEqual({ arrival: 'Must be at least 15 minutes after departure.' })
    expect(validateSchedule({ departure: '2026-10-02T18:00', arrival: '2026-10-02T18:15' }, NO_TIMES))
      .toEqual({})
  })

  it('needs a precinct for each unlinked hub, and two different precincts', () => {
    const preview = makePreview({ destination: UNLINKED_DESTINATION })

    expect(validateManifestRoute(preview, NO_PICKS)).toEqual({ destination: 'Choose the precinct for hub DUR.' })
    expect(validateManifestRoute(preview, { originId: '', destinationId: ORIGIN_ID })).toEqual({
      destination: 'Origin and destination must be different precincts.',
    })
    expect(validateManifestRoute(preview, { originId: '', destinationId: DESTINATION_ID })).toEqual({})
  })

  it('needs both ends of an empty leg, and different ones', () => {
    expect(validateEmptyLegRoute(NO_PICKS)).toEqual({
      origin: 'Select an origin precinct.', destination: 'Select a destination precinct.',
    })
    expect(validateEmptyLegRoute({ originId: 'p1', destinationId: 'p1' })).toEqual({ destination: 'Must differ from origin.' })
  })
})

describe('buildFromManifestPayload', () => {
  it("sends null for untouched times so the server keeps the manifest's own", () => {
    const payload = buildFromManifestPayload(makePreview(), CREW, NO_OVERRIDES, NO_PICKS)

    expect(payload).toEqual({
      manifest_number: 81,
      expected_snapshot_sha256: 'a'.repeat(64),
      driver_id: 'driver-1',
      horse_id: 'horse-1',
      trailer_ids: ['trailer-1'],
      planned_departure_at: null,
      planned_arrival_at: null,
      origin_precinct_id: null,
      destination_precinct_id: null,
    })
  })

  it('treats an override equal to the manifest value as untouched', () => {
    const preview = makePreview()
    const same = { departure: manifestTimes(preview).departure, arrival: null }

    expect(buildFromManifestPayload(preview, CREW, same, NO_PICKS).planned_departure_at).toBeNull()
  })

  it('sends an edited time as a UTC instant, and a pick only for an unlinked hub', () => {
    const preview = makePreview({ destination: UNLINKED_DESTINATION })
    const payload = buildFromManifestPayload(
      preview, CREW,
      { departure: '2026-10-02T19:30', arrival: null },
      { originId: 'ignored-origin', destinationId: DESTINATION_ID },
    )

    expect(payload.planned_departure_at).toBe('2026-10-02T17:30:00.000Z')
    expect(payload.origin_precinct_id).toBeNull()
    expect(payload.destination_precinct_id).toBe(DESTINATION_ID)
  })
})

describe('buildEmptyLegPayload', () => {
  it('posts an empty leg with no cargo and no order number', () => {
    const payload = buildEmptyLegPayload(
      CREW,
      { departure: '2026-10-02T19:30', arrival: null },
      { originId: 'p1', destinationId: 'p2' },
    )

    expect(payload).toEqual({
      trip_type: 'empty_leg',
      driver_id: 'driver-1',
      horse_id: 'horse-1',
      trailer_ids: ['trailer-1'],
      origin_precinct_id: 'p1',
      destination_precinct_id: 'p2',
      consignments: [],
      planned_departure_at: '2026-10-02T17:30:00.000Z',
      planned_arrival_at: null,
    })
  })
})
