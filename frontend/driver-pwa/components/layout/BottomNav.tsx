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

const TAB_AVATAR_PX = 26

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
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
          const showBadge = href === ROUTES.home && needsAttention
          const isProfile = href === ROUTES.profile

          return (
            <button
              key={href}
              type="button"
              aria-label={showBadge ? `${label}, needs attention` : label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                markTransition('none')
                router.push(href)
              }}
              className={cn(
                'relative flex h-[52px] flex-col items-center justify-center gap-[3px] rounded-full',
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
