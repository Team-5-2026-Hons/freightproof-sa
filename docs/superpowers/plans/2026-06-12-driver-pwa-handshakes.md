# Driver PWA — Full Handshake Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 20 driver-facing handshake steps (H1–H5), in-transit hub, and panic flow for the FreightProof driver PWA, with offline queuing.

**Architecture:** Step dispatcher at `/trip/[id]/handshake/[h]/step/[slug]` renders step-specific components. Each step writes into `useHandshakeDraft` (localStorage-backed). The final step of each handshake calls `submitHandshake()` (demo: mock response) then navigates via a pure, URL-derived helper (`nextHandshakeRoute`, Task 5b) — **not** TripContext's internal step counter, which desyncs on refresh/deep-link. The backend stays the single authority on whether each handshake is valid; the frontend only collects, displays, and submits evidence. Offline submissions queue in localStorage and flush on reconnect.

**Tech Stack:** Next.js 15 (`output: 'export'`, all pages `"use client"`), TypeScript 5.5+, Tailwind 3.4, `@capacitor/camera`, `@capacitor/geolocation`, vitest (new devDep for hooks), existing: `useHoldToConfirm`, `useLocation`, `TripContext`.

**Parallelisation note:** Tasks 1–6 (including 5b) must run sequentially. Tasks 7–11 are independent of each other and can run in parallel once Task 6 is complete. Tasks 12–13 depend on all screens being done.

---

## Engineering principles (read before any task)

These four rules govern every file in this plan. They are not style preferences — they
keep the app demo-ready, examinable, and safe to hand between four devs.

**1. The backend computes; the frontend only collects, displays, and submits.**
The driver PWA captures evidence (GPS, photos, counts, seal numbers), shows it back for
confirmation, and POSTs it. It performs **no business logic**: no hash computation, no
journey-lock verification, no authoritative "valid/invalid" decision, no anchoring.
Mismatch banners (count ≠ manifest, seal ≠ H2 seal) are **UX hints only** — the backend
is the single authority on whether a handshake is valid and what becomes legal evidence.
If a screen is deciding *truth* rather than *capturing and showing* it, it is wrong.

**2. Navigation is derived from the URL, never from in-memory step state.**
The current route (`/trip/[id]/handshake/[h]/step/[slug]`) is the single source of truth
for "which trip / which step." A refresh or deep-link must land the driver exactly where
the URL says. Do **not** drive flow from `TripContext`'s internal `currentStep` /
`currentHandshake` counters — they reset on load and will desync from the URL. Use the
pure `nextHandshakeRoute()` helper (Task 5b). Resolve the trip by the URL `id` on each
screen, not from `TripContext.trip` (which only ever holds one "active" trip).

**3. Follow the dispatcher portal's design language and the shared design system.**
Use the semantic Tailwind tokens defined in the driver-pwa theme and
`@shared/lib/tokens.ts` — `primary`/`secondary`/`tertiary`/`success`/`error`, the
`surface` container scale, `outline`/`outline-variant`, the radius + `shadow-ambient-*`
scale, and the Inter weight ramp. **Never** use raw Tailwind palette classes
(`text-gray-500`, `text-blue-600`, `bg-white`). Compose existing `components/ui/*`
(`Button`, `Input`, `Card`, `Chip`, `Modal`, `Toast`, `Spinner`, `EmptyState`) rather
than restyling ad hoc. The driver app is the **light, mobile counterpart** of the
dispatcher portal (see `docs/superpowers/specs/2026-05-13-dispatcher-ui-redesign.md` and
`docs/FreightProof_Frontend_Spec_v1.md`): same brand blue (`secondary` `#0051d5`) for
primary actions, same card / border / typographic vocabulary — not the dark sidebar
chrome. This includes migrating the existing `login`, `otp`, and `trips` pages off their
raw gray/blue classes onto tokens as they are touched.

**4. Reusable, maintainable, human-readable code.**
Write code a team member can read and defend at examination. Small,
single-responsibility components; shared primitives over copy-paste (every GPS step uses
`GpsCapture`, every photo step uses `CameraCapture` — the per-handshake screens differ
only in copy and which draft fields they touch). Keep pure logic (navigation, mismatch
checks) in small testable functions separate from presentation. Type every prop; no
`any`. Comment the *why*, not the *what*. No clever one-liners — prefer explicit, obvious
control flow.

---

## Forward-compatibility (do NOT build now — just don't block it)

Iteration 2 deliberately hardcodes a single-client, single-leg flow (FedEx JHB→DBN). That
is correct for the demo. Two seams will need to open later — keep the code shaped so they
*can* open without a rewrite:

1. **Backend-driven step profiles.** Which steps each handshake requires (seal vs no seal,
   per-parcel scan, temperature, document upload) varies by client / route / load. Keep
   the **five-handshake spine fixed** (it is the evidence backbone), but treat
   `@shared/lib/constants/handshake-meta.ts` (`STEP_SLUGS` / `STEP_NAMES` /
   `HANDSHAKE_STEP_COUNTS`) as the **single source** of step definitions. Do not scatter
   step assumptions across components. Later, this table is sourced from a per-trip
   "evidence-requirements profile" the backend supplies (principle 1) — the dispatcher
   already reads from this table, so that becomes a sourcing change, not a redesign.

2. **Multi-stop / multi-leg (Option B, FP-112).** The current flow assumes **one origin**
   (H1–H3) and **one destination** (H4–H5). Multi-stop will repeat the
   gate-in / unload / gate-out cycle per `TripStop`. Don't hardcode "single origin / single
   destination" anywhere beyond the step table — route by `tripId` + handshake + slug only,
   so a future per-stop sequence slots in without touching the step components.

3. **Multiple clients in one truck (consolidated loads).** Load Factor will not send two
   trucks when one has space — a single trip may carry **FedEx and RAM cargo together**.
   The data model already half-points this way (`Consignment` carries its own
   `client_organization_id` and links to a trip), but `Trip.client_organization_id` is
   currently single + required, so today's flow is one-client-per-trip. When this opens, a
   trip holds **N consignments (one per client)**, the journey-lock hash must cover all of
   them, and each client's view must filter to *their* consignment only. Don't bake "one
   client per trip" into the driver UI — key parcel/manifest data off the **consignment**,
   not the trip's single client.

All three are explicitly out of scope here; this note only prevents accidental decisions
that would make them expensive later. See `docs/parcel-traceability.md` for the
parcel-level tracing design these seams feed into.

---

## Scope

**In scope:** Frontend driver PWA only — route structure, shared components, state hooks, H1–H5 screens, in-transit hub, panic flow, offline queue.

**Out of scope (separate plans needed):**
- Backend driver API (`GET /driver/trips`, `PATCH /api/v1/handshakes/{id}`) — demo runs on mock responses
- Simulation harness (`/dev/simulate/[tripId]`, FP-116)

**Blocked (BQ2):** H5 step 4 (`4-pod-photo`) — physical POD photo vs on-device signature pending Bruce confirmation. Implement as a non-blocking placeholder that auto-advances after acknowledging.

---

## File Map

**Create:**
```
app/(app)/layout.tsx
app/(app)/trips/page.tsx                                        (replace app/trips/page.tsx)
app/(app)/trips/[id]/page.tsx                                   (replace app/trips/[id]/page.tsx)
app/(app)/trip/[id]/handshake/[h]/step/[slug]/page.tsx
app/(app)/trip/[id]/in-transit/page.tsx
app/(app)/trip/[id]/in-transit/exception/page.tsx
app/(app)/trip/[id]/panic/page.tsx
app/(app)/trip/[id]/panic/submitted/page.tsx
components/handshake/StepHeader.tsx
components/handshake/HoldButton.tsx
components/handshake/CameraCapture.tsx
components/handshake/GpsCapture.tsx
components/handshake/SealInput.tsx
components/handshake/EvidenceReview.tsx
components/handshake/steps/H1GateArrival.tsx
components/handshake/steps/H1EntryPhoto.tsx
components/handshake/steps/H1Verification.tsx
components/handshake/steps/H2ArriveBay.tsx
components/handshake/steps/H2Manifest.tsx
components/handshake/steps/H2Waybill.tsx
components/handshake/steps/H2Seal.tsx
components/handshake/steps/H2Review.tsx
components/handshake/steps/H3ApproachExit.tsx
components/handshake/steps/H3ExitSeal.tsx
components/handshake/steps/H3Departure.tsx
components/handshake/steps/H4ApproachDest.tsx
components/handshake/steps/H4EntryPhoto.tsx
components/handshake/steps/H4SealVerify.tsx
components/handshake/steps/H5HandWaybill.tsx
components/handshake/steps/H5SealInspection.tsx
components/handshake/steps/H5VisualCount.tsx
components/handshake/steps/H5PodPhoto.tsx           (placeholder — BQ2)
components/handshake/steps/H5Reconciliation.tsx
components/handshake/steps/H5Closed.tsx
lib/types/evidence-draft.ts
lib/hooks/useHandshakeDraft.ts
lib/hooks/useOfflineQueue.ts
lib/api/handshakes.ts
lib/navigation/handshake-flow.ts
lib/mocks/parcel-perfect-manifest.json
vitest.config.ts
vitest.setup.ts
```

**Modify:**
```
lib/hooks/useLocation.ts           (make capture() return Promise<LocationCoords | null>)
lib/constants/routes.ts            (add trips, tripDetail helpers)
app/login/page.tsx                 (drive AuthContext on OTP request; migrate to tokens)
app/otp/page.tsx                   (call AuthContext.signIn so (app) guard sees a user)
package.json                       (add vitest devDeps + test script)
```

**Delete:**
```
app/trips/page.tsx
app/trips/[id]/page.tsx
app/trips/[id]/handshake/[step]/page.tsx
```

---

## Task 1: Test infrastructure + authenticated route group

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `vitest.setup.ts`
- Create: `app/(app)/layout.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Add vitest devDependencies to package.json**

```json
// In package.json, add to "devDependencies":
"vitest": "^2.0.0",
"@vitest/ui": "^2.0.0",
"@testing-library/react": "^16.0.0",
"@testing-library/jest-dom": "^6.4.0",
"jsdom": "^24.0.0",
"@vitejs/plugin-react": "^4.3.0"

