// Shared nav item data + active-match logic, consumed by BottomNav (and previously
// NavDrawer, now removed). Lives in lib/navigation/ alongside full-bleed.ts and
// handshake-flow.ts so both the component and its regression tests can import it
// without depending on a specific nav UI shell.

import { Home, Truck, Settings, type LucideIcon } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  matchPrefixes: readonly string[]
}

// Trips list/detail live under '/trips', but handshake, in-transit, checkpoint,
// upload, exception, and panic screens all live under the singular '/trip/[id]/...'
// prefix (see routes.ts). A driver reaches every one of those screens by drilling
// into a specific trip, so conceptually they're still "in Trips" — there's no other
// nav item that represents that state — so both prefixes count as Trips-active.
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Home', href: ROUTES.home, icon: Home, matchPrefixes: [] },
  { label: 'Trips', href: ROUTES.trips, icon: Truck, matchPrefixes: ['/trips', '/trip'] },
  { label: 'Settings', href: ROUTES.settings, icon: Settings, matchPrefixes: ['/settings'] },
]

/** Exact match for '/', otherwise true if pathname is or is nested under any prefix. */
export function isNavItemActive(pathname: string, href: string, matchPrefixes: readonly string[]): boolean {
  if (href === ROUTES.home) return pathname === href
  return matchPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
