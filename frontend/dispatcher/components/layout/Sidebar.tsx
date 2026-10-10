'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { X, Shield, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
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
  adminOnly?: boolean
}

interface NavGroup {
  label?: string
  items: NavItem[]
}

// Create Trip is not in NAV_GROUPS: it is the sidebar's one primary action, so it is
// rendered as a button above the navigation rather than as a row inside it.
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
      { label: 'Dashboard', href: ROUTES.home, icon: 'home', activePatterns: ['/'] },
      // Analytics and parcel search are read-only and organisation-scoped.
      { label: 'Analytics', href: ROUTES.analytics, icon: 'bars', activePatterns: [ROUTES.analytics] },
    ],
  },
  {
    label: 'Trips',
    items: [
      { label: 'Trip History', href: ROUTES.history,  icon: 'clock', activePatterns: ['/history'] },
      { label: 'Parcel Search', href: ROUTES.parcels, icon: 'box', activePatterns: [ROUTES.parcels] },
      // Hidden in 6071ab2 as "not yet live", back now that FP-146 gave the queue a real
      // org-scoped list, detail page and resolve flow. `activePatterns` covers the detail
      // route too, so the entry stays lit while a dispatcher works one exception.
      { label: 'Exceptions',   href: ROUTES.exceptions, icon: 'warn', activePatterns: ['/exceptions'] },
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
    // Deliberately unlabelled. A precinct belongs under neither TRIPS nor FLEET, and
    // inventing a group name before there is a second resident would be guessing at a
    // taxonomy. When organisations or partners arrive, give this group a label.
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

// Shown when there is no name to take initials from (session still loading).
const FALLBACK_INITIALS = 'D'

// Humanizes the DispatcherUser role for display; falls back to the base
// "Dispatcher" label when the role is the non-admin variant or user is unknown.
function roleLabel(role: DispatcherUser['role'] | undefined): string {
  return role === 'admin_dispatcher' ? 'Admin Dispatcher' : 'Dispatcher'
}

// First letter of the first and last name — a single-word name yields one letter.
function initialsOf(fullName: string | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return FALLBACK_INITIALS
  const first = parts[0][0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

function isActive(pathname: string, patterns: string[]): boolean {
  return patterns.some(p => {
    if (p === '/') return pathname === '/'
    return pathname.startsWith(p)
  })
}

// Shared by every interactive element on the dark surface so keyboard focus looks the same.
const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-white/40'

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
      aria-current={active ? 'page' : undefined}
      title={item.label}
      className={cn(
        'group flex items-center gap-3 h-9 px-3 rounded-lg text-[14px] transition-colors duration-[120ms]',
        FOCUS_RING,
        collapsed && 'justify-center px-0 h-10',
        // Raised pill rather than a recolour: a lighter fill with an inner hairline reads
        // as "lifted" on the dark surface without introducing a second accent colour.
        active
          ? 'bg-white/[0.10] ring-1 ring-inset ring-white/[0.08] text-white font-medium'
          : 'text-white/60 hover:text-white hover:bg-white/[0.06]',
      )}
    >
      <Ic
        n={item.icon}
        s={16}
        className={cn('shrink-0 transition-colors', active ? 'text-white' : 'text-white/50 group-hover:text-white/80')}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
}

// The primary action. White-on-dark is the inverse of the app's near-black primary
// Button, so it reads as the same design language while being the brightest thing here.
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
  /** Icon-only rail. Desktop-only — the mobile drawer never collapses. */
  collapsed?: boolean
  /** Renders the collapse/expand control when provided (desktop instance only). */
  onToggleCollapse?: () => void
}

function SidebarContent({ onClose, collapsed = false, onToggleCollapse }: SidebarContentProps) {
  const pathname = usePathname()
  const { user } = useAuth()
  const visibleGroups = NAV_GROUPS
    .map(group => ({
      ...group,
      items: group.items.filter(item => !item.adminOnly || user?.role === 'admin_dispatcher'),
    }))
    .filter(group => group.items.length > 0)

  const displayName = user?.full_name ?? 'Dispatcher'

  return (
    // No background of its own: the dark surface and rounded edge belong to the frame in
    // DispatcherShell (and to the drawer wrapper below), so this column is just content.
    <div
      className={cn(
        'flex flex-col h-full shrink-0 transition-[width] duration-200 motion-reduce:transition-none',
        collapsed ? 'w-[68px]' : 'w-[256px]',
      )}
    >
      {/* Header — logo mark + wordmark, with the collapse control on the right */}
      {/* px-3 lines the logo and collapse control up with the Create Trip button's edges below. */}
      <div className={cn('flex items-center gap-3 h-16', collapsed ? 'justify-center' : 'px-3')}>
        {/* The tile needs its own fill: it sits on the same surface as the sidebar. */}
        <div className="w-9 h-9 rounded-lg bg-white/10 ring-1 ring-white/10 flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-white" />
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

      {/* In the icon rail there is no room beside the logo, so the expand control sits beneath it. */}
      {collapsed && onToggleCollapse && (
        <div className="flex justify-center pb-2">
          <CollapseToggle collapsed={collapsed} onToggle={onToggleCollapse} />
        </div>
      )}

      <div className="px-3 pt-1 pb-2">
        <CreateTripButton pathname={pathname} onClose={onClose} collapsed={collapsed} />
      </div>

      {/* Nav groups — separated by spacing, not rules */}
      <nav aria-label="Primary" className="flex-1 px-3 pb-2 overflow-y-auto">
        {visibleGroups.map(group => (
          // Keyed on the first item's href, not the label: groups may be unlabelled,
          // and two unlabelled groups would otherwise collide on an `undefined` key.
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

      {/* Footer — settings, then who is signed in and whether the live stream is up */}
      <div className="px-3 pb-3 flex flex-col gap-0.5">
        <NavLink item={SETTINGS_ITEM} pathname={pathname} onClose={onClose} collapsed={collapsed} />

        <div className={cn('mt-2 flex flex-col gap-2', collapsed ? 'items-center' : 'px-3')}>
          <div className="flex items-center gap-2.5 min-w-0" title={collapsed ? displayName : undefined}>
            <div className="relative shrink-0">
              <div
                aria-hidden
                className="w-8 h-8 rounded-full bg-white/10 ring-1 ring-white/10 flex items-center justify-center text-[12px] font-[600] text-white/85"
              >
                {initialsOf(user?.full_name)}
              </div>
              {/* Collapsed rail has no room for a "Live" row, so the status becomes a
                  presence dot on the avatar — a dispatcher can still see the stream is alive. */}
              {collapsed && <LiveBadge compact className="absolute -bottom-0.5 -right-0.5" />}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-[13px] font-[500] text-white/90 leading-tight truncate">{displayName}</div>
                <div className="text-[11px] text-white/45 leading-tight truncate">{roleLabel(user?.role)}</div>
              </div>
            )}
          </div>
          {/* Own line, below the identity, rather than competing with the name for width. */}
          {!collapsed && <LiveBadge />}
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
          {/* The drawer floats outside DispatcherShell's frame, so it carries the same
              surface, radius and hairline itself. */}
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
