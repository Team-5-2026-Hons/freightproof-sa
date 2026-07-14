# Dispatcher UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the dispatcher frontend with the HTML reference files in `docs/references/` — dark outer chrome, correct sidebar, and all pages using `TopBar` / `StatCard` / `SecHead` primitives.

**Architecture:** Foundation-first — Tailwind token → shell → sidebar → three new primitive components → five pages rewritten against HTML references → five ref-less pages get shell/TopBar corrections only.

**Tech Stack:** Next.js 15 App Router, TypeScript 5.5, Tailwind v3.4, React 19, `Ic` icon set (`components/ui/Ic.tsx`).

**Key constraints (read before touching any file):**
- No raw hex literals (`#rrggbb`) anywhere in component code. Use Tailwind token classes or the one allowed inline style (Button primary gradient). `rgba()` and named colours (`white`) are fine. CSS variables (`var(--sec)`) must only be used in inline `style={{}}` props, never as SVG presentation attribute values — use `currentColor` via Tailwind `text-*` classes on the Ic wrapper instead.
- `"use client"` only where state/hooks are required. `TopBar`, `StatCard`, `SecHead` are pure presentational — no `"use client"`.
- Do not touch `driver-pwa/`, `frontend/shared/`, or any backend file.
- After every task: run `cd frontend/dispatcher && npx tsc --noEmit` and fix any type errors before committing.

---

## File map

| Action | File |
|---|---|
| Modify | `frontend/dispatcher/tailwind.config.ts` |
| Modify | `frontend/dispatcher/components/layout/DispatcherShell.tsx` |
| Modify | `frontend/dispatcher/components/layout/Sidebar.tsx` |
| **Create** | `frontend/dispatcher/components/ui/TopBar.tsx` |
| **Create** | `frontend/dispatcher/components/ui/StatCard.tsx` |
| **Create** | `frontend/dispatcher/components/ui/SecHead.tsx` |
| Modify | `frontend/dispatcher/components/domain/ChecklistRow.tsx` |
| Modify | `frontend/dispatcher/app/(app)/page.tsx` |
| Modify | `frontend/dispatcher/app/(app)/trips/[id]/page.tsx` |
| Modify | `frontend/dispatcher/app/(app)/trips/new/page.tsx` |
| Modify | `frontend/dispatcher/app/(app)/history/page.tsx` |
| Modify | `frontend/dispatcher/app/(app)/sla/page.tsx` |
| Modify | `frontend/dispatcher/app/(app)/exceptions/page.tsx` |
| Modify | `frontend/dispatcher/app/(app)/exceptions/[id]/page.tsx` |
| Modify | `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx` |
| Modify | `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx` |
| Modify | `frontend/dispatcher/app/(app)/settings/page.tsx` |

---

## Task 1 — Add `canvas` colour token to Tailwind config

**Files:**
- Modify: `frontend/dispatcher/tailwind.config.ts`

The outer shell needs `bg-canvas` (`#0a0a0c`). This is the only Tailwind config change needed — all other tokens already exist.

- [ ] **Step 1: Add the token**

In `frontend/dispatcher/tailwind.config.ts`, inside `theme.extend.colors`, add `canvas` as the first entry (before `surf`):

```ts
colors: {
  canvas: '#0a0a0c',   // ← add this line
  surf:         '#fcf8f9',
  // … rest unchanged
```

- [ ] **Step 2: Verify**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `chore(dispatcher): add canvas colour token to tailwind config`

---

## Task 2 — Fix `DispatcherShell` (two-layer chrome)

**Files:**
- Modify: `frontend/dispatcher/components/layout/DispatcherShell.tsx`

Replace the flat `min-h-screen bg-surface` layout with: dark `bg-canvas` outer layer (12 px padding) + `bg-surf rounded-xl shadow-level-6` floating panel. The `Menu` icon from lucide is retained for the mobile hamburger — it is a utility icon absent from the IP set (spec §1).

- [ ] **Step 1: Replace the file**

```tsx
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
    <div className="min-h-screen bg-canvas p-3">
      {/* Floating panel — r-xl, elevation-6, white surface */}
      <div className="flex min-h-[calc(100vh-24px)] bg-surf rounded-xl shadow-level-6 overflow-hidden">
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
```

- [ ] **Step 2: Verify**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(dispatcher): dark outer canvas + floating panel shell chrome`

---

## Task 3 — Fix `Sidebar` (logo mark, nav groups, Ic icons, user footer)

**Files:**
- Modify: `frontend/dispatcher/components/layout/Sidebar.tsx`

Complete rewrite. Key technique for icons: set `className="text-sec"` or `className="text-white/45"` on `<Ic>` — since `Ic` passes `className` to the `<svg>` element, Tailwind sets the CSS `color` property, and `stroke="currentColor"` on the SVG reads it. No hex in component code.

Logo mark: `fill="white"` (named colour — not hex, not banned) + `fill="currentColor"` on the circle (reads `text-sec` from wrapper).

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Ic } from '@/components/ui/Ic'
import { useAuth } from '@/lib/hooks/useAuth'
import { cn } from '@shared/lib/utils/cn'
import { ROUTES } from '@/lib/constants/routes'
import type { IconName } from '@/components/ui/Ic'

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
      // Active Trips is the same page as Dashboard (/); omit duplicate to avoid 404.
      // The Dashboard nav item above covers it.
      { label: 'Create Trip',  href: ROUTES.tripNew, icon: 'plus',  activePatterns: ['/trips/new'] },
      { label: 'Trip History', href: ROUTES.history,  icon: 'clock', activePatterns: ['/history'] },
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
  icon: 'check',
  activePatterns: ['/settings'],
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

  return (
    <div className="flex flex-col h-full bg-primary w-[220px] shrink-0">
      {/* Header — logo mark + wordmark + eyebrow */}
      <div className="flex items-center gap-[10px] px-[18px] py-[18px] border-b border-white/[0.08]">
        {/* Hex logo mark — bg-sec container, white polygon, sec-coloured circle */}
        <div className="w-8 h-8 bg-sec rounded-md flex items-center justify-center shrink-0 text-sec">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <path d="M12 2L20 6.5V17.5L12 22L4 17.5V6.5Z" fill="white" fillOpacity="0.88" />
            <circle cx={12} cy={12} r={3} fill="currentColor" />
          </svg>
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
        {NAV_GROUPS.map(group => (
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

        {/* Settings — ungrouped, separated by a small top margin */}
        <div className="mt-2">
          <NavLink item={SETTINGS_ITEM} pathname={pathname} onClose={onClose} />
        </div>
      </div>

      {/* Footer — user avatar + name + role */}
      <div className="flex items-center gap-2 px-[18px] py-3 border-t border-white/[0.08]">
        <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0">
          <Ic n="user" s={13} className="text-white/60" />
        </div>
        <div>
          <div className="text-[12px] font-[600] text-white/85 leading-tight">
            {user?.full_name ?? 'Dispatcher'}
          </div>
          <div className="text-[10px] text-white/40">Dispatcher</div>
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
```

