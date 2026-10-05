'use client'

import { useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'

interface DispatcherShellProps {
  children: ReactNode
}

export function DispatcherShell({ children }: DispatcherShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    // One dark base layer fills the whole window; the sidebar is flat on it and the page
    // content is the only floating element.
    <div className="flex h-screen overflow-hidden bg-primary">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Content card — inset from the window edge so it reads as a sheet above the base
          layer. No left margin at md+ because the sidebar's own padding supplies that gutter. */}
      <div className="flex-1 flex flex-col min-w-0 m-3 md:ml-0 rounded-xl bg-surf shadow-level-6 overflow-hidden">
        {/* Mobile hamburger strip — hidden on md+ */}
        <header className="flex items-center gap-3 px-4 h-[60px] bg-surf-lowest border-b border-outline-v/20 md:hidden shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="p-1 rounded-md text-on-surf hover:bg-surf-high transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-extrabold tracking-widest uppercase text-on-surf">
            FreightProof
          </span>
        </header>

        {/* Page content — scrolls within the panel */}
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
