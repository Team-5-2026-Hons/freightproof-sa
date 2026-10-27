// Shared nav item data + active-match logic, consumed by BottomNav.

import { Home, Truck, CircleUserRound, type LucideIcon } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  matchPrefixes: readonly string[]
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Home', href: ROUTES.home, icon: Home, matchPrefixes: [] },
  { label: 'Trips', href: ROUTES.trips, icon: Truck, matchPrefixes: ['/trips', '/trip'] },
  { label: 'Profile', href: ROUTES.profile, icon: CircleUserRound, matchPrefixes: [ROUTES.profile, ROUTES.settings] },
]

/** Exact match for '/', otherwise true if pathname is or is nested under any prefix. */
export function isNavItemActive(pathname: string, href: string, matchPrefixes: readonly string[]): boolean {
  if (href === ROUTES.home) return pathname === href
  return matchPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
