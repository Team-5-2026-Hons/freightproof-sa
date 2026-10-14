import { describe, expect, it } from 'vitest'
import { locationLabel, progressLabel, tripEvidenceLink } from './trace-display'
import { makeJourney } from './__fixtures__/trace'

describe('trace display semantics', () => {
  it('does not claim a delivery confirmation after an override', () => {
    expect(progressLabel({ ...makeJourney().progress, position: 'after_delivery', has_overrides: true })).toBe('Journey resolved with an override')
  })
  it('does not turn the reference precinct into an observed position without a verdict', () => {
    const journey = makeJourney()
    journey.last_recorded_location!.precinct_confirmed = null
    expect(locationLabel(journey)).toBe('Position recorded — facility unverified')
  })
  it('does not put return query parameters inside the phase fragment', () => {
    const url = new URL(tripEvidenceLink('trip', '/parcels?barcode=0001', 'phase'), 'https://example.test')
    expect(url.searchParams.get('returnTo')).toBe('/parcels?barcode=0001')
    expect(url.hash).toBe('#phase-phase')
  })
})
