'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { X, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Ic } from '@/components/ui/Ic'
import { LogoMark } from '@/components/landing/Logo'
import { ProfileMenu } from '@/components/layout/ProfileMenu'
import { useAuth } from '@/lib/hooks/useAuth'
import { useSidebarCollapse } from '@/lib/context/SidebarCollapseContext'
import { useForensicMode } from '@/lib/context/ForensicModeContext'
import { SETTINGS_SECTION_IDS } from '@/lib/settings/section-query'
import { cn } from '@shared/lib/utils/cn'
import { ROUTES } from '@/lib/constants/routes'
import type { IconName } from '@/components/ui/Ic'

interface NavItem {
  label: string
  href: string
  icon: IconName
  activePatterns: string[]
  adminOnly?: boolean
  exact?: boolean
}

interface NavGroup {
  label?: string
  items: NavItem[]
}

const CREATE_TRIP_ITEM: NavItem = {
  label: 'Create Trip',
  href: ROUTES.tripNew,
  icon: 'plus',
  activePatterns: ['/trips/new'],
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: ROUTES.home, icon: 'home', activePatterns: [ROUTES.home] },
      { label: 'Analytics', href: ROUTES.analytics, icon: 'bars', activePatterns: [ROUTES.analytics] },
    ],
  },
  {
    label: 'Trips',
    items: [
      { label: 'Active Trips', href: ROUTES.trips, icon: 'route', activePatterns: [ROUTES.trips], exact: true },
      { label: 'Trip History', href: ROUTES.history,  icon: 'clock', activePatterns: ['/history'] },
      { label: 'Parcel Search', href: ROUTES.parcels, icon: 'box', activePatterns: [ROUTES.parcels] },
      { label: 'Exceptions',   href: ROUTES.exceptions, icon: 'warn', activePatterns: ['/exceptions'] },
      { label: 'Incidents',    href: ROUTES.incidents,  icon: 'siren', activePatterns: ['/incidents'] },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { label: 'Vehicles', href: ROUTES.fleetVehicles, icon: 'truck', activePatterns: ['/fleet/vehicles'] },
      { label: 'Drivers',  href: ROUTES.fleetDrivers,  icon: 'user',  activePatterns: ['/fleet/drivers'] },
    ],
  },
  {
    items: [
      { label: 'Precincts', href: ROUTES.precincts, icon: 'map', activePatterns: ['/precincts'] },
    ],
  },
]

const SETTINGS_ITEM: NavItem = {
  label: 'Settings',
  href: ROUTES.settings,
  icon: 'gear',
  activePatterns: ['/settings'],
}

function isActive(pathname: string, patterns: string[], exact = false): boolean {
  return patterns.some(p => {
    if (p === '/' || exact) return pathname === p
    return pathname.startsWith(p)
  })
}

const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-white/40'

const FORENSIC_BADGE: NavBadge = {
  text: 'Forensic',
  href: ROUTES.settingsSection(SETTINGS_SECTION_IDS.forensic),
  label: 'Forensic view is on. Open its setting',
  collapsedLabel: 'Settings, forensic view on',
}

interface NavBadge {
  text: string
  href: string
  label: string
  collapsedLabel: string
}

const BADGE_GUTTER = 'pr-[88px]'

function NavLink({ item, pathname, onClose, collapsed, badge }: {
  item: NavItem
  pathname: string
  onClose?: () => void
  collapsed?: boolean
  badge?: NavBadge
}) {
  const active = isActive(pathname, item.activePatterns, item.exact)
  const label = badge && collapsed ? badge.collapsedLabel : item.label
  return (
    <div className="relative">
      <Link
        href={item.href}
        onClick={onClose}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        title={label}
        className={cn(
          'group flex items-center gap-3 h-9 px-3 rounded-lg text-[14px] transition-colors duration-[120ms]',
          FOCUS_RING,
          collapsed && 'justify-center px-0 h-10',
          badge && !collapsed && BADGE_GUTTER,
          active
            ? 'bg-white/[0.10] ring-1 ring-inset ring-white/[0.08] text-white font-medium'
            : 'text-white/60 hover:text-white hover:bg-white/[0.06]',
        )}
      >
        <span className="relative shrink-0">
          <Ic
            n={item.icon}
            s={16}
            className={cn('transition-colors', active ? 'text-white' : 'text-white/50 group-hover:text-white/80')}
          />
          {badge && collapsed && (
            <span aria-hidden className="absolute -top-1 -right-1 w-[8px] h-[8px] rounded-full bg-sec-c ring-2 ring-primary" />
          )}
        </span>
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
      {badge && !collapsed && (
        <Link
          href={badge.href}
          onClick={onClose}
          aria-label={badge.label}
          className={cn(
            'absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-sec-c px-[6px] py-[1px]',
            'text-[11px] font-[600] text-sec-onc transition-[filter] duration-[120ms] hover:brightness-95',
            FOCUS_RING,
          )}
        >
          {badge.text}
        </Link>
      )}
    </div>
  )
}

