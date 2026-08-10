# Driver PWA Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `frontend/driver-pwa/` up to the dispatcher design system (matching `docs/references/driver-*.html`), add a navigation shell (drawer nav + profile panel), a Trips list with Active/Upcoming/Past tabs, and real motion/feedback via framer-motion.

**Architecture:** Foundation-first — token migration → trip-filtering logic (tested) → shared primitive motion polish → new nav/profile components → new pages (Settings, Trips list, Home). Because every H1–H5 handshake step component already composes `GpsCapture`, `HoldButton`, `CameraCapture`, and `SealInput` rather than duplicating styling, upgrading those five shared files cascades the visual/motion fix to all 17 step screens without per-file edits.

**Tech Stack:** Next.js 15 App Router, TypeScript 5.5, Tailwind v3.4, React 19, framer-motion (new), vitest + @testing-library/react.

**Key constraints (read before touching any file):**
- Do not touch `frontend/dispatcher/` or any backend file.
- `frontend/shared/lib/mocks/trips.ts` gets exactly one additive change (Task 4) — a new mock trip record, no type changes. This is a shared file; flag it in the final report.
- `"use client"` only where state/hooks are required.
- After every task: run `cd frontend/driver-pwa && npx tsc --noEmit` and fix any type errors before committing.
- Respect `prefers-reduced-motion` — already handled globally in `app/globals.css`; framer-motion components must use `useReducedMotion()` to skip non-essential animation.

---

## File map

| Action | File |
|---|---|
| Modify | `frontend/driver-pwa/tailwind.config.ts` |
| Modify | `frontend/driver-pwa/package.json` |
| **Create** | `frontend/driver-pwa/lib/utils/trip-filters.ts` |
| **Create** | `frontend/driver-pwa/lib/utils/__tests__/trip-filters.test.ts` |
| Modify | `frontend/shared/lib/mocks/trips.ts` |
| Modify | `frontend/driver-pwa/components/handshake/GpsCapture.tsx` |
| Modify | `frontend/driver-pwa/components/handshake/HoldButton.tsx` |
| Modify | `frontend/driver-pwa/components/handshake/CameraCapture.tsx` |
| Modify | `frontend/driver-pwa/components/ui/Toast.tsx` |
| **Create** | `frontend/driver-pwa/components/layout/NavDrawer.tsx` |
| **Create** | `frontend/driver-pwa/components/layout/ProfilePanel.tsx` |
| **Create** | `frontend/driver-pwa/components/layout/AppShell.tsx` |
| **Create** | `frontend/driver-pwa/lib/constants/app.ts` |
| **Create** | `frontend/driver-pwa/lib/utils/trip-status-chip.ts` |
| Modify | `frontend/driver-pwa/app/(app)/layout.tsx` |
| **Create** | `frontend/driver-pwa/app/(app)/settings/page.tsx` |
| Modify | `frontend/driver-pwa/app/(app)/trips/page.tsx` |
| Modify | `frontend/driver-pwa/app/page.tsx` |
| Modify | `frontend/driver-pwa/app/(app)/trips/[id]/ActiveTripPageClient.tsx` |
| Modify | `frontend/driver-pwa/app/(app)/trip/[id]/in-transit/InTransitPageClient.tsx` |

---

## Task 1 — Tailwind token migration

**Files:**
- Modify: `frontend/driver-pwa/tailwind.config.ts`

