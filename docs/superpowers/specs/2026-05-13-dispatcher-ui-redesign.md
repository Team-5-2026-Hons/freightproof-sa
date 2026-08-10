# Dispatcher UI Redesign — Spec

**Date:** 2026-05-13
**Branch:** Ciaran
**Approach:** Foundation-first (shell → missing primitives → pages with references → ref-less pages)

---

## Goal

Align the dispatcher frontend with the HTML reference files in `docs/references/` and the v1.3 spec in `docs/FreightProof_Frontend_Spec_v1.md`. The current implementation has the correct structural skeleton but diverges from the references in shell chrome, sidebar, missing UI primitives, and page layout.

---

## 1. Shell & Layout (`DispatcherShell`)

**File:** `frontend/dispatcher/components/layout/DispatcherShell.tsx`

Replace the flat `min-h-screen bg-surface` layout with a two-layer chrome:

- **Outer layer:** root div is `min-h-screen bg-[#0a0a0c] p-3` (12px padding all sides)
- **Inner panel:** `flex flex-row bg-surf rounded-[14px] shadow-[0_16px_64px_rgba(0,0,0,0.5)] overflow-hidden min-h-[calc(100vh-24px)]`
- Sidebar (220px fixed) sits inside the panel on the left
- Main content area is `flex-1 flex flex-col bg-surf overflow-hidden` on the right — individual pages scroll within this area
- Mobile hamburger collapses sidebar into a slide-over overlay (existing pattern, restyled to match panel chrome)
- Remove the mobile top bar header strip (sidebar overlay handles mobile nav)

---

## 2. Sidebar

**File:** `frontend/dispatcher/components/layout/Sidebar.tsx`

### Header
- 32×32 blue (`bg-sec`) `r-md` square logo mark with the hex SVG (white polygon + blue circle at centre)
- "FreightProof" wordmark: 16/800/−0.02em, white
- "EVIDENCE PLATFORM" eyebrow: 10px/uppercase/0.06em letter-spacing/`rgba(255,255,255,0.35)`
- Bottom border: `1px solid rgba(255,255,255,0.08)`

### Nav groups
Replace flat `NAV_ITEMS` with grouped structure:

| Group label | Items |
|---|---|
| OVERVIEW | Dashboard (`home` icon → `/`) |
| TRIPS | Create Trip (`plus` → `/trips/new`), Active Trips (`file` → `/`), Trip History (`clock` → `/history`) |
| REPORTING | SLA Reports (`bars` → `/sla`) |
| FLEET | Vehicles (`truck` → `/fleet/vehicles`), Drivers (`user` → `/fleet/drivers`) |
| *(ungrouped)* | Settings (`check` → `/settings`) |

Group labels: 10/700/0.12em uppercase/`rgba(255,255,255,0.3)`, padding `12px 18px 4px`.

### Item states
- **Active:** `rgba(255,255,255,0.1)` bg + `3px solid --sec` left border, icon `--sec`, label white/600
- **Inactive:** transparent bg + 3px transparent border, icon `rgba(255,255,255,0.45)`, label `rgba(255,255,255,0.55)`/400
- **Hover (inactive):** `rgba(255,255,255,0.06)` bg
- Item padding: `9px 18px`, gap: 9px between icon and label
- Replace all Lucide icons with `Ic` from the IP set

### Footer
- 28×28 circle avatar: `rgba(255,255,255,0.1)` bg, `user` icon (`rgba(255,255,255,0.6)`)
- Name: 12/600/`rgba(255,255,255,0.85)` — from `useAuth().user?.full_name`
- Role: 10/`rgba(255,255,255,0.4)` — hardcoded "Dispatcher"
- Top border: `1px solid rgba(255,255,255,0.08)`, padding `12px 18px`

---

## 3. New UI Primitives

### `TopBar`
**File:** `frontend/dispatcher/components/ui/TopBar.tsx` *(create)*

```
interface TopBarProps {
  title: string
  sub?: string
  children?: ReactNode   // right slot — buttons, chips
}
```

- Height 60px, `bg-surf-lowest`, bottom border `1px solid outline-v/20`, `shadow-[0_1px_0_rgba(27,27,28,0.06)]`, `flex-shrink-0`
- Left: title (18/800/−0.02em/`--on-surf`) + optional sub (11/500/0.03em/`--sec`/tabular-nums, `mt-[2px]`)
- Right: `children` in `ml-auto flex gap-2 items-center`
- Padding: `0 24px`
- **Replaces `PageHeader` on all redesigned dispatcher pages**

