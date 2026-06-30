'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Home, Truck, Settings } from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'

interface NavDrawerProps {
  open: boolean
  onClose: () => void
}

// Trips list/detail live under '/trips', but handshake, in-transit, checkpoint,
// upload, exception, and panic screens all live under the singular '/trip/[id]/...'
// prefix (see routes.ts). A driver reaches every one of those screens by drilling
// into a specific trip, so conceptually they're still "in Trips" — there's no other
// nav item that represents that state — so both prefixes count as Trips-active.
const NAV_ITEMS = [
  { label: 'Home',  href: ROUTES.home,     icon: Home,    matchPrefixes: [] as string[] },
  { label: 'Trips', href: ROUTES.trips,    icon: Truck,   matchPrefixes: ['/trips', '/trip'] },
  { label: 'Settings', href: ROUTES.settings, icon: Settings, matchPrefixes: ['/settings'] },
] as const

/** Exact match for '/', otherwise true if pathname is or is nested under any prefix. */
function isNavItemActive(pathname: string, href: string, matchPrefixes: readonly string[]): boolean {
  if (href === ROUTES.home) return pathname === href
  return matchPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function NavDrawer({ open, onClose }: NavDrawerProps) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <Drawer open={open} onClose={onClose} side="left" title="FreightProof">
      <nav className="flex flex-col gap-1" aria-label="Main navigation">
        {NAV_ITEMS.map(({ label, href, icon: Icon, matchPrefixes }) => {
          const isActive = isNavItemActive(pathname, href, matchPrefixes)
          return (
            <button
              key={href}
              onClick={() => { router.push(href); onClose() }}
              className={cn(
                'flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors',
                isActive
                  ? 'bg-secondary/10 text-secondary'
                  : 'text-surface-on-variant hover:bg-surface-container-low',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          )
        })}
      </nav>
    </Drawer>
  )
}