// Add to "scripts":
"test": "vitest run",
"test:watch": "vitest"
```

Run: `cd frontend/driver-pwa && npm install`

- [ ] **Step 2: Create vitest.config.ts**

```typescript
// frontend/driver-pwa/vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
})
```

- [ ] **Step 3: Create vitest.setup.ts**

```typescript
// frontend/driver-pwa/vitest.setup.ts
import '@testing-library/jest-dom'
```

- [ ] **Step 4: Create app/(app)/layout.tsx**

```tsx
// frontend/driver-pwa/app/(app)/layout.tsx
'use client'

import { useContext, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { TripProvider } from '@/lib/context/TripContext'
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

  return <TripProvider>{children}</TripProvider>
}
```

- [ ] **Step 5: Update app/page.tsx to redirect based on auth**

```tsx
// frontend/driver-pwa/app/page.tsx
'use client'

import { useContext, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { ROUTES } from '@/lib/constants/routes'

export default function RootPage() {
  const auth = useContext(AuthContext)
  const router = useRouter()

  useEffect(() => {
    if (auth?.isLoading) return
    if (auth?.user) {
      router.replace(ROUTES.trips)
    } else {
      router.replace(ROUTES.login)
    }
  }, [auth?.user, auth?.isLoading, router])

  return null
}
```

- [ ] **Step 5b: Wire login/OTP into AuthContext (so the new guard actually works)**

The `(app)` guard above redirects unless `AuthContext.user` is set, but the existing
`login`/`otp` pages talk to Supabase directly and never populate `AuthContext` — with the
guard in place that causes an immediate bounce back to `/login`. Make `AuthContext` the
single source of truth for the session:

- In `app/login/page.tsx`: in demo mode call `auth.requestOtp(phone)` instead of the raw
  Supabase call, then navigate to `/otp`. Keep the real Supabase path behind
  `NEXT_PUBLIC_DEMO_MODE === 'false'` for later.
- In `app/otp/page.tsx`: on verify, call `auth.signIn({ phone, otp })` (which sets the
  driver on `AuthContext`) **before** `router.replace(ROUTES.trips)`.
- While here, migrate both pages off raw `text-gray-*` / `text-blue-*` / `bg-white` onto
  the design-system tokens (principle 3).

Real Supabase-session → `AuthContext` hydration is a follow-up; demo mode is enough to
unblock the guard now.

---

## Task 2: ROUTES.ts additions + move trips pages into (app) group

**Files:**
- Modify: `lib/constants/routes.ts`
- Create: `app/(app)/trips/page.tsx`
- Create: `app/(app)/trips/[id]/page.tsx`
- Delete: `app/trips/page.tsx`, `app/trips/[id]/page.tsx`, `app/trips/[id]/handshake/[step]/page.tsx`

- [ ] **Step 1: Update lib/constants/routes.ts**

```typescript
// frontend/driver-pwa/lib/constants/routes.ts
export const ROUTES = {
  home:     '/',
  login:    '/login',
  trips:    '/trips',
  settings: '/settings',

  tripDetail: (tripId: string) => `/trips/${tripId}`,

  handshakeStep: (tripId: string, handshake: number, slug: string) =>
    `/trip/${tripId}/handshake/${handshake}/step/${slug}`,

  inTransit:  (tripId: string) => `/trip/${tripId}/in-transit`,
  checkpoint: (tripId: string) => `/trip/${tripId}/in-transit/checkpoint`,
  upload:     (tripId: string) => `/trip/${tripId}/in-transit/upload`,
  exception:  (tripId: string) => `/trip/${tripId}/in-transit/exception`,

  panic:          (tripId: string) => `/trip/${tripId}/panic`,
  panicSubmitted: (tripId: string) => `/trip/${tripId}/panic/submitted`,

  devTokens: '/dev/tokens',
} as const
```

- [ ] **Step 2: Create app/(app)/trips/page.tsx**

```tsx
// frontend/driver-pwa/app/(app)/trips/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { Trip } from '@shared/lib/types/trip'
import { ROUTES } from '@/lib/constants/routes'

export default function TripsPage() {
  const router = useRouter()
  // TODO Iter 2 backend: replace with GET /driver/trips using authenticated session
  const trips: Trip[] = mockTrips

  if (trips.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-surface-on-variant text-sm">No active trips assigned to you.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-4">
      <h1 className="mb-4 text-xl font-semibold">My Trips</h1>
      <ul className="flex flex-col gap-3">
        {trips.map((trip) => (
          <li key={trip.id}>
            <button
              className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-left shadow-ambient-sm"
              onClick={() => router.push(ROUTES.tripDetail(String(trip.id)))}
            >
              <p className="font-semibold">{trip.trip_reference}</p>
              <p className="text-sm text-surface-on-variant">{trip.order_number}</p>
              <span className="mt-1 inline-block rounded-full bg-surface-container-high px-2 py-0.5 text-xs">
                {trip.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

- [ ] **Step 3: Create app/(app)/trips/[id]/page.tsx**

```tsx
// frontend/driver-pwa/app/(app)/trips/[id]/page.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'

const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

export default function ActiveTripPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // TODO Iter 2 backend: fetch from GET /driver/trips/{id}
  const trip = mockTrips.find((t) => (t.id as string) === id)

  if (!trip) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-surface-on-variant text-sm">Trip not found.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-4">
      <button onClick={() => router.push(ROUTES.trips)} className="mb-4 text-sm text-secondary">
        ← My Trips
      </button>
      <h1 className="text-xl font-semibold">{trip.trip_reference}</h1>
      <p className="mb-4 text-sm text-surface-on-variant">{trip.order_number}</p>

      <section className="mb-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
        <p className="mb-1 text-sm font-medium">Status</p>
        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs">{trip.status}</span>
      </section>

      {trip.status === 'in_transit' && (
        <button
          className="mb-4 w-full rounded-xl border border-secondary bg-secondary/5 p-3 text-left text-sm font-medium text-secondary"
          onClick={() => router.push(ROUTES.inTransit(String(trip.id)))}
        >
          In-Transit Hub →
        </button>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Handshakes</h2>
        <ul className="flex flex-col gap-2">
          {HANDSHAKE_NUMBERS.map((n) => (
            <li key={n}>
              <button
                className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-left text-sm"
                onClick={() =>
                  router.push(ROUTES.handshakeStep(String(trip.id), n, STEP_SLUGS[n][0]))
                }
              >
                <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
```

- [ ] **Step 4: Delete the three old files**

```bash
rm frontend/driver-pwa/app/trips/page.tsx
rm frontend/driver-pwa/app/trips/[id]/page.tsx
rm "frontend/driver-pwa/app/trips/[id]/handshake/[step]/page.tsx"
rmdir "frontend/driver-pwa/app/trips/[id]/handshake/[step]"
rmdir "frontend/driver-pwa/app/trips/[id]/handshake"
rmdir "frontend/driver-pwa/app/trips/[id]"
rmdir frontend/driver-pwa/app/trips
```

---

## Task 3: Evidence types + useHandshakeDraft hook

**Files:**
- Create: `lib/types/evidence-draft.ts`
- Create: `lib/hooks/useHandshakeDraft.ts`
- Test: `lib/hooks/__tests__/useHandshakeDraft.test.ts`

- [ ] **Step 1: Create lib/types/evidence-draft.ts**

```typescript
// frontend/driver-pwa/lib/types/evidence-draft.ts

export interface H1Evidence {
  gpsLat: number | null
  gpsLng: number | null
  gatePhotoDataUrl: string | null
  capturedAt: string | null
}

export interface H2Evidence {
  gpsLat: number | null
  gpsLng: number | null
  ppManifestParcelCount: number | null
  driverVisualCount: number | null
  waybillPhotoDataUrl: string | null
  sealNumber: string | null
  sealPhotoDataUrl: string | null
  capturedAt: string | null
}

export interface H3Evidence {
  gpsLat: number | null
  gpsLng: number | null
  gatePhotoDataUrl: string | null
  sealNumberConfirmed: string | null
  capturedAt: string | null
}

export interface H4Evidence {
  gpsLat: number | null
  gpsLng: number | null
  gatePhotoDataUrl: string | null
  sealVerifiedMatch: boolean | null
  capturedAt: string | null
}

export interface H5Evidence {
  waybillHandedOver: boolean | null
  sealBrokenPhotoDataUrl: string | null
  driverVisualCount: number | null
  podPhotoDataUrl: string | null   // blocked BQ2 — always null in demo
  reconciliationNote: string | null
  capturedAt: string | null
}

export type HandshakeEvidence = H1Evidence | H2Evidence | H3Evidence | H4Evidence | H5Evidence
```

- [ ] **Step 2: Write failing test for useHandshakeDraft**

```typescript
// frontend/driver-pwa/lib/hooks/__tests__/useHandshakeDraft.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useHandshakeDraft } from '../useHandshakeDraft'
import type { H1Evidence } from '@/lib/types/evidence-draft'

const INITIAL: H1Evidence = {
  gpsLat: null, gpsLng: null, gatePhotoDataUrl: null, capturedAt: null,
}

beforeEach(() => localStorage.clear())

describe('useHandshakeDraft', () => {
  it('returns initial state when nothing is stored', () => {
    const { result } = renderHook(() =>
      useHandshakeDraft<H1Evidence>('trip-1', 'origin_gate_in', INITIAL)
    )
    expect(result.current[0]).toEqual(INITIAL)
  })

  it('updateDraft merges partial patch into draft', () => {
    const { result } = renderHook(() =>
      useHandshakeDraft<H1Evidence>('trip-1', 'origin_gate_in', INITIAL)
    )
    act(() => result.current[1]({ gpsLat: -26.09, gpsLng: 28.13 }))
    expect(result.current[0].gpsLat).toBe(-26.09)
    expect(result.current[0].gpsLng).toBe(28.13)
  })

  it('persists draft to localStorage', () => {
    const { result } = renderHook(() =>
      useHandshakeDraft<H1Evidence>('trip-1', 'origin_gate_in', INITIAL)
    )
    act(() => result.current[1]({ gpsLat: -26.09 }))
    const stored = JSON.parse(localStorage.getItem('fp_draft_trip-1_origin_gate_in') ?? '{}')
    expect(stored.gpsLat).toBe(-26.09)
  })

  it('clearDraft resets to initial and removes storage key', () => {
    const { result } = renderHook(() =>
      useHandshakeDraft<H1Evidence>('trip-1', 'origin_gate_in', INITIAL)
    )
    act(() => result.current[1]({ gpsLat: -26.09 }))
    act(() => result.current[2]())
    expect(result.current[0]).toEqual(INITIAL)
    expect(localStorage.getItem('fp_draft_trip-1_origin_gate_in')).toBeNull()
  })
})
```

- [ ] **Step 3: Create lib/hooks/useHandshakeDraft.ts**

```typescript
// frontend/driver-pwa/lib/hooks/useHandshakeDraft.ts
'use client'

import { useState, useCallback } from 'react'
import type { HandshakeType } from '@shared/lib/types/handshake'

const storageKey = (tripId: string, type: HandshakeType): string =>
  `fp_draft_${tripId}_${type}`

export function useHandshakeDraft<T extends object>(
  tripId: string,
  handshakeType: HandshakeType,
  initial: T,
): [draft: T, updateDraft: (patch: Partial<T>) => void, clearDraft: () => void] {
  const key = storageKey(tripId, handshakeType)

  const [draft, setDraft] = useState<T>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  const updateDraft = useCallback(
    (patch: Partial<T>) => {
      setDraft((prev) => {
        const next = { ...prev, ...patch }
        try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage full */ }
        return next
      })
    },
    [key],
  )

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
    setDraft(initial)
  }, [key, initial])

  return [draft, updateDraft, clearDraft]
}
```

---

## Task 4: API client + useOfflineQueue hook

**Files:**
- Create: `lib/api/handshakes.ts`
- Create: `lib/hooks/useOfflineQueue.ts`
- Test: `lib/hooks/__tests__/useOfflineQueue.test.ts`

- [ ] **Step 1: Create lib/api/handshakes.ts**

```typescript
// frontend/driver-pwa/lib/api/handshakes.ts
import type { HandshakeType } from '@shared/lib/types/handshake'
import type { HandshakeEvidence } from '@/lib/types/evidence-draft'

export interface SubmitHandshakeResult {
  ok: boolean
  eventHash: string
}

// Demo mode: NEXT_PUBLIC_DEMO_MODE=true returns a mock success immediately.
// Production: POSTs to the backend handshake endpoint (to be implemented in a separate plan).
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export async function submitHandshake(
  tripId: string,
  handshakeType: HandshakeType,
  evidence: HandshakeEvidence,
): Promise<SubmitHandshakeResult> {
  if (DEMO_MODE) {
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    return { ok: true, eventHash: crypto.randomUUID() }
  }

  const resp = await fetch(`${BACKEND_URL}/api/v1/trips/${tripId}/handshakes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handshake_type: handshakeType, evidence }),
  })

  if (!resp.ok) {
    throw new Error(`submitHandshake failed: HTTP ${resp.status}`)
  }

  return resp.json() as Promise<SubmitHandshakeResult>
}
```

- [ ] **Step 2: Write failing test for useOfflineQueue**

```typescript
// frontend/driver-pwa/lib/hooks/__tests__/useOfflineQueue.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useOfflineQueue } from '../useOfflineQueue'
import type { H1Evidence } from '@/lib/types/evidence-draft'

// Mock submitHandshake so tests don't hit the network
vi.mock('@/lib/api/handshakes', () => ({
  submitHandshake: vi.fn().mockResolvedValue({ ok: true, eventHash: 'abc' }),
}))

beforeEach(() => localStorage.clear())

const EVIDENCE: H1Evidence = {
  gpsLat: -26.09, gpsLng: 28.13, gatePhotoDataUrl: 'data:img', capturedAt: '2026-06-12T10:00:00Z',
}

describe('useOfflineQueue', () => {
  it('starts with empty queue', () => {
    const { result } = renderHook(() => useOfflineQueue())
    expect(result.current.queueLength).toBe(0)
  })

  it('enqueue increments queueLength and persists to localStorage', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    expect(result.current.queueLength).toBe(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].tripId).toBe('trip-1')
  })

  it('flush calls submitHandshake for each entry and clears the queue', async () => {
    const { submitHandshake } = await import('@/lib/api/handshakes')
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    await act(() => result.current.flush())
    expect(submitHandshake).toHaveBeenCalledTimes(1)
    expect(result.current.queueLength).toBe(0)
  })
})
```

- [ ] **Step 3: Create lib/hooks/useOfflineQueue.ts**

```typescript
// frontend/driver-pwa/lib/hooks/useOfflineQueue.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import { submitHandshake } from '@/lib/api/handshakes'
import type { HandshakeType } from '@shared/lib/types/handshake'
import type { HandshakeEvidence } from '@/lib/types/evidence-draft'

