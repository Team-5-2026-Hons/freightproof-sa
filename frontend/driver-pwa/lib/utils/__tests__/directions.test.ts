import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockPrecincts } from '@shared/lib/mocks/precincts'

const mockPlatform = vi.fn(() => 'web')
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => mockPlatform() } }))

import { directionsUrl } from '../directions'

const dbn = mockPrecincts[1]
const latLng = `${dbn.latitude},${dbn.longitude}`

beforeEach(() => mockPlatform.mockReturnValue('web'))

describe('directionsUrl', () => {
  it('test_opens_google_maps_directions_in_a_browser', () => {
    expect(directionsUrl(String(dbn.id))).toBe(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(latLng)}`)
  })

  it('test_hands_off_to_apple_maps_driving_directions_on_ios', () => {
    mockPlatform.mockReturnValue('ios')

    expect(directionsUrl(String(dbn.id))).toBe(`maps://?daddr=${latLng}&dirflg=d`)
  })

  it('test_starts_google_navigation_on_android', () => {
    mockPlatform.mockReturnValue('android')

    expect(directionsUrl(String(dbn.id))).toBe(`google.navigation:q=${latLng}`)
  })

  it('test_offers_nothing_for_a_precinct_it_cannot_place', () => {
    expect(directionsUrl(crypto.randomUUID())).toBeNull()
  })
})
