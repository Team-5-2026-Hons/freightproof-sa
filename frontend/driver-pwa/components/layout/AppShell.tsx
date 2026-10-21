'use client'

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { OfflineBanner } from './OfflineBanner'
import { BottomNav } from './BottomNav'

// Titles for the top-level tab destinations — the only routes AppShell wraps (every
// other route is full-bleed and renders its own SubpageHeader/StepHeader). They match
// the tab labels, so the screen a driver lands on is named exactly what they tapped.
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/trips': 'Trips',
  '/profile': 'Profile',
}

// Tabs whose screen opens with its own header, so the large title would say the same
// thing twice: Profile leads with the driver's photo and name (overhaul 10.1). The title
// stays in the DOM, visually hidden, so the screen still announces its name.
const HIDDEN_LARGE_TITLE = new Set(['/', '/profile'])

// Tabs laid out to exactly one screen instead of scrolling (Tim, 14 Oct: Trips must not
// scroll — its lists end above the tab bar and "See all" holds the rest). The page fills
// the flex column below the title. The scrollport can still scroll, but only when the
// content cannot fit at all — at the large accessibility text sizes — so a driver who
// needs big text can always reach "See all" instead of losing it under the tab bar.
const FIT_TO_SCREEN = new Set(['/trips'])

/**
 * Clearance under fitted content for the floating tab bar: its 62px pill + 8px top gap +
 * a 14px breath, in px like the bar itself (it does not scale with Dynamic Type). A
 * spacer at the END of a fitted page, not padding here: when large text makes the page
 * spill past its box, the spill — not this box — has to end above the bar.
 */
export const TAB_BAR_SPACER = 'h-[calc(84px+env(safe-area-inset-bottom))]'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  // True once the large title has scrolled up under the bar — the iOS hand-off point
  // where the big title disappears and the small centred one takes over.
  const [collapsed, setCollapsed] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const barRowRef = useRef<HTMLDivElement | null>(null)
  const scrollportRef = useRef<HTMLDivElement | null>(null)
  const pathname = usePathname()
  const title = ROUTE_TITLES[pathname] ?? 'FreightProof'
  const largeTitleHidden = HIDDEN_LARGE_TITLE.has(pathname)
  const fitToScreen = FIT_TO_SCREEN.has(pathname)

  // Collapse once the large title's midline passes under the bar — the point iOS hands
  // over, and early enough that a short screen (which can only scroll a few points) never
  // rests with half-clipped letters peeking out under an opaque bar. Read from live layout
  // on each scroll rather than a fixed pixel threshold, because the bar's height moves
  // with the safe-area inset, the offline banner, and Dynamic Type. React skips the
  // re-render while the boolean is unchanged, so this is cheap per event.
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const titleEl = titleRef.current
    const headerEl = headerRef.current
    // With no visible large title there is nothing to hand over to the inline one.
    if (!titleEl || !headerEl || largeTitleHidden) return
    const titleMidline = titleEl.offsetTop + titleEl.offsetHeight / 2
    // The collapsed bar's bottom edge: the header's own height (status bar + banner) plus
    // the small-title row laid over the content beneath it.
    const barBottom = headerEl.offsetHeight + (barRowRef.current?.offsetHeight ?? 0)
    // Floored at 0: at rest the title already sits under the inline row, so the raw
    // difference is negative and a scroll event at the very top (a tab switch clamping
    // the scrollport back to 0 fires one) would collapse the bar over the title.
    setCollapsed(event.currentTarget.scrollTop > Math.max(0, titleMidline - barBottom))
  }, [largeTitleHidden])

  // This shell, its scrollport and the collapsed flag outlive every tab switch, so each
  // tab would otherwise open at the previous tab's offset — and Next.js then scrolls the
  // new page's top edge to the scrollport's top, under the sticky bar. Layout effect, so
  // the reset lands before paint and after Next's own scroll handling (children first).
  useLayoutEffect(() => {
    setCollapsed(false)
    const scrollport = scrollportRef.current
    if (!scrollport) return
    // iOS ignores a scrollTop write while a fling is still decelerating — the "scroll down,
    // tap a tab at once" case. Turning scrolling off for a frame stops the fling first.
    scrollport.style.overflowY = 'hidden'
    scrollport.scrollTop = 0
    const frame = window.requestAnimationFrame(() => {
      scrollport.style.overflowY = ''
    })
    return () => {
      window.cancelAnimationFrame(frame)
      scrollport.style.overflowY = ''
    }
  }, [pathname])

  return (
    <>
      {/* One scrollport for the whole tab screen, h-dvh so the frame is exactly one
          screen tall. The bar is sticky INSIDE it (not a sibling above it) so content
          really passes underneath the glass once scrolled — the material only means
          something when there is something behind it. pb-32 lets the last row scroll
          clear of the floating tab pill, which overlays rather than taking up space. */}
      <div
        ref={scrollportRef}
        onScroll={handleScroll}
        className={cn('h-dvh overflow-y-auto overscroll-contain', fitToScreen && 'flex flex-col')}
      >
        {/* pt-safe: under viewportFit:'cover' the bar would otherwise sit behind the
            status bar / Dynamic Island.

            At rest the bar takes NO height of its own: the large title sits right under the
            status bar, the way App Store's Today and Music's Home do on a tab with no bar
            buttons. An empty 44pt row above it made the title look like it was hovering
            mid-screen (HIG layout › "Order content by relative importance"). The small
            centred title row is laid over the content instead of in the flow, and only
            once the large title scrolls under it does the material grow to cover that row,
            as glass with a hairline. */}
        <header ref={headerRef} className="sticky top-0 z-sticky pt-safe">
          {/* The bar's material, decorative: at rest it backs only the status bar (and the
              offline banner); collapsed it extends over the small-title row. */}
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 border-b transition-[height,background-color,border-color] duration-200',
              collapsed ? 'glass-nav h-[calc(100%+2.75rem)] border-outline-variant/40' : 'h-full border-transparent bg-surface',
            )}
          />
          {/* Inside the sticky bar so a connectivity warning stays on screen while the
              driver scrolls — drivers work through signal dead zones. */}
          <div className="relative">
            <OfflineBanner />
          </div>
          {!largeTitleHidden && (
            <div className="relative h-0">
              <div ref={barRowRef} className="pointer-events-none absolute inset-x-0 top-0 flex h-11 items-center justify-center px-4">
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
            </div>
          )}
        </header>

        <h1 ref={titleRef} className={cn(largeTitleHidden ? 'sr-only' : 'px-4 pt-2 text-large-title text-surface-on')}>
          {title}
        </h1>

        {/* In fit mode the screen-transition frame (app/(app)/template.tsx) sits between this
            box and the page; [&>*] hands the remaining height through it, or the page's own
            flex-1 has nothing to fill and the Past list collapses to one row. */}
        <div className={cn(fitToScreen ? 'flex min-h-0 flex-1 flex-col [&>*]:flex [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex-col' : 'pb-32')}>{children}</div>
      </div>

      <BottomNav />
    </>
  )
}