interface QueueEntry {
  id: string
  tripId: string
  handshakeType: HandshakeType
  evidence: HandshakeEvidence
  enqueuedAt: string
}

const QUEUE_KEY = 'fp_offline_queue'

function loadQueue(): QueueEntry[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(QUEUE_KEY) : null
    return raw ? (JSON.parse(raw) as QueueEntry[]) : []
  } catch { return [] }
}

function saveQueue(entries: QueueEntry[]): void {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(entries)) } catch { /* storage full */ }
}

export function useOfflineQueue() {
  const [queueLength, setQueueLength] = useState(0)

  const flush = useCallback(async () => {
    const queue = loadQueue()
    if (queue.length === 0) return
    const failed: QueueEntry[] = []
    for (const entry of queue) {
      try {
        await submitHandshake(entry.tripId, entry.handshakeType, entry.evidence)
      } catch {
        failed.push(entry)
      }
    }
    saveQueue(failed)
    setQueueLength(failed.length)
  }, [])

  const enqueue = useCallback(
    (tripId: string, handshakeType: HandshakeType, evidence: HandshakeEvidence) => {
      const entry: QueueEntry = {
        id: crypto.randomUUID(),
        tripId,
        handshakeType,
        evidence,
        enqueuedAt: new Date().toISOString(),
      }
      const q = [...loadQueue(), entry]
      saveQueue(q)
      setQueueLength(q.length)
    },
    [],
  )

  useEffect(() => {
    setQueueLength(loadQueue().length)
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [flush])

  return { queueLength, enqueue, flush }
}
```

---

## Task 5: Modify useLocation + shared handshake components

**Files:**
- Modify: `lib/hooks/useLocation.ts`
- Create: `components/handshake/StepHeader.tsx`
- Create: `components/handshake/HoldButton.tsx`
- Create: `components/handshake/CameraCapture.tsx`
- Create: `components/handshake/GpsCapture.tsx`
- Create: `components/handshake/SealInput.tsx`
- Create: `components/handshake/EvidenceReview.tsx`

- [ ] **Step 1: Update lib/hooks/useLocation.ts — make capture() return coords**

```typescript
// frontend/driver-pwa/lib/hooks/useLocation.ts
'use client'

import { useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

export interface LocationCoords {
  latitude: number
  longitude: number
  accuracy: number
}

export type LocationStatus = 'idle' | 'capturing' | 'captured' | 'error'

export interface LocationState {
  coords: LocationCoords | null
  status: LocationStatus
  capture: () => Promise<LocationCoords | null>
}

// Fallback for browser dev environment — Linbro Park, JHB (FedEx origin depot)
const LINBRO_PARK: LocationCoords = { latitude: -26.0942, longitude: 28.1342, accuracy: 5 }

export function useLocation(): LocationState {
  const [coords, setCoords] = useState<LocationCoords | null>(null)
  const [status, setStatus] = useState<LocationStatus>('idle')

  const capture = useCallback(async (): Promise<LocationCoords | null> => {
    setStatus('capturing')
    try {
      let result: LocationCoords
      if (Capacitor.isNativePlatform()) {
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10_000,
        })
        result = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }
      } else {
        // Simulate GPS acquisition delay for browser dev
        await new Promise<void>((resolve) => setTimeout(resolve, 300))
        result = LINBRO_PARK
      }
      setCoords(result)
      setStatus('captured')
      return result
    } catch {
      setStatus('error')
      return null
    }
  }, [])

  return { coords, status, capture }
}
```

- [ ] **Step 2: Create components/handshake/StepHeader.tsx**

```tsx
// frontend/driver-pwa/components/handshake/StepHeader.tsx
'use client'

import { useRouter } from 'next/navigation'
import { ROUTES } from '@/lib/constants/routes'

interface StepHeaderProps {
  tripId: string
  handshakeName: string
  stepName: string
  stepIndex: number   // 1-based
  totalSteps: number
}