### `StatCard`
**File:** `frontend/dispatcher/components/ui/StatCard.tsx` *(create)*

```
interface StatCardProps {
  value: string
  label: string
  warn?: boolean
  success?: boolean
}
```

- `bg-surf-lowest`, `r-lg`, `p-[16px_20px]`, `flex-1`, `shadow-[0_2px_12px_rgba(27,27,28,0.06)]`
- Value: 28/800/−0.03em/lh-1 — colour: `--err` if `warn`, `--ok` if `success`, else `--on-surf`
- Label: 12/500/`--on-surf-v`, `mt-[6px]`

### `SecHead`
**File:** `frontend/dispatcher/components/ui/SecHead.tsx` *(create)*

```
interface SecHeadProps {
  title: string
  action?: string
  onAction?: () => void
}
```

- `bg-surf-low`, `p-[10px_24px]`, flex row, `flex-shrink-0`
- Title: 11/700/0.1em uppercase/`--on-surf-v`
- Action button (optional): gradient-primary (`linear-gradient(135deg,#1b1b1c,#303031)`), `r-md`, `6px 16px`, 13/600, `plus` icon (13px white)

---

## 4. Pages with HTML references

### 4.1 Dashboard (`app/(app)/page.tsx`)

Remove `PageShell` + `PageHeader`. Replace with:

1. `TopBar` — title "Dashboard", sub formatted as `"DD MMM YYYY · Load Factor Transport"` (date from `new Date()`, company hardcoded matching reference), right slot: "New Trip" primary `Button` with `plus` icon
2. Stat strip — `flex gap-3 p-[16px_24px] bg-surf-low flex-shrink-0`:
   - `StatCard` value=activeCount label="Active trips"
   - `StatCard` value=openExceptionCount label="Exceptions today" warn={openExceptionCount > 0}
   - `StatCard` value=completedCount label="Completed today" — derived from `useTrips({ status: ['closed'] })` filtered to trips whose `updated_at` is today (same calendar day in SAST)
   - `StatCard` value=`${onTimePercent}%` label="On-time rate (30d)" success
3. `ExceptionBanner` — shown only when `openExceptionCount > 0`, inside `mx-6 mt-4`, links to `/exceptions`
4. Trip list card — `flex-1 overflow-auto mx-6 my-4 bg-surf-lowest r-lg shadow-ambient overflow-hidden`:
   - `SecHead` title="Active Trips" action="New Trip" onAction → `/trips/new`
   - Column header row: TRIP ID / ORDER / DRIVER · HORSE / ROUTE / PROGRESS / STATUS (matching reference widths)
   - `ChecklistRow` per trip — update to flat table-row layout (see §4.1a)

#### 4.1a `ChecklistRow` update
**File:** `frontend/dispatcher/components/domain/ChecklistRow.tsx`

Change from card/button layout to a flat table row matching the reference `TripRow`:
- `flex items-center gap-3 px-6 py-3 bg-surf-lowest cursor-pointer transition-colors hover:bg-surf-low`
- Columns (fixed widths matching reference): Trip ID (88px, `--sec`, tabular-nums/0.05em), Order (100px, 11px/`--on-surf-v`), Driver+Horse (115px), Route (100px), Progress (flex-1: `MiniTL` dots + hint text), Status chip (90px)
- Exception left border: `border-l-4 border-err` when `open_exception_count > 0`
- Separator: `1px solid outline-v/10` between rows (via `divide-y`)

### 4.2 Trip Detail (`app/(app)/trips/[id]/page.tsx`)

Replace `PageHeader` with `TopBar`:
- title = trip reference
- sub = status chip + precinct names
- right slot: back button

Layout: full-height flex column inside the main content area:
1. `TopBar`
2. Horizontal `HandshakeChain` (full-width, `px-6 py-4 bg-surf-low border-b border-outline-v/20`)
3. `Tabs` (Timeline / Manifest / Exceptions / Blockchain), `px-6 py-0 bg-surf-lowest border-b`
4. Tab content area: `flex-1 overflow-y-auto`
   - **Timeline tab:** `Timeline` component with events list — each event: circle node (done=green/check, active=blue/pulse, warn=amber, pending=outline) + connector line + label/meta/detail/`EvidenceTag`/`ChainTag`
   - **Manifest tab:** `EvidencePacket` per stop
   - **Exceptions tab:** filtered `ExceptionBanner` list for this trip
   - **Blockchain tab:** `BlockchainReceipt` cards
