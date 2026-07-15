// frontend/driver-pwa/lib/navigation/__tests__/nav-items.test.ts
import { describe, it, expect } from 'vitest'
import { isNavItemActive, NAV_ITEMS } from '../nav-items'
import { ROUTES } from '@/lib/constants/routes'

const trips = NAV_ITEMS.find((item) => item.label === 'Trips')!
const settings = NAV_ITEMS.find((item) => item.label === 'Settings')!

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

  it('treats any nested "/settings/..." path as Settings-active', () => {
    expect(isNavItemActive('/settings/foo', settings.href, settings.matchPrefixes)).toBe(true)
  })

  it('does not cross-match — a trips path is not Settings-active and vice versa', () => {
    expect(isNavItemActive('/trips', settings.href, settings.matchPrefixes)).toBe(false)
    expect(isNavItemActive('/settings', trips.href, trips.matchPrefixes)).toBe(false)
  })
})
