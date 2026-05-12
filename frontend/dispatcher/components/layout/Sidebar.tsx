'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Truck,
  History,
  AlertTriangle,
  BarChart3,
  Settings,
  Navigation,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import { ROUTES } from '@/lib/constants/routes'
import type { ReactNode } from 'react'

interface NavItem {
  label: string
  href: string
  icon: ReactNode
  /** Active when pathname starts with any of these prefixes */
  activePatterns: string[]
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Active Trips',
    href: ROUTES.home,
    icon: <Navigation className="w-5 h-5" />,
    activePatterns: ['/', '/trips'],
  },
  {
    label: 'Trip History',
    href: ROUTES.history,
    icon: <History className="w-5 h-5" />,
    activePatterns: ['/history'],
  },
  {
    label: 'Exceptions',
    href: ROUTES.exceptions,
    icon: <AlertTriangle className="w-5 h-5" />,
    activePatterns: ['/exceptions'],
  },
  {
    label: 'SLA Reports',
    href: ROUTES.sla,
    icon: <BarChart3 className="w-5 h-5" />,
    activePatterns: ['/sla'],
  },
  {
    label: 'Fleet',
    href: ROUTES.fleetVehicles,
    icon: <Truck className="w-5 h-5" />,
    activePatterns: ['/fleet'],
  },
  {
    label: 'Settings',
    href: ROUTES.settings,
    icon: <Settings className="w-5 h-5" />,
    activePatterns: ['/settings'],
  },
]

/** Matches active state — exact match for "/" or prefix match for deeper routes */
function isActive(pathname: string, patterns: string[]): boolean {
  return patterns.some(p => {
    if (p === '/') return pathname === '/'
    return pathname.startsWith(p)
  })
}

interface SidebarProps {
  /** Controls the mobile hamburger drawer visibility */
  mobileOpen: boolean
  onMobileClose: () => void
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname()

  const navContent = (
    <nav className="flex flex-col gap-1 px-3 py-4">
      {NAV_ITEMS.map(item => {
        const active = isActive(pathname, item.activePatterns)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onMobileClose}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200',
              'text-sm font-bold uppercase tracking-wider',
              active
                ? 'text-secondary bg-secondary/10 relative'
                : 'text-primary-on-container hover:text-primary-on hover:bg-primary-on/5',
            )}
          >
            {/* Blue left accent bar — 3px — per DESIGN_SYSTEM.md §9.5 */}
            {active && (
              <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-secondary" />
            )}
            {item.icon}
            <span className="hidden lg:inline">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )

  return (
    <>
      {/* Desktop / tablet sidebar — always visible at md+ */}
      <aside className="hidden md:flex flex-col bg-primary text-primary-on h-screen sticky top-0 lg:w-60 md:w-16 shrink-0">
        <div className="flex items-center gap-2.5 px-4 py-5 lg:px-5">
          <span className="text-sm font-black tracking-widest uppercase text-primary-on lg:block hidden">
            FreightProof
          </span>
          <span className="text-sm font-black tracking-widest uppercase text-primary-on lg:hidden block">
            FP
          </span>
        </div>
        {navContent}
      </aside>

      {/* Mobile drawer overlay — below md */}
      {mobileOpen && (
        <div className="fixed inset-0 z-overlay md:hidden">
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-primary/40"
            onClick={onMobileClose}
            aria-hidden
          />
          {/* Drawer panel */}
          <aside className="relative w-60 h-full bg-primary text-primary-on shadow-ambient flex flex-col">
            <div className="flex items-center justify-between px-5 py-5">
              <span className="text-sm font-black tracking-widest uppercase text-primary-on">
                FreightProof
              </span>
              <button
                onClick={onMobileClose}
                aria-label="Close navigation"
                className="text-primary-on-container hover:text-primary-on transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {navContent}
          </aside>
        </div>
      )}
    </>
  )
}