5. Metadata strip below `HandshakeChain` (keep existing 4-card grid for driver/horse/origin/destination) — move above the `Tabs` row, inside `px-6 py-4`

### 4.3 Create Trip (`app/(app)/trips/new/page.tsx`)

Replace `PageHeader`/`PageShell` with `TopBar` (title "New Trip").

Two-column layout `flex gap-6 p-6 flex-1 overflow-auto`:
- **Left (form, flex-1):** sections in `Card` components with `SecHead` per section — Order lookup, Driver/Vehicle selects, Precinct selects, slot times
- **Right (preview, 320px):** sticky summary card updating as form fills

### 4.4 Trip History (`app/(app)/history/page.tsx`)

Replace `PageHeader`/`PageShell` with `TopBar` (title "Trip History").

Toolbar: `DateRangePicker` + search `Input` + filter chips in `px-6 py-4 bg-surf-low border-b flex gap-3 items-center`.

Trip list: same `r-lg` card + `SecHead` + column header + `ChecklistRow` pattern as dashboard.

### 4.5 SLA Reports (`app/(app)/sla/page.tsx`)

Replace `PageHeader`/`PageShell` with `TopBar` (title "SLA Reports", right slot: "Export PDF" ghost button).

Filter bar: `DateRangePicker` + client select in `px-6 py-4 bg-surf-low border-b`.

Chart grid: `grid grid-cols-2 gap-6 p-6` — 4 `SLAChartCard`s (on-time pickup, on-time delivery, exceptions by type, handshake completion rate).

---

## 5. Ref-less pages (exceptions, fleet, settings)

Apply shell and `TopBar` correction only. No logic changes.

| Page | `TopBar` title |
|---|---|
| `/exceptions` | "Exceptions" |
| `/exceptions/[id]` | "Exception Detail" |
| `/fleet/vehicles` | "Fleet — Vehicles" |
| `/fleet/drivers` | "Fleet — Drivers" |
| `/settings` | "Settings" |

Each page: remove `PageShell`/`PageHeader` wrapper, add `TopBar` at top of return. Keep all existing content below unchanged.

---

## 6. Files changed / created

### Create
- `frontend/dispatcher/components/ui/TopBar.tsx`
- `frontend/dispatcher/components/ui/StatCard.tsx`
- `frontend/dispatcher/components/ui/SecHead.tsx`

### Modify
- `frontend/dispatcher/components/layout/DispatcherShell.tsx`
- `frontend/dispatcher/components/layout/Sidebar.tsx`
- `frontend/dispatcher/components/domain/ChecklistRow.tsx`
- `frontend/dispatcher/app/(app)/page.tsx`
- `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`
- `frontend/dispatcher/app/(app)/trips/new/page.tsx`
- `frontend/dispatcher/app/(app)/history/page.tsx`
- `frontend/dispatcher/app/(app)/sla/page.tsx`
- `frontend/dispatcher/app/(app)/exceptions/page.tsx`
- `frontend/dispatcher/app/(app)/exceptions/[id]/page.tsx`
- `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`
- `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`
- `frontend/dispatcher/app/(app)/settings/page.tsx`

### Keep unchanged
- `frontend/dispatcher/components/layout/PageHeader.tsx` — retained, just no longer used on redesigned pages
- `frontend/dispatcher/components/layout/PageShell.tsx` — retained
- All `components/ui/` primitives not listed above
- All `components/domain/` except `ChecklistRow`
- All `lib/` files

---

## 7. Constraints

- No raw hex in component code — all colours via Tailwind token classes or the one allowed inline style (Button primary gradient)
- No `any` in TypeScript
- `"use client"` only where state/hooks require it — `TopBar`, `StatCard`, `SecHead` are server components (no state)
- Reference HTML files are the visual truth for pages 4.1–4.5; spec §5.1–5.3 is the truth for primitives
- Do not touch `driver-pwa/` or `frontend/shared/`
