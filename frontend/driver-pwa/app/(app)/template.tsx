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

function ScreenFrame({ pathname, children }: { pathname: string; children: ReactNode }) {
  const router = useRouter()
  const [direction, setDirection] = useState<TransitionDirection>(() => peekTransition())
  const swipe = useEdgeSwipeBack()

  useEffect(() => {
    resetTransition()
    const url = window.location.pathname === pathname ? pathname + window.location.search : pathname
    recordScreen(pathname, url, direction)

    if (consumeColdStart() && pathname === ROUTES.home) {
      const resumeTo = takeResumeScreen(currentActorId())
      if (resumeTo !== null) {
        markTransition('none')
        router.replace(resumeTo)
        return
      }
    }
    if (isResumableRoute(pathname)) rememberScreen(url, currentActorId())
    else if (direction === 'none') forgetScreen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enterClass = ENTER_CLASS[direction]
  const dragging = swipe.offset !== null

  return (
    <div
      {...swipe.handlers}
      className={cn(
        enterClass,
        (enterClass !== null || dragging) && 'min-h-dvh',
        swipe.armed && 'touch-pan-y',
        dragging && 'bg-surface shadow-level-4',
      )}
      style={dragging ? { transform: `translate3d(${swipe.offset}px, 0, 0)` } : undefined}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setDirection('none')
      }}
    >
      {children}
    </div>
  )
}

export default function AppTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return <ScreenFrame key={pathname} pathname={pathname}>{children}</ScreenFrame>
}
