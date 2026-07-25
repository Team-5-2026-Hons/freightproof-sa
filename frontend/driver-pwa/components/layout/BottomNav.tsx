'use client'

import { useRouter, usePathname } from 'next/navigation'
import { CircleUserRound } from 'lucide-react'
import { NAV_ITEMS, isNavItemActive } from '@/lib/navigation/nav-items'
import { useTrip } from '@/lib/hooks/useTrip'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'

interface BottomNavProps {
  onProfileClick: () => void
}

// Shopify-mobile-style floating bottom bar: a centered pill of destination icons
// plus a separate circular avatar button, replacing the old hamburger + NavDrawer.
// We have no search feature, so (unlike the Shopify reference) there's no search
// circle in the pill — just the three NAV_ITEMS destinations.
export function BottomNav({ onProfileClick }: BottomNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  // useTrip() throws outside TripProvider, but BottomNav is only ever rendered from
  // AppShell, which app/(app)/layout.tsx always wraps in <TripProvider> — the same
  // assumption every other useTrip() consumer in this codebase already relies on
  // (HomeContent, ActiveTripPageClient, InTransitPageClient, etc.), so no extra
  // try/catch guard is added here; it would only mask a real wiring bug elsewhere.
  const { trip } = useTrip()

  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-sticky flex items-center justify-center gap-3 px-4 pt-2 pb-safe"
    >
      <div className="flex items-center gap-1 rounded-full border border-outline-variant/20 bg-surface-container-lowest px-2 py-2 shadow-lg">
        {NAV_ITEMS.map(({ label, href, icon: Icon, matchPrefixes }) => {
          const isActive = isNavItemActive(pathname, href, matchPrefixes)
          // Red dot signals a driver has an assigned active trip — only ever relevant
          // on the Trips destination, identified by route rather than label to avoid
          // a magic string match against NAV_ITEMS' display text.
          const showTripDot = href === ROUTES.trips && trip !== null

          return (
            <button
              key={href}
              type="button"
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => router.push(href)}
              className={cn(
                'relative flex h-11 w-11 items-center justify-center rounded-full transition-colors',
                isActive
                  ? 'bg-surface-container-low text-surface-on'
                  : 'text-surface-on-variant hover:text-surface-on',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              {showTripDot && (
                <>
                  <span
                    className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-error"
                    aria-hidden
                  />
                  <span className="sr-only">You have an active trip assigned</span>
                </>
              )}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        aria-label="Open driver profile"
        onClick={onProfileClick}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-lowest text-surface-on-variant shadow-lg transition-colors hover:text-surface-on"
      >
        <CircleUserRound className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </button>
    </nav>
  )
}
