'use client'

import { useRouter, usePathname } from 'next/navigation'
import { CircleUserRound } from 'lucide-react'
import { NAV_ITEMS, isNavItemActive } from '@/lib/navigation/nav-items'
import { useTrip } from '@/lib/hooks/useTrip'
import { ROUTES } from '@/lib/constants/routes'
import { tripNeedsAttention } from '@/lib/utils/trip-attention'
import { cn } from '@/lib/utils'
import { markTransition } from '@/lib/navigation/transition-direction'

interface BottomNavProps {
  onProfileClick: () => void
}

// iOS 26-style floating tab bar: a glass pill of labelled destinations, plus a separate
// circular Profile button in the slot Apple gives to search/account. Labels are not
// optional — an icon-only bar made drivers guess what the truck and the gear meant
// (HIG tab-bars › "Include tab labels to help with navigation").
//
// Sizes here are deliberately px, not the rem type roles: iOS tab bars do not grow with
// Dynamic Type (the system shows a Large Content Viewer instead), and a pill that scaled
// with an accessibility text size would swallow the bottom third of the screen.
export function BottomNav({ onProfileClick }: BottomNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  // useTrip() throws outside TripProvider, but BottomNav is only ever rendered from
  // AppShell, which app/(app)/layout.tsx always wraps in <TripProvider>.
  const { trip, exceptions } = useTrip()
  const needsAttention = tripNeedsAttention(trip, exceptions)

  return (
    <nav
      aria-label="Main navigation"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-sticky flex items-center justify-center gap-3 px-4 pt-2 pb-safe"
    >
      <div className="glass-nav pointer-events-auto flex items-center rounded-full border border-outline-variant/30 p-1 shadow-level-4">
        {NAV_ITEMS.map(({ label, href, icon: Icon, matchPrefixes }) => {
          const isActive = isNavItemActive(pathname, href, matchPrefixes)
          // Identified by route rather than label so the badge never depends on display text.
          const showBadge = href === ROUTES.trips && needsAttention

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
                'relative flex h-[52px] min-w-[72px] flex-col items-center justify-center gap-0.5 rounded-full px-3',
                // Feedback on press, not on the next paint: the pill dips the instant the
                // finger lands (emil-apple-design §1, respond on pointer-down).
                'transition-[transform,background-color,color] duration-150 active:scale-95',
                isActive
                  ? 'bg-secondary/10 text-secondary'
                  : 'text-surface-on-variant hover:text-surface-on',
              )}
            >
              <span className="relative">
                <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.25 : 1.75} aria-hidden />
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

      <button
        type="button"
        aria-label="Open driver profile"
        onClick={onProfileClick}
        className={cn(
          'glass-nav pointer-events-auto flex h-[62px] w-[62px] items-center justify-center rounded-full',
          'border border-outline-variant/30 text-surface-on-variant shadow-level-4',
          'transition-[transform,color] duration-150 active:scale-95 hover:text-surface-on',
        )}
      >
        <CircleUserRound className="h-[26px] w-[26px]" strokeWidth={1.75} aria-hidden />
      </button>
    </nav>
  )
}
