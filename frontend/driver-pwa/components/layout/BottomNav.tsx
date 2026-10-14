'use client'

import { useRouter, usePathname } from 'next/navigation'
import { NAV_ITEMS, isNavItemActive } from '@/lib/navigation/nav-items'
import { useTrip } from '@/lib/hooks/useTrip'
import { useAuth } from '@/lib/hooks/useAuth'
import { useDriverPhoto } from '@/lib/profile/driver-photo'
import { DriverAvatar } from '@/components/profile/DriverAvatar'
import { ROUTES } from '@/lib/constants/routes'
import { tripNeedsAttention } from '@/lib/utils/trip-attention'
import { cn } from '@/lib/utils'
import { markTransition } from '@/lib/navigation/transition-direction'

// The Profile tab's avatar, in px like the icons beside it (see the Dynamic Type note below).
const TAB_AVATAR_PX = 26

// iOS 26-style floating tab bar: one glass pill of three labelled destinations — Home,
// Trips, Profile (overhaul, Oct 2026). The separate profile circle is gone: Settings
// merged into Profile, and the Profile tab shows the driver themselves. Labels are not
// optional — an icon-only bar made drivers guess what the truck meant
// (HIG tab-bars › "Include tab labels to help with navigation").
//
// The selected tab is ink, not blue: blue now means progress and nothing else.
//
// Sizes here are deliberately px, not the rem type roles: iOS tab bars do not grow with
// Dynamic Type (the system shows a Large Content Viewer instead), and a pill that scaled
// with an accessibility text size would swallow the bottom third of the screen.
export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  // useTrip() throws outside TripProvider, but BottomNav is only ever rendered from
  // AppShell, which app/(app)/layout.tsx always wraps in <TripProvider>.
  const { trip, exceptions } = useTrip()
  const { user } = useAuth()
  const photo = useDriverPhoto(user?.id ?? null)
  const needsAttention = tripNeedsAttention(trip, exceptions)

  return (
    <nav
      aria-label="Main navigation"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-sticky px-5 pt-2 pb-safe"
    >
      <div className="glass-nav pointer-events-auto grid h-[62px] grid-cols-3 items-center rounded-full px-1.5 shadow-level-4 ring-1 ring-hairline">
        {NAV_ITEMS.map(({ label, href, icon: Icon, matchPrefixes }) => {
          const isActive = isNavItemActive(pathname, href, matchPrefixes)
          // On Home, because Home is where the active trip and its open exceptions are
          // shown — a badge must lead to its reason. Identified by route, not label.
          const showBadge = href === ROUTES.home && needsAttention
          const isProfile = href === ROUTES.profile

          return (
            <button
              key={href}
              type="button"
              aria-label={showBadge ? `${label}, needs attention` : label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                // Tabs swap in place on iOS; only drilling in and backing out slide.
                markTransition('none')
                router.push(href)
              }}
              className={cn(
                'relative flex h-[52px] flex-col items-center justify-center gap-[3px] rounded-full',
                // Feedback on press, not on the next paint (emil-apple-design §1).
                'transition-[transform,color] duration-150 active:scale-95',
                isActive ? 'text-surface-on' : 'text-surface-on-variant',
              )}
            >
              <span className="relative">
                {isProfile && user ? (
                  <DriverAvatar name={user.full_name} photo={photo} size={TAB_AVATAR_PX} ring={isActive} decorative />
                ) : (
                  <Icon className="h-6 w-6" strokeWidth={isActive ? 2.25 : 1.75} aria-hidden />
                )}
                {showBadge && (
                  <span
                    className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full bg-error ring-2 ring-surface"
                    aria-hidden
                  />
                )}
              </span>
              {/* 11px is the HIG floor; Apple's own tab labels sit at 10pt. */}
              <span className={cn('text-[11px] leading-none', isActive ? 'font-semibold' : 'font-medium')}>
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
