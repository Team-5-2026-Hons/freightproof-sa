'use client'

import { useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'

interface DispatcherShellProps {
  children: ReactNode
}

/**
 * The full dispatcher layout frame. Every authenticated page is rendered inside this.
 * 240 px sidebar at lg+, 64 px icon rail at md, hamburger below md.
 * ToastViewport is wired in the root layout via ToastProvider — not duplicated here.
 */
export function DispatcherShell({ children }: DispatcherShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar — hamburger trigger, visible below md */}
        <header className="flex items-center gap-3 px-4 py-3 bg-surface md:hidden glass-nav sticky top-0 z-sticky border-b border-outline-variant/20 shadow-ambient-header">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="p-2 -ml-2 rounded-xl text-surface-on hover:bg-surface-container-high transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-black tracking-widest uppercase text-surface-on">
            FreightProof
          </span>
        </header>

        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  )
}
