'use client'

import { useState, type ReactNode } from 'react'
import { OfflineBanner } from './OfflineBanner'
import { ProfilePanel } from './ProfilePanel'
import { BottomNav } from './BottomNav'

interface AppShellProps {
  title?: string
  children: ReactNode
}

export function AppShell({ title = 'FreightProof', children }: AppShellProps) {
  const [profileOpen, setProfileOpen] = useState(false)

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