**Note:** `ROUTES.trips` (`/trips`) has no corresponding `page.tsx` — the active trips page lives at `/` (`ROUTES.home`). The "Active Trips" entry was removed from the TRIPS group above to avoid a 404; Dashboard at `/` serves both roles.

- [ ] **Step 2: Verify**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(dispatcher): sidebar — hex logo, nav groups, Ic icons, user footer`

---

## Task 4 — Create `TopBar` component

**Files:**
- Create: `frontend/dispatcher/components/ui/TopBar.tsx`

60px page header strip that replaces `PageHeader` on all redesigned pages. Pure presentational — no state, no `"use client"`.

- [ ] **Step 1: Create the file**

```tsx
import type { ReactNode } from 'react'

interface TopBarProps {
  title: string
  /** Secondary line below title — shown in sec colour, tabular-nums. */
  sub?: string
  /** Right slot — buttons, chips, etc. Rendered in a flex row with 8px gap. */
  children?: ReactNode
}

/**
 * 60px page header strip used on every authenticated dispatcher page.
 * Left: title + optional sub line. Right: children slot.
 * Replaces PageHeader on all redesigned pages (spec §5.3).
 */
export function TopBar({ title, sub, children }: TopBarProps) {
  return (
    <div className="flex items-center gap-3 px-6 h-[60px] bg-surf-lowest border-b border-outline-v/20 shadow-level-1 shrink-0">
      <div>
        <div className="text-[18px] font-[800] tracking-[-0.02em] text-on-surf leading-tight">
          {title}
        </div>
        {sub && (
          <div className="text-[11px] font-[500] tracking-[0.03em] text-sec tabular-nums mt-[2px]">
            {sub}
          </div>
        )}
      </div>
      {children && (
        <div className="ml-auto flex gap-2 items-center">
          {children}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(dispatcher): TopBar ui primitive`

---

## Task 5 — Create `StatCard` component

**Files:**
- Create: `frontend/dispatcher/components/ui/StatCard.tsx`

Metric tile — 28px value + 12px label. Used in the dashboard stat strip.

- [ ] **Step 1: Create the file**

```tsx
interface StatCardProps {
  value: string
  label: string
  /** Red value colour — for exception counts etc. */
  warn?: boolean
  /** Green value colour — for on-time rates etc. */
  success?: boolean
}

/**
 * Metric display tile — 28px/800 value, 12px/500 label.
 * Used in the dashboard stat strip (spec §5.1).
 */
export function StatCard({ value, label, warn, success }: StatCardProps) {
  return (
    <div className="bg-surf-lowest rounded-lg p-[16px_20px] flex-1 shadow-level-3">
      <div
        className={[
          'text-[28px] font-[800] tracking-[-0.03em] leading-none',
          warn    ? 'text-err' :
          success ? 'text-ok'  :
                    'text-on-surf',
        ].join(' ')}
      >
        {value}
      </div>
      <div className="text-[12px] font-[500] text-on-surf-v mt-[6px]">
        {label}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(dispatcher): StatCard ui primitive`

---

## Task 6 — Create `SecHead` component

**Files:**
- Create: `frontend/dispatcher/components/ui/SecHead.tsx`

Section header band used above trip lists and card sections. Optional gradient-primary action button.

- [ ] **Step 1: Create the file**

```tsx
interface SecHeadProps {
  title: string
  /** Label for the optional action button on the right. */
  action?: string
  onAction?: () => void
}

/**
 * Sticky-feeling section header band — surf-low background, uppercase label,
 * optional gradient-primary action button with plus icon (spec §5.1).
 */
export function SecHead({ title, action, onAction }: SecHeadProps) {
  return (
    <div className="flex items-center px-6 py-[10px] bg-surf-low shrink-0">
      <span className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
        {title}
      </span>
      {action && (
        <button
          onClick={onAction}
          style={{ background: 'linear-gradient(135deg,#1b1b1c 0%,#303031 100%)' }}
          className="ml-auto flex items-center gap-[5px] text-white text-[13px] font-[600] rounded-md px-4 py-[6px] cursor-pointer transition-all hover:brightness-[1.12] active:scale-[0.97]"
        >
          {/* Plus icon inline — avoids importing Ic just for a single layout-primitive */}
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {action}
        </button>
      )}
    </div>
  )
}
```

> The inline `linear-gradient` is the one allowed inline style per DESIGN_SYSTEM.md (Button primary variant). The two `#` hex values within that style prop are inside the gradient string, which is the same exemption used by `Button.tsx`. The inline SVG avoids a circular dependency.

- [ ] **Step 2: Verify**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(dispatcher): SecHead ui primitive`

---

## Task 7 — Update `ChecklistRow` to flat table-row layout

**Files:**
- Modify: `frontend/dispatcher/components/domain/ChecklistRow.tsx`

Change from a card-style button to a flat table row with fixed-width columns matching the reference. This component is used on Active Trips and Trip History — both get the same table-row layout.

Column widths (from reference `TripRow`): Trip ID 88px · Order 100px · Driver/Horse 115px · Route 100px · Progress flex-1 · Status chip.

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { Chip } from '@/components/ui/Chip'
import { TripIdStamp } from './TripIdStamp'
import { HandshakeChain } from './HandshakeChain'
import { ROUTES } from '@/lib/constants/routes'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { TripSummary, TripStatus } from '@shared/lib/types/trip'
import { cn } from '@shared/lib/utils/cn'

interface ChecklistRowProps {
  trip: TripSummary
  className?: string
}

const STATUS_HINT: Record<TripStatus, string> = {
  created:         'Pending start',
  origin_gate_in:  'H1: Gate In',
  loading:         'H2: Loading',
  origin_gate_out: 'H3: Gate Out',
  in_transit:      'In Transit',
  dest_gate_in:    'H4: Dest Gate',
  unloading:       'H5: Unloading',
  closed:          '✓ Closed',
  cancelled:       'Cancelled',
  exception_hold:  '⚠ Exception',
}

/**
 * Flat table-row layout used on Active Trips and Trip History.
 * Fixed-width columns match the HTML reference TripRow exactly.
 * Clicking navigates to Trip Detail.
 */
export function ChecklistRow({ trip, className }: ChecklistRowProps) {
  const router = useRouter()
  const statusMeta = TRIP_STATUS_META[trip.status]

  const originPrecinct = mockPrecincts.find(p => p.id === trip.origin_precinct_id)
  const destPrecinct   = mockPrecincts.find(p => p.id === trip.destination_precinct_id)
  const fullTrip       = mockTrips.find(t => t.id === trip.id)
  const handshakes     = fullTrip?.handshakes ?? []

  const originShort = originPrecinct?.name.split('—')[0]?.trim() ?? '—'
  const destShort   = destPrecinct?.name.split('—')[0]?.trim() ?? '—'

  const hint = trip.open_exception_count > 0
    ? `⚠ ${trip.open_exception_count} exception${trip.open_exception_count > 1 ? 's' : ''}`
    : STATUS_HINT[trip.status]

  return (
    <button
      onClick={() => router.push(ROUTES.tripDetail(trip.id))}
      className={cn(
        'w-full flex items-center gap-3 px-6 py-3 text-left',
        'bg-surf-lowest cursor-pointer transition-colors duration-[120ms]',
        'hover:bg-surf-low',
        trip.open_exception_count > 0 && 'border-l-4 border-err',
        className,
      )}
    >
      {/* Trip ID — 88px, sec colour, tabular-nums */}
      <div className="w-[88px] shrink-0 text-[13px] font-[600] text-sec tabular-nums tracking-[0.05em]">
        <TripIdStamp tripReference={trip.trip_reference} />
      </div>

      {/* Order number — 100px */}
      <div className="w-[100px] shrink-0 text-[11px] text-on-surf-v tabular-nums tracking-[0.03em]">
        {trip.order_number}
      </div>

      {/* Driver + Horse — 115px */}
      <div className="w-[115px] shrink-0">
        <div className="text-[14px] font-[600] text-on-surf truncate">{trip.driver.full_name}</div>
        <div className="text-[11px] text-on-surf-v tabular-nums tracking-[0.04em] truncate">
          {trip.horse?.registration ?? '—'}
        </div>
      </div>

      {/* Route — 100px */}
      <div className="w-[100px] shrink-0 text-[13px] font-[600] text-on-surf truncate">
        {originShort} → {destShort}
      </div>

      {/* Progress — flex-1: compact HandshakeChain + hint text */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        {handshakes.length > 0 && (
          <HandshakeChain handshakes={handshakes} compact />
        )}
        <span className={cn(
          'text-[11px] truncate',
          trip.open_exception_count > 0 ? 'text-warn' :
          trip.status === 'closed'       ? 'text-ok'   :
                                           'text-on-surf-v',
        )}>
          {hint}
        </span>
      </div>

      {/* Status chip */}
      <Chip type={statusMeta.chipType} label={statusMeta.label} className="shrink-0" />
    </button>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(dispatcher): ChecklistRow — flat table-row layout matching reference`

---

## Task 8 — Rewrite Dashboard page

**Files:**
- Modify: `frontend/dispatcher/app/(app)/page.tsx`

Replace `PageShell` + `PageHeader` with `TopBar`, add 4-`StatCard` strip, `ExceptionBanner` when exceptions exist, `SecHead` + column-header row + `ChecklistRow` list inside a `r-lg` card.

The table card uses `overflow-hidden` — the column-header band and rows sit flush inside without outer padding.

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar }         from '@/components/ui/TopBar'
import { StatCard }       from '@/components/ui/StatCard'
import { SecHead }        from '@/components/ui/SecHead'
import { Button }         from '@/components/ui/Button'
import { Ic }             from '@/components/ui/Ic'
import { EmptyState }     from '@/components/ui/EmptyState'
import { ChecklistRow }   from '@/components/domain/ChecklistRow'
import { ExceptionBanner } from '@/components/domain/ExceptionBanner'
import { useTrips }       from '@/lib/hooks/useTrips'
import { useExceptions }  from '@/lib/hooks/useExceptions'
import { ROUTES }         from '@/lib/constants/routes'
import { COPY }           from '@shared/lib/constants/copy'
import { mockTrips }      from '@shared/lib/mocks/trips'
import type { TripStatus } from '@shared/lib/types/trip'

const ACTIVE_STATUSES: TripStatus[] = [
  'created', 'origin_gate_in', 'loading', 'origin_gate_out',
  'in_transit', 'dest_gate_in', 'unloading', 'exception_hold',
]

const CLOSED_STATUS: TripStatus[] = ['closed']

// Column headers matching reference TripRow widths exactly
const COLUMNS = [
  { label: 'TRIP ID',        width: 88  },
  { label: 'ORDER',          width: 100 },
  { label: 'DRIVER / HORSE', width: 115 },
  { label: 'ROUTE',          width: 100 },
  { label: 'PROGRESS',       width: null },  // flex-1
  { label: 'STATUS',         width: 90  },
] as const

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function ActiveTripsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')

  const allTrips      = useTrips({ status: ACTIVE_STATUSES })
  const closedTrips   = useTrips({ status: CLOSED_STATUS })
  const openExceptions = useExceptions({ resolved: false })

  // Completed today — closed trips whose updated_at is today
  const todayStr = new Date().toDateString()
  const completedCount = useMemo(
    () => closedTrips.filter(t => new Date(t.updated_at).toDateString() === todayStr).length,
    [closedTrips, todayStr],
  )

  // On-time % — trips that arrived at or before planned arrival
  const onTimePercent = useMemo(() => {
    const withArrival = allTrips.filter(t => t.actual_arrival_at && t.planned_arrival_at)
    if (withArrival.length === 0) return 100
    const onTime = withArrival.filter(
      t => new Date(t.actual_arrival_at!) <= new Date(t.planned_arrival_at!),
    )
    return Math.round((onTime.length / withArrival.length) * 100)
  }, [allTrips])

  // Exception description — first two trip references + type
  const exceptionDescription = useMemo(() => {
    return openExceptions.slice(0, 2).map(e => {
      const trip = mockTrips.find(t => t.id === e.trip_id)
      const ref  = trip?.trip_reference ?? 'Unknown'
      return `${ref}: ${e.exception_type.replace(/_/g, ' ')}`
    }).join(' · ')
  }, [openExceptions])

  const filteredTrips = useMemo(() => {
    if (!search.trim()) return allTrips
    const term = search.toLowerCase()
    return allTrips.filter(t =>
      t.trip_reference.toLowerCase().includes(term) ||
      t.driver.full_name.toLowerCase().includes(term) ||
      t.order_number.toLowerCase().includes(term),
    )
  }, [allTrips, search])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Dashboard"
        sub={`${formatDate(new Date())} · Load Factor Transport`}
      >
        <Button
          size="sm"
          iconLeft={<Ic n="plus" s={13} className="text-white" />}
          onClick={() => router.push(ROUTES.tripNew)}
        >
          New Trip
        </Button>
      </TopBar>

      {/* Stat strip */}
      <div className="flex gap-3 px-6 py-4 bg-surf-low shrink-0">
        <StatCard value={String(allTrips.length)}   label="Active trips" />
        <StatCard value={String(openExceptions.length)} label="Exceptions today" warn={openExceptions.length > 0} />
        <StatCard value={String(completedCount)}    label="Completed today" />
        <StatCard value={`${onTimePercent}%`}       label="On-time rate (30d)" success />
      </div>

      {/* Exception banner — only when open exceptions exist */}
      {openExceptions.length > 0 && (
        <div className="mx-6 mt-4 shrink-0">
          <ExceptionBanner
            title={`${openExceptions.length} exception${openExceptions.length > 1 ? 's' : ''} require review`}
            description={exceptionDescription}
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push(ROUTES.exceptions)}
              >
                View all
              </Button>
            }
          />
        </div>
      )}

      {/* Search */}
      <div className="px-6 py-3 shrink-0">
        <div className="relative">
          <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
          <input
            type="text"
            placeholder="Search trip ID, driver, or order…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf placeholder:text-on-surf-v/60 outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
          />
        </div>
      </div>

      {/* Trip list card */}
      <div className="flex-1 overflow-auto mx-6 mb-6 bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden flex flex-col">
        <SecHead
          title="Active Trips"
          action="New Trip"
          onAction={() => router.push(ROUTES.tripNew)}
        />

        {/* Column header row */}
        <div className="flex gap-3 px-6 py-[7px] bg-surf-low shrink-0">
          {COLUMNS.map(col => (
            <div
              key={col.label}
              style={col.width ? { width: col.width, flexShrink: 0 } : { flex: 1 }}
              className="text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v"
            >
              {col.label}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-outline-v/10">
          {allTrips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Ic n="truck" s={32} className="text-on-surf-v" />}
                title={COPY.emptyState.activeTrips.title}
                body={COPY.emptyState.activeTrips.body}
              />
            </div>
          ) : filteredTrips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Ic n="search" s={32} className="text-on-surf-v" />}
                title={COPY.emptyState.noResults.title}
                body={COPY.emptyState.noResults.body}
              />
            </div>
          ) : (
            filteredTrips.map(trip => (
              <ChecklistRow key={trip.id} trip={trip} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Start dev server and visually verify against `docs/references/dispatcher-dashboard.html`**

```bash
cd frontend/dispatcher && npm run dev
```
Open `http://localhost:3000` and `docs/references/dispatcher-dashboard.html` side by side. Check:
- Dark outer body, white floating panel with rounded corners
- Sidebar: hex logo, group headers, active state (blue left border + icon)
- Stat strip: 4 cards in a row, large numbers
- Exception banner (visible if `openExceptions.length > 0` in mock data)
- Column header row above trip rows

Stop the dev server when done.

- [ ] **Step 4: Commit**

> **Suggested commit:** `feat(dispatcher): dashboard — TopBar, StatCards, ExceptionBanner, table layout`

---

## Task 9 — Rewrite Trip Detail page

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`

Replace `PageShell` + `PageHeader` with `TopBar`. Move `HandshakeChain` to a full-width `bg-surf-low` strip directly below `TopBar`. Move metadata cards below the chain. Keep all existing tab logic unchanged.

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertTriangle, Clock, Package, Link2 } from 'lucide-react'
import { TopBar }            from '@/components/ui/TopBar'
import { Tabs }              from '@/components/ui/Tabs'
import { Chip }              from '@/components/ui/Chip'
import { Card }              from '@/components/ui/Card'
import { Button }            from '@/components/ui/Button'
import { EmptyState }        from '@/components/ui/EmptyState'
import { Ic }                from '@/components/ui/Ic'
import { HandshakeChain }    from '@/components/domain/HandshakeChain'
import { ExceptionBanner }   from '@/components/domain/ExceptionBanner'
import { EvidencePacket }    from '@/components/domain/EvidencePacket'
import { BlockchainReceipt } from '@/components/domain/BlockchainReceipt'
import { TimestampWithIcon } from '@/components/domain/TimestampWithIcon'
import { ROUTES }            from '@/lib/constants/routes'
import {
  TRIP_STATUS_META,
  HANDSHAKE_STATUS_META,
  EXCEPTION_SEVERITY_META,
} from '@shared/lib/constants/status-meta'
import { HANDSHAKE_NAMES }   from '@shared/lib/constants/handshake-meta'
import { mockTrips }         from '@shared/lib/mocks/trips'
import { mockPrecincts }     from '@shared/lib/mocks/precincts'
import { mockManifests }     from '@shared/lib/mocks/manifests'
import type { HandshakeNumber } from '@shared/lib/types/handshake'

const TABS = [
  { id: 'timeline',   label: 'Timeline',   icon: <Clock className="w-4 h-4" /> },
  { id: 'manifest',   label: 'Manifest',   icon: <Package className="w-4 h-4" /> },
  { id: 'exceptions', label: 'Exceptions', icon: <AlertTriangle className="w-4 h-4" /> },
  { id: 'blockchain', label: 'Blockchain', icon: <Link2 className="w-4 h-4" /> },
]

export default function TripDetailPage() {
  const params   = useParams()
  const router   = useRouter()
  const [activeTab, setActiveTab] = useState('timeline')

  const tripId = params.id as string
  const trip   = useMemo(() => mockTrips.find(t => t.id === tripId), [tripId])

  if (!trip) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Trip not found">
          <Button variant="secondary" size="sm" onClick={() => router.push(ROUTES.home)}
            iconLeft={<Ic n="back" s={14} className="text-on-surf" />}>
            Back
          </Button>
        </TopBar>
        <div className="p-6">
          <EmptyState
            icon={<AlertTriangle />}
            title="Trip not found"
            body="This trip does not exist or you do not have access to it."
            cta={<Button onClick={() => router.push(ROUTES.home)}>Back to Active Trips</Button>}
          />
        </div>
      </div>
    )
  }

  const statusMeta     = TRIP_STATUS_META[trip.status]
  const originPrecinct = mockPrecincts.find(p => p.id === trip.origin_precinct_id)
  const destPrecinct   = mockPrecincts.find(p => p.id === trip.destination_precinct_id)
  const openExceptions = trip.exceptions.filter(e => !e.resolved)
  const isClosed       = trip.status === 'closed'
  const manifest       = mockManifests.find(m => m.trip_id === trip.id)

  const originShort = originPrecinct?.name.split('—')[0]?.trim() ?? '—'
  const destShort   = destPrecinct?.name.split('—')[0]?.trim() ?? '—'

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Top bar — trip reference + status chip + back */}
      <TopBar
        title={trip.trip_reference}
        sub={`${originShort} → ${destShort}`}
      >
        <Chip type={statusMeta.chipType} label={statusMeta.label} />
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
          onClick={() => router.back()}
        >
          Back
        </Button>
      </TopBar>

      {/* Handshake chain — full-width strip in surf-low */}
      <div className="px-6 py-4 bg-surf-low border-b border-outline-v/20 shrink-0">
        <HandshakeChain handshakes={trip.handshakes} />
      </div>

      {/* Metadata strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-4 bg-surf-low border-b border-outline-v/20 shrink-0">
        {[
          { label: 'Driver',      value: trip.driver?.full_name   ?? '—' },
          { label: 'Horse',       value: trip.horse?.registration  ?? '—' },
          { label: 'Origin',      value: originShort },
          { label: 'Destination', value: destShort },
        ].map(item => (
          <div key={item.label}>
            <p className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">{item.label}</p>
            <p className="text-[13px] font-[600] text-on-surf mt-[2px]">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Closed banner */}
      {isClosed && (
        <div className="mx-6 mt-4 flex items-center gap-2 p-3 bg-surf-low rounded-lg shrink-0">
          <Chip type="complete" label="Closed" />
          <span className="text-sm text-on-surf-v">This trip is complete and read-only.</span>
        </div>
      )}

      {/* Open exception banner */}
      {openExceptions.length > 0 && !isClosed && (
        <div className="mx-6 mt-4 shrink-0">
          <ExceptionBanner
            title={`${openExceptions.length} open exception${openExceptions.length > 1 ? 's' : ''}`}
            description={openExceptions[0].description}
            action={
              <Button
                variant="danger"
                size="sm"
                onClick={() => router.push(ROUTES.exceptionDetail(openExceptions[0].id))}
              >
                View
              </Button>
            }
          />
        </div>
      )}

      {/* Tabs */}
      <div className="px-6 bg-surf-lowest border-b border-outline-v/20 shrink-0">
        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {activeTab === 'timeline' && (
          <>
            {trip.handshakes
              .filter(hs => hs.status !== 'pending')
              .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
              .map(hs => {
                const hsMeta = HANDSHAKE_STATUS_META[hs.status]
                const hsName = HANDSHAKE_NAMES[hs.sequence_number as HandshakeNumber]
                return (
                  <EvidencePacket
                    key={hs.id}
                    chipType={hsMeta.chipType}
                    chipLabel={hsMeta.label}
                    title={hsName}
                    exception={hs.status === 'exception'}
                  >
                    {hs.completed_at && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v w-24">Completed</span>
                        <TimestampWithIcon timestamp={hs.completed_at} />
                      </div>
                    )}
                    {hs.seal_number && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v w-24">Seal</span>
                        <span className="font-mono tracking-[0.05em] font-bold text-sm text-on-surf">{hs.seal_number}</span>
                      </div>
                    )}
                    {hs.parcel_count_origin !== null && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v w-24">Parcels</span>
                        <span className="text-sm text-on-surf font-medium">{hs.parcel_count_origin} loaded</span>
                      </div>
                    )}
                    {hs.pulsit_geofence_confirmed !== null && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v w-24">Geofence</span>
                        <Chip
                          type={hs.pulsit_geofence_confirmed ? 'complete' : 'critical'}
                          label={hs.pulsit_geofence_confirmed ? 'Confirmed' : 'Mismatch'}
                        />
                      </div>
                    )}
                    {hs.event_hash && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v w-24">Hash</span>
                        <span className="font-mono tracking-[0.05em] text-xs text-on-surf-v truncate">
                          {hs.event_hash.slice(0, 16)}…
                        </span>
                      </div>
                    )}
                  </EvidencePacket>
                )
              })}
            {trip.handshakes.filter(hs => hs.status !== 'pending').length === 0 && (
              <EmptyState icon={<Clock />} title="No events yet" body="This trip has no completed handshake events." />
            )}
          </>
        )}

        {activeTab === 'manifest' && (
          <>
            {manifest ? (
              manifest.stops.map((stop, i) => (
                <EvidencePacket
                  key={i}
                  chipType="transit"
                  chipLabel={`Stop ${i + 1}`}
                  title={stop.delivery_stop}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v w-24">Parcels</span>
                    <span className="text-sm text-on-surf font-medium">{stop.parcel_count} items</span>
                  </div>
                  {stop.parcels.map(parcel => (
                    <div key={parcel.id} className="flex items-center gap-2 text-xs text-on-surf-v">
                      <span className="font-mono tracking-[0.05em] font-bold">{parcel.barcode}</span>
                      {parcel.description && <span>· {parcel.description}</span>}
                    </div>
                  ))}
                </EvidencePacket>
              ))
            ) : (
              <EmptyState icon={<Package />} title="No manifest" body="No manifest has been loaded for this trip yet." />
            )}
          </>
        )}

        {activeTab === 'exceptions' && (
          <>
            {trip.exceptions.length > 0 ? (
              trip.exceptions.map(exc => {
                const sevMeta = EXCEPTION_SEVERITY_META[exc.severity]
                return (
                  <EvidencePacket
                    key={exc.id}
                    chipType={sevMeta.chipType}
                    chipLabel={exc.exception_type.replace(/_/g, ' ')}
                    title={exc.description}
                    exception={!exc.resolved}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v w-24">Source</span>
                      <span className="text-sm text-on-surf font-medium capitalize">{exc.source}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v w-24">Status</span>
                      <Chip type={exc.resolved ? 'complete' : 'critical'} label={exc.resolved ? 'Resolved' : 'Open'} />
                    </div>
                    {exc.resolver_note && (
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v w-24 shrink-0">Note</span>
                        <span className="text-sm text-on-surf">{exc.resolver_note}</span>
                      </div>
                    )}
                    <TimestampWithIcon timestamp={exc.created_at} />
                  </EvidencePacket>
                )
              })
            ) : (
              <EmptyState icon={<AlertTriangle />} title="No exceptions" body="This trip has no logged exceptions." />
            )}
          </>
        )}

        {activeTab === 'blockchain' && (
          <>
            {trip.blockchain_receipts.length > 0 ? (
              trip.blockchain_receipts.map(receipt => (
                <BlockchainReceipt key={receipt.id} receipt={receipt} />
              ))
            ) : (
              <EmptyState icon={<Link2 />} title="No blockchain receipts" body="No events have been anchored to the blockchain for this trip yet." />
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Visually verify against `docs/references/dispatcher-trip-detail.html`**

```bash
cd frontend/dispatcher && npm run dev
```
Navigate to a trip detail page. Check: `TopBar` at top, `HandshakeChain` in the surf-low strip, metadata row below, tabs, tab content. Stop the server when done.

- [ ] **Step 4: Commit**

> **Suggested commit:** `feat(dispatcher): trip detail — TopBar, chain strip, metadata, tabs`

---

## Task 10 — Rewrite Create Trip page

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx`

Replace `PageShell` + `PageHeader` with `TopBar`. Wrap form in a two-column layout (form left, summary card right) per the reference. All existing form state and submit logic stays unchanged.

- [ ] **Step 1: Read the current file fully before editing**

Read `frontend/dispatcher/app/(app)/trips/new/page.tsx` (the full file — only the first 80 lines were reviewed earlier) to capture all existing form fields and submit logic.

- [ ] **Step 2: Replace shell and layout only**

Replace from the `return (` statement downward. The form state, hooks, and submit handler above the `return` stay unchanged. The replacement wraps with `TopBar` and a two-column layout:

```tsx
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="New Trip">
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
          onClick={() => router.back()}
        >
          Cancel
        </Button>
      </TopBar>

      <div className="flex gap-6 p-6 flex-1 overflow-auto">
        {/* Form — left column */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-4 min-w-0">
          {/* ORDER */}
          <Card className="p-6">
            <SecHead title="Order" />
            <div className="p-6 pt-3">
              <Input
                label="Order number"
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value)}
                error={error && !orderNumber ? 'Required' : undefined}
              />
            </div>
          </Card>

          {/* DRIVER & VEHICLE */}
          <Card className="p-0 overflow-hidden">
            <SecHead title="Driver & Vehicle" />
            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-[12px] font-[600] text-on-surf-v mb-1">Driver</label>
                <select
                  value={driverId}
                  onChange={e => setDriverId(e.target.value)}
                  className="w-full px-3 py-2 text-[14px] bg-surf-low border border-outline-v/30 rounded-md text-on-surf outline-none focus:border-sec transition-colors"
                >
                  <option value="">Select driver…</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>{d.full_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-[600] text-on-surf-v mb-1">Horse (truck)</label>
                <select
                  value={horseId}
                  onChange={e => setHorseId(e.target.value)}
                  className="w-full px-3 py-2 text-[14px] bg-surf-low border border-outline-v/30 rounded-md text-on-surf outline-none focus:border-sec transition-colors"
                >
                  <option value="">Select horse…</option>
                  {horses.map(h => (
                    <option key={h.id} value={h.id}>{h.registration}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-[600] text-on-surf-v mb-1">Trailer(s)</label>
                <select
                  multiple
                  value={trailerIds}
                  onChange={e => setTrailerIds(Array.from(e.target.selectedOptions, o => o.value))}
                  className="w-full px-3 py-2 text-[14px] bg-surf-low border border-outline-v/30 rounded-md text-on-surf outline-none focus:border-sec transition-colors h-24"
                >
                  {trailers.map(t => (
                    <option key={t.id} value={t.id}>{t.registration}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* ROUTE */}
          <Card className="p-0 overflow-hidden">
            <SecHead title="Route" />
            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-[12px] font-[600] text-on-surf-v mb-1">Origin precinct</label>
                <select
                  value={originId}
                  onChange={e => setOriginId(e.target.value)}
                  className="w-full px-3 py-2 text-[14px] bg-surf-low border border-outline-v/30 rounded-md text-on-surf outline-none focus:border-sec transition-colors"
                >
                  <option value="">Select origin…</option>
                  {precincts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-[600] text-on-surf-v mb-1">Destination precinct</label>
                <select
                  value={destId}
                  onChange={e => setDestId(e.target.value)}
                  className="w-full px-3 py-2 text-[14px] bg-surf-low border border-outline-v/30 rounded-md text-on-surf outline-none focus:border-sec transition-colors"
                >
                  <option value="">Select destination…</option>
                  {precincts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* SLOT TIME */}
          <Card className="p-0 overflow-hidden">
            <SecHead title="Schedule" />
            <div className="p-6">
              <Input
                label="Planned departure"
                type="datetime-local"
                value={plannedDeparture}
                onChange={e => setPlannedDeparture(e.target.value)}
              />
            </div>
          </Card>

          <Button
            type="submit"
            full
            loading={loading}
            disabled={!isValid}
          >
            Create Trip · Anchor journey lock
          </Button>
        </form>

        {/* Summary preview — right column */}
        <div className="w-[300px] shrink-0 hidden lg:block">
          <Card className="p-0 overflow-hidden sticky top-0">
            <SecHead title="Trip Summary" />
            <div className="p-5 flex flex-col gap-3 text-[13px]">
              {[
                { label: 'Order',       value: orderNumber  || '—' },
                { label: 'Driver',      value: drivers.find(d => d.id === driverId)?.full_name || '—' },
                { label: 'Horse',       value: horses.find(h => h.id === horseId)?.registration || '—' },
                { label: 'Origin',      value: precincts.find(p => p.id === originId)?.name || '—' },
                { label: 'Destination', value: precincts.find(p => p.id === destId)?.name || '—' },
              ].map(row => (
                <div key={row.label} className="flex justify-between gap-2">
                  <span className="text-on-surf-v font-[500]">{row.label}</span>
                  <span className="text-on-surf font-[600] text-right truncate max-w-[160px]">{row.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
```

Add these imports at the top of the file (replace the existing `PageShell`, `PageHeader`, `ArrowLeft`, `Plus` imports):
```tsx
import { TopBar }   from '@/components/ui/TopBar'
import { SecHead }  from '@/components/ui/SecHead'
import { Ic }       from '@/components/ui/Ic'
```

Remove these imports:
```tsx
// Remove:
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { ArrowLeft, Plus } from 'lucide-react'
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Visually verify against `docs/references/dispatcher-create-trip.html`**

Start `npm run dev`, navigate to `/trips/new`. Check: TopBar at top, two-column layout on desktop (form left, summary card right), SecHead section headers, gradient Create button.

- [ ] **Step 5: Commit**

> **Suggested commit:** `feat(dispatcher): create trip — TopBar, two-column layout`

---

## Task 11 — Rewrite Trip History page

**Files:**
- Modify: `frontend/dispatcher/app/(app)/history/page.tsx`

Replace `PageShell` + `PageHeader` with `TopBar`. Add a filter/search toolbar. Trip list uses the same `SecHead` + column-header + `ChecklistRow` pattern as the dashboard.

- [ ] **Step 1: Read the current file**

```bash
cat frontend/dispatcher/app/\(app\)/history/page.tsx
```

- [ ] **Step 2: Replace the file**

```tsx
'use client'

import { useState, useMemo } from 'react'
import { TopBar }       from '@/components/ui/TopBar'
import { SecHead }      from '@/components/ui/SecHead'
import { Ic }           from '@/components/ui/Ic'
import { EmptyState }   from '@/components/ui/EmptyState'
import { ChecklistRow } from '@/components/domain/ChecklistRow'
import { useTrips }     from '@/lib/hooks/useTrips'
import { COPY }         from '@shared/lib/constants/copy'
import type { TripStatus } from '@shared/lib/types/trip'

const CLOSED_STATUS: TripStatus[] = ['closed', 'cancelled']

const COLUMNS = [
  { label: 'TRIP ID',        width: 88  },
  { label: 'ORDER',          width: 100 },
  { label: 'DRIVER / HORSE', width: 115 },
  { label: 'ROUTE',          width: 100 },
  { label: 'PROGRESS',       width: null },
  { label: 'STATUS',         width: 90  },
] as const

export default function HistoryPage() {
  const [search, setSearch] = useState('')
  const allTrips = useTrips({ status: CLOSED_STATUS })

  const filteredTrips = useMemo(() => {
    if (!search.trim()) return allTrips
    const term = search.toLowerCase()
    return allTrips.filter(t =>
      t.trip_reference.toLowerCase().includes(term) ||
      t.driver.full_name.toLowerCase().includes(term) ||
      t.order_number.toLowerCase().includes(term),
    )
  }, [allTrips, search])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Trip History" sub={`${allTrips.length} closed trips`} />

      {/* Search / filter bar */}
      <div className="flex items-center gap-3 px-6 py-4 bg-surf-low border-b border-outline-v/20 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
          <input
            type="text"
            placeholder="Search trip ID, driver, or order…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-[13px] bg-surf-lowest rounded-md border border-outline-v/30 text-on-surf placeholder:text-on-surf-v/60 outline-none focus:border-sec transition-colors"
          />
        </div>
      </div>

      {/* Trip list card */}
      <div className="flex-1 overflow-auto mx-6 my-6 bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden flex flex-col">
        <SecHead title="Closed Trips" />

        <div className="flex gap-3 px-6 py-[7px] bg-surf-low shrink-0">
          {COLUMNS.map(col => (
            <div
              key={col.label}
              style={col.width ? { width: col.width, flexShrink: 0 } : { flex: 1 }}
              className="text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v"
            >
              {col.label}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-outline-v/10">
          {allTrips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Ic n="clock" s={32} className="text-on-surf-v" />}
                title="No trip history"
                body="Closed trips will appear here."
              />
            </div>
          ) : filteredTrips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Ic n="search" s={32} className="text-on-surf-v" />}
                title={COPY.emptyState.noResults.title}
                body={COPY.emptyState.noResults.body}
              />
            </div>
          ) : (
            filteredTrips.map(trip => (
              <ChecklistRow key={trip.id} trip={trip} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Visually verify against `docs/references/dispatcher-trip-history.html`**

Start `npm run dev`, navigate to `/history`. Check: TopBar, search bar, table card with column headers, `ChecklistRow` rows for closed/cancelled trips.

- [ ] **Step 5: Commit**

> **Suggested commit:** `feat(dispatcher): trip history — TopBar, search bar, table layout`

---

## Task 12 — Rewrite SLA Reports page

**Files:**
- Modify: `frontend/dispatcher/app/(app)/sla/page.tsx`

Replace `PageShell` + `PageHeader` with `TopBar`. Add filter bar. Keep existing chart logic if present; if the page is mostly a stub, add the 2×2 chart grid skeleton using `SLAChartCard` (or `Card` wrappers if `SLAChartCard` doesn't exist yet).

- [ ] **Step 1: Read the current file**

```bash
cat frontend/dispatcher/app/\(app\)/sla/page.tsx
```

- [ ] **Step 2: Replace the shell**

Replace the file with the content below. The `useSLAMetrics` hook is already implemented. If it isn't, use stub values.

```tsx
'use client'

import { useState } from 'react'
import { TopBar }         from '@/components/ui/TopBar'
import { Button }         from '@/components/ui/Button'
import { Ic }             from '@/components/ui/Ic'
import { Card }           from '@/components/ui/Card'
import { EmptyState }     from '@/components/ui/EmptyState'
import { useSLAMetrics }  from '@/lib/hooks/useSLAMetrics'
import type { DateRange } from '@/components/ui/DateRangePicker'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function thirtyDaysAgo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

export default function SLAPage() {
  const [range] = useState<DateRange>({ from: thirtyDaysAgo(), to: todayStr() })
  const metrics = useSLAMetrics({ range })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="SLA Reports">
        <Button variant="ghost" size="sm" iconLeft={<Ic n="dl" s={14} className="text-sec" />}>
          Export PDF
        </Button>
      </TopBar>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-4 bg-surf-low border-b border-outline-v/20 shrink-0">
        <span className="text-[12px] font-[600] text-on-surf-v">
          {range.from} — {range.to}
        </span>
        <span className="text-[11px] text-on-surf-v">(date range picker — Phase 1 hook)</span>
      </div>

      {/* 2×2 chart grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-5">
            <p className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v mb-4">On-time pickup %</p>
            {metrics ? (
              <p className="text-[28px] font-[800] text-ok">{metrics.onTimePickupPct}%</p>
            ) : (
              <EmptyState icon={<Ic n="bars" s={24} className="text-on-surf-v" />} title="No data" body="No trips in this period." />
            )}
          </Card>

          <Card className="p-5">
            <p className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v mb-4">On-time delivery %</p>
            {metrics ? (
              <p className="text-[28px] font-[800] text-ok">{metrics.onTimeDeliveryPct}%</p>
            ) : (
              <EmptyState icon={<Ic n="bars" s={24} className="text-on-surf-v" />} title="No data" body="No trips in this period." />
            )}
          </Card>

          <Card className="p-5">
            <p className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v mb-4">Exceptions by type</p>
            {metrics ? (
              <div className="space-y-2">
                {Object.entries(metrics.exceptionsByType).map(([type, count]) => (
                  <div key={type} className="flex justify-between text-[13px]">
                    <span className="text-on-surf-v capitalize">{type.replace(/_/g, ' ')}</span>
                    <span className="font-[700] text-on-surf">{count as number}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Ic n="warn" s={24} className="text-on-surf-v" />} title="No data" body="No exceptions in this period." />
            )}
          </Card>

          <Card className="p-5">
            <p className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v mb-4">Handshake completion rate</p>
            {metrics ? (
              <p className="text-[28px] font-[800] text-on-surf">{metrics.handshakeCompletionPct}%</p>
            ) : (
              <EmptyState icon={<Ic n="check" s={24} className="text-on-surf-v" />} title="No data" body="No trips in this period." />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
```

**If `useSLAMetrics` doesn't exist yet**, add a stub at `frontend/dispatcher/lib/hooks/useSLAMetrics.ts`:

```ts
'use client'

import type { DateRange } from '@/components/ui/DateRangePicker'

interface SLAMetrics {
  onTimePickupPct: number
  onTimeDeliveryPct: number
  handshakeCompletionPct: number
  exceptionsByType: Record<string, number>
}

export function useSLAMetrics(_filter: { range: DateRange }): SLAMetrics | null {
  // Stub until real data is wired. Returns null = "no data" state on charts.
  return null
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Visually verify against `docs/references/dispatcher-sla-reports.html`**

Start `npm run dev`, navigate to `/sla`. Check: TopBar with Export button, filter bar, 2×2 card grid.

- [ ] **Step 5: Commit**

> **Suggested commit:** `feat(dispatcher): sla reports — TopBar, filter bar, chart grid`

---

## Task 13 — Apply `TopBar` to ref-less pages

**Files:**
- Modify: `frontend/dispatcher/app/(app)/exceptions/page.tsx`
- Modify: `frontend/dispatcher/app/(app)/exceptions/[id]/page.tsx`
- Modify: `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`
- Modify: `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`
- Modify: `frontend/dispatcher/app/(app)/settings/page.tsx`

For each page: remove the `PageShell` wrapper and `PageHeader`, add `TopBar` at the top of the return with the title below, wrap content in `<div className="flex flex-col flex-1 min-h-0">`. Keep all existing content unchanged below the TopBar.

- [ ] **Step 1: Fix `exceptions/page.tsx`**

Read the current file. Remove the `<PageShell>` wrapper and `<PageHeader title="Exceptions Feed" />`. Add at the top of the return:

```tsx
import { TopBar } from '@/components/ui/TopBar'

// In the return:
return (
  <div className="flex flex-col flex-1 min-h-0">
    <TopBar title="Exceptions" />
    <div className="flex-1 overflow-y-auto p-6">
      {/* existing content from the old PageShell — the toggle buttons, grid, etc. */}
    </div>
  </div>
)
```

Remove these imports: `PageShell`, `PageHeader`. Add: `TopBar`.

- [ ] **Step 2: Fix `exceptions/[id]/page.tsx`**

Read the current file. Same pattern:

```tsx
import { TopBar } from '@/components/ui/TopBar'

return (
  <div className="flex flex-col flex-1 min-h-0">
    <TopBar title="Exception Detail">
      {/* keep any back button that was in PageHeader actions */}
    </TopBar>
    <div className="flex-1 overflow-y-auto p-6">
      {/* existing content */}
    </div>
  </div>
)
```

- [ ] **Step 3: Fix `fleet/vehicles/page.tsx`**

Same pattern. TopBar title: `"Fleet — Vehicles"`.

- [ ] **Step 4: Fix `fleet/drivers/page.tsx`**

Same pattern. TopBar title: `"Fleet — Drivers"`.

- [ ] **Step 5: Fix `settings/page.tsx`**

Same pattern. TopBar title: `"Settings"`.

- [ ] **Step 6: Verify TypeScript**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

> **Suggested commit:** `feat(dispatcher): apply TopBar to exceptions, fleet, settings pages`

---

## Task 14 — Final build verification

**Files:** none

- [ ] **Step 1: Run TypeScript check**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 2: Run lint**

```bash
cd frontend/dispatcher && npm run lint
```
Expected: no errors. If the hex-ban ESLint rule fires, find the offending hex literal and replace it with a Tailwind token class.

- [ ] **Step 3: Run production build**

```bash
cd frontend/dispatcher && npm run build
```
Expected: Build completes with no errors. If there are `next/navigation` or `"use client"` errors, add `"use client"` to the affected component.

- [ ] **Step 4: Spot-check all pages in dev**

```bash
cd frontend/dispatcher && npm run dev
```

Visit each route and confirm it renders without a white screen:
- `/` — dashboard
- `/trips/<any-id>` — trip detail
- `/trips/new` — create trip
- `/history` — trip history
- `/sla` — SLA reports
- `/exceptions` — exceptions list
- `/exceptions/<any-id>` — exception detail
- `/fleet/vehicles` — fleet vehicles
- `/fleet/drivers` — fleet drivers
- `/settings` — settings

- [ ] **Step 5: Final commit**

> **Suggested commit:** `chore(dispatcher): build and lint clean after ui redesign`
