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
      <header className="flex h-14 shrink-0 items-center justify-center border-b border-outline-variant/20 bg-surface-container-lowest px-2 shadow-ambient-header">
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
