'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { OfflineBanner } from './OfflineBanner'
import { ProfilePanel } from './ProfilePanel'
import { BottomNav } from './BottomNav'

// Titles for the top-level tab destinations — the only routes AppShell wraps (every
// other route is full-bleed and renders its own SubpageHeader/StepHeader). They match
// the tab labels, so the screen a driver lands on is named exactly what they tapped.
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/trips': 'Trips',
  '/settings': 'Settings',
}

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  // True once the large title has scrolled up under the bar — the iOS hand-off point
  // where the big title disappears and the small centred one takes over.
  const [collapsed, setCollapsed] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const pathname = usePathname()
  const title = ROUTE_TITLES[pathname] ?? 'FreightProof'

  // Collapse once the large title's midline passes under the bar — the point iOS hands
  // over, and early enough that a short screen (which can only scroll a few points) never
  // rests with half-clipped letters peeking out under an opaque bar. Read from live layout
  // on each scroll rather than a fixed pixel threshold, because the bar's height moves
  // with the safe-area inset, the offline banner, and Dynamic Type. React skips the
  // re-render while the boolean is unchanged, so this is cheap per event.
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const titleEl = titleRef.current
    const headerEl = headerRef.current
    if (!titleEl || !headerEl) return
    const titleMidline = titleEl.offsetTop + titleEl.offsetHeight / 2
    setCollapsed(event.currentTarget.scrollTop > titleMidline - headerEl.offsetHeight)
  }, [])

  return (
    <>
      {/* One scrollport for the whole tab screen, h-dvh so the frame is exactly one
          screen tall. The bar is sticky INSIDE it (not a sibling above it) so content
          really passes underneath the glass once scrolled — the material only means
          something when there is something behind it. pb-32 lets the last row scroll
          clear of the floating tab pill, which overlays rather than taking up space. */}
      <div onScroll={handleScroll} className="h-dvh overflow-y-auto overscroll-contain">
        {/* pt-safe: under viewportFit:'cover' the bar would otherwise sit behind the
            status bar / Dynamic Island. At rest it is the page colour with no edge —
            the large title below is the header. Collapsed, it turns to glass with a
            hairline, the moment content starts sliding beneath it. */}
        <header
          ref={headerRef}
          className={cn(
            'sticky top-0 z-sticky border-b pt-safe transition-[background-color,border-color] duration-200',
            collapsed ? 'glass-nav border-outline-variant/40' : 'border-transparent bg-surface',
          )}
        >
          <div className="flex h-11 items-center justify-center px-4">
            {/* Hidden from assistive tech while the large title is on screen, so a
                screen reader never hears the screen name twice. */}
            <p
              aria-hidden={!collapsed}
              className={cn(
                'text-headline text-surface-on transition-opacity duration-200',
                collapsed ? 'opacity-100' : 'opacity-0',
              )}
            >
              {title}
            </p>
          </div>
          {/* Inside the sticky bar so a connectivity warning stays on screen while the
              driver scrolls — drivers work through signal dead zones. */}
          <OfflineBanner />
        </header>

        <h1 ref={titleRef} className="px-4 pt-1 text-large-title text-surface-on">
          {title}
        </h1>

        <div className="pb-32">{children}</div>
      </div>

      <BottomNav onProfileClick={() => setProfileOpen(true)} />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  )
}
