import { describe, expect, it } from 'vitest'

import {
  validatePrecinctForm,
  parseCoordinatePair,
  PRECINCT_FIELD_ORDER,
  type PrecinctFormValues,
} from '@shared/lib/validation/precinct'

function values(overrides: Partial<PrecinctFormValues> = {}): PrecinctFormValues {
  return {
    name: 'Riverhorse Valley',
    address: '12 Sookhai Place, Durban',
    latitude: '-29.7942',
    longitude: '30.9820',
    geofence_radius_metres: '200',
    ...overrides,
  }
}

describe('validatePrecinctForm', () => {
  it('accepts a well-formed precinct', () => {
    expect(Object.values(validatePrecinctForm(values())).every((e) => e === null)).toBe(true)
  })

  it('requires a name', () => {
    expect(validatePrecinctForm(values({ name: '   ' })).name).not.toBeNull()
  })

  it('rejects a latitude outside -90..90', () => {
    expect(validatePrecinctForm(values({ latitude: '91' })).latitude).not.toBeNull()
    expect(validatePrecinctForm(values({ latitude: '-91' })).latitude).not.toBeNull()
  })

  it('rejects a longitude outside -180..180', () => {
    expect(validatePrecinctForm(values({ longitude: '181' })).longitude).not.toBeNull()
    expect(validatePrecinctForm(values({ longitude: '-181' })).longitude).not.toBeNull()
  })

  it('accepts the boundary coordinates', () => {
    const errors = validatePrecinctForm(values({ latitude: '-90', longitude: '180' }))

    expect(errors.latitude).toBeNull()
    expect(errors.longitude).toBeNull()
  })

  it('rejects a non-numeric coordinate', () => {
    expect(validatePrecinctForm(values({ latitude: 'south' })).latitude).not.toBeNull()
  })

  it('requires both coordinates', () => {
    const errors = validatePrecinctForm(values({ latitude: '', longitude: '' }))

    expect(errors.latitude).not.toBeNull()
    expect(errors.longitude).not.toBeNull()
  })

  it('rejects a radius outside the backend bounds', () => {
    expect(validatePrecinctForm(values({ geofence_radius_metres: '49' })).geofence_radius_metres).not.toBeNull()
    expect(validatePrecinctForm(values({ geofence_radius_metres: '5001' })).geofence_radius_metres).not.toBeNull()
  })

  it('accepts the radius boundaries', () => {
    expect(validatePrecinctForm(values({ geofence_radius_metres: '50' })).geofence_radius_metres).toBeNull()
    expect(validatePrecinctForm(values({ geofence_radius_metres: '5000' })).geofence_radius_metres).toBeNull()
  })

  it('lists every validated field in the focus order', () => {
    expect([...PRECINCT_FIELD_ORDER].sort()).toEqual(Object.keys(validatePrecinctForm(values())).sort())
  })
})

describe('parseCoordinatePair', () => {
  it('splits a comma-separated pair pasted from a maps app', () => {
    expect(parseCoordinatePair('-29.7942, 30.9820')).toEqual({ lat: '-29.7942', lng: '30.9820' })
  })

  it('tolerates missing and extra whitespace', () => {
    expect(parseCoordinatePair('-29.7942,30.9820')).toEqual({ lat: '-29.7942', lng: '30.9820' })
    expect(parseCoordinatePair('  -29.7942 ,  30.9820  ')).toEqual({ lat: '-29.7942', lng: '30.9820' })
  })

  it('returns null for a plain single number, so normal typing is untouched', () => {
    expect(parseCoordinatePair('-29.7942')).toBeNull()
    expect(parseCoordinatePair('-29.')).toBeNull()
    expect(parseCoordinatePair('')).toBeNull()
  })

  it('returns null when either half is not a number', () => {
    expect(parseCoordinatePair('south, 30.98')).toBeNull()
    expect(parseCoordinatePair('-29.79, east')).toBeNull()
  })

  it('returns null when the pair is out of range, rather than filling in nonsense', () => {
    expect(parseCoordinatePair('999, 30.98')).toBeNull()
    expect(parseCoordinatePair('-29.79, 999')).toBeNull()
  })

  it('ignores a three-part string', () => {
    expect(parseCoordinatePair('-29.79, 30.98, 12')).toBeNull()
  })

  it('parses a DMS pair with straight quotes, south/east', () => {
    // 26 + 9/60 + 53.9/3600 = 26.164972..., negated for S; 28 + 14/60 + 0.1/3600 = 28.233361... for E.
    expect(parseCoordinatePair(`26°09'53.9"S 28°14'00.1"E`)).toEqual({
      lat: '-26.16497',
      lng: '28.23336',
    })
  })

  it('parses a DMS pair with prime/double-prime marks, north/west', () => {
    // 40 + 26/60 + 46/3600 = 40.446111... for N; 79 + 58/60 + 56/3600 = 79.982222..., negated for W.
    expect(parseCoordinatePair(`40°26′46″N 79°58′56″W`)).toEqual({
      lat: '40.44611',
      lng: '-79.98222',
    })
  })

  it('tolerates a comma between the two DMS tokens', () => {
    expect(parseCoordinatePair(`26°09'53.9"S, 28°14'00.1"E`)).toEqual({
      lat: '-26.16497',
      lng: '28.23336',
    })
  })

  it('accepts a lowercase hemisphere letter', () => {
    expect(parseCoordinatePair(`26°09'53.9"s 28°14'00.1"e`)).toEqual({
      lat: '-26.16497',
      lng: '28.23336',
    })
  })

  it('returns null when the DMS pair is not lat(N/S)-then-lng(E/W)', () => {
    // Both tokens claim to be latitude — not a coordinate pair, however well-formed each token is.
    expect(parseCoordinatePair(`26°09'53.9"S 28°14'00.1"N`)).toBeNull()
  })

  it('returns null when a DMS token is missing its hemisphere letter', () => {
    expect(parseCoordinatePair(`26°09'53.9" 28°14'00.1"E`)).toBeNull()
  })

  it('returns null when a DMS pair computes outside a valid coordinate range', () => {
    expect(parseCoordinatePair(`200°09'53.9"S 28°14'00.1"E`)).toBeNull()
  })
})
