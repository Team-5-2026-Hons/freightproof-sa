'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { markTransition, peekTransition, resetTransition, type TransitionDirection } from '@/lib/navigation/transition-direction'
import { recordScreen } from '@/lib/navigation/back-stack'
import { useEdgeSwipeBack } from '@/lib/navigation/useEdgeSwipeBack'
import { consumeColdStart, forgetScreen, isResumableRoute, rememberScreen, takeResumeScreen } from '@/lib/navigation/resume'
import { currentActorId } from '@/lib/session/custody-context'
import { ROUTES } from '@/lib/constants/routes'

const ENTER_CLASS: Record<TransitionDirection, string | null> = {
  forward: 'animate-push-in',
  back: 'animate-pop-in',
  none: null,
}

// One instance per screen: keyed on the pathname by the template below, so it mounts —
// and reads the pending direction — once for every navigation.
function ScreenFrame({ pathname, children }: { pathname: string; children: ReactNode }) {
  const router = useRouter()
  // Read once, as this screen mounts: the direction belongs to the navigation that
  // brought us here, not to anything that happens while we're on screen. Cleared when the
  // slide finishes, so the classes below exist only for those 320ms.
  const [direction, setDirection] = useState<TransitionDirection>(() => peekTransition())
  const swipe = useEdgeSwipeBack()

  useEffect(() => {
    resetTransition()
    // The query (trip detail's ?id=) is only readable from the live URL; it is taken only
    // when the URL already shows this screen, so a late history update can't mislabel it.
    const url = window.location.pathname === pathname ? pathname + window.location.search : pathname
    recordScreen(pathname, url, direction)

    // Android recreates the WebView after the scanner or camera whenever it needs the
    // memory, and the app then starts on Home with the driver's step gone. If this is the
    // first screen of the session and it is Home, put them back on the screen they were
    // mid-task on; the step's own ledger guard still redirects if the trip has moved on.
    if (consumeColdStart() && pathname === ROUTES.home) {
      const resumeTo = takeResumeScreen(currentActorId())
      if (resumeTo !== null) {
        markTransition('none')
        router.replace(resumeTo)
        return
      }
    }
    if (isResumableRoute(pathname)) rememberScreen(url, currentActorId())
    // A tab root is a deliberate exit from the workflow. Anything else (trip pages, lists)
    // leaves the record alone: a driver glancing at the trip page mid-step is still mid-step.
    else if (direction === 'none') forgetScreen()
    // Mount-only: direction is this screen's arrival, read once (see useState above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enterClass = ENTER_CLASS[direction]
  const dragging = swipe.offset !== null

  return (
    // A transform, so the slide runs on the compositor instead of re-laying-out the whole
    // screen every frame (`left` stuttered on mid-range Android). A transform makes this
    // box the containing block for position:fixed children (LoadingScreen is fixed
    // inset-0), so while it runs the box is held at least viewport-tall — inset-0 then
    // still covers the screen — and both classes drop on animationend, handing fixed
    // children back to the viewport the moment the slide stops. An edge swipe moves the
    // same box the same way, under the same rule.
    <div
      {...swipe.handlers}
      className={cn(
        enterClass,
        (enterClass !== null || dragging) && 'min-h-dvh',
        // Vertical scrolling stays the browser's; a horizontal drag from the edge is ours.
        swipe.armed && 'touch-pan-y',
        dragging && 'bg-surface shadow-level-4',
      )}
      style={dragging ? { transform: `translate3d(${swipe.offset}px, 0, 0)` } : undefined}
      onAnimationEnd={(e) => {
        // Only this frame's own slide: a child's animation (a spinner, a fade) bubbles here too.
        if (e.target === e.currentTarget) setDirection('none')
      }}
    >
      {children}
    </div>
  )
}

// The iOS push/pop for every screen inside the signed-in app (design audit step 8).
// Next only re-creates a template when its OWN child segment changes, so
// /trip/in-transit → /trip/phase/… (both under "trip") would reuse one instance and never
// animate; keying the frame on the full pathname gives every screen change a fresh mount.
export default function AppTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return <ScreenFrame key={pathname} pathname={pathname}>{children}</ScreenFrame>
}
