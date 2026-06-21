'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { X, Shield } from 'lucide-react'
import { Ic } from '@/components/ui/Ic'
import { useAuth } from '@/lib/hooks/useAuth'
// ITERATION 2: import { useExceptions } from '@/lib/hooks/useExceptions'
import { cn } from '@shared/lib/utils/cn'
import { ROUTES } from '@/lib/constants/routes'
import type { IconName } from '@/components/ui/Ic'
import type { DispatcherUser } from '@/lib/types/user'

interface NavItem {
  label: string
  href: string
  icon: IconName
  activePatterns: string[]
  badge?: number
}

interface NavGroup {
  label?: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'OVERVIEW',
    items: [
      { label: 'Dashboard', href: ROUTES.home, icon: 'home', activePatterns: ['/'] },
    ],
  },
  {
    label: 'TRIPS',
    items: [
      { label: 'Create Trip',  href: ROUTES.tripNew, icon: 'plus',  activePatterns: ['/trips/new'] },
      { label: 'Trip History', href: ROUTES.history,  icon: 'clock', activePatterns: ['/history'] },
      // ITERATION 2: { label: 'Exceptions', href: ROUTES.exceptions, icon: 'warn', activePatterns: ['/exceptions'] },
    ],
  },
  {
    label: 'REPORTING',
    items: [
      { label: 'SLA Reports', href: ROUTES.sla, icon: 'bars', activePatterns: ['/sla'] },
    ],
  },
  {
    label: 'FLEET',
    items: [
      { label: 'Vehicles', href: ROUTES.fleetVehicles, icon: 'truck', activePatterns: ['/fleet/vehicles'] },
      { label: 'Drivers',  href: ROUTES.fleetDrivers,  icon: 'user',  activePatterns: ['/fleet/drivers'] },
    ],
  },
]

const SETTINGS_ITEM: NavItem = {
  label: 'Settings',
  href: ROUTES.settings,
  icon: 'gear',
  activePatterns: ['/settings'],
}

// Humanizes the DispatcherUser role for display; falls back to the base
// "Dispatcher" label when the role is the non-admin variant or user is unknown.
function roleLabel(role: DispatcherUser['role'] | undefined): string {
  return role === 'admin_dispatcher' ? 'Admin Dispatcher' : 'Dispatcher'
}

function isActive(pathname: string, patterns: string[]): boolean {
  return patterns.some(p => {
    if (p === '/') return pathname === '/'
    return pathname.startsWith(p)
  })
}

function NavLink({ item, pathname, onClose }: { item: NavItem; pathname: string; onClose?: () => void }) {
  const active = isActive(pathname, item.activePatterns)
  return (
    <Link
      href={item.href}
      onClick={onClose}
      className={cn(
        'flex items-center gap-[9px] px-[18px] py-[9px] transition-all duration-[120ms]',
        'border-l-[3px]',
        active
          ? 'bg-white/10 border-sec'
          : 'border-transparent hover:bg-white/[0.06]',
      )}
    >
      <Ic
        n={item.icon}
        s={15}
        className={active ? 'text-sec' : 'text-white/45'}
      />
      <span className={cn(
        'text-[14px]',
        active ? 'font-[600] text-white' : 'font-[400] text-white/55',
      )}>
        {item.label}
      </span>
      {item.badge != null && (
        <span className="ml-auto bg-err text-white text-[10px] font-[700] rounded-sm px-[6px] py-[1px]">
          {item.badge}
        </span>
      )}
    </Link>
  )
}

interface SidebarContentProps {
  onClose?: () => void
}

function SidebarContent({ onClose }: SidebarContentProps) {
  const pathname = usePathname()
  const { user } = useAuth()
  // ITERATION 2: restore exception badge — uncomment the three lines below and remove `const navGroups = NAV_GROUPS`
  // const openExceptions = useExceptions({ resolved: false })
  // const navGroups = NAV_GROUPS.map(g => ({
  //   ...g,
  //   items: g.items.map(item =>
  //     item.href === ROUTES.exceptions && openExceptions.length > 0
  //       ? { ...item, badge: openExceptions.length }
  //       : item,
  //   ),
  // }))
  const navGroups = NAV_GROUPS

  return (
    <div className="flex flex-col h-full bg-primary w-[220px] shrink-0">
      {/* Header — logo mark + wordmark + eyebrow */}
      <div className="flex items-center gap-[10px] px-[18px] py-[18px] border-b border-white/[0.08]">
        {/* Hex logo mark — bg-sec container, white polygon, sec-coloured circle */}
        <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-[800] text-white leading-none tracking-[-0.02em]">
            FreightProof
          </div>
          <div className="text-[10px] text-white/35 mt-[2px] tracking-[0.06em] uppercase">
            Evidence Platform
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="ml-auto text-white/60 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav groups */}
      <div className="flex-1 py-2 overflow-y-auto">
        {navGroups.map(group => (
          <div key={group.label}>
            {group.label && (
              <div className="text-[10px] font-[700] tracking-[0.12em] uppercase text-white/30 px-[18px] pt-3 pb-1">
                {group.label}
              </div>
            )}
            {group.items.map(item => (
              <NavLink
                key={item.href + item.label}
                item={item}
                pathname={pathname}
                onClose={onClose}
              />
            ))}
          </div>
        ))}

      </div>

      {/* Settings — pinned above the profile footer */}
      <div className="border-t border-white/[0.08]">
        <NavLink item={SETTINGS_ITEM} pathname={pathname} onClose={onClose} />
      </div>

      {/* Footer — user avatar + name + role */}
      <div className="flex items-center gap-2 px-[18px] py-3 border-t border-white/[0.08]">
        <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0">
          <Ic n="user" s={13} className="text-white/60" />
        </div>
        <div>
          <div className="flex items-center gap-[6px] text-[12px] font-[600] text-white/85 leading-tight">
            <span>{user?.full_name ?? 'Dispatcher'}</span>
            {user?.role === 'admin_dispatcher' && (
              <span className="bg-white/15 text-white/85 text-[9px] font-[700] tracking-[0.04em] rounded-[var(--r-sm)] px-[5px] py-[1px]">
                ADMIN
              </span>
            )}
          </div>
          <div className="text-[10px] text-white/40">{roleLabel(user?.role)}</div>
        </div>
      </div>
    </div>
  )
}

interface SidebarProps {
  mobileOpen: boolean
  onMobileClose: () => void
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar — always visible at md+ */}
      <div className="hidden md:block">
        <SidebarContent />
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-overlay md:hidden">
          <div
            className="absolute inset-0 bg-primary/40"
            onClick={onMobileClose}
            aria-hidden
          />
          <div className="relative">
            <SidebarContent onClose={onMobileClose} />
          </div>
        </div>
      )}
    </>
  )
}