function CreateTripButton({ pathname, onClose, collapsed }: {
  pathname: string
  onClose?: () => void
  collapsed: boolean
}) {
  const active = isActive(pathname, CREATE_TRIP_ITEM.activePatterns)
  return (
    <Link
      href={CREATE_TRIP_ITEM.href}
      onClick={onClose}
      aria-label={CREATE_TRIP_ITEM.label}
      aria-current={active ? 'page' : undefined}
      title={CREATE_TRIP_ITEM.label}
      className={cn(
        'flex items-center justify-center gap-2 rounded-lg bg-white text-primary text-[13px] font-semibold',
        'transition-[background-color,transform] duration-[120ms] hover:bg-white/90 active:scale-[0.97]',
        FOCUS_RING,
        collapsed ? 'h-10 w-10 mx-auto' : 'h-9 px-3',
        active && 'ring-2 ring-white/30',
      )}
    >
      <Ic n={CREATE_TRIP_ITEM.icon} s={15} sw={2.25} className="shrink-0" />
      {!collapsed && <span>{CREATE_TRIP_ITEM.label}</span>}
    </Link>
  )
}

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center justify-center w-8 h-8 shrink-0 rounded-lg text-white/50',
        'hover:text-white hover:bg-white/[0.08] transition-colors',
        FOCUS_RING,
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}

interface SidebarContentProps {
  onClose?: () => void
  collapsed?: boolean
  /** Renders the collapse/expand control when provided (desktop instance only). */
  onToggleCollapse?: () => void
}

function SidebarContent({ onClose, collapsed = false, onToggleCollapse }: SidebarContentProps) {
  const pathname = usePathname()
  const { user } = useAuth()
  const { canViewForensics, forensicOn } = useForensicMode()
  const forensicBadge = canViewForensics && forensicOn ? FORENSIC_BADGE : undefined
  const visibleGroups = NAV_GROUPS
    .map(group => ({
      ...group,
      items: group.items.filter(item => !item.adminOnly || user?.role === 'admin_dispatcher'),
    }))
    .filter(group => group.items.length > 0)

  return (
    <div
      className={cn(
        'flex flex-col h-full shrink-0 transition-[width] duration-200 motion-reduce:transition-none',
        collapsed ? 'w-[68px]' : 'w-[256px]',
      )}
    >
      <div className={cn('flex items-center gap-3 h-16', collapsed ? 'justify-center' : 'px-3')}>
        <div className="w-9 h-9 rounded-lg bg-surf flex items-center justify-center shrink-0">
          <LogoMark size={22} />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-[800] text-white leading-none tracking-[-0.02em]">
              FreightProof
            </div>
            <div className="text-[10px] text-white/40 mt-[3px] tracking-[0.05em] uppercase whitespace-nowrap">
              Evidence Platform
            </div>
          </div>
        )}
        {!collapsed && onToggleCollapse && (
          <CollapseToggle collapsed={collapsed} onToggle={onToggleCollapse} />
        )}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className={cn('ml-auto text-white/60 hover:text-white transition-colors rounded-lg p-1', FOCUS_RING)}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {collapsed && onToggleCollapse && (
        <div className="flex justify-center pb-2">
          <CollapseToggle collapsed={collapsed} onToggle={onToggleCollapse} />
        </div>
      )}

      <div className="px-3 pt-1 pb-2">
        <CreateTripButton pathname={pathname} onClose={onClose} collapsed={collapsed} />
      </div>

      <nav aria-label="Primary" className="flex-1 px-3 pb-2 overflow-y-auto">
        {visibleGroups.map(group => (
          <div key={group.label ?? group.items[0].href} className={cn('flex flex-col gap-0.5', collapsed ? 'mt-3' : 'mt-1')}>
            {group.label && !collapsed && (
              <div className="text-[11px] font-[500] text-white/45 px-3 pt-3 pb-1">
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
      </nav>

      <div className="px-3 pb-3 flex flex-col gap-0.5">
        <NavLink item={SETTINGS_ITEM} pathname={pathname} onClose={onClose} collapsed={collapsed} badge={forensicBadge} />

        <ProfileMenu collapsed={collapsed} onClose={onClose} />
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
      <div className="hidden md:block">
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggle} />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-overlay md:hidden">
          <div
            className="absolute inset-0 bg-primary/40"
            onClick={onMobileClose}
            aria-hidden
          />
          <div className="relative h-full p-3">
            <div className="h-full bg-primary rounded-xl ring-1 ring-white/10 shadow-level-6 overflow-hidden">
              <SidebarContent onClose={onMobileClose} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
