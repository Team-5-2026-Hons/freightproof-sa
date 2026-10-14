import { describe, expect, it } from 'vitest'
import { matchesTripSearch } from './search'

const MANIFEST_TRIP = {
  trip_reference: 'FP-20261001-AB12CD34',
  driver: { full_name: 'Sipho Dlamini' },
  pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'JNB', number: 69, display: 'CGY Logistics · JNB 69' },
}
const EMPTY_LEG = { ...MANIFEST_TRIP, pp_manifest: null }

describe('matchesTripSearch', () => {
  it('matches the trip reference, the driver and the manifest label, ignoring case', () => {
    expect(matchesTripSearch(MANIFEST_TRIP, 'ab12')).toBe(true)
    expect(matchesTripSearch(MANIFEST_TRIP, 'sipho')).toBe(true)
    expect(matchesTripSearch(MANIFEST_TRIP, 'jnb 69')).toBe(true)
    expect(matchesTripSearch(MANIFEST_TRIP, 'cgy')).toBe(true)
  })

  it('handles a trip with no manifest instead of throwing', () => {
    expect(matchesTripSearch(EMPTY_LEG, 'jnb')).toBe(false)
  })

  it('matches everything on a blank term', () => {
    expect(matchesTripSearch(EMPTY_LEG, '   ')).toBe(true)
  })
})