export function StepHeader({ tripId, handshakeName, stepName, stepIndex, totalSteps }: StepHeaderProps) {
  const router = useRouter()
  const progress = (stepIndex / totalSteps) * 100

  return (
    <header className="sticky top-0 z-sticky bg-surface pb-3 pt-4 px-4 shadow-ambient-header">
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={() => router.push(ROUTES.tripDetail(tripId))}
          className="text-sm text-secondary"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-surface-on-variant truncate">{handshakeName}</p>
          <p className="text-base font-semibold leading-tight truncate">{stepName}</p>
        </div>
        <span className="text-xs text-surface-on-variant tabular-nums">
          {stepIndex}/{totalSteps}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-surface-container-highest overflow-hidden">
        <div
          className="h-full rounded-full bg-secondary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Create components/handshake/HoldButton.tsx**

```tsx
// frontend/driver-pwa/components/handshake/HoldButton.tsx
'use client'

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
  const { isPressing, progress, onPressStart, onPressEnd } = useHoldToConfirm(
    durationMs,
    onConfirm,
  )

  const circumference = 2 * Math.PI * 26  // r=26
  const strokeDashoffset = circumference * (1 - progress)

  return (
    <button
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      disabled={disabled}
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
        {isPressing ? 'Hold…' : label}
      </span>
    </button>
  )
}
```

- [ ] **Step 4: Create components/handshake/CameraCapture.tsx**

```tsx
// frontend/driver-pwa/components/handshake/CameraCapture.tsx
'use client'

import { useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

interface CameraCaptureProps {
  label: string
  dataUrl: string | null
  onCapture: (dataUrl: string) => void
}

export function CameraCapture({ label, dataUrl, onCapture }: CameraCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false)

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
      {dataUrl ? (
        <div className="relative rounded-xl overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt={label} className="w-full max-h-48 object-cover" />
          <button
            onClick={handleCapture}
            className="absolute bottom-2 right-2 rounded-full bg-surface-container-highest/90 px-3 py-1 text-xs font-medium"
          >
            Retake
          </button>
        </div>
      ) : (
        <button
          onClick={handleCapture}
          disabled={isCapturing}
          className="flex h-32 w-full items-center justify-center rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low text-sm text-surface-on-variant disabled:opacity-60"
        >
          {isCapturing ? 'Opening camera…' : '📷 Tap to photograph'}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create components/handshake/GpsCapture.tsx**

```tsx
// frontend/driver-pwa/components/handshake/GpsCapture.tsx
'use client'

import { useLocation } from '@/lib/hooks/useLocation'
import { Button } from '@/components/ui/Button'

interface GpsCaptureProps {
  onCapture: (lat: number, lng: number) => void
  captured: boolean   // true if draft already has coords
}

export function GpsCapture({ onCapture, captured }: GpsCaptureProps) {
  const { status, capture } = useLocation()

  async function handleCapture() {
    const result = await capture()
    if (result) onCapture(result.latitude, result.longitude)
  }

  if (captured) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3">
        <span className="text-success text-lg">📍</span>
        <p className="text-sm font-medium text-success">Location captured</p>
      </div>
    )
  }

  return (
    <Button
      onClick={handleCapture}
      loading={status === 'capturing'}
      disabled={status === 'capturing'}
      variant="secondary"
      size="lg"
    >
      {status === 'error' ? 'Retry GPS' : 'Capture GPS Location'}
    </Button>
  )
}
```

- [ ] **Step 6: Create components/handshake/SealInput.tsx**

```tsx
// frontend/driver-pwa/components/handshake/SealInput.tsx
'use client'

import { Input } from '@/components/ui/Input'
import { CameraCapture } from './CameraCapture'

interface SealInputProps {
  sealNumber: string | null
  sealPhotoDataUrl: string | null
  onSealNumberChange: (value: string) => void
  onSealPhotoCapture: (dataUrl: string) => void
  requirePhoto?: boolean
}

