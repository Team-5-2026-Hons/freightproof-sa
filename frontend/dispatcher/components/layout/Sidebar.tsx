'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { X, Shield } from 'lucide-react'
import { Ic } from '@/components/ui/Ic'
import { LiveBadge } from '@/components/layout/LiveBadge'
import { useAuth } from '@/lib/hooks/useAuth'
import { useSidebarCollapse } from '@/lib/context/SidebarCollapseContext'
import { cn } from '@shared/lib/utils/cn'
import { ROUTES } from '@/lib/constants/routes'
import type { IconName } from '@/components/ui/Ic'
import type { DispatcherUser } from '@/lib/types/user'

interface NavItem {
  label: string
  href: string
  icon: IconName
  activePatterns: string[]
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

function NavLink({ item, pathname, onClose, collapsed }: {
  item: NavItem
  pathname: string
  onClose?: () => void
  collapsed?: boolean
}) {
  const active = isActive(pathname, item.activePatterns)
  return (
    <Link
      href={item.href}
      onClick={onClose}
      aria-label={item.label}
      title={item.label}
      className={cn(
        'flex items-center gap-[9px] mx-2 px-[14px] py-[9px] rounded-md transition-all duration-[120ms]',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-white/[0.13]'
          : 'hover:bg-white/[0.06]',
      )}
    >
      <Ic
        n={item.icon}
        s={15}
        className={active ? 'text-sec' : 'text-white/45'}
      />
      {!collapsed && (
        <span className={cn(
          'text-[14px]',
          active ? 'font-[600] text-white' : 'font-[400] text-white/55',
        )}>
          {item.label}
        </span>
      )}
    </Link>
  )
}

interface SidebarContentProps {
  onClose?: () => void
  /** Icon-only rail. Desktop-only — the mobile drawer never collapses. */
  collapsed?: boolean
  /** Renders the collapse/expand control when provided (desktop instance only). */
  onToggleCollapse?: () => void
}

function SidebarContent({ onClose, collapsed = false, onToggleCollapse }: SidebarContentProps) {
  const pathname = usePathname()
  const { user } = useAuth()

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-primary shrink-0 transition-[width] duration-200 motion-reduce:transition-none',
        collapsed ? 'w-16' : 'w-[220px]',
      )}
    >
      {/* Header — logo mark + wordmark + eyebrow */}
      <div className={cn(
        'flex items-center gap-[10px] h-[60px] border-b border-white/[0.08]',
        collapsed ? 'justify-center px-0' : 'px-[18px]',
      )}>
        {/* Hex logo mark — bg-sec container, white polygon, sec-coloured circle */}
        <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-[800] text-white leading-none tracking-[-0.02em]">
              FreightProof
            </div>
            <div className="text-[10px] text-white/35 mt-[2px] tracking-[0.06em] uppercase">
              Evidence Platform
            </div>
          </div>
        )}
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

      {/* Collapse toggle — own row so it has room regardless of rail width */}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex items-center gap-[9px] h-[38px] border-b border-white/[0.08] text-white/45 hover:text-white hover:bg-white/[0.06] transition-colors',
            collapsed ? 'justify-center px-0' : 'px-[18px]',
          )}
        >
          <Ic
            n="chev"
            s={13}
            className={cn(
              'transition-transform duration-200 motion-reduce:transition-none',
              !collapsed && 'rotate-180',
            )}
          />
          {!collapsed && <span className="text-[12px] font-[500]">Collapse</span>}
        </button>
      )}

      {/* Nav groups */}
      <div className="flex-1 py-2 overflow-y-auto">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            {group.label && !collapsed && (
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
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}

      </div>

      {/* Settings — pinned above the profile footer */}
      <div className="border-t border-white/[0.08]">
        <NavLink item={SETTINGS_ITEM} pathname={pathname} onClose={onClose} collapsed={collapsed} />
      </div>

      {/* Footer — user avatar + name + role */}
      <div className={cn(
        'flex items-center gap-2 border-t border-white/[0.08]',
        collapsed ? 'flex-col py-3 px-0' : 'px-[18px] py-3',
      )}>
        <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0">
          <Ic n="user" s={13} className="text-white/60" />
        </div>
        {!collapsed && (
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
        )}
        {/* Live-connection indicator for the dispatcher's real-time stream — stays
            visible (dot-only) when collapsed so a dispatcher can still see the SSE
            stream is alive without expanding the rail. */}
        <div className={collapsed ? 'shrink-0' : 'ml-auto shrink-0'}>
          <LiveBadge compact={collapsed} />
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
  const { collapsed, toggle } = useSidebarCollapse()

  return (
    <>
      {/* Desktop sidebar — always visible at md+, collapsible to an icon rail */}
      <div className="hidden md:block">
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggle} />
      </div>

      {/* Mobile drawer overlay — always full width, never collapses */}
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