Port the shorthand tokens from `frontend/dispatcher/tailwind.config.ts` (already migrated, matches `docs/references/driver-*.html`'s CSS vars exactly). Keep every existing class name driver-pwa already uses (`bg-primary`, `text-surface-on-variant`, `bg-secondary-fixed`, etc.) working via backwards-compat aliases, so no other file needs to change for colors/radii to update everywhere at once.

- [ ] **Step 1: Replace the file**

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Design-system shorthand tokens — mirror CSS variable names exactly ──
        canvas:       '#0a0a0c',
        surf:         '#fcf8f9',
        'surf-low':   '#f6f3f4',
        'surf-lowest':'#ffffff',
        'surf-high':  '#e5e2e3',
        'on-surf':    '#1b1b1c',
        'on-surf-v':  '#46464f',

        sec:   { DEFAULT: '#0051d5', c: '#d8e2ff', on: '#ffffff', onc: '#001551' },
        ok:    { DEFAULT: '#006c4c', c: '#89f8c7', on: '#ffffff', onc: '#002114' },
        err:   { DEFAULT: '#ba1a1a', c: '#ffdad6', on: '#ffffff', onc: '#410002' },
        warn:  { DEFAULT: '#805600', c: '#ffb95f', on: '#ffffff', onc: '#2b1700' },
        chain: { DEFAULT: '#006874', c: '#97f0ff', on: '#ffffff', onc: '#001f24' },

        outline: {
          DEFAULT: '#777680',
          v:       '#c7c6ca',
          variant: '#c7c6ca',   // backwards-compat alias used by existing components
        },

        // ── Semantic tokens — backwards-compat names with corrected hex values ──
        // Match the shorthand tokens above; kept so existing class names work
        // during the migration. New components should use the shorthand tokens.
        primary: {
          DEFAULT:       '#1b1b1c',   // was #000000 — now matches --primary
          container:     '#303031',
          on:            '#ffffff',
          'on-container':'rgba(255,255,255,0.45)',
        },
        secondary: {
          DEFAULT:       '#0051d5',
          container:     '#d8e2ff',   // was #316bf3
          on:            '#ffffff',
          'on-container':'#001551',   // was #fefcff
          fixed:         '#d8e2ff',
          'fixed-dim':   '#b4c5ff',
        },
        tertiary: {
          DEFAULT:       '#805600',   // was #b87500
          container:     '#ffb95f',   // was #ffddb8
          on:            '#ffffff',
          'on-container':'#2b1700',
          'fixed-dim':   '#ffb95f',
        },
        success: {
          DEFAULT:       '#006c4c',   // was #1a7c3e
          container:     '#89f8c7',   // was #c8f2d9
          on:            '#ffffff',
          'on-container':'#002114',   // was #0a3d1f
        },
        error: {
          DEFAULT:       '#ba1a1a',
          container:     '#ffdad6',
          on:            '#ffffff',
          'on-container':'#410002',
        },
        surface: {
          DEFAULT:            '#fcf8f9',
          'container-lowest': '#ffffff',
          'container-low':    '#f6f3f4',
          container:          '#f0edee',
          'container-high':   '#e5e2e3',   // was #eae7e8
          'container-highest':'#e5e2e3',
          dim:                '#dcd9da',
          on:                 '#1b1b1c',
          'on-variant':       '#46464f',
        },
      },

      fontFamily: {
        sans:     ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono:     ['var(--font-inter)', 'system-ui', 'sans-serif'],
        headline: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display:  ['var(--font-inter)', 'system-ui', 'sans-serif'],
        body:     ['var(--font-inter)', 'system-ui', 'sans-serif'],
        label:    ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },

      borderRadius: {
        none:    '0px',
        sm:      '3px',
        DEFAULT: '3px',
        md:      '6px',
        lg:      '10px',
        xl:      '14px',
        '2xl':   '24px',
        full:    '9999px',
      },

      boxShadow: {
        'level-1': '0 1px 0 rgba(27,27,28,0.06)',
        'level-2': '0 2px 8px rgba(27,27,28,0.04)',
        'level-3': '0 2px 12px rgba(27,27,28,0.06)',
        'level-4': '0 2px 16px rgba(27,27,28,0.08)',
        'level-5': '0 8px 32px rgba(27,27,28,0.18)',
        'level-6': '0 16px 64px rgba(0,0,0,0.5)',
        // Backwards-compat aliases
        'ambient-sm':     '0 4px 20px rgba(27,27,28,0.06)',
        'ambient':        '0 8px 40px rgba(27,27,28,0.06)',
        'ambient-header': '0 8px 30px rgba(0,0,0,0.06)',
        'ambient-up':     '0 -4px 24px rgba(0,0,0,0.06)',
        'ambient-up-lg':  '0 -8px 40px rgba(0,0,0,0.08)',
      },

      zIndex: {
        raised:  '10',
        sticky:  '20',
        overlay: '40',
        modal:   '60',
        toast:   '80',
        panic:   '100',
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors (this is a Tailwind config change only — no TS types affected — this just confirms nothing else broke first).

- [ ] **Step 3: Visual smoke check**

```bash
cd frontend/driver-pwa && npm run dev
```
Open `/dev/tokens` in the browser. Confirm colors render (blue secondary, green success, no black-primary regression) and corners are visibly rounder (`rounded-xl` now 14px, was 8px).

- [ ] **Step 4: Commit**

> **Suggested commit:** `style(driver-pwa): migrate tailwind tokens to match dispatcher design system`

---

## Task 2 — Add framer-motion dependency

**Files:**
- Modify: `frontend/driver-pwa/package.json`

- [ ] **Step 1: Install**

```bash
cd frontend/driver-pwa && npm install framer-motion@^11.0.0
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors. Confirm `"framer-motion": "^11.0.0"` now appears under `dependencies` in `package.json`.

- [ ] **Step 3: Commit**

> **Suggested commit:** `chore(driver-pwa): add framer-motion for capture/transition feedback`

---

## Task 3 — Trip-filtering utility (tested)

**Files:**
- Create: `frontend/driver-pwa/lib/utils/trip-filters.ts`
- Create: `frontend/driver-pwa/lib/utils/__tests__/trip-filters.test.ts`

Pure functions the new Trips list (Task 14) and Home page (Task 15) both depend on. Written and tested before any UI consumes them.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/driver-pwa/lib/utils/__tests__/trip-filters.test.ts
import { describe, it, expect } from 'vitest'
import { tripsForDriver, categorizeTrips, filterPastTrips } from '../trip-filters'
import type { Trip, TripId } from '@shared/lib/types/trip'
import type { DriverId } from '@shared/lib/types/driver'

const driverA = 'driver-a' as DriverId
const driverB = 'driver-b' as DriverId

function makeTrip(overrides: Partial<Trip>): Trip {
  return {
    id: 'trip-1' as TripId,
    trip_reference: 'TRP-TEST-0001',
    order_number: 'ORD-0001',
    status: 'created',
    journey_lock_hash: null,
    idvs_check_status: 'pending',
    origin_precinct_id: 'origin-1',
    destination_precinct_id: 'dest-1',
    pulsit_trip_reference_id: null,
    planned_departure_at: '2026-06-20T08:00:00Z',
    actual_departure_at: null,
    planned_arrival_at: null,
    actual_arrival_at: null,
    closed_at: null,
    driver: null,
    horse: null,
    trailers: [],
    handshakes: [],
    exceptions: [],
    blockchain_receipts: [],
    created_at: '2026-06-20T07:00:00Z',
    updated_at: '2026-06-20T07:00:00Z',
    ...overrides,
  }
}

describe('tripsForDriver', () => {
  it('returns only trips belonging to the given driver id', () => {
    const trips = [
      makeTrip({ id: 't1' as TripId, driver: { id: driverA } as Trip['driver'] }),
      makeTrip({ id: 't2' as TripId, driver: { id: driverB } as Trip['driver'] }),
    ]

    const result = tripsForDriver(trips, driverA)

    expect(result.map((t) => t.id)).toEqual(['t1'])
  })
})

describe('categorizeTrips', () => {
  it('puts non-terminal, non-created trips in active', () => {
    const trips = [makeTrip({ id: 't1' as TripId, status: 'in_transit' })]

    const { active } = categorizeTrips(trips)

    expect(active.map((t) => t.id)).toEqual(['t1'])
  })

  it('puts created trips in upcoming', () => {
    const trips = [makeTrip({ id: 't1' as TripId, status: 'created' })]

    const { upcoming } = categorizeTrips(trips)

    expect(upcoming.map((t) => t.id)).toEqual(['t1'])
  })

  it('puts closed and cancelled trips in past', () => {
    const trips = [
      makeTrip({ id: 't1' as TripId, status: 'closed' }),
      makeTrip({ id: 't2' as TripId, status: 'cancelled' }),
    ]

    const { past } = categorizeTrips(trips)

    expect(past.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })
})

describe('filterPastTrips', () => {
  const trips = [
    makeTrip({
      id: 't1' as TripId, status: 'closed',
      origin_precinct_id: 'jhb', destination_precinct_id: 'dbn',
      actual_arrival_at: '2026-06-10T10:00:00Z',
    }),
    makeTrip({
      id: 't2' as TripId, status: 'closed',
      origin_precinct_id: 'ct', destination_precinct_id: 'jhb',
      actual_arrival_at: '2026-06-15T10:00:00Z',
    }),
  ]

  it('filters by date range using actual_arrival_at', () => {
    const result = filterPastTrips(trips, { dateFrom: '2026-06-12', dateTo: '2026-06-20', search: '' })

    expect(result.map((t) => t.id)).toEqual(['t2'])
  })

  it('filters by origin/destination search, case-insensitive', () => {
    const result = filterPastTrips(trips, { dateFrom: null, dateTo: null, search: 'JHB' })

    expect(result.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('returns all trips when no filters are set', () => {
    const result = filterPastTrips(trips, { dateFrom: null, dateTo: null, search: '' })

    expect(result).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend/driver-pwa && npx vitest run lib/utils/__tests__/trip-filters.test.ts
```
Expected: FAIL — `Cannot find module '../trip-filters'`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/driver-pwa/lib/utils/trip-filters.ts
import type { Trip } from '@shared/lib/types/trip'
import type { DriverId } from '@shared/lib/types/driver'

// "Active" here is a display grouping only — it reflects the existing
// TripStatus state machine (a driver has at most one non-terminal,
// non-'created' trip at a time in practice). No new enforcement is added.
const TERMINAL_STATUSES: Trip['status'][] = ['closed', 'cancelled']

export function tripsForDriver(trips: Trip[], driverId: DriverId): Trip[] {
  return trips.filter((t) => t.driver?.id === driverId)
}

export interface CategorizedTrips {
  active: Trip[]
  upcoming: Trip[]
  past: Trip[]
}

export function categorizeTrips(trips: Trip[]): CategorizedTrips {
  const active: Trip[] = []
  const upcoming: Trip[] = []
  const past: Trip[] = []

  for (const trip of trips) {
    if (TERMINAL_STATUSES.includes(trip.status)) {
      past.push(trip)
    } else if (trip.status === 'created') {
      upcoming.push(trip)
    } else {
      active.push(trip)
    }
  }

  return { active, upcoming, past }
}

export interface PastTripFilters {
  dateFrom: string | null   // ISO date, inclusive
  dateTo: string | null     // ISO date, inclusive
  search: string            // matches origin/destination precinct id, case-insensitive
}

export function filterPastTrips(trips: Trip[], filters: PastTripFilters): Trip[] {
  return trips.filter((trip) => {
    const reference = trip.actual_arrival_at ?? trip.planned_arrival_at
    if (filters.dateFrom && (!reference || reference < filters.dateFrom)) return false
    if (filters.dateTo && (!reference || reference > `${filters.dateTo}T23:59:59Z`)) return false

    if (filters.search.trim() !== '') {
      const needle = filters.search.trim().toLowerCase()
      const haystack = `${trip.origin_precinct_id} ${trip.destination_precinct_id}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }

    return true
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend/driver-pwa && npx vitest run lib/utils/__tests__/trip-filters.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify types**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/driver-pwa/lib/utils/trip-filters.ts frontend/driver-pwa/lib/utils/__tests__/trip-filters.test.ts
git commit -m "feat(driver-pwa): add tested trip categorization and filtering utilities"
```

---

## Task 4 — Add one "upcoming" mock trip (shared file — flag this)

**Files:**
- Modify: `frontend/shared/lib/mocks/trips.ts`

`mockDrivers[0]` (Sipho Dlamini) is the demo-mode logged-in driver (`AuthContext.tsx`). Currently his only trips are `TRP-2026-0035` (`closed`) and `TRP-2026-0041` (`in_transit`) — there is no `created`-status trip for him, so the new Upcoming tab (Task 14) would always render empty for the demo account. Add one new trip record, following the existing pattern exactly. **This is additive only — no type changes, no existing record touched** — but it is a `frontend/shared/` file other devs' branches may also touch; flag in the final report per CLAUDE.md.

- [ ] **Step 1: Read the file's existing ID-declaration block and trip array tail**

```bash
sed -n '1,20p;690,700p' frontend/shared/lib/mocks/trips.ts
```

- [ ] **Step 2: Add a new trip ID constant**

Add after the existing `TRIP_0042_ID` declaration near the top of the file:

```ts
export const TRIP_0043_ID = tripId('3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b')
```

- [ ] **Step 3: Add the new trip record**

Add at the end of the `mockTrips` array (after the `TRP-2026-0042` entry, before the closing `]`):

```ts
  // TRP-2026-0043 — created, not yet started (upcoming for Dlamini)
  {
    id: TRIP_0043_ID,
    trip_reference: 'TRP-2026-0043',
    order_number: 'FX-ORD-2026-0043',
    status: 'created',
    journey_lock_hash: null,
    idvs_check_status: 'pending',
    origin_precinct_id: PRECINCT_FEDEX_JHB_ID,
    destination_precinct_id: PRECINCT_FEDEX_DBN_ID,
    pulsit_trip_reference_id: null,
    planned_departure_at: '2026-06-25T07:00:00Z',
    actual_departure_at: null,
    planned_arrival_at: '2026-06-25T16:00:00Z',
    actual_arrival_at: null,
    closed_at: null,
    driver: mockDrivers.find(d => d.id === DRIVER_DLAMINI_ID) ?? null,
    horse: mockHorses.find(h => h.id === HORSE_1_ID) ?? null,
    trailers: mockTrailers.filter(t => t.id === TRAILER_2_ID),
    handshakes: [],
    exceptions: [],
    blockchain_receipts: [],
    created_at: '2026-06-22T09:00:00Z',
    updated_at: '2026-06-22T09:00:00Z',
  },
```

- [ ] **Step 4: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
cd ../dispatcher && npx tsc --noEmit
```
Expected: no errors in either app (confirms the addition didn't break dispatcher, which also reads `mockTrips`).

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/lib/mocks/trips.ts
git commit -m "test(shared): add upcoming mock trip for driver-pwa Upcoming tab demo data"
```

---

## Task 5 — GpsCapture motion polish

**Files:**
- Modify: `frontend/driver-pwa/components/handshake/GpsCapture.tsx`

Add a pulsing ring on the satellite icon while acquiring (mirrors the reference HTML's `.pulse` keyframe) and a scale-in on the success state, respecting reduced motion.

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { MapPin } from 'lucide-react'
import { useLocation } from '@/lib/hooks/useLocation'
import { Button } from '@/components/ui/Button'

interface GpsCaptureProps {
  onCapture: (lat: number, lng: number) => void
  captured: boolean   // true if draft already has coords
}

export function GpsCapture({ onCapture, captured }: GpsCaptureProps) {
  const { status, capture } = useLocation()
  const reduceMotion = useReducedMotion()

  async function handleCapture() {
    const result = await capture()
    if (result) onCapture(result.latitude, result.longitude)
  }

  if (captured) {
    return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3"
      >
        <MapPin className="h-5 w-5 text-success" strokeWidth={2} aria-hidden />
        <p className="text-sm font-medium text-success">Location captured</p>
      </motion.div>
    )
  }

  return (
    <div className="relative">
      {status === 'capturing' && !reduceMotion && (
        <motion.span
          aria-hidden
          className="absolute left-4 top-1/2 -mt-2 h-4 w-4 rounded-full bg-secondary/40"
          animate={{ scale: [1, 2.2, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <Button
        onClick={handleCapture}
        loading={status === 'capturing'}
        disabled={status === 'capturing'}
        variant="secondary"
        size="lg"
      >
        {status === 'error' ? 'Retry GPS' : 'Capture GPS Location'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(driver-pwa): add GPS acquiring pulse and success transition`

---

## Task 6 — HoldButton completion flourish

**Files:**
- Modify: `frontend/driver-pwa/components/handshake/HoldButton.tsx`

On confirm, scale up briefly before calling `onConfirm` so the action visibly registers — currently `onConfirm` fires with no feedback beyond the ring completing.

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import { useState, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useHoldToConfirm } from '@/lib/hooks/useHoldToConfirm'
import { cn } from '@shared/lib/utils/cn'

interface HoldButtonProps {
  label: string
  durationMs?: number
  onConfirm: () => void
  disabled?: boolean
  variant?: 'primary' | 'danger'
}

export function HoldButton({
  label,
  durationMs = 2000,
  onConfirm,
  disabled = false,
  variant = 'primary',
}: HoldButtonProps) {
  const [justConfirmed, setJustConfirmed] = useState(false)
  const reduceMotion = useReducedMotion()

  const handleConfirm = useCallback(() => {
    setJustConfirmed(true)
    // Let the flourish play before handing off — 180ms matches the scale transition below.
    setTimeout(() => {
      setJustConfirmed(false)
      onConfirm()
    }, reduceMotion ? 0 : 180)
  }, [onConfirm, reduceMotion])

  const { isPressing, progress, onPressStart, onPressEnd } = useHoldToConfirm(
    durationMs,
    handleConfirm,
  )

  const circumference = 2 * Math.PI * 26  // r=26
  const strokeDashoffset = circumference * (1 - progress)

  return (
    <motion.button
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      disabled={disabled}
      animate={justConfirmed ? { scale: [1, 1.15, 1] } : { scale: 1 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn(
        'relative flex h-20 w-20 items-center justify-center rounded-full',
        'select-none touch-none transition-opacity disabled:opacity-40',
        variant === 'primary' ? 'bg-primary' : 'bg-error',
      )}
    >
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="26" fill="none" stroke="white" strokeOpacity={0.2} strokeWidth="4" />
        {isPressing && (
          <circle
            cx="30" cy="30" r="26"
            fill="none" stroke="white" strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className="relative z-10 text-center text-xs font-bold uppercase tracking-wider text-white leading-tight px-2">
        {justConfirmed ? 'Confirmed' : isPressing ? 'Hold…' : label}
      </span>
    </motion.button>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(driver-pwa): add HoldButton confirmation flourish`

---

## Task 7 — CameraCapture transition

**Files:**
- Modify: `frontend/driver-pwa/components/handshake/CameraCapture.tsx`

Animate the swap from the empty dashed capture box to the captured photo instead of an instant DOM swap.

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import { useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Camera as CameraIcon } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

interface CameraCaptureProps {
  label: string
  dataUrl: string | null
  onCapture: (dataUrl: string) => void
}

export function CameraCapture({ label, dataUrl, onCapture }: CameraCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false)
  const reduceMotion = useReducedMotion()

  const handleCapture = useCallback(async () => {
    setIsCapturing(true)
    try {
      if (Capacitor.isNativePlatform()) {
        const photo = await Camera.getPhoto({
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera,
          quality: 70,
        })
        if (photo.dataUrl) onCapture(photo.dataUrl)
      } else {
        // Browser fallback: file input with environment camera hint
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.capture = 'environment'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') onCapture(reader.result)
          }
          reader.readAsDataURL(file)
        }
        input.click()
      }
    } finally {
      setIsCapturing(false)
    }
  }, [onCapture])

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <AnimatePresence mode="wait" initial={false}>
        {dataUrl ? (
          <motion.div
            key="captured"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative rounded-xl overflow-hidden"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt={label} className="w-full max-h-48 object-cover" />
            <button
              onClick={handleCapture}
              className="absolute bottom-2 right-2 rounded-full bg-surface-container-highest/90 px-3 py-1 text-xs font-medium"
            >
              Retake
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="empty"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={handleCapture}
            disabled={isCapturing}
            className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low text-sm text-surface-on-variant disabled:opacity-60"
          >
            <CameraIcon className="h-6 w-6" strokeWidth={1.5} aria-hidden />
            {isCapturing ? 'Opening camera…' : 'Tap to photograph'}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(driver-pwa): animate CameraCapture capture/retake transition`

---

## Task 8 — Toast enter/exit animation

**Files:**
- Modify: `frontend/driver-pwa/components/ui/Toast.tsx`

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import { useEffect, type ReactNode } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { X, CheckCircle2, AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastData {
  id: string
  kind: ToastKind
  title: string
  body?: string
  sticky?: boolean
}

interface ToastItemProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

const kindConfig: Record<ToastKind, { icon: ReactNode; accent: string; role: 'status' | 'alert' }> = {
  info:    { icon: <Info className="w-4 h-4 text-secondary shrink-0" />,       accent: 'border-secondary/20',  role: 'status' },
  success: { icon: <CheckCircle2 className="w-4 h-4 text-success shrink-0" />, accent: 'border-success/20',   role: 'status' },
  warning: { icon: <AlertTriangle className="w-4 h-4 text-tertiary shrink-0" />, accent: 'border-tertiary/20', role: 'status' },
  error:   { icon: <ShieldAlert className="w-4 h-4 text-error shrink-0" />,    accent: 'border-error/20',      role: 'alert'  },
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const { icon, accent, role } = kindConfig[toast.kind]
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (toast.sticky || toast.kind === 'error') return
    const timer = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast, onDismiss])

  return (
    <motion.div
      role={role}
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'flex items-start gap-3 w-full max-w-sm px-4 py-3 pr-3',
        'bg-surface-container-lowest rounded-xl shadow-ambient',
        'border border-outline-variant/20',
        accent,
      )}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-surface-on">{toast.title}</p>
        {toast.body && <p className="text-xs text-surface-on-variant mt-0.5 leading-relaxed">{toast.body}</p>}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="w-6 h-6 flex items-center justify-center rounded-lg text-surface-on-variant hover:bg-surface-container-low shrink-0 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  )
}

interface ToastViewportProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

// Render once inside ToastProvider. Consumers call useToast().notify() — never render this directly.
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-6 right-6 z-[80] flex flex-col gap-3 items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.slice(0, 3).map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(driver-pwa): animate toast enter/exit`

---

## Task 9 — Trip status → Chip kind mapping helper

**Files:**
- Create: `frontend/driver-pwa/lib/utils/trip-status-chip.ts`

`TRIP_STATUS_META` (in `@shared/lib/constants/status-meta`) uses a `ChipType` (`'transit'|'loading'|'complete'|'exception'|'critical'|'pending'`) that doesn't match driver-pwa's own `Chip` component, which takes `ChipKind` (`'verified'|'success'|'warning'|'error'|'pending'|'neutral'|'overridden'|'info'`). Needed by Task 14 (Trips list) and Task 15 (Home) to render a status chip without changing `Chip.tsx`'s prop contract (which is used by every handshake step screen).

- [ ] **Step 1: Write the file**

```ts
// frontend/driver-pwa/lib/utils/trip-status-chip.ts
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import type { TripStatus } from '@shared/lib/types/trip'
import type { ChipKind } from '@/components/ui/Chip'

const CHIP_TYPE_TO_KIND: Record<string, ChipKind> = {
  pending:   'pending',
  transit:   'info',
  loading:   'info',
  complete:  'success',
  exception: 'warning',
  critical:  'error',
}

export function tripStatusChip(status: TripStatus): { kind: ChipKind; label: string } {
  const meta = TRIP_STATUS_META[status]
  return { kind: CHIP_TYPE_TO_KIND[meta.chipType] ?? 'neutral', label: meta.label }
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/driver-pwa/lib/utils/trip-status-chip.ts
git commit -m "feat(driver-pwa): add trip status to Chip kind mapping helper"
```

---

## Task 10 — NavDrawer component

**Files:**
- Create: `frontend/driver-pwa/components/layout/NavDrawer.tsx`

Reuses the existing `Drawer` primitive (`components/ui/Drawer.tsx`, side="left") rather than building new slide-over mechanics.

- [ ] **Step 1: Write the file**

```tsx
'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Home, Truck, Settings } from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'

interface NavDrawerProps {
  open: boolean
  onClose: () => void
}

const NAV_ITEMS = [
  { label: 'Home',  href: ROUTES.home,     icon: Home },
  { label: 'Trips', href: ROUTES.trips,    icon: Truck },
  { label: 'Settings', href: ROUTES.settings, icon: Settings },
] as const

export function NavDrawer({ open, onClose }: NavDrawerProps) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <Drawer open={open} onClose={onClose} side="left" title="FreightProof">
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <button
              key={href}
              onClick={() => { router.push(href); onClose() }}
              className={cn(
                'flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors',
                isActive
                  ? 'bg-secondary/10 text-secondary'
                  : 'text-surface-on-variant hover:bg-surface-container-low',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          )
        })}
      </nav>
    </Drawer>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(driver-pwa): add nav drawer with Home/Trips/Settings`

---

## Task 11 — ProfilePanel component

**Files:**
- Create: `frontend/driver-pwa/components/layout/ProfilePanel.tsx`

Shows driver identity, assigned vehicle (from the active trip if one exists), and a trip-count stat — no distance/odometer stat, since `Trip`/`TripSummary` have no distance field in `@shared/lib/types/trip.ts` (would require inventing data not in the schema). Side="right" `Drawer`.

- [ ] **Step 1: Write the file**

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { LogOut, Phone, Truck as TruckIcon } from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/hooks/useAuth'
import { mockTrips } from '@shared/lib/mocks/trips'
import { tripsForDriver, categorizeTrips } from '@/lib/utils/trip-filters'
import { ROUTES } from '@/lib/constants/routes'

interface ProfilePanelProps {
  open: boolean
  onClose: () => void
}

export function ProfilePanel({ open, onClose }: ProfilePanelProps) {
  const { user, signOut } = useAuth()
  const router = useRouter()

  if (!user) return null

  const driverTrips = tripsForDriver(mockTrips, user.id)
  const { active, past } = categorizeTrips(driverTrips)
  const currentVehicle = active[0]?.horse ?? null

  async function handleLogout() {
    await signOut()
    onClose()
    router.replace(ROUTES.login)
  }

  return (
    <Drawer open={open} onClose={onClose} side="right" title="Driver Profile">
      <div className="flex flex-col gap-6">
        <div>
          <p className="text-lg font-bold text-surface-on">{user.full_name}</p>
          <p className="text-sm text-surface-on-variant">License {user.license_number}</p>
        </div>

        <div className="flex items-center gap-2 text-sm text-surface-on-variant">
          <Phone className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {user.phone_number}
        </div>

        <div className="flex items-center gap-2 text-sm text-surface-on-variant">
          <TruckIcon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {currentVehicle ? `${currentVehicle.registration} (${currentVehicle.make ?? 'Horse'})` : 'No vehicle assigned to an active trip'}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-2xl font-extrabold text-surface-on">{past.length}</p>
            <p className="text-xs text-surface-on-variant mt-1">Trips completed</p>
          </div>
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-2xl font-extrabold text-surface-on">{driverTrips.length}</p>
            <p className="text-xs text-surface-on-variant mt-1">Total trips</p>
          </div>
        </div>

        <Button variant="danger" size="md" iconLeft={<LogOut className="h-4 w-4" aria-hidden />} onClick={handleLogout}>
          Log out
        </Button>
      </div>
    </Drawer>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(driver-pwa): add driver profile panel with logout`

---

## Task 12 — AppShell component

**Files:**
- Create: `frontend/driver-pwa/components/layout/AppShell.tsx`

Top bar: hamburger (opens `NavDrawer`) — title — profile icon (opens `ProfilePanel`).

- [ ] **Step 1: Write the file**

```tsx
'use client'

import { useState, type ReactNode } from 'react'
import { Menu, CircleUserRound } from 'lucide-react'
import { NavDrawer } from './NavDrawer'
import { ProfilePanel } from './ProfilePanel'
import { IconButton } from '@/components/ui/IconButton'

interface AppShellProps {
  title?: string
  children: ReactNode
}

export function AppShell({ title = 'FreightProof', children }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-sticky flex h-14 items-center justify-between border-b border-outline-variant/20 bg-surface-container-lowest px-2 shadow-ambient-header">
        <IconButton icon={<Menu className="h-5 w-5" aria-hidden />} aria-label="Open navigation" onClick={() => setNavOpen(true)} />
        <p className="text-sm font-bold text-surface-on">{title}</p>
        <IconButton icon={<CircleUserRound className="h-5 w-5" aria-hidden />} aria-label="Open driver profile" onClick={() => setProfileOpen(true)} />
      </header>

      <div className="flex-1">{children}</div>

      <NavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(driver-pwa): add AppShell top bar wiring nav drawer and profile panel`

---

## Task 13 — Wire AppShell into the app layout

**Files:**
- Modify: `frontend/driver-pwa/app/(app)/layout.tsx:1-30`

- [ ] **Step 1: Replace the file**

```tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { TripProvider } from '@/lib/context/TripContext'
import { AppShell } from '@/components/layout/AppShell'
import { ROUTES } from '@/lib/constants/routes'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useContext(AuthContext)
  const router = useRouter()

  useEffect(() => {
    if (!auth?.isLoading && !auth?.user) {
      router.replace(ROUTES.login)
    }
  }, [auth?.user, auth?.isLoading, router])

  if (auth?.isLoading || !auth?.user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-surface-on-variant">Loading…</p>
      </main>
    )
  }

  return (
    <TripProvider>
      <AppShell>{children}</AppShell>
    </TripProvider>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

> **Suggested commit:** `feat(driver-pwa): wire AppShell into authenticated app layout`

---

## Task 14 — Settings page

**Files:**
- Create: `frontend/driver-pwa/lib/constants/app.ts`
- Create: `frontend/driver-pwa/app/(app)/settings/page.tsx`

Minimal per CLAUDE.md domain rules — driver has no account settings beyond OTP login/logout (logout already lives in `ProfilePanel`, Task 11).

- [ ] **Step 1: Write the constants file**

```ts
// frontend/driver-pwa/lib/constants/app.ts
// Bump together with package.json "version" — not read at build time to avoid
// bundling package.json into the client.
export const APP_VERSION = '0.1.0'

// Placeholder — replace with the real operator support line before production.
export const SUPPORT_PHONE = '+27 11 555 0100'
export const SUPPORT_EMAIL = 'support@freightproof.app'
```

- [ ] **Step 2: Write the page**

```tsx
// frontend/driver-pwa/app/(app)/settings/page.tsx
import { Card } from '@/components/ui/Card'
import { APP_VERSION, SUPPORT_PHONE, SUPPORT_EMAIL } from '@/lib/constants/app'

export default function SettingsPage() {
  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-surface-on">Settings</h1>

      <Card variant="section">
        <p className="text-sm font-medium text-surface-on">Support</p>
        <p className="mt-2 text-sm text-surface-on-variant">{SUPPORT_PHONE}</p>
        <p className="text-sm text-surface-on-variant">{SUPPORT_EMAIL}</p>
      </Card>

      <Card variant="section">
        <p className="text-sm font-medium text-surface-on">About</p>
        <p className="mt-2 text-sm text-surface-on-variant">FreightProof Driver v{APP_VERSION}</p>
      </Card>
    </main>
  )
}
```

- [ ] **Step 3: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/driver-pwa/lib/constants/app.ts "frontend/driver-pwa/app/(app)/settings/page.tsx"
git commit -m "feat(driver-pwa): add minimal settings page"
```

---

## Task 15 — Trips list: Active / Upcoming / Past tabs + filters

**Files:**
- Modify: `frontend/driver-pwa/app/(app)/trips/page.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// frontend/driver-pwa/app/(app)/trips/page.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Inbox } from 'lucide-react'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { Trip } from '@shared/lib/types/trip'
import { ROUTES } from '@/lib/constants/routes'
import { useAuth } from '@/lib/hooks/useAuth'
import { Tabs } from '@/components/ui/Tabs'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { tripsForDriver, categorizeTrips, filterPastTrips } from '@/lib/utils/trip-filters'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'

type TabId = 'active' | 'upcoming' | 'past'

const EMPTY_STATE_COPY: Record<TabId, { title: string; body: string }> = {
  active:   { title: 'No active trip',   body: 'You have no trip in progress right now.' },
  upcoming: { title: 'No upcoming trips', body: 'Your dispatcher hasn’t assigned you a future trip yet.' },
  past:     { title: 'No matching trips', body: 'No past trips match these filters. Try widening the date range or clearing the search.' },
}

function TripCard({ trip, onClick }: { trip: Trip; onClick: () => void }) {
  const { kind, label } = tripStatusChip(trip.status)
  return (
    <Card onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-surface-on">{trip.trip_reference}</p>
          <p className="text-sm text-surface-on-variant">{trip.order_number}</p>
        </div>
        <Chip kind={kind}>{label}</Chip>
      </div>
    </Card>
  )
}

export default function TripsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [tab, setTab] = useState<TabId>('active')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // TODO Iter 2 backend: replace with GET /driver/trips using authenticated session
  const driverTrips = useMemo(
    () => (user ? tripsForDriver(mockTrips, user.id) : []),
    [user],
  )
  const { active, upcoming, past } = useMemo(() => categorizeTrips(driverTrips), [driverTrips])

  const filteredPast = useMemo(
    () => filterPastTrips(past, { dateFrom: dateFrom || null, dateTo: dateTo || null, search }),
    [past, dateFrom, dateTo, search],
  )

  const hasActiveTrip = active.length > 0
  const tripsToShow = tab === 'active' ? active : tab === 'upcoming' ? upcoming : filteredPast

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-surface-on">My Trips</h1>

      <Tabs
        tabs={[
          { id: 'active', label: `Active (${active.length})` },
          { id: 'upcoming', label: `Upcoming (${upcoming.length})` },
          { id: 'past', label: `Past (${past.length})` },
        ]}
        active={tab}
        onChange={(id) => setTab(id as TabId)}
      />

      {tab === 'upcoming' && hasActiveTrip && (
        <p className="rounded-xl bg-tertiary-container px-4 py-3 text-sm text-tertiary-on-container">
          Finish your active trip before starting the next one.
        </p>
      )}

      {tab === 'past' && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="date" label="From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" label="To" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Input label="Origin / destination" placeholder="e.g. JHB" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      {tripsToShow.length === 0 ? (
        <EmptyState
          icon={<Inbox strokeWidth={1.5} aria-hidden />}
          title={EMPTY_STATE_COPY[tab].title}
          body={EMPTY_STATE_COPY[tab].body}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {tripsToShow.map((trip) => (
            <li key={trip.id}>
              <TripCard trip={trip} onClick={() => router.push(ROUTES.tripDetail(String(trip.id)))} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Manual check**

```bash
npm run dev
```
Visit `/trips` logged in as the demo driver. Confirm: Active tab shows `TRP-2026-0041`, Upcoming shows `TRP-2026-0043` (added in Task 4) with the "finish active trip" notice visible, Past shows `TRP-2026-0035` and responds to the date/search filters.

- [ ] **Step 4: Commit**

```bash
git add "frontend/driver-pwa/app/(app)/trips/page.tsx"
git commit -m "feat(driver-pwa): rebuild trips list with active/upcoming/past tabs and filters"
```

---

## Task 16 — Home page (replaces redirect-only root page)

**Files:**
- Modify: `frontend/driver-pwa/app/page.tsx`

`ROUTES.home` (`'/'`) currently only redirects to `/trips` or `/login`. Per the new nav (Task 10), Home is its own destination showing the driver's current active trip (or an empty/upcoming-preview state), matching `docs/references/driver-trip-home.html`'s content focus.

- [ ] **Step 1: Replace the file**

```tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { TripProvider } from '@/lib/context/TripContext'
import { AppShell } from '@/components/layout/AppShell'
import { ROUTES } from '@/lib/constants/routes'
import { HomeContent } from '@/components/home/HomeContent'

export default function RootPage() {
  const auth = useContext(AuthContext)
  const router = useRouter()

  useEffect(() => {
    if (!auth?.isLoading && !auth?.user) {
      router.replace(ROUTES.login)
    }
  }, [auth?.user, auth?.isLoading, router])

  if (auth?.isLoading || !auth?.user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-surface-on-variant">Loading…</p>
      </main>
    )
  }

  return (
    <TripProvider>
      <AppShell>
        <HomeContent />
      </AppShell>
    </TripProvider>
  )
}
```

- [ ] **Step 2: Write the Home content component**

**File:** `frontend/driver-pwa/components/home/HomeContent.tsx` (create)

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { PackageSearch } from 'lucide-react'
import { mockTrips } from '@shared/lib/mocks/trips'
import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { useAuth } from '@/lib/hooks/useAuth'
import { tripsForDriver, categorizeTrips } from '@/lib/utils/trip-filters'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'

const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

export function HomeContent() {
  const router = useRouter()
  const { user } = useAuth()

  if (!user) return null

  // TODO Iter 2 backend: replace with GET /driver/trips using authenticated session
  const driverTrips = tripsForDriver(mockTrips, user.id)
  const { active, upcoming } = categorizeTrips(driverTrips)
  const trip = active[0]

  if (!trip) {
    const next = upcoming[0]
    return (
      <main className="flex min-h-screen flex-col gap-4 p-4">
        <EmptyState
          icon={<PackageSearch strokeWidth={1.5} aria-hidden />}
          title="No active trip right now"
          body={next ? 'Your next trip is below.' : 'Your dispatcher hasn’t assigned you a trip yet.'}
        />
        {next && (
          <Card variant="section" onClick={() => router.push(ROUTES.tripDetail(String(next.id)))}>
            <p className="text-xs uppercase tracking-wider text-surface-on-variant">Next up</p>
            <p className="mt-1 font-semibold text-surface-on">{next.trip_reference}</p>
          </Card>
        )}
      </main>
    )
  }

  const { kind, label } = tripStatusChip(trip.status)

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <div>
        <p className="text-xl font-semibold text-surface-on">{trip.trip_reference}</p>
        <p className="text-sm text-surface-on-variant">{trip.order_number}</p>
      </div>

      <Chip kind={kind} className="self-start">{label}</Chip>

      {trip.status === 'in_transit' && (
        <button
          className="w-full rounded-xl border border-secondary bg-secondary/5 p-3 text-left text-sm font-medium text-secondary"
          onClick={() => router.push(ROUTES.inTransit(String(trip.id)))}
        >
          In-Transit Hub →
        </button>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-surface-on-variant">Handshakes</h2>
        {HANDSHAKE_NUMBERS.map((n) => (
          <Button
            key={n}
            variant="secondary"
            size="lg"
            className="justify-start"
            onClick={() => router.push(ROUTES.handshakeStep(String(trip.id), n, STEP_SLUGS[n][0]))}
          >
            <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
          </Button>
        ))}
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual check**

```bash
npm run dev
```
Visit `/` logged in as the demo driver. Confirm it shows `TRP-2026-0041` (in_transit) with the In-Transit Hub link and 5 handshake buttons — no redirect to `/trips` happens anymore.

- [ ] **Step 5: Commit**

```bash
git add frontend/driver-pwa/app/page.tsx frontend/driver-pwa/components/home/HomeContent.tsx
git commit -m "feat(driver-pwa): give Home its own active-trip view instead of redirecting to Trips"
```

---

## Task 17 — Restyle ActiveTripPageClient (trip detail) with primitives

**Files:**
- Modify: `frontend/driver-pwa/app/(app)/trips/[id]/ActiveTripPageClient.tsx`

This page (reached from a Trips-list card) currently uses raw `<div>`/`<button>` markup instead of `Card`/`Chip`/`Button`. Token migration (Task 1) already fixed its colors, but bare markup is exactly the "shocking" layout complaint — swap to primitives for visual consistency with Home/Trips.

- [ ] **Step 1: Replace the file**

```tsx
// frontend/driver-pwa/app/(app)/trips/[id]/ActiveTripPageClient.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'

const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

export default function ActiveTripPageClient() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // TODO Iter 2 backend: fetch from GET /driver/trips/{id}
  const trip = mockTrips.find((t) => (t.id as string) === id)

  if (!trip) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  const { kind, label } = tripStatusChip(trip.status)

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <button onClick={() => router.push(ROUTES.trips)} className="self-start text-sm text-secondary">
        ← My Trips
      </button>

      <div>
        <h1 className="text-xl font-semibold text-surface-on">{trip.trip_reference}</h1>
        <p className="text-sm text-surface-on-variant">{trip.order_number}</p>
      </div>

      <Card variant="section">
        <p className="mb-2 text-sm font-medium text-surface-on">Status</p>
        <Chip kind={kind}>{label}</Chip>
      </Card>

      {trip.status === 'in_transit' && (
        <Button variant="secondary" size="lg" onClick={() => router.push(ROUTES.inTransit(String(trip.id)))}>
          In-Transit Hub →
        </Button>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-surface-on-variant">Handshakes</h2>
        {HANDSHAKE_NUMBERS.map((n) => (
          <Card key={n} onClick={() => router.push(ROUTES.handshakeStep(String(trip.id), n, STEP_SLUGS[n][0]))}>
            <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
          </Card>
        ))}
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "frontend/driver-pwa/app/(app)/trips/[id]/ActiveTripPageClient.tsx"
git commit -m "style(driver-pwa): rebuild trip detail page with Card/Chip/Button primitives"
```

---

## Task 18 — Restyle in-transit hub with primitives

**Files:**
- Modify: `frontend/driver-pwa/app/(app)/trip/[id]/in-transit/InTransitPageClient.tsx`

Covers the in-transit/panic restyle requested in the spec. `PanicPageClient.tsx` and `PanicSubmittedPageClient.tsx` already compose `HoldButton` and `Button` rather than raw markup, so Task 1 (token migration) and Task 6 (HoldButton flourish) already bring them in line — no separate edit needed there. `InTransitPageClient.tsx` is the one file in this flow still using raw `<section>`/`<div>` cards instead of `Card`/`Chip`; fix that here.

- [ ] **Step 1: Replace the file**

```tsx
// frontend/driver-pwa/app/(app)/trip/[id]/in-transit/InTransitPageClient.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { ArrowRight, ShieldAlert } from 'lucide-react'
import { mockTrips } from '@shared/lib/mocks/trips'
import { ROUTES } from '@/lib/constants/routes'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

export default function InTransitPageClient() {
  const { id: tripId } = useParams<{ id: string }>()
  const router = useRouter()
  const trip = mockTrips.find((t) => (t.id as string) === tripId)

  if (!trip) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  const openExceptions = trip.exceptions.filter((e) => !e.resolved)

  return (
    <main className="min-h-screen flex flex-col">
      <header className="sticky top-0 bg-surface shadow-ambient-header px-4 py-4">
        <button onClick={() => router.push(ROUTES.tripDetail(tripId))} className="mb-1 text-sm text-secondary">
          ← Trip detail
        </button>
        <h1 className="text-xl font-bold">{trip.trip_reference}</h1>
        <p className="text-sm text-surface-on-variant">In Transit</p>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {/* ETA */}
        <Card variant="section">
          <p className="text-xs text-surface-on-variant mb-1">Planned arrival</p>
          <p className="text-base font-semibold text-surface-on">
            {trip.planned_arrival_at
              ? new Date(trip.planned_arrival_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
              : 'Not set'}
          </p>
        </Card>

        {/* Open exceptions */}
        {openExceptions.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-error">
              {openExceptions.length} open exception{openExceptions.length > 1 ? 's' : ''}
            </p>
            {openExceptions.map((exc) => (
              <Card key={exc.id} variant="exception">
                <p className="text-xs font-semibold text-error-on-container capitalize">
                  {exc.exception_type.replace(/_/g, ' ')}
                </p>
                <p className="text-xs text-surface-on-variant mt-0.5 line-clamp-2">{exc.description}</p>
              </Card>
            ))}
          </section>
        )}

        {/* Log exception */}
        <Button
          variant="secondary"
          size="lg"
          onClick={() => router.push(ROUTES.exception(tripId))}
        >
          Log exception
        </Button>

        {/* Begin destination gate-in */}
        <Button
          size="lg"
          iconRight={<ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(ROUTES.handshakeStep(tripId, 4, STEP_SLUGS[4][0]))}
        >
          Arrive at destination
        </Button>

        {/* Panic */}
        <button
          onClick={() => router.push(ROUTES.panic(tripId))}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-error py-4 text-sm font-bold uppercase tracking-widest text-error-on"
        >
          <ShieldAlert className="h-5 w-5" strokeWidth={2} aria-hidden />
          Panic
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "frontend/driver-pwa/app/(app)/trip/[id]/in-transit/InTransitPageClient.tsx"
git commit -m "style(driver-pwa): rebuild in-transit hub ETA/exception cards with Card primitive"
```

---

## Task 19 — Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type check**

```bash
cd frontend/driver-pwa && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 2: Run full test suite**

```bash
cd frontend/driver-pwa && npx vitest run
```
Expected: all tests pass, including the existing `panic/__tests__/page.test.tsx` (untouched by this plan) and the new `trip-filters.test.ts`.

- [ ] **Step 3: Confirm dispatcher unaffected**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors (only `frontend/shared/lib/mocks/trips.ts` was touched outside `driver-pwa/`, and only additively).

- [ ] **Step 4: Manual walkthrough**

```bash
cd frontend/driver-pwa && npm run dev
```
Log in as the demo driver and walk: Home → hamburger → Trips/Settings nav → profile icon → driver details + logout → log back in → Trips list tabs/filters → open the active trip → into an H1 step → confirm GPS pulse, capture transition, and HoldButton flourish all play → trigger a toast (e.g. via an existing exception-logging flow) and confirm it animates in/out.

No commit for this task — it's a checkpoint before declaring the plan complete.

---

## Out of scope reminders (do not implement, even if tempted)

- Enforcing "one active trip" as new backend/orchestration validation — display-only per the spec.
- A `ChainTag`-equivalent component for blockchain-receipt display, mentioned in the spec's primitives section — deferred because no current driver-pwa screen surfaces `blockchain_receipts` to the driver (checked during planning: no step component reads that field). Build it in a follow-up plan if/when a screen needs it — building it speculatively now would be a YAGNI violation.
- Per-file pixel-matching of all 17 H1–H5 step components against their reference HTML — they inherit the fix via Tasks 1, 5–8 since they compose the primitives those tasks change.