export function SealInput({
  sealNumber,
  sealPhotoDataUrl,
  onSealNumberChange,
  onSealPhotoCapture,
  requirePhoto = true,
}: SealInputProps) {
  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Seal number"
        placeholder="e.g. FP-1234"
        value={sealNumber ?? ''}
        onChange={(e) => onSealNumberChange(e.target.value.toUpperCase())}
      />
      {requirePhoto && (
        <CameraCapture
          label="Seal photo"
          dataUrl={sealPhotoDataUrl}
          onCapture={onSealPhotoCapture}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 7: Create components/handshake/EvidenceReview.tsx**

```tsx
// frontend/driver-pwa/components/handshake/EvidenceReview.tsx
'use client'

interface EvidenceItem {
  label: string
  value: string | null
  isImage?: boolean
}

interface EvidenceReviewProps {
  items: EvidenceItem[]
}

export function EvidenceReview({ items }: EvidenceReviewProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
      <p className="text-sm font-semibold">Evidence collected</p>
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1">
          <p className="text-xs text-surface-on-variant">{item.label}</p>
          {item.isImage && item.value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.value} alt={item.label} className="max-h-24 w-full rounded-lg object-cover" />
          ) : (
            <p className={`text-sm font-medium ${item.value ? 'text-surface-on' : 'text-error'}`}>
              {item.value ?? '⚠ Missing'}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
```

---

## Task 5b: URL-driven navigation helper (single source of truth)

Fixes the dispatcher ↔ TripContext desync (principle 2): flow is computed from the URL by
a pure, testable function instead of TripContext's internal step counter.

**Files:**
- Create: `lib/navigation/handshake-flow.ts`
- Test:   `lib/navigation/__tests__/handshake-flow.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/driver-pwa/lib/navigation/__tests__/handshake-flow.test.ts
import { describe, it, expect } from 'vitest'
import { nextHandshakeRoute } from '../handshake-flow'

describe('nextHandshakeRoute', () => {
  it('advances to the next step within a handshake', () => {
    expect(nextHandshakeRoute('trip-1', 1, '1-approach-gate'))
      .toBe('/trip/trip-1/handshake/1/step/2-entry-photo')
  })
  it('rolls from the last step of H1 into the first step of H2', () => {
    expect(nextHandshakeRoute('trip-1', 1, '3-verification'))
      .toBe('/trip/trip-1/handshake/2/step/1-arrive-bay')
  })
  it('hands off to the in-transit hub at the end of H3', () => {
    expect(nextHandshakeRoute('trip-1', 3, '3-departure'))
      .toBe('/trip/trip-1/in-transit')
  })
  it('returns to the trip list at the end of H5', () => {
    expect(nextHandshakeRoute('trip-1', 5, '6-closed'))
      .toBe('/trips')
  })
})
```

- [ ] **Step 2: Create the helper**

```typescript
// frontend/driver-pwa/lib/navigation/handshake-flow.ts
import { STEP_SLUGS, HANDSHAKE_STEP_COUNTS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'

type Handshake = 1 | 2 | 3 | 4 | 5

/**
 * Given where the driver is now (handshake + step slug), return the route for the NEXT
 * screen. Navigation is a pure function of the URL, so a refresh or deep-link can never
 * desync "which step am I on". This is presentation flow only — the backend remains the
 * authority on whether a handshake is actually valid and anchored.
 */
export function nextHandshakeRoute(tripId: string, handshake: Handshake, slug: string): string {
  const slugs = STEP_SLUGS[handshake]
  const stepIndex = slugs.indexOf(slug)                       // 0-based; -1 if unknown
  const isLastStep = stepIndex === HANDSHAKE_STEP_COUNTS[handshake] - 1

  // Mid-handshake → next step of the same handshake.
  if (stepIndex >= 0 && !isLastStep) {
    return ROUTES.handshakeStep(tripId, handshake, slugs[stepIndex + 1])
  }
  // End of Origin Gate-Out (H3): the driver departs — hand off to the in-transit hub.
  if (handshake === 3) {
    return ROUTES.inTransit(tripId)
  }
  // End of H1/H2/H4 → first step of the next handshake.
  if (handshake < 5) {
    const next = (handshake + 1) as Handshake
    return ROUTES.handshakeStep(tripId, next, STEP_SLUGS[next][0])
  }
  // End of Unloading (H5): the trip is closed — back to the trip list.
  return ROUTES.trips
}
```

> **Note (cross-dev):** This supersedes `TripContext.advance()` / `goBack()` for step
> flow. `TripContext` may keep `currentStep` / `currentHandshake` for progress *display*,
> but it must no longer be the navigation authority. Coordinate with whoever owns
> `TripContext.tsx` before removing those methods.

---

## Task 6: Step dispatcher page + PP manifest mock

**Files:**
- Create: `app/(app)/trip/[id]/handshake/[h]/step/[slug]/page.tsx`
- Create: `lib/mocks/parcel-perfect-manifest.json`

- [ ] **Step 1: Create lib/mocks/parcel-perfect-manifest.json**

```json
{
  "manifest_reference": "PP-MANIFEST-2026-0041",
  "trip_reference": "TRP-2026-0041",
  "parcel_count": 27,
  "total_weight_kg": 312.4,
  "consignee": "FedEx Durban Hub",
  "consignor": "FedEx Johannesburg Hub",
  "generated_at": "2026-05-09T05:30:00Z",
  "items": [
    { "barcode": "FX-0041-001", "description": "General freight", "weight_kg": 12.1 },
    { "barcode": "FX-0041-002", "description": "General freight", "weight_kg": 11.8 },
    { "barcode": "FX-0041-003", "description": "General freight", "weight_kg": 9.5 }
  ],
  "_note": "Mock data shaped like Parcel Perfect API response. Real wiring pending FP-121."
}
```

- [ ] **Step 2: Create the step dispatcher page skeleton**

```tsx
// frontend/driver-pwa/app/(app)/trip/[id]/handshake/[h]/step/[slug]/page.tsx
'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { HANDSHAKE_NAMES, STEP_NAMES, STEP_SLUGS, HANDSHAKE_STEP_COUNTS } from '@shared/lib/constants/handshake-meta'
import { StepHeader } from '@/components/handshake/StepHeader'
import { useHandshakeDraft } from '@/lib/hooks/useHandshakeDraft'
import { submitHandshake } from '@/lib/api/handshakes'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { nextHandshakeRoute } from '@/lib/navigation/handshake-flow'
import type { H1Evidence, H2Evidence, H3Evidence, H4Evidence, H5Evidence } from '@/lib/types/evidence-draft'
import { H1GateArrival } from '@/components/handshake/steps/H1GateArrival'
import { H1EntryPhoto } from '@/components/handshake/steps/H1EntryPhoto'
import { H1Verification } from '@/components/handshake/steps/H1Verification'
import { H2ArriveBay } from '@/components/handshake/steps/H2ArriveBay'
import { H2Manifest } from '@/components/handshake/steps/H2Manifest'
import { H2Waybill } from '@/components/handshake/steps/H2Waybill'
import { H2Seal } from '@/components/handshake/steps/H2Seal'
import { H2Review } from '@/components/handshake/steps/H2Review'
import { H3ApproachExit } from '@/components/handshake/steps/H3ApproachExit'
import { H3ExitSeal } from '@/components/handshake/steps/H3ExitSeal'
import { H3Departure } from '@/components/handshake/steps/H3Departure'
import { H4ApproachDest } from '@/components/handshake/steps/H4ApproachDest'
import { H4EntryPhoto } from '@/components/handshake/steps/H4EntryPhoto'
import { H4SealVerify } from '@/components/handshake/steps/H4SealVerify'
import { H5HandWaybill } from '@/components/handshake/steps/H5HandWaybill'
import { H5SealInspection } from '@/components/handshake/steps/H5SealInspection'
import { H5VisualCount } from '@/components/handshake/steps/H5VisualCount'
import { H5PodPhoto } from '@/components/handshake/steps/H5PodPhoto'
import { H5Reconciliation } from '@/components/handshake/steps/H5Reconciliation'
import { H5Closed } from '@/components/handshake/steps/H5Closed'

const H1_INITIAL: H1Evidence = { gpsLat: null, gpsLng: null, gatePhotoDataUrl: null, capturedAt: null }
const H2_INITIAL: H2Evidence = { gpsLat: null, gpsLng: null, ppManifestParcelCount: null, driverVisualCount: null, waybillPhotoDataUrl: null, sealNumber: null, sealPhotoDataUrl: null, capturedAt: null }
const H3_INITIAL: H3Evidence = { gpsLat: null, gpsLng: null, gatePhotoDataUrl: null, sealNumberConfirmed: null, capturedAt: null }
const H4_INITIAL: H4Evidence = { gpsLat: null, gpsLng: null, gatePhotoDataUrl: null, sealVerifiedMatch: null, capturedAt: null }
const H5_INITIAL: H5Evidence = { waybillHandedOver: null, sealBrokenPhotoDataUrl: null, driverVisualCount: null, podPhotoDataUrl: null, reconciliationNote: null, capturedAt: null }

export default function HandshakeStepPage() {
  const { id: tripId, h, slug } = useParams<{ id: string; h: string; slug: string }>()
  const router = useRouter()
  const { enqueue } = useOfflineQueue()

  const handshakeNum = Number(h) as 1 | 2 | 3 | 4 | 5
  const slugList = STEP_SLUGS[handshakeNum] ?? []
  const stepIndex = slugList.indexOf(slug)   // 0-based
  const stepName = STEP_NAMES[handshakeNum]?.[stepIndex] ?? slug
  const totalSteps = HANDSHAKE_STEP_COUNTS[handshakeNum]

  // URL-derived navigation (single source of truth) — see lib/navigation/handshake-flow.ts.
  // The backend stays authoritative for whether the handshake is valid; this only moves
  // the driver to the next screen. Driving flow from the URL (not TripContext's internal
  // counter) means a refresh or deep-link can never land on the wrong step.
  const advance = useCallback(
    () => router.push(nextHandshakeRoute(tripId, handshakeNum, slug)),
    [router, tripId, handshakeNum, slug],
  )

  const [h1Draft, updateH1, clearH1] = useHandshakeDraft<H1Evidence>(tripId, 'origin_gate_in', H1_INITIAL)
  const [h2Draft, updateH2, clearH2] = useHandshakeDraft<H2Evidence>(tripId, 'loading', H2_INITIAL)
  const [h3Draft, updateH3, clearH3] = useHandshakeDraft<H3Evidence>(tripId, 'origin_gate_out', H3_INITIAL)
  const [h4Draft, updateH4, clearH4] = useHandshakeDraft<H4Evidence>(tripId, 'dest_gate_in', H4_INITIAL)
  const [h5Draft, updateH5, clearH5] = useHandshakeDraft<H5Evidence>(tripId, 'unloading', H5_INITIAL)

  async function submitAndAdvance(
    type: 'origin_gate_in' | 'loading' | 'origin_gate_out' | 'dest_gate_in' | 'unloading',
    evidence: H1Evidence | H2Evidence | H3Evidence | H4Evidence | H5Evidence,
    clearFn: () => void,
  ) {
    try {
      await submitHandshake(tripId, type, evidence)
    } catch {
      enqueue(tripId, type, evidence)
    }
    clearFn()
    advance()
  }

  const props = { tripId }

  if (handshakeNum === 1) {
    if (slug === '1-approach-gate') return <H1GateArrival {...props} draft={h1Draft} onUpdate={updateH1} onComplete={advance} />
    if (slug === '2-entry-photo')   return <H1EntryPhoto  {...props} draft={h1Draft} onUpdate={updateH1} onComplete={advance} />
    if (slug === '3-verification')  return <H1Verification {...props} draft={h1Draft} onComplete={() => submitAndAdvance('origin_gate_in', h1Draft, clearH1)} />
  }

  if (handshakeNum === 2) {
    if (slug === '1-arrive-bay') return <H2ArriveBay {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '2-manifest')   return <H2Manifest  {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '3-waybill')    return <H2Waybill   {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '4-seal')       return <H2Seal      {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '5-review')     return <H2Review    {...props} draft={h2Draft} onComplete={() => submitAndAdvance('loading', h2Draft, clearH2)} />
  }

  if (handshakeNum === 3) {
    if (slug === '1-approach-exit')  return <H3ApproachExit {...props} draft={h3Draft} onUpdate={updateH3} onComplete={advance} />
    if (slug === '2-exit-and-seal')  return <H3ExitSeal     {...props} draft={h3Draft} onUpdate={updateH3} onComplete={advance} />
    if (slug === '3-departure')      return <H3Departure    {...props} draft={h3Draft} onComplete={() => submitAndAdvance('origin_gate_out', h3Draft, clearH3)} />
  }

  if (handshakeNum === 4) {
    if (slug === '1-approach-dest')    return <H4ApproachDest {...props} draft={h4Draft} onUpdate={updateH4} onComplete={advance} />
    if (slug === '2-dest-entry-photo') return <H4EntryPhoto   {...props} draft={h4Draft} onUpdate={updateH4} onComplete={advance} />
    if (slug === '3-seal-verify')      return <H4SealVerify   {...props} draft={h4Draft} h2SealNumber={h2Draft.sealNumber} onComplete={() => submitAndAdvance('dest_gate_in', h4Draft, clearH4)} />
  }

  if (handshakeNum === 5) {
    if (slug === '1-hand-waybill')        return <H5HandWaybill    {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} />
    if (slug === '2-seal-break-inspection') return <H5SealInspection {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} />
    if (slug === '3-visual-count')        return <H5VisualCount    {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} h2Count={h2Draft.driverVisualCount} />
    if (slug === '4-pod-photo')           return <H5PodPhoto       {...props} onComplete={advance} />
    if (slug === '5-reconciliation')      return <H5Reconciliation {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} />
    if (slug === '6-closed')              return <H5Closed         {...props} draft={h5Draft} onComplete={() => submitAndAdvance('unloading', h5Draft, clearH5)} />
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-sm text-error">Unknown step: H{handshakeNum}/{slug}</p>
    </main>
  )
}
```

---

## Task 7: H1 — Origin Gate-In (3 step components)

**Files:**
- Create: `components/handshake/steps/H1GateArrival.tsx`
- Create: `components/handshake/steps/H1EntryPhoto.tsx`
- Create: `components/handshake/steps/H1Verification.tsx`

- [ ] **Step 1: Create H1GateArrival.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H1GateArrival.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { GpsCapture } from '@/components/handshake/GpsCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H1Evidence } from '@/lib/types/evidence-draft'

interface H1GateArrivalProps {
  tripId: string
  draft: H1Evidence
  onUpdate: (patch: Partial<H1Evidence>) => void
  onComplete: () => void
}

export function H1GateArrival({ tripId, draft, onUpdate, onComplete }: H1GateArrivalProps) {
  const hasGps = draft.gpsLat !== null && draft.gpsLng !== null

  function handleGpsCapture(lat: number, lng: number) {
    onUpdate({ gpsLat: lat, gpsLng: lng, capturedAt: new Date().toISOString() })
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader
        tripId={tripId}
        handshakeName="Origin Gate-In"
        stepName="Gate Arrival"
        stepIndex={1}
        totalSteps={3}
      />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Capture your GPS location at the origin gate to record your arrival position.
        </p>
        <GpsCapture captured={hasGps} onCapture={handleGpsCapture} />
        {hasGps && (
          <p className="text-xs text-surface-on-variant">
            {draft.gpsLat?.toFixed(5)}, {draft.gpsLng?.toFixed(5)}
          </p>
        )}
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!hasGps} />
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create H1EntryPhoto.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H1EntryPhoto.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H1Evidence } from '@/lib/types/evidence-draft'

interface H1EntryPhotoProps {
  tripId: string
  draft: H1Evidence
  onUpdate: (patch: Partial<H1Evidence>) => void
  onComplete: () => void
}

export function H1EntryPhoto({ tripId, draft, onUpdate, onComplete }: H1EntryPhotoProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader
        tripId={tripId}
        handshakeName="Origin Gate-In"
        stepName="Entry Photo"
        stepIndex={2}
        totalSteps={3}
      />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the gate entry point. This photo is anchored as evidence of your arrival.
        </p>
        <CameraCapture
          label="Gate entry photo"
          dataUrl={draft.gatePhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ gatePhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton
          label="Hold to confirm"
          onConfirm={onComplete}
          disabled={!draft.gatePhotoDataUrl}
        />
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Create H1Verification.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H1Verification.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { EvidenceReview } from '@/components/handshake/EvidenceReview'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H1Evidence } from '@/lib/types/evidence-draft'

interface H1VerificationProps {
  tripId: string
  draft: H1Evidence
  onComplete: () => void
}

export function H1Verification({ tripId, draft, onComplete }: H1VerificationProps) {
  const isReady = draft.gpsLat !== null && draft.gatePhotoDataUrl !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader
        tripId={tripId}
        handshakeName="Origin Gate-In"
        stepName="Verification"
        stepIndex={3}
        totalSteps={3}
      />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Review your evidence. Hold to submit — this anchors H1 to the blockchain.
        </p>
        <EvidenceReview
          items={[
            { label: 'GPS location', value: draft.gpsLat ? `${draft.gpsLat.toFixed(5)}, ${draft.gpsLng?.toFixed(5)}` : null },
            { label: 'Entry photo', value: draft.gatePhotoDataUrl, isImage: true },
          ]}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Submit H1" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
```

---

## Task 8: H2 — Loading (5 step components)

**Files:**
- Create: `components/handshake/steps/H2ArriveBay.tsx`
- Create: `components/handshake/steps/H2Manifest.tsx`
- Create: `components/handshake/steps/H2Waybill.tsx`
- Create: `components/handshake/steps/H2Seal.tsx`
- Create: `components/handshake/steps/H2Review.tsx`

- [ ] **Step 1: Create H2ArriveBay.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H2ArriveBay.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { GpsCapture } from '@/components/handshake/GpsCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H2Evidence } from '@/lib/types/evidence-draft'

interface H2ArriveBayProps {
  tripId: string
  draft: H2Evidence
  onUpdate: (patch: Partial<H2Evidence>) => void
  onComplete: () => void
}

export function H2ArriveBay({ tripId, draft, onUpdate, onComplete }: H2ArriveBayProps) {
  const hasGps = draft.gpsLat !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Loading" stepName="Arrive at Bay" stepIndex={1} totalSteps={5} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Capture your GPS location once you have pulled into the loading bay.
        </p>
        <GpsCapture captured={hasGps} onCapture={(lat, lng) => onUpdate({ gpsLat: lat, gpsLng: lng, capturedAt: new Date().toISOString() })} />
        {hasGps && <p className="text-xs text-surface-on-variant">{draft.gpsLat?.toFixed(5)}, {draft.gpsLng?.toFixed(5)}</p>}
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!hasGps} />
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create H2Manifest.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H2Manifest.tsx
'use client'

import { useState } from 'react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H2Evidence } from '@/lib/types/evidence-draft'
import manifest from '@/lib/mocks/parcel-perfect-manifest.json'

interface H2ManifestProps {
  tripId: string
  draft: H2Evidence
  onUpdate: (patch: Partial<H2Evidence>) => void
  onComplete: () => void
}

export function H2Manifest({ tripId, draft, onUpdate, onComplete }: H2ManifestProps) {
  const [countInput, setCountInput] = useState(
    draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '',
  )
  const ppCount = manifest.parcel_count
  const driverCount = countInput !== '' ? parseInt(countInput, 10) : null
  const hasMismatch = driverCount !== null && driverCount !== ppCount
  const isReady = driverCount !== null && !isNaN(driverCount)

  function handleConfirm() {
    onUpdate({ ppManifestParcelCount: ppCount, driverVisualCount: driverCount })
    onComplete()
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Loading" stepName="Confirm Manifest" stepIndex={2} totalSteps={5} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="mb-1 text-xs text-surface-on-variant">Parcel Perfect manifest</p>
          <p className="text-2xl font-bold">{ppCount}</p>
          <p className="text-sm text-surface-on-variant">parcels on this load</p>
          <p className="mt-1 text-xs text-surface-on-variant">{manifest.manifest_reference}</p>
        </div>
        <Input
          label="Your visual count"
          type="number"
          inputMode="numeric"
          placeholder="Count parcels physically"
          value={countInput}
          onChange={(e) => setCountInput(e.target.value)}
        />
        {hasMismatch && (
          <div className="rounded-xl bg-error-container px-4 py-3">
            <p className="text-sm font-medium text-error-on-container">
              Count mismatch: PP says {ppCount}, you counted {driverCount}. This will be flagged as an exception.
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Confirm count" onConfirm={handleConfirm} disabled={!isReady} />
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Create H2Waybill.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H2Waybill.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H2Evidence } from '@/lib/types/evidence-draft'

interface H2WaybillProps {
  tripId: string
  draft: H2Evidence
  onUpdate: (patch: Partial<H2Evidence>) => void
  onComplete: () => void
}

export function H2Waybill({ tripId, draft, onUpdate, onComplete }: H2WaybillProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Loading" stepName="Photograph Waybill" stepIndex={3} totalSteps={5} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the physical waybill. This becomes the legal evidence copy.
        </p>
        <CameraCapture
          label="Waybill"
          dataUrl={draft.waybillPhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ waybillPhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!draft.waybillPhotoDataUrl} />
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Create H2Seal.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H2Seal.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { SealInput } from '@/components/handshake/SealInput'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H2Evidence } from '@/lib/types/evidence-draft'

interface H2SealProps {
  tripId: string
  draft: H2Evidence
  onUpdate: (patch: Partial<H2Evidence>) => void
  onComplete: () => void
}

export function H2Seal({ tripId, draft, onUpdate, onComplete }: H2SealProps) {
  const isReady = Boolean(draft.sealNumber?.trim()) && draft.sealPhotoDataUrl !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Loading" stepName="Capture Seal" stepIndex={4} totalSteps={5} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Enter the seal number printed on the physical seal and photograph it. The seal number is locked in the journey hash.
        </p>
        <SealInput
          sealNumber={draft.sealNumber}
          sealPhotoDataUrl={draft.sealPhotoDataUrl}
          onSealNumberChange={(v) => onUpdate({ sealNumber: v })}
          onSealPhotoCapture={(dataUrl) => onUpdate({ sealPhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Create H2Review.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H2Review.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { EvidenceReview } from '@/components/handshake/EvidenceReview'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H2Evidence } from '@/lib/types/evidence-draft'

interface H2ReviewProps {
  tripId: string
  draft: H2Evidence
  onComplete: () => void
}

export function H2Review({ tripId, draft, onComplete }: H2ReviewProps) {
  const isReady =
    draft.gpsLat !== null &&
    draft.waybillPhotoDataUrl !== null &&
    Boolean(draft.sealNumber?.trim()) &&
    draft.sealPhotoDataUrl !== null &&
    draft.driverVisualCount !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Loading" stepName="Review & Submit" stepIndex={5} totalSteps={5} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Review all evidence. Hold to submit — H2 will be anchored to Hedera HCS.
        </p>
        <EvidenceReview
          items={[
            { label: 'GPS', value: draft.gpsLat ? `${draft.gpsLat.toFixed(5)}, ${draft.gpsLng?.toFixed(5)}` : null },
            { label: 'PP parcel count', value: draft.ppManifestParcelCount !== null ? String(draft.ppManifestParcelCount) : null },
            { label: 'Your visual count', value: draft.driverVisualCount !== null ? String(draft.driverVisualCount) : null },
            { label: 'Waybill photo', value: draft.waybillPhotoDataUrl, isImage: true },
            { label: 'Seal number', value: draft.sealNumber },
            { label: 'Seal photo', value: draft.sealPhotoDataUrl, isImage: true },
          ]}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Submit H2" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
```

---

## Task 9: H3 — Origin Gate-Out (3 step components)

**Files:**
- Create: `components/handshake/steps/H3ApproachExit.tsx`
- Create: `components/handshake/steps/H3ExitSeal.tsx`
- Create: `components/handshake/steps/H3Departure.tsx`

- [ ] **Step 1: Create H3ApproachExit.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H3ApproachExit.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { GpsCapture } from '@/components/handshake/GpsCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H3Evidence } from '@/lib/types/evidence-draft'

interface H3ApproachExitProps {
  tripId: string
  draft: H3Evidence
  onUpdate: (patch: Partial<H3Evidence>) => void
  onComplete: () => void
}

export function H3ApproachExit({ tripId, draft, onUpdate, onComplete }: H3ApproachExitProps) {
  const hasGps = draft.gpsLat !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Origin Gate-Out" stepName="Approach Exit Gate" stepIndex={1} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Capture your GPS location as you approach the exit gate.
        </p>
        <GpsCapture captured={hasGps} onCapture={(lat, lng) => onUpdate({ gpsLat: lat, gpsLng: lng, capturedAt: new Date().toISOString() })} />
        {hasGps && <p className="text-xs text-surface-on-variant">{draft.gpsLat?.toFixed(5)}, {draft.gpsLng?.toFixed(5)}</p>}
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!hasGps} />
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create H3ExitSeal.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H3ExitSeal.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H3Evidence } from '@/lib/types/evidence-draft'

interface H3ExitSealProps {
  tripId: string
  draft: H3Evidence
  onUpdate: (patch: Partial<H3Evidence>) => void
  onComplete: () => void
}

export function H3ExitSeal({ tripId, draft, onUpdate, onComplete }: H3ExitSealProps) {
  const isReady = draft.gatePhotoDataUrl !== null && Boolean(draft.sealNumberConfirmed?.trim())

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Origin Gate-Out" stepName="Exit Photo & Seal" stepIndex={2} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the exit gate, then confirm the seal number is still intact.
        </p>
        <CameraCapture
          label="Exit gate photo"
          dataUrl={draft.gatePhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ gatePhotoDataUrl: dataUrl })}
        />
        <Input
          label="Confirm seal number"
          placeholder="e.g. FP-1234"
          value={draft.sealNumberConfirmed ?? ''}
          onChange={(e) => onUpdate({ sealNumberConfirmed: e.target.value.toUpperCase() })}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Create H3Departure.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H3Departure.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { EvidenceReview } from '@/components/handshake/EvidenceReview'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H3Evidence } from '@/lib/types/evidence-draft'

interface H3DepartureProps {
  tripId: string
  draft: H3Evidence
  onComplete: () => void
}

export function H3Departure({ tripId, draft, onComplete }: H3DepartureProps) {
  const isReady = draft.gpsLat !== null && draft.gatePhotoDataUrl !== null && draft.sealNumberConfirmed !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Origin Gate-Out" stepName="Confirm Departure" stepIndex={3} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          You are about to depart. Hold to submit — your departure is recorded and you are now in transit.
        </p>
        <EvidenceReview
          items={[
            { label: 'GPS', value: draft.gpsLat ? `${draft.gpsLat.toFixed(5)}, ${draft.gpsLng?.toFixed(5)}` : null },
            { label: 'Exit photo', value: draft.gatePhotoDataUrl, isImage: true },
            { label: 'Seal confirmed', value: draft.sealNumberConfirmed },
          ]}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Depart" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
```

---

## Task 10: H4 — Destination Gate-In (3 step components)

**Files:**
- Create: `components/handshake/steps/H4ApproachDest.tsx`
- Create: `components/handshake/steps/H4EntryPhoto.tsx`
- Create: `components/handshake/steps/H4SealVerify.tsx`

- [ ] **Step 1: Create H4ApproachDest.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H4ApproachDest.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { GpsCapture } from '@/components/handshake/GpsCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H4Evidence } from '@/lib/types/evidence-draft'

interface H4ApproachDestProps {
  tripId: string
  draft: H4Evidence
  onUpdate: (patch: Partial<H4Evidence>) => void
  onComplete: () => void
}

export function H4ApproachDest({ tripId, draft, onUpdate, onComplete }: H4ApproachDestProps) {
  const hasGps = draft.gpsLat !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Destination Gate-In" stepName="Destination Gate Arrival" stepIndex={1} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          You have arrived at the destination. Capture your GPS location.
        </p>
        <GpsCapture captured={hasGps} onCapture={(lat, lng) => onUpdate({ gpsLat: lat, gpsLng: lng, capturedAt: new Date().toISOString() })} />
        {hasGps && <p className="text-xs text-surface-on-variant">{draft.gpsLat?.toFixed(5)}, {draft.gpsLng?.toFixed(5)}</p>}
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!hasGps} />
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create H4EntryPhoto.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H4EntryPhoto.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H4Evidence } from '@/lib/types/evidence-draft'

interface H4EntryPhotoProps {
  tripId: string
  draft: H4Evidence
  onUpdate: (patch: Partial<H4Evidence>) => void
  onComplete: () => void
}

export function H4EntryPhoto({ tripId, draft, onUpdate, onComplete }: H4EntryPhotoProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Destination Gate-In" stepName="Entry Photo" stepIndex={2} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the destination gate entry point.
        </p>
        <CameraCapture
          label="Destination entry photo"
          dataUrl={draft.gatePhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ gatePhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!draft.gatePhotoDataUrl} />
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Create H4SealVerify.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H4SealVerify.tsx
'use client'

import { useState } from 'react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H4Evidence } from '@/lib/types/evidence-draft'

interface H4SealVerifyProps {
  tripId: string
  draft: H4Evidence
  h2SealNumber: string | null   // seal set at loading — must match
  onComplete: () => void
}

export function H4SealVerify({ tripId, draft, h2SealNumber, onComplete }: H4SealVerifyProps) {
  const [input, setInput] = useState(draft.sealVerifiedMatch !== null ? (h2SealNumber ?? '') : '')
  const matches = input.trim().toUpperCase() === (h2SealNumber ?? '').toUpperCase()
  const hasInput = input.trim().length > 0

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Destination Gate-In" stepName="Seal Verification" stepIndex={3} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="text-xs text-surface-on-variant mb-1">Seal set at loading (H2)</p>
          <p className="text-lg font-bold font-mono">{h2SealNumber ?? 'Unknown'}</p>
        </div>
        <Input
          label="Enter seal number from vehicle"
          placeholder="Type the seal number you see"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {hasInput && (
          <div className={`rounded-xl px-4 py-3 ${matches ? 'bg-success/10' : 'bg-error-container'}`}>
            <p className={`text-sm font-medium ${matches ? 'text-success' : 'text-error-on-container'}`}>
              {matches ? '✓ Seal matches — integrity confirmed' : '✗ Mismatch — this will be flagged as an exception'}
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-center p-6">
        <HoldButton
          label={matches ? 'Submit H4' : 'Submit (flag mismatch)'}
          variant={matches ? 'primary' : 'danger'}
          onConfirm={onComplete}
          disabled={!hasInput}
        />
      </div>
    </main>
  )
}
```

---

## Task 11: H5 — Unloading (6 step components)

**Files:**
- Create: `components/handshake/steps/H5HandWaybill.tsx`
- Create: `components/handshake/steps/H5SealInspection.tsx`
- Create: `components/handshake/steps/H5VisualCount.tsx`
- Create: `components/handshake/steps/H5PodPhoto.tsx`
- Create: `components/handshake/steps/H5Reconciliation.tsx`
- Create: `components/handshake/steps/H5Closed.tsx`

- [ ] **Step 1: Create H5HandWaybill.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H5HandWaybill.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H5Evidence } from '@/lib/types/evidence-draft'

interface H5HandWaybillProps {
  tripId: string
  draft: H5Evidence
  onUpdate: (patch: Partial<H5Evidence>) => void
  onComplete: () => void
}

export function H5HandWaybill({ tripId, draft, onUpdate, onComplete }: H5HandWaybillProps) {
  function handleConfirm() {
    onUpdate({ waybillHandedOver: true })
    onComplete()
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Unloading" stepName="Hand Waybill Copy" stepIndex={1} totalSteps={6} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 flex flex-col gap-2">
          <p className="text-sm font-semibold">Action required</p>
          <p className="text-sm text-surface-on-variant">
            Hand the physical waybill copy to the warehouse receiver. Once they acknowledge receipt, hold to confirm.
          </p>
        </div>
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Waybill handed over" onConfirm={handleConfirm} />
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create H5SealInspection.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H5SealInspection.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H5Evidence } from '@/lib/types/evidence-draft'

interface H5SealInspectionProps {
  tripId: string
  draft: H5Evidence
  onUpdate: (patch: Partial<H5Evidence>) => void
  onComplete: () => void
}

export function H5SealInspection({ tripId, draft, onUpdate, onComplete }: H5SealInspectionProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Unloading" stepName="Wait for Inspection" stepIndex={2} totalSteps={6} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Wait for the warehouse to inspect and break the seal. Photograph the broken seal as evidence.
        </p>
        <CameraCapture
          label="Broken seal photo"
          dataUrl={draft.sealBrokenPhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ sealBrokenPhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!draft.sealBrokenPhotoDataUrl} />
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Create H5VisualCount.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H5VisualCount.tsx
'use client'

import { useState } from 'react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H5Evidence } from '@/lib/types/evidence-draft'

interface H5VisualCountProps {
  tripId: string
  draft: H5Evidence
  onUpdate: (patch: Partial<H5Evidence>) => void
  onComplete: () => void
  h2Count: number | null   // loading count to compare against
}

export function H5VisualCount({ tripId, draft, onUpdate, onComplete, h2Count }: H5VisualCountProps) {
  const [input, setInput] = useState(draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '')
  const count = input !== '' ? parseInt(input, 10) : null
  const hasMismatch = count !== null && h2Count !== null && count !== h2Count

  function handleConfirm() {
    onUpdate({ driverVisualCount: count })
    onComplete()
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Unloading" stepName="Visual Count" stepIndex={3} totalSteps={6} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {h2Count !== null && (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
            <p className="text-xs text-surface-on-variant mb-1">Loaded at origin (H2)</p>
            <p className="text-2xl font-bold">{h2Count} parcels</p>
          </div>
        )}
        <Input
          label="Your visual count at destination"
          type="number"
          inputMode="numeric"
          placeholder="Count unloaded parcels"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {hasMismatch && (
          <div className="rounded-xl bg-error-container px-4 py-3">
            <p className="text-sm font-medium text-error-on-container">
              Count mismatch: loaded {h2Count}, you counted {count}. This will be flagged.
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Confirm count" onConfirm={handleConfirm} disabled={count === null || isNaN(count)} />
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Create H5PodPhoto.tsx (BQ2 placeholder)**

```tsx
// frontend/driver-pwa/components/handshake/steps/H5PodPhoto.tsx
// BLOCKED: BQ2 — physical POD photo vs on-device signature pending Bruce confirmation.
// This screen auto-advances after driver acknowledges. Replace when BQ2 is resolved.
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { Button } from '@/components/ui/Button'

interface H5PodPhotoProps {
  tripId: string
  onComplete: () => void
}

export function H5PodPhoto({ tripId, onComplete }: H5PodPhotoProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Unloading" stepName="Photograph POD" stepIndex={4} totalSteps={6} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
        <div className="rounded-xl border-2 border-dashed border-outline-variant p-8 text-center">
          <p className="text-sm font-semibold mb-2">POD capture pending</p>
          <p className="text-xs text-surface-on-variant mb-4">
            Physical vs on-device signature method is pending confirmation (BQ2).
            This step will be fully implemented once the method is confirmed.
          </p>
          <p className="text-xs text-tertiary font-medium">Blocked: BQ2</p>
        </div>
      </div>
      <div className="p-6">
        <Button size="lg" onClick={onComplete}>
          Continue (BQ2 pending)
        </Button>
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Create H5Reconciliation.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H5Reconciliation.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H5Evidence } from '@/lib/types/evidence-draft'

interface H5ReconciliationProps {
  tripId: string
  draft: H5Evidence
  onUpdate: (patch: Partial<H5Evidence>) => void
  onComplete: () => void
}

export function H5Reconciliation({ tripId, draft, onUpdate, onComplete }: H5ReconciliationProps) {
  function handleConfirm() {
    onUpdate({ reconciliationNote: 'Driver confirmed delivery reconciliation at destination.' })
    onComplete()
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Unloading" stepName="Reconciliation" stepIndex={5} totalSteps={6} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Confirm that the unloading is reconciled with the warehouse. Any discrepancies have been logged.
        </p>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 flex flex-col gap-3">
          <div className="flex justify-between">
            <span className="text-sm text-surface-on-variant">Parcels counted at destination</span>
            <span className="text-sm font-bold">{draft.driverVisualCount ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-surface-on-variant">Seal broken & photographed</span>
            <span className="text-sm font-bold">{draft.sealBrokenPhotoDataUrl ? '✓' : '✗'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-surface-on-variant">Waybill handed over</span>
            <span className="text-sm font-bold">{draft.waybillHandedOver ? '✓' : '✗'}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Confirm reconciliation" onConfirm={handleConfirm} />
      </div>
    </main>
  )
}
```

- [ ] **Step 6: Create H5Closed.tsx**

```tsx
// frontend/driver-pwa/components/handshake/steps/H5Closed.tsx
'use client'

import { useRouter } from 'next/navigation'
import { StepHeader } from '@/components/handshake/StepHeader'
import { HoldButton } from '@/components/handshake/HoldButton'
import { ROUTES } from '@/lib/constants/routes'
import type { H5Evidence } from '@/lib/types/evidence-draft'

interface H5ClosedProps {
  tripId: string
  draft: H5Evidence
  onComplete: () => void
}

export function H5Closed({ tripId, draft, onComplete }: H5ClosedProps) {
  const router = useRouter()
  const isReady =
    draft.waybillHandedOver === true &&
    draft.sealBrokenPhotoDataUrl !== null &&
    draft.driverVisualCount !== null

  function handleClose() {
    onComplete()
    router.replace(ROUTES.trips)
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Unloading" stepName="Trip Closed" stepIndex={6} totalSteps={6} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
          <span className="text-4xl">✓</span>
        </div>
        <div>
          <p className="text-xl font-bold">Trip Complete</p>
          <p className="mt-1 text-sm text-surface-on-variant">
            All five handshakes are done. Evidence has been anchored to Hedera HCS.
          </p>
        </div>
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Close trip" onConfirm={handleClose} disabled={!isReady} />
      </div>
    </main>
  )
}
```

---

## Task 12: In-transit hub + exception screen

**Files:**
- Create: `app/(app)/trip/[id]/in-transit/page.tsx`
- Create: `app/(app)/trip/[id]/in-transit/exception/page.tsx`

- [ ] **Step 1: Create in-transit hub page**

```tsx
// frontend/driver-pwa/app/(app)/trip/[id]/in-transit/page.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import { ROUTES } from '@/lib/constants/routes'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { Button } from '@/components/ui/Button'

export default function InTransitPage() {
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
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="text-xs text-surface-on-variant mb-1">Planned arrival</p>
          <p className="text-base font-semibold">
            {trip.planned_arrival_at
              ? new Date(trip.planned_arrival_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
              : 'Not set'}
          </p>
        </section>

        {/* Open exceptions */}
        {openExceptions.length > 0 && (
          <section>
            <p className="mb-2 text-sm font-semibold text-error">
              {openExceptions.length} open exception{openExceptions.length > 1 ? 's' : ''}
            </p>
            <ul className="flex flex-col gap-2">
              {openExceptions.map((exc) => (
                <li key={exc.id} className="rounded-xl bg-error-container/50 px-4 py-3">
                  <p className="text-xs font-semibold text-error-on-container capitalize">
                    {exc.exception_type.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-surface-on-variant mt-0.5 line-clamp-2">{exc.description}</p>
                </li>
              ))}
            </ul>
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
          onClick={() => router.push(ROUTES.handshakeStep(tripId, 4, STEP_SLUGS[4][0]))}
        >
          Arrive at destination →
        </Button>

        {/* Panic */}
        <button
          onClick={() => router.push(ROUTES.panic(tripId))}
          className="mt-2 w-full rounded-xl bg-error py-4 text-sm font-bold uppercase tracking-widest text-white"
        >
          🚨 PANIC
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create exception logging screen**

```tsx
// frontend/driver-pwa/app/(app)/trip/[id]/in-transit/exception/page.tsx
'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTrip } from '@/lib/hooks/useTrip'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/Button'
import type { ExceptionType } from '@shared/lib/types/exception'
import { DRIVER_EXCEPTION_TYPES } from '@shared/lib/constants/status-meta'

// Labels for the driver-selectable exceptions. Options are DERIVED from the shared
// DRIVER_EXCEPTION_TYPES so the picker can never drift to an invalid / non-driver type
// (e.g. system-detected gps_mismatch or route_deviation). The backend remains the
// authority on what each exception means and whether it is valid.
const EXCEPTION_LABELS: Partial<Record<ExceptionType, string>> = {
  delivery_refused:       'Delivery refused',
  cargo_damage:           'Cargo damage',
  seal_broken_in_transit: 'Seal broken in transit',
  mechanical:             'Vehicle breakdown',
  document_review:        'Document issue',
}

// panic_button has its own dedicated flow (Task 13) — exclude it from this picker.
const EXCEPTION_OPTIONS = DRIVER_EXCEPTION_TYPES
  .filter((value) => value !== 'panic_button')
  .map((value) => ({ value, label: EXCEPTION_LABELS[value] ?? value }))

export default function LogExceptionPage() {
  const { id: tripId } = useParams<{ id: string }>()
  const router = useRouter()
  const { logException } = useTrip()
  const [type, setType] = useState<ExceptionType | null>(null)
  const [description, setDescription] = useState('')

  function handleSubmit() {
    if (!type) return
    logException(type, { description })
    router.push(ROUTES.inTransit(tripId))
  }

  return (
    <main className="flex min-h-screen flex-col p-4">
      <button onClick={() => router.back()} className="mb-4 text-sm text-secondary">← Back</button>
      <h1 className="text-xl font-bold mb-6">Log Exception</h1>

      <div className="flex flex-col gap-3 mb-6">
        {EXCEPTION_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setType(opt.value)}
            className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
              type === opt.value
                ? 'border-secondary bg-secondary/10 text-secondary'
                : 'border-outline-variant bg-surface-container-lowest text-surface-on'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <textarea
        className="mb-6 w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-sm resize-none"
        rows={4}
        placeholder="Describe what happened (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <Button size="lg" disabled={!type} onClick={handleSubmit}>
        Submit exception
      </Button>
    </main>
  )
}
```

---

## Task 13: Panic flow

**Files:**
- Create: `app/(app)/trip/[id]/panic/page.tsx`
- Create: `app/(app)/trip/[id]/panic/submitted/page.tsx`

- [ ] **Step 1: Create panic page**

```tsx
// frontend/driver-pwa/app/(app)/trip/[id]/panic/page.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { useTrip } from '@/lib/hooks/useTrip'
import { HoldButton } from '@/components/handshake/HoldButton'
import { ROUTES } from '@/lib/constants/routes'

export default function PanicPage() {
  const { id: tripId } = useParams<{ id: string }>()
  const router = useRouter()
  const { logException } = useTrip()

  function handlePanic() {
    logException('panic_button', {
      description: 'Driver activated panic button.',
      triggeredAt: new Date().toISOString(),
    })
    router.replace(ROUTES.panicSubmitted(tripId))
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-error p-6">
      <div className="text-center text-white">
        <p className="text-5xl mb-4">🚨</p>
        <h1 className="text-2xl font-bold mb-2">Panic Alert</h1>
        <p className="text-sm opacity-90">
          Hold the button below to send an emergency alert to your dispatcher.
          Your GPS location will be included.
        </p>
      </div>
      <HoldButton
        label="SEND PANIC"
        durationMs={3000}
        onConfirm={handlePanic}
        variant="danger"
      />
      <button
        onClick={() => router.back()}
        className="text-sm text-white/70 underline"
      >
        Cancel — return to in-transit
      </button>
    </main>
  )
}
```

- [ ] **Step 2: Create panic submitted page**

```tsx
// frontend/driver-pwa/app/(app)/trip/[id]/panic/submitted/page.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/Button'

export default function PanicSubmittedPage() {
  const { id: tripId } = useParams<{ id: string }>()
  const router = useRouter()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <p className="text-5xl">✅</p>
      <h1 className="text-xl font-bold">Alert sent</h1>
      <p className="text-sm text-surface-on-variant max-w-xs">
        Your dispatcher has been notified. Stay calm and wait for contact.
        This event has been recorded and timestamped.
      </p>
      <Button size="lg" onClick={() => router.replace(ROUTES.inTransit(tripId))}>
        Return to in-transit
      </Button>
    </main>
  )
}
```

---

## Final verification (run once, after all tasks are complete)

This is the **only** place tests, type-checks, build, and commits happen. Individual tasks
create files and write their test code, but do not run verification in isolation — run it
all here, fix any failures, then commit the feature as a unit.

**1. Automated checks** — all must pass before the smoke test:

```bash
cd frontend/driver-pwa
npm test            # vitest: useHandshakeDraft ×4, useOfflineQueue ×3, nextHandshakeRoute ×4
npm run type-check  # zero TypeScript errors
npm run build       # output: 'export' build succeeds; out/ is populated with static HTML
```

**2. Golden-path smoke test:**

```bash
cd frontend/driver-pwa && npm run dev   # http://localhost:3001
```

1. Home → redirected to `/login`
2. Login with phone → OTP → redirected to `/trips` (confirm `AuthContext.user` is set — no bounce)
3. Tap a trip → trip detail page with handshake list
4. H1: `1-approach-gate` (GPS) → `2-entry-photo` (camera) → `3-verification` (hold-to-submit) → back to trips
5. Refresh mid-flow on a `…/step/…` URL → lands on the **same** step (URL-driven nav, no desync)
6. In-transit hub loads for an `in_transit` trip; exception picker shows only driver-selectable types
7. Panic hold-to-confirm works and navigates to submitted

Expected: all screens render without console errors; hold-to-confirm ring animates; camera opens the file picker in browser.

**3. Self-review gates** — every box must be true:

- [ ] All 20 handshake step components created and wired into the dispatcher
- [ ] H5 step 4 placeholder clearly marked as BQ2-blocked
- [ ] `useHandshakeDraft` persists evidence in localStorage across navigation
- [ ] `useOfflineQueue` queues and retries on reconnect
- [ ] `submitHandshake` returns mock success in demo mode (`NEXT_PUBLIC_DEMO_MODE=true`)
- [ ] No `any` types introduced; every prop typed
- [ ] `"use client"` on every page and component
- [ ] `ROUTES.*` used for every navigation — no string literals
- [ ] Navigation derived from the URL via `nextHandshakeRoute` — no reliance on TripContext step state
- [ ] Trip resolved by URL `id` on each screen — not from `TripContext.trip`
- [ ] Login/OTP populate `AuthContext` so the `(app)` guard works
- [ ] Exception picker sourced from `DRIVER_EXCEPTION_TYPES` — no invalid `ExceptionType` literals
- [ ] Design-system tokens + `components/ui/*` only — no raw `text-gray-*` / `text-blue-*` / `bg-white`
- [ ] No business logic in the frontend — evidence is collected/displayed/submitted; backend computes & validates
- [ ] `output: 'export'` build passes; hook + navigation unit tests pass

> **Suggested commit:** `feat(driver-pwa): full H1–H5 handshake flow, in-transit hub, panic + offline queue`

## New .env keys required

```
NEXT_PUBLIC_DEMO_MODE=true        # set true to skip real backend calls (demo)
NEXT_PUBLIC_API_URL=              # backend base URL (empty = localhost:8000)
```

Add both keys to `frontend/driver-pwa/.env.example` (values empty).
