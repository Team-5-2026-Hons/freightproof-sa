'use client'

import { useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { OfflineBanner } from './OfflineBanner'
import { ProfilePanel } from './ProfilePanel'
import { BottomNav } from './BottomNav'

// Shell header titles for top-level nav destinations. Handshake/trip sub-flows
// render their own StepHeader, so the fallback brand title is correct there.
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
  const pathname = usePathname()
  const title = ROUTE_TITLES[pathname] ?? 'FreightProof'

  return (
    // h-dvh (not min-h-screen): pins this frame to exactly one screen's height so the
    // header and BottomNav never move. Previously this was min-h-screen with no upper
    // bound, and every page rendered as {children} below also declared its own
    // min-h-screen — the two stacked, so the frame always grew past one viewport no
    // matter how little content a page had, forcing the whole document to scroll (the
    // header included) instead of just the content between the fixed header and nav.
    <div className="flex h-dvh flex-col">
      {/* min-h-14 (not h-14) + pt-safe: the shell header is the topmost element on
          every non-full-bleed screen, so under viewportFit:'cover' it renders behind the
          iOS status bar unless it carries the inset itself. A fixed h-14 would absorb
          that padding into the same 56px box and crush the title instead of sitting
          below the notch. */}
      {/* bg-surface, matching <body> — this bar used to be surface-container-lowest
          (pure white) with a border and a drop shadow over a surface-tinted page, which
          on a phone reads as a floating white slab bolted to the top of the screen
          rather than as the top of the screen. It is a flex sibling ABOVE the
          scrollport below, not an overlay, so no content ever passes under it and it
          needs no separation cue at all: matching the page exactly is what makes the
          title look like it belongs to the page. */}
      <header className="flex min-h-14 shrink-0 items-center justify-center bg-surface px-2 pt-safe">
        <p className="text-sm font-bold text-surface-on">{title}</p>
      </header>

      {/* Drivers work through signal dead zones — surface connectivity loss on every shell screen. */}
      <OfflineBanner />

      {/* The only scrollable region in the shell — overflow-y-auto here (not on the
          document) is what keeps the header and BottomNav locked in place while a
          page's content scrolls underneath them. pb-28 clears the floating BottomNav
          pill, which overlays fixed-to-viewport rather than participating in normal
          document flow. */}
      <div className="flex-1 overflow-y-auto pb-28">{children}</div>

      <BottomNav onProfileClick={() => setProfileOpen(true)} />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  )
}
