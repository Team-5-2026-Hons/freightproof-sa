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
    <div className="h-screen overflow-hidden bg-canvas p-3">
      {/* Floating panel — r-xl, elevation-6, white surface */}
      <div className="flex h-full bg-surf rounded-xl shadow-level-6 overflow-hidden">
        <Sidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
    </div>
  )
}
