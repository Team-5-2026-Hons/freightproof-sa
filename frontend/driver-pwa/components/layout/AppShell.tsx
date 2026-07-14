'use client'

import { useState, type ReactNode } from 'react'
import { Menu, CircleUserRound } from 'lucide-react'
import { NavDrawer } from './NavDrawer'
import { OfflineBanner } from './OfflineBanner'
import { ProfilePanel } from './ProfilePanel'
import { IconButton } from '@/components/ui/IconButton'

interface AppShellProps {
  title?: string
  children: ReactNode
}

export function AppShell({ title = 'FreightProof', children }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-sticky flex h-14 items-center justify-between border-b border-outline-variant/20 bg-surface-container-lowest px-2 shadow-ambient-header">
        <IconButton icon={<Menu className="h-5 w-5" aria-hidden />} aria-label="Open navigation" onClick={() => { setProfileOpen(false); setNavOpen(true) }} />
        <p className="text-sm font-bold text-surface-on">{title}</p>
        <IconButton icon={<CircleUserRound className="h-5 w-5" aria-hidden />} aria-label="Open driver profile" onClick={() => { setNavOpen(false); setProfileOpen(true) }} />
      </header>

      {/* Drivers work through signal dead zones — surface connectivity loss on every shell screen. */}
      <OfflineBanner />

      <div className="flex-1">{children}</div>

      <NavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  )
}
