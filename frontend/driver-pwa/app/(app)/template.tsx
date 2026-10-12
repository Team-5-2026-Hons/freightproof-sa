'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { peekTransition, resetTransition, type TransitionDirection } from '@/lib/navigation/transition-direction'

const ENTER_CLASS: Record<TransitionDirection, string | null> = {
  forward: 'animate-push-in',
  back: 'animate-pop-in',
  none: null,
}

// One instance per screen: keyed on the pathname by the template below, so it mounts —
// and reads the pending direction — once for every navigation.
function ScreenFrame({ children }: { children: ReactNode }) {
  // Read once, as this screen mounts: the direction belongs to the navigation that
  // brought us here, not to anything that happens while we're on screen.
  const [direction] = useState<TransitionDirection>(() => peekTransition())

  useEffect(() => {
    resetTransition()
  }, [])

  return (
    // `relative` + an animated `left`, not a transform: a transform would make this
    // wrapper the containing block for every position:fixed child (LoadingScreen is
    // fixed inset-0), re-anchoring them to the sliding box for the length of the
    // animation. `left` on a relative box moves it without that side effect.
    <div className={cn('relative', ENTER_CLASS[direction])}>
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
  return <ScreenFrame key={pathname}>{children}</ScreenFrame>
}
