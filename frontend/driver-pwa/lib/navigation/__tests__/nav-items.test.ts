// frontend/driver-pwa/lib/navigation/__tests__/nav-items.test.ts
import { describe, it, expect } from 'vitest'
import { isNavItemActive, NAV_ITEMS } from '../nav-items'
import { ROUTES } from '@/lib/constants/routes'

const trips = NAV_ITEMS.find((item) => item.label === 'Trips')!
const profile = NAV_ITEMS.find((item) => item.label === 'Profile')!

describe('isNavItemActive', () => {
  it('matches Home only on an exact "/" — Home has no matchPrefixes to fall back on', () => {
    expect(isNavItemActive('/', ROUTES.home, [])).toBe(true)
    expect(isNavItemActive('/trips', ROUTES.home, [])).toBe(false)
    expect(isNavItemActive('/settings', ROUTES.home, [])).toBe(false)
  })

  it('treats "/trips" and any nested trip list/detail path as Trips-active', () => {
    expect(isNavItemActive('/trips', trips.href, trips.matchPrefixes)).toBe(true)
    expect(isNavItemActive('/trips/abc', trips.href, trips.matchPrefixes)).toBe(true)
  })

  it('also treats the singular "/trip/..." handshake tree as Trips-active', () => {
    expect(isNavItemActive('/trip/handshake/2/step/x', trips.href, trips.matchPrefixes)).toBe(true)
  })

  it('test_profile_is_active_on_profile_and_on_the_old_settings_path', () => {
    expect(isNavItemActive('/profile', profile.href, profile.matchPrefixes)).toBe(true)
    expect(isNavItemActive('/settings', profile.href, profile.matchPrefixes)).toBe(true)
  })

  it('does not cross-match — a trips path is not Profile-active and vice versa', () => {
    expect(isNavItemActive('/trips', profile.href, profile.matchPrefixes)).toBe(false)
    expect(isNavItemActive('/profile', trips.href, trips.matchPrefixes)).toBe(false)
  })

  it('test_has_exactly_three_tabs_home_trips_profile', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual(['Home', 'Trips', 'Profile'])
    expect(profile.href).toBe(ROUTES.profile)
  })
})
