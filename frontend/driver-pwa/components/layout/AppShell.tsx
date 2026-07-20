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
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-sticky flex h-14 items-center justify-center border-b border-outline-variant/20 bg-surface-container-lowest px-2 shadow-ambient-header">
        <p className="text-sm font-bold text-surface-on">{title}</p>
      </header>

      {/* Drivers work through signal dead zones — surface connectivity loss on every shell screen. */}
      <OfflineBanner />

      {/* pb-28 clears the floating BottomNav pill, which overlays fixed-to-viewport
          rather than participating in normal document flow. */}
      <div className="flex-1 pb-28">{children}</div>

      <BottomNav onProfileClick={() => setProfileOpen(true)} />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  )
}
