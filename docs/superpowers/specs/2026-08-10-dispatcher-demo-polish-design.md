# Dispatcher Portal Demo Polish

**Date:** 2026-08-10
**Author:** Ciaran
**Branch:** dev
**Status:** Approved design — ready for implementation plan

## Goal

Seven independent, small UI/UX fixes in the dispatcher portal ahead of a
demo: relabel the confirmation-phase signature, drop the never-wired anchor
status display, move the linehaul document to the correct phase, hide two
not-yet-live nav items and their dashboard surfacing, drop a
does-nothing-yet verification section, and warn dispatchers about an
already-assigned waybill at search time instead of only at submit. Each item
stands alone — none depend on each other, and each can ship as its own
commit.

## Context

Codebase note: the frontend lives at `frontend/dispatcher/` (not a
top-level `dispatcher/`); backend at `backend/app/`.

Two behaviors recur across several items and are worth stating once:

- **Anchor status is asynchronous by design.** `phase_service.py`'s
  `_dispatch_anchor` queues the Hedera submit on a Celery worker after the
  request commits, so `anchor_status` returns `pending` on the initial
  response and only flips to `anchored`/`failed` once the worker lands the
  receipt. In a dev/demo setup without a running worker, or without the
  frontend re-fetching, it reads `pending` indefinitely. This is not a bug
  to fix here — it's why items 1 and 5 remove the display for the demo
  rather than trying to make it read correctly.
- **`waybill_photo_artifact_id` vs `linehaul_photo_artifact_id`.** Two
  distinct backend fields exist. `waybill_photo_artifact_id` is captured at
  departure; its driver-facing step label was renamed to "Photograph
  Linehaul Document" at some point but the field/slug stayed `waybill`.
  `linehaul_photo_artifact_id` is a separate field genuinely captured at
  loading (`LoadingCompleteRequest`, `backend/app/schemas/phases.py`) but is
  not wired into the frontend `PhaseDescriptor` type or `LoadingDetail.tsx`
  at all. Item 2 uses the first field (the one the driver actually
  populates today) rather than wiring up the second, unused one — see
  Decisions.

## Decisions (from brainstorming)

1. **Signature (item 1):** keep the existing document-link treatment
   (`EvidenceDocument`, "Open ↗"), just relabel it to make clear it's the
   cryptographic signature. No new raw-value display, no verify badge —
   out of scope for this pass.
2. **Anchor removal (item 1):** remove anchor status display from all three
   locations — `PhaseAnchorSection` on Confirmation and Departure, and the
   inline `Field label="Anchor"` on Activation. Leave `PhaseAnchorSection.tsx`
   itself in the codebase, unused, rather than deleting it — it's real code
   for a feature that isn't wired up yet, not dead code.
3. **Linehaul doc (item 2):** move the existing `waybill_photo_artifact_id`
   evidence block from `DepartureDetail.tsx` to `LoadingDetail.tsx`,
   relabeled "Linehaul document." Do not wire up the separate
   `linehaul_photo_artifact_id` field — that's a larger change (new shared
   type field, backend response wiring) out of scope for this polish pass.
4. **Verification section (item 5):** remove the entire section from
   `ActivationDetail.tsx` — Identity check, Anchor (already covered by
   decision 2), and Gate photo all go. None of the three are backed by a
   live signal yet.
5. **Dashboard/active-trips exceptions (item 4):** remove only the
   "Exceptions today" stat card and the "N exceptions need review" banner
   from `app/page.tsx`. `ChecklistRow.tsx`'s per-row red-border accent and
   "⚠ N exception(s)" progress hint stay — those are driven by real
   `open_exception_count` data, not mocks.
6. **Seal vs. parcel mismatch ordering (item 6):** no code change. The
   ordering is structural — seal mismatch can only be evaluated once the
   driver keys in the destination seal number in the final
   `UnloadingCompleteRequest`, while parcel mismatch is a side effect of the
   live warehouse scan feed that can fire any time the phase is open.
   Fixing it would mean restructuring the driver-pwa unloading capture flow
   to make seal entry its own earlier step — out of scope right before a
   demo. Documented here as known behavior for future backlog.
7. **Waybill duplicate check (item 7):** extend the existing
   `GET /api/v1/pp/waybills/{ref}` response rather than adding a new
   endpoint. The waybill summary still displays in full (so the dispatcher
   can see it's a real, valid waybill) but the "Add" action is disabled
   with a message naming the trip it's already assigned to. The final
   fail-closed check in `create_trip` is unchanged.

## Design

### Item 1 — Signature relabel + anchor removal

`frontend/dispatcher/components/domain/ConfirmationDetail.tsx` (~lines 42-51):
rename the `EvidenceDocument label="POD signature"` to
`label="POD signature (Ed25519)"` (or similar — final wording at
implementation time). Remove `<PhaseAnchorSection phase={phase} />` (line 76).

`frontend/dispatcher/components/domain/DepartureDetail.tsx` (~line 52):
remove `<PhaseAnchorSection phase={phase} />`.

`frontend/dispatcher/components/domain/ActivationDetail.tsx`: covered under
item 5 (the whole Verification section, including this field, is removed).

### Item 2 — Linehaul document moves to Loading

`frontend/dispatcher/components/domain/DepartureDetail.tsx` (~lines 38-45):
remove the `EvidencePhoto label="Waybill photo"` block from the Seal section.

`frontend/dispatcher/components/domain/LoadingDetail.tsx`: add a new
`<Section title="Linehaul document">` rendering the same
`waybill_photo_artifact_id` artifact via `EvidencePhoto`, labeled "Linehaul
document." No changes to `frontend/shared/lib/types/phase.ts` or any backend
file — same field, same artifact lookup (`artifactsById`), just relocated.

### Item 3 — Sidebar SLA/Exceptions

`frontend/dispatcher/components/layout/Sidebar.tsx`: remove the `Exceptions`
entry from the `TRIPS` group (~line 40) and the `SLA Reports` entry from the
`REPORTING` group (~line 46) in `NAV_GROUPS`. Remove the associated
`useExceptions`-driven badge wiring (~lines 118-126) that only applied to
the Exceptions nav item. Routes (`app/(app)/exceptions/`, `app/(app)/sla/`)
and `lib/constants/routes.ts` entries stay — just unlinked from nav.

### Item 4 — Dashboard/active-trips exceptions

`frontend/dispatcher/app/(app)/page.tsx`: remove the `StatCard` with label
"Exceptions today" (~line 212) and the exception banner block (~lines
239-255, the "N exceptions need review · Review →" row). Remove the
`openExceptions`/`useExceptions` call and `exceptionDescription` builder
(~lines 102, 147-153) once nothing else in the file references them.

`frontend/dispatcher/components/domain/ChecklistRow.tsx`: no change.

### Item 5 — Activation card Verification section

`frontend/dispatcher/components/domain/ActivationDetail.tsx` (~lines 44-51):
remove the entire `<Section title="Verification">` block — `Field label="Identity check"`,
`Field label="Anchor"`, and `EvidencePhoto label="Gate photo"` all go. Remove
the now-unused `IDVS_LABELS` constant (~lines 21-25) if nothing else in the
file references it.

### Item 6 — Seal vs. parcel mismatch ordering

No code change. This section exists in the spec purely as a record of the
decision and its rationale (see Decisions #6), so it isn't re-litigated
later.

### Item 7 — Waybill duplicate check at search time

**Backend** — `backend/app/api/v1/endpoints/pp.py` (`GET
/api/v1/pp/waybills/{waybill_number}`, ~lines 39-55): after fetching the PP
summary, call into `backend/app/orchestration/consignment_service.py` to
check whether a `Consignment` row already exists for this `pp_reference`
with a non-null `trip_id`. If so, add an `already_assigned_to_trip: str |
None` field (the owning trip's reference) to the response schema
(`backend/app/schemas/pp.py` or wherever `PPWaybillSummary` lives). This
follows the existing layering — the endpoint stays thin, calling into
`orchestration/` for the FreightProof-side check and `integrations/`
(via `pp_lookup_service`) for the PP-side data, same as today.

**Frontend** — `frontend/dispatcher/app/(app)/trips/new/page.tsx`,
`pullWaybill()` (~lines 312-329): read the new
`already_assigned_to_trip` field from the response. If present, still show
the full waybill summary (customer, parcel count, weight, destination —
proves it's a real waybill) but set a status akin to the existing
`'duplicate'` state used for same-session dupes, disabling the "Add"
control. Message: something like "Already assigned to trip
{already_assigned_to_trip}" — distinct wording from the existing "Already
added to this trip" (same-session) message so dispatchers can tell the two
cases apart.

No change to `handleSubmit` (~lines 400-454) or the 409 handling — the
fail-closed check in `create_trip` → `fetch_and_sync_consignment` stays as
the authoritative last line of defense.

## Testing

**Item 7 (the only item touching backend logic) needs tests per project
standard:**

- Integration (`backend/tests/integration/test_pp.py` or similar): waybill
  lookup for a reference already assigned to another trip returns
  `already_assigned_to_trip` populated with the correct trip reference;
  lookup for an unassigned waybill returns it as `None`.
- No regression to the existing `create_trip` 409 fail-closed path — assert
  it's untouched (no new test needed if existing coverage already exercises
  it; confirm during implementation).

**Correction from initial research:** `dispatcher/` does have a component
test runner (`vitest`, `npm run test`) with existing suites for
`ConfirmationDetail`, `LoadingDetail`, and `UnloadingDetail` specifically —
the two components items 1 and 2 touch most directly. Those get real
`vitest` coverage, not just smoke. `ActivationDetail`, `DepartureDetail`,
`Sidebar`, and `app/page.tsx` have no existing suite, so those stay on
`npx tsc --noEmit` + manual smoke, consistent with how untested surfaces are
already handled elsewhere in this codebase.

- `ConfirmationDetail.test.tsx`: new cases asserting the relabeled signature
  text renders and the anchor section is gone.
- `LoadingDetail.test.tsx`: new cases asserting the linehaul document
  section renders the artifact when present and "Not captured" when not;
  existing cases updated to pass the newly-required `artifactsById` prop.
- Manual smoke for the rest: load a trip at each affected phase (activation,
  loading, departure, confirmation, unloading) and confirm the removed
  sections are gone and the moved linehaul doc appears under loading. Also
  smoke the sidebar (SLA/Exceptions absent) and dashboard (banner/stat card
  absent, but per-row exception indicators on trips with real
  `open_exception_count` still show).
- The wizard step-1 duplicate-warning UI (item 7 frontend half) has no
  existing test suite either — verified by manual smoke (search an
  already-assigned waybill, confirm the summary shows with Add disabled and
  the owning trip named) plus `tsc --noEmit`. The backend half (the
  authoritative check) gets full `pytest` coverage — see below.

## Out of scope

- Wiring up real anchor status (Hedera worker visibility, live polling) —
  item 1/5 remove the display rather than fix the underlying async gap.
- Wiring up the unused `linehaul_photo_artifact_id` field — item 2 reuses
  the field the driver already populates instead.
- Any driver-pwa changes — items 2 and 6 both touch driver-captured data
  but no driver-pwa file changes; item 6 explicitly declines the flow
  restructuring that would require them.
- IDVS identity verification — item 5 removes the placeholder display, does
  not implement the check.
- Any change to `create_trip`'s fail-closed 409 behavior — item 7 adds an
  earlier warning, not a replacement for the existing server-side gate.

## Cross-dev / shared-file flags

- No changes to any file listed in CLAUDE.md's shared-files section
  (`main.py`, `core/config.py`, `db/models/__init__.py`, dependency
  manifests, docker-compose, CLAUDE.md itself).
- `backend/app/schemas/pp.py` (or wherever `PPWaybillSummary` is defined)
  gains a new optional field — additive, should not break other consumers,
  but flag in TASK COMPLETE since it's a shared response schema.
- No migrations — item 7 reads existing `Consignment.trip_id`, no new
  columns.

---

# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git note (overrides the skill default):** this project's CLAUDE.md forbids Claude from ever running `git commit`. Every task below ends with `git add` (staging) instead of `git commit` — staging only, never committing. The developer reviews `git diff --staged` and commits themselves.

**Goal:** Ship all seven dispatcher-portal demo-polish items from the spec above as eight small, independent, stageable changes.

**Architecture:** No new subsystems — every task is a targeted edit to an existing component, page, or endpoint, following whatever pattern that file already uses. Two tasks (4 and 6) touch components with existing `vitest` suites and get real test coverage; the rest are typecheck + manual smoke, consistent with this codebase's existing test footprint. Task 7 (backend) gets full `pytest` unit + integration coverage per project standard.

**Tech Stack:** Next.js 15 / React 19 / TypeScript (`frontend/dispatcher/`, `frontend/shared/`), `vitest` + `@testing-library/react`; FastAPI / SQLAlchemy 2.0 / Pydantic v2 (`backend/app/`), `pytest` + `pytest-asyncio` + `httpx.AsyncClient`.

**Task order:** 1–6 (frontend-only) can run in any order — each touches disjoint files. 7 must run before 8 (frontend step-1 warning depends on the backend field existing). Item 6 (seal vs. parcel mismatch ordering) has no task — see the note after Task 8.

---

### Task 1: Sidebar — hide SLA and Exceptions (item 3)

**Files:**
- Modify: `frontend/dispatcher/components/layout/Sidebar.tsx`

- [ ] **Step 1: Remove the two nav entries and the now-empty REPORTING group**

In `NAV_GROUPS`, delete the `Exceptions` entry from the `TRIPS` group and delete the entire `REPORTING` group (its only item was `SLA Reports`):

```tsx
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
```

- [ ] **Step 2: Remove the exceptions-badge wiring and its now-unused import**

Replace:

```tsx
import { useExceptions } from '@/lib/hooks/useExceptions'
```

by deleting that import line entirely (it has no other use in this file).

Then in `SidebarContent`, replace:

```tsx
function SidebarContent({ onClose }: SidebarContentProps) {
  const pathname = usePathname()
  const { user } = useAuth()
  const openExceptions = useExceptions({ resolved: false })
  const navGroups = NAV_GROUPS.map(g => ({
    ...g,
    items: g.items.map(item =>
      item.href === ROUTES.exceptions && openExceptions.length > 0
        ? { ...item, badge: openExceptions.length }
        : item,
    ),
  }))

  return (
```

with:

```tsx
function SidebarContent({ onClose }: SidebarContentProps) {
  const pathname = usePathname()
  const { user } = useAuth()

  return (
```

And further down, replace `{navGroups.map(group => (` with `{NAV_GROUPS.map(group => (` (the derived `navGroups` variable no longer exists).

- [ ] **Step 3: Typecheck**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke**

Run the dispatcher dev server, confirm the sidebar shows Dashboard, Create Trip, Trip History, Vehicles, Drivers — no Exceptions, no SLA Reports, no REPORTING group heading.

- [ ] **Step 5: Stage**

```bash
git add frontend/dispatcher/components/layout/Sidebar.tsx
```

Suggested commit message: `fix(dispatcher): hide SLA and Exceptions nav entries — not yet live`

---

### Task 2: Dashboard — remove exceptions banner and stat card (item 4)

**Files:**
- Modify: `frontend/dispatcher/app/(app)/page.tsx`

- [ ] **Step 1: Remove the now-unused imports**

Replace:

```tsx
import { useTrips }       from '@/lib/hooks/useTrips'
import { useAuth }        from '@/lib/hooks/useAuth'
import { useExceptions }  from '@/lib/hooks/useExceptions'
import { mockTrips }      from '@shared/lib/mocks/trips'
import { usePrecincts }   from '@/lib/hooks/usePrecincts'
```

with:

```tsx
import { useTrips }       from '@/lib/hooks/useTrips'
import { useAuth }        from '@/lib/hooks/useAuth'
import { usePrecincts }   from '@/lib/hooks/usePrecincts'
```

- [ ] **Step 2: Remove the `openExceptions` hook call**

Replace:

```tsx
  const { trips: allFetchedTrips, isLoading: tripsLoading, error: tripsError, refetch: refetchTrips } = useTrips()
  const { precincts, error: precinctsError } = usePrecincts()
  const openExceptions = useExceptions({ resolved: false })
```

with:

```tsx
  const { trips: allFetchedTrips, isLoading: tripsLoading, error: tripsError, refetch: refetchTrips } = useTrips()
  const { precincts, error: precinctsError } = usePrecincts()
```

- [ ] **Step 3: Remove the `exceptionDescription` builder**

Replace:

```tsx
  const exceptionDescription = useMemo(() => {
    return openExceptions.slice(0, 2).map(e => {
      const trip = mockTrips.find(t => t.id === e.trip_id)
      const ref  = trip?.trip_reference ?? 'Unknown'
      return `${ref}: ${e.exception_type.replace(/_/g, ' ')}`
    }).join(' · ')
  }, [openExceptions])

  const filteredTrips = useMemo(() => {
```

with:

```tsx
  const filteredTrips = useMemo(() => {
```

- [ ] **Step 4: Remove the "Exceptions today" stat card**

Replace:

```tsx
      <div className="flex gap-3 px-6 py-4 bg-surf-low shrink-0">
        <StatCard value={String(allTrips.length)}       label="Active trips"      loading={tripsLoading} />
        <StatCard value={String(openExceptions.length)} label="Exceptions today" warn={openExceptions.length > 0} />
        <StatCard value={String(completedCount)}         label="Completed today"   loading={tripsLoading} />
        <StatCard value={`${onTimePercent}%`}            label="On-time rate (30d)" success={onTimePercent >= 90} warn={onTimePercent < 70} loading={tripsLoading} />
      </div>
```

with:

```tsx
      <div className="flex gap-3 px-6 py-4 bg-surf-low shrink-0">
        <StatCard value={String(allTrips.length)}       label="Active trips"      loading={tripsLoading} />
        <StatCard value={String(completedCount)}         label="Completed today"   loading={tripsLoading} />
        <StatCard value={`${onTimePercent}%`}            label="On-time rate (30d)" success={onTimePercent >= 90} warn={onTimePercent < 70} loading={tripsLoading} />
      </div>
```

- [ ] **Step 5: Remove the "N exceptions need review" banner**

Replace:

```tsx
        <SecHead
          title="Active Trips"
          action="New Trip"
          onAction={() => router.push(ROUTES.tripNew)}
        />

        {openExceptions.length > 0 && (
          <div className="flex items-center gap-2 px-6 py-[7px] bg-err/8 border-b border-err/20 shrink-0">
            <Ic n="warn" s={13} className="text-err shrink-0" />
            <span className="text-[12px] font-[600] text-err">
              {openExceptions.length} exception{openExceptions.length > 1 ? 's' : ''} need review
            </span>
            {exceptionDescription && (
              <span className="text-[11px] text-err/60 truncate">· {exceptionDescription}</span>
            )}
            <button
              onClick={() => router.push(ROUTES.exceptions)}
              className="ml-auto text-[12px] font-[600] text-err hover:text-err/80 transition-colors shrink-0"
            >
              Review →
            </button>
          </div>
        )}

        {/* Table scroll area */}
```

with:

```tsx
        <SecHead
          title="Active Trips"
          action="New Trip"
          onAction={() => router.push(ROUTES.tripNew)}
        />

        {/* Table scroll area */}
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual smoke**

Load the dashboard: confirm the stat strip shows Active trips / Completed today / On-time rate only (no Exceptions today), and no banner appears above the table regardless of whether any trip has open exceptions. `ChecklistRow`'s own per-row red border and `⚠ N exception(s)` hint (unrelated code path) should be unaffected — confirm a trip with a real open exception still shows those.

- [ ] **Step 8: Stage**

```bash
git add "frontend/dispatcher/app/(app)/page.tsx"
```

Suggested commit message: `fix(dispatcher): remove exceptions banner and stat card from dashboard — not yet live`

---

### Task 3: Activation card — remove the Verification section (item 5, includes item 1's Activation anchor removal)

**Files:**
- Modify: `frontend/dispatcher/components/domain/ActivationDetail.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the full contents of `ActivationDetail.tsx` with:

```tsx
'use client'

import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import type { Trip } from '@shared/lib/types/trip'

interface Props {
  phase: PhaseDescriptor
  trip: Trip
  // The precinct this phase is anchored to, resolved by the page from phase.stop_sequence.
  precinct: Precinct | undefined
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

export function ActivationDetail({ phase, trip, precinct }: Props) {
  const stop = phase.stop_sequence === null
    ? undefined
    : trip.stops.find(s => s.sequence === phase.stop_sequence)

  return (
    <PhaseDetailCard>

      <Section title="Expected location">
        <Field label="Precinct"  value={precinct?.name} span />
        <Field label="Address"   value={precinct?.address} span />
        <Field label="Slot time" value={fmtDateTime(stop?.slot_time)} />
        <Field label="Arrived"   value={phase.completed_at ? fmtDateTime(phase.completed_at) : 'Not yet'} />
      </Section>

      <PhaseLocationSection phase={phase} precinct={precinct} />

      {/* An override means a human bypassed a check. It is never a footnote — and it is
          no longer only activation's concern, so the rendering is shared. */}
      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
```

Note: `artifactsById` stays in `Props` (the call site in `trips/[id]/page.tsx` still passes it) but is no longer destructured in the function signature, since nothing in the component body needs it anymore — this avoids touching the call site.

- [ ] **Step 2: Typecheck**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke**

Open a trip's activation phase card: confirm "Expected location" and the location map section still render, and "Verification" (Identity check / Anchor / Gate photo) is gone entirely.

- [ ] **Step 4: Stage**

```bash
git add frontend/dispatcher/components/domain/ActivationDetail.tsx
```

Suggested commit message: `fix(dispatcher): remove non-functional Verification section from activation card`

---

### Task 4: Confirmation phase — relabel signature, remove anchor section (item 1)

**Files:**
- Modify: `frontend/dispatcher/components/domain/ConfirmationDetail.tsx`
- Test: `frontend/dispatcher/components/domain/__tests__/ConfirmationDetail.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add two new `it` blocks inside the existing `describe('ConfirmationDetail', ...)` in `ConfirmationDetail.test.tsx`, after the last existing test:

```tsx
  it('labels the POD signature as the cryptographic signature, not a generic document', () => {
    render(
      <ConfirmationDetail
        phase={makePhase('confirmation')}
        originScannedCount={null}
      />,
    )

    expect(screen.getByText('POD signature (Ed25519)')).toBeInTheDocument()
  })

  it('does not render an anchor status section', () => {
    render(
      <ConfirmationDetail
        phase={makePhase('confirmation')}
        originScannedCount={null}
      />,
    )

    expect(screen.queryByText('Anchor')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run ConfirmationDetail`
Expected: the new "labels the POD signature" test FAILs (current label is `POD signature`, no `(Ed25519)`); the new "does not render an anchor status section" test PASSes-or-FAILs depending on current state — it should FAIL, since `PhaseAnchorSection` (which renders a "Status" field, not literal text "Anchor" as a Field label — but it does render `<Section title="Anchor">`, and `Section` renders its `title` as visible text) is still present before Step 3.

- [ ] **Step 3: Implement — rewrite `ConfirmationDetail.tsx`**

Replace the full contents of the file with:

```tsx
'use client'

import { EvidenceDocument } from './EvidenceDocument'
import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  /** Parcels scanned onto the truck at this consignment's PICKUP stop — which on a
   *  cross-dock trip is not the stop immediately before this one. */
  originScannedCount: number | null
  // Both optional: the POD/location sections below are unaffected by the
  // reconciliation redesign this component exists for, but the trip detail page's
  // call site still has both to give, so they are defaulted rather than dropped.
  precinct?: Precinct | undefined
  artifactsById?: Map<string, EvidenceArtifactWithUrl>
}

// The reconciliation is parcel-grain on both sides and sourced from two independent depot
// systems. The driver's count is parcels too (team decision) — it is excluded from the
// verdict not because it counts a different unit, but because it is a BLIND, independent
// observation: the driver is never shown an expected number before committing his own
// (the F1 fence on unloading/VisualCount.tsx). Folding it into the automated verdict
// would spend that independence for nothing, since the two depot scans already settle
// the count. It is recorded and anchored as evidence in its own right.
export function ConfirmationDetail({
  phase, originScannedCount, precinct, artifactsById = new Map(),
}: Props) {
  const destination = phase.parcel_count_destination
  const hasBoth = originScannedCount !== null && destination !== null
  const unaccounted = hasBoth ? originScannedCount - destination : 0

  return (
    <PhaseDetailCard>

      <Section title="Proof of delivery">
        <EvidencePhoto
          label="POD photo"
          artifact={phase.pod_photo_artifact_id ? artifactsById.get(phase.pod_photo_artifact_id) : undefined}
        />
        <EvidenceDocument
          label="POD signature (Ed25519)"
          artifact={phase.pod_signature_artifact_id ? artifactsById.get(phase.pod_signature_artifact_id) : undefined}
        />
      </Section>

      <Section title="Chain of custody">
        <Field label="Scanned out (origin depot)" value={originScannedCount?.toString()} />
        <Field label="Scanned in (destination depot)" value={destination?.toString()} />
      </Section>
      {hasBoth && (
        <div className={`text-[11px] font-[600] px-3 pb-3 ${unaccounted === 0 ? 'text-ok' : 'text-warn'}`}>
          {unaccounted === 0
            ? 'Counts agree ✓'
            : `${unaccounted} parcel unaccounted for in transit ✗`}
        </div>
      )}

      <Section title="Driver observation">
        <Field label="Parcels counted by driver" value={phase.driver_visual_count?.toString()} />
      </Section>
      <div className="text-[11px] text-on-surf-v px-3 pb-3">
        Counted blind — recorded as independent evidence, not reconciled against the scans above.
      </div>

      <PhaseLocationSection phase={phase} precinct={precinct} title="Location at confirmation" />

      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
```

This drops the `PhaseAnchorSection` import and its render call.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run ConfirmationDetail`
Expected: all 5 tests (3 existing + 2 new) PASS.

- [ ] **Step 5: Typecheck**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Stage**

```bash
git add frontend/dispatcher/components/domain/ConfirmationDetail.tsx frontend/dispatcher/components/domain/__tests__/ConfirmationDetail.test.tsx
```

Suggested commit message: `fix(dispatcher): relabel POD signature and drop anchor section on confirmation phase`

---

### Task 5: Departure phase — remove anchor section and waybill photo (item 1 + item 2 part A)

**Files:**
- Modify: `frontend/dispatcher/components/domain/DepartureDetail.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the full contents of `DepartureDetail.tsx` with:

```tsx
'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { PhaseLocationSection } from './PhaseLocationSection'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  precinct: Precinct | undefined
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

export function DepartureDetail({ phase, precinct, artifactsById }: Props) {
  return (
    <PhaseDetailCard>

      {/* Each departure carries its OWN seal, so a cross-dock trip visibly shows a
          different seal per leg. Never hoist this to the trip. */}
      <Section title="Seal">
        <div className="col-span-2">
          <div className="text-[10px] text-on-surf-v mb-[3px]">Seal number</div>
          {phase.seal_number ? (
            // Reuses the sidebar's seal badge exactly, translated off the legacy `bg-primary`/
            // `text-white`/`var(--r-sm)` tokens onto their shorthand equivalents (same hex,
            // real radius scale) — see DepartureDetail report for the mapping.
            <span className="font-mono tracking-[0.06em] font-[700] text-[13px] bg-on-surf text-surf-lowest rounded-sm px-[10px] py-[3px]">
              {phase.seal_number}
            </span>
          ) : (
            <span className="text-[12px] text-on-surf-v">Not captured</span>
          )}
        </div>
        <EvidencePhoto
          label="Seal photo"
          artifact={phase.seal_photo_artifact_id ? artifactsById.get(phase.seal_photo_artifact_id) : undefined}
        />
      </Section>

      <PhaseLocationSection phase={phase} precinct={precinct} title="Location at departure" />

      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
```

This drops the `PhaseAnchorSection` import/render call and the "Waybill photo" `EvidencePhoto` block (that evidence moves to `LoadingDetail` in Task 6 — it is the same `waybill_photo_artifact_id`, not a new field).

- [ ] **Step 2: Typecheck**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke**

Open a trip's departure phase card: confirm "Seal" section still shows seal number + seal photo, "Waybill photo" is gone, and the "Anchor" section is gone.

- [ ] **Step 4: Stage**

```bash
git add frontend/dispatcher/components/domain/DepartureDetail.tsx
```

Suggested commit message: `fix(dispatcher): remove anchor section and move linehaul doc off departure phase`

---

### Task 6: Loading phase — add the Linehaul document section (item 2 part B)

**Files:**
- Modify: `frontend/dispatcher/components/domain/LoadingDetail.tsx`
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx:793-797`
- Test: `frontend/dispatcher/components/domain/__tests__/LoadingDetail.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `LoadingDetail.test.tsx` with (adds the `ForensicOnly` mock needed now that `LoadingDetail` renders `EvidencePhoto`, adds `artifactsById` to every existing render call since it becomes a required prop, and adds two new tests):

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoadingDetail } from '../LoadingDetail'
import { makePhase } from './testFixtures'
import type { ArtifactId, EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

// LoadingDetail now renders EvidencePhoto for the linehaul document, which mounts
// ForensicOnly for any artifact with provenance to show. ForensicOnly needs a real
// ForensicModeProvider (itself gated on useAuth) to render at all — mocked at the
// module boundary the same way ConfirmationDetail.test.tsx and UnloadingDetail.test.tsx
// isolate themselves, since this suite is about the warehouse-scan verdict and the
// linehaul document presence, not forensic-mode plumbing.
vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()

describe('LoadingDetail', () => {
  it('shows the stamped count once the phase is resolved', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', parcel_count_origin: 2 }}
        expectedCount={3}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.getByText('Scanned onto truck')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('flags a short scan once resolved', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', parcel_count_origin: 2 }}
        expectedCount={3}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.getByText(/1 not scanned/i)).toBeInTheDocument()
  })

  it('shows no verdict when there is no manifest baseline', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', parcel_count_origin: null }}
        expectedCount={null}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.queryByText(/not scanned/i)).not.toBeInTheDocument()
  })

  // Regression guard for the live/stamped distinction: while the phase is still open,
  // the panel must show the LIVE scanned_out_count, not the (not-yet-final) stamped
  // parcel_count_origin, and must label it differently so a viewer can tell the two
  // apart on screen.
  it('shows the live count, distinctly labelled, while the phase is unresolved', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'in_progress', parcel_count_origin: null }}
        expectedCount={3}
        liveScannedOutCount={2}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.getByText('Scanned onto truck (in progress)')).toBeInTheDocument()
    expect(screen.queryByText('Scanned onto truck')).not.toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('ignores a stray stamped figure while unresolved and reads the live count instead', () => {
    render(
      <LoadingDetail
        // parcel_count_origin should never be non-null on an unresolved row in practice,
        // but the component must still prefer the live figure if it somehow is.
        phase={{ ...makePhase('loading'), status: 'in_progress', parcel_count_origin: 9 }}
        expectedCount={3}
        liveScannedOutCount={1}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('9')).not.toBeInTheDocument()
  })

  it('shows the linehaul document photographed at loading', () => {
    const artifact: EvidenceArtifactWithUrl = {
      id: 'artifact-1' as ArtifactId,
      trip_id: 'trip-1',
      artifact_type: 'photo',
      s3_key: 'key',
      s3_bucket: 'bucket',
      file_hash: 'abc123',
      mime_type: 'image/jpeg',
      captured_at: '2026-01-01T00:00:00Z',
      captured_by_driver_id: null,
      captured_by_user_id: null,
      captured_lat: null,
      captured_lng: null,
      created_at: '2026-01-01T00:00:00Z',
      signed_url: 'https://example.test/artifact-1',
    }
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', waybill_photo_artifact_id: 'artifact-1' }}
        expectedCount={null}
        liveScannedOutCount={null}
        artifactsById={new Map([['artifact-1', artifact]])}
      />,
    )

    expect(screen.getByText('Linehaul document')).toBeInTheDocument()
    expect(screen.getByAltText('Linehaul document')).toBeInTheDocument()
  })

  it('shows not captured when no linehaul document has been photographed yet', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'in_progress', waybill_photo_artifact_id: null }}
        expectedCount={null}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.getByText('Linehaul document')).toBeInTheDocument()
    expect(screen.getByText('Not captured')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail and the old ones fail to compile/run**

Run: `cd frontend/dispatcher && npx vitest run LoadingDetail`
Expected: FAIL — `artifactsById` is not yet a prop on `LoadingDetail`, so this won't even type-check/render correctly, and the two new "linehaul document" tests fail outright since the section doesn't exist yet.

- [ ] **Step 3: Implement — rewrite `LoadingDetail.tsx`**

Replace the full contents of the file with:

```tsx
'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { isClosedPhaseStatus } from '@/lib/types/dev'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

interface Props {
  phase: PhaseDescriptor
  /** Manifest baseline from Parcel Perfect's tracks[]. Null when the trip carries no
   *  PP reference — common, and not a failure. */
  expectedCount: number | null
  /** Live, summed scanned_out_count over the consignments picked up at THIS stop —
   *  recomputed per request from Parcel rows. Read only while loading is still open;
   *  once the phase resolves, phase.parcel_count_origin (the stamped tally) takes over
   *  and this is ignored even if still supplied. Null when nothing on the manifest is
   *  booked to collect here — distinct from a real 0 scanned so far. */
  liveScannedOutCount: number | null
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

// Loading is now system-observed: the warehouse's scan is what records what went on the
// truck, and parcel_count_origin is the scanned tally stamped at close. The driver's own
// count is gone — he never enters the warehouse and could not honestly produce one.
export function LoadingDetail({ phase, expectedCount, liveScannedOutCount, artifactsById }: Props) {
  // Governing distinction: parcel_count_origin is written ONCE at phase close and is the
  // evidence; scanned_out_count is recomputed every request and still moving until then.
  // Swapping a live figure in where the stamped one belongs (or vice versa) is the one
  // thing this panel must not do — hence the resolved/unresolved branch, not a fallback.
  const resolved = isClosedPhaseStatus(phase.status)
  const scanned = resolved ? phase.parcel_count_origin : liveScannedOutCount
  const scannedLabel = resolved ? 'Scanned onto truck' : 'Scanned onto truck (in progress)'

  // Null is not zero: no baseline means nothing to compare, not "nothing was loaded".
  const hasBoth = expectedCount !== null && scanned !== null
  const missing = hasBoth ? expectedCount - scanned : 0

  return (
    <PhaseDetailCard>
      <Section title="Warehouse scan">
        <Field label="Expected (manifest)" value={expectedCount?.toString()} />
        <Field label={scannedLabel} value={scanned?.toString()} />
      </Section>
      {hasBoth && (
        <div className={`text-[11px] font-[600] px-3 pb-3 ${missing === 0 ? 'text-ok' : 'text-warn'}`}>
          {missing === 0 ? 'All parcels scanned ✓' : `${missing} not scanned ✗`}
        </div>
      )}
      {/* Same waybill_photo_artifact_id captured at departure previously — the driver's
          step is named "Photograph Linehaul Document" and happens right after loading,
          so the evidence belongs here, not on the departure card. */}
      <Section title="Linehaul document">
        <EvidencePhoto
          label="Linehaul document"
          artifact={phase.waybill_photo_artifact_id ? artifactsById.get(phase.waybill_photo_artifact_id) : undefined}
        />
      </Section>
      <PhaseOverrideSection phase={phase} />
    </PhaseDetailCard>
  )
}
```

- [ ] **Step 4: Update the call site**

In `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`, replace:

```tsx
                          <LoadingDetail
                            phase={phase}
                            expectedCount={expectedCountForLoadingStop(phase.trip_stop_id)}
                            liveScannedOutCount={scannedOutCountForLoadingStop(phase.trip_stop_id)}
                          />
```

with:

```tsx
                          <LoadingDetail
                            phase={phase}
                            expectedCount={expectedCountForLoadingStop(phase.trip_stop_id)}
                            liveScannedOutCount={scannedOutCountForLoadingStop(phase.trip_stop_id)}
                            artifactsById={artifactsById}
                          />
```

(`artifactsById` is already in scope at this call site — it's passed to `ActivationDetail`, `DepartureDetail`, `UnloadingDetail`, and `ConfirmationDetail` a few lines above and below.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run LoadingDetail`
Expected: all 7 tests PASS.

- [ ] **Step 6: Typecheck**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual smoke**

Open a trip's loading phase card: confirm "Warehouse scan" is unchanged and a new "Linehaul document" section appears showing the photo (or "Not captured" if none yet). Confirm the departure phase card no longer shows it (covered by Task 5's smoke check too).

- [ ] **Step 8: Stage**

```bash
git add frontend/dispatcher/components/domain/LoadingDetail.tsx frontend/dispatcher/components/domain/__tests__/LoadingDetail.test.tsx "frontend/dispatcher/app/(app)/trips/[id]/page.tsx"
```

Suggested commit message: `fix(dispatcher): show linehaul document on loading phase, not departure`

---

### Task 7: Backend — flag an already-assigned waybill at lookup time (item 7, backend half)

**Files:**
- Modify: `backend/app/schemas/pp.py`
- Modify: `backend/app/orchestration/consignment_service.py`
- Modify: `backend/app/api/v1/endpoints/pp.py`
- Test: `backend/tests/unit/test_consignment_service.py`
- Test: `backend/tests/integration/test_pp_endpoints.py`

- [ ] **Step 1: Write the failing unit tests for the new orchestration function**

In `backend/tests/unit/test_consignment_service.py`, change the import line:

```python
from app.orchestration.consignment_service import fetch_and_sync_consignment
```

to:

```python
from app.orchestration.consignment_service import fetch_and_sync_consignment, get_assigned_trip_reference
```

Then add these two tests at the end of the file (after the existing tests, same indentation level as the other `@pytest.mark.asyncio` test functions):

```python
@pytest.mark.asyncio
async def test_get_assigned_trip_reference_returns_reference_when_assigned():
    """A pp_reference already linked to a trip returns that trip's reference."""
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = "FP-TEST-PP"
    db.execute = AsyncMock(return_value=result)

    trip_reference = await get_assigned_trip_reference(db, "WAY001")

    assert trip_reference == "FP-TEST-PP"


@pytest.mark.asyncio
async def test_get_assigned_trip_reference_returns_none_when_unassigned():
    """No Consignment row (or one with no trip_id) for this reference returns None."""
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=result)

    trip_reference = await get_assigned_trip_reference(db, "WAY999")

    assert trip_reference is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_consignment_service.py -k get_assigned_trip_reference -v`
Expected: FAIL with an import error — `get_assigned_trip_reference` does not exist yet.

- [ ] **Step 3: Implement the orchestration function**

In `backend/app/orchestration/consignment_service.py`, append this function at the end of the file (it needs no new imports — `select`, `Trip`, and `Consignment` are already imported at the top of this file):

```python
async def get_assigned_trip_reference(db: AsyncSession, pp_reference: str) -> Optional[str]:
    """Read-only check: is this pp_reference already attached to a trip?

    Used by the wizard-time PP lookup (GET /pp/waybills/{ref}) to warn a dispatcher
    before they try to add a waybill that's already claimed. The authoritative
    fail-closed check still happens in fetch_and_sync_consignment at trip creation —
    this is advisory only, same spirit as the rest of the wizard-time lookup.

    Returns None both when no Consignment exists yet for this reference and when one
    exists but isn't yet linked to a trip.
    """
    result = await db.execute(
        select(Trip.trip_reference)
        .join(Consignment, Consignment.trip_id == Trip.id)
        .where(Consignment.parcel_perfect_reference == pp_reference)
    )
    return result.scalar_one_or_none()
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_consignment_service.py -k get_assigned_trip_reference -v`
Expected: both tests PASS.

- [ ] **Step 5: Add the schema field**

In `backend/app/schemas/pp.py`, replace:

```python
class PPWaybillSummary(BaseModel):
    """Wizard-time validation summary. Never the raw PP payload."""

    waybill: str
    account_number: str
    customer_name: str
    parcel_count: int
    weight_kg: Optional[float] = None
    declared_value: Optional[float] = None
    dest_town: str
    dest_person: str
    manifest_number: Optional[int] = None
    is_delivered: bool
    has_delivery_failure: bool
```

with:

```python
class PPWaybillSummary(BaseModel):
    """Wizard-time validation summary. Never the raw PP payload."""

    waybill: str
    account_number: str
    customer_name: str
    parcel_count: int
    weight_kg: Optional[float] = None
    declared_value: Optional[float] = None
    dest_town: str
    dest_person: str
    manifest_number: Optional[int] = None
    is_delivered: bool
    has_delivery_failure: bool
    # Populated by a FreightProof-side check (not PP) — set when this waybill is
    # already linked to another trip. See consignment_service.get_assigned_trip_reference.
    already_assigned_to_trip: Optional[str] = None
```

- [ ] **Step 6: Write the failing integration tests**

In `backend/tests/integration/test_pp_endpoints.py`, update the imports:

```python
from app.core.config import settings
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.session import get_db
from app.main import app
from app.schemas.pp import PPWaybillSummary

from tests.conftest import auth_header, make_token
```

to:

```python
from app.core.config import settings
from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.organisations import Organization
from app.db.models.people import Driver, User
from app.db.models.trips import Consignment, Trip
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app
from app.schemas.pp import PPWaybillSummary

from tests.conftest import auth_header, make_token
```

Then add a new fixture and two new tests, after the existing `seed_dispatcher` fixture:

```python
@pytest_asyncio.fixture
async def seed_trip_with_consignment(db_session, seed_dispatcher):
    """A trip that already owns the WAY001 consignment — drives the already-assigned check."""
    user, org = seed_dispatcher
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    db_session.add_all([driver, horse])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-PP", order_number="ORD-PP",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY001",
    )
    db_session.add(consignment)
    await db_session.flush()
    return trip


async def test_get_waybill_marks_reference_unassigned_when_no_consignment_exists(
    client: AsyncClient, seed_dispatcher,
):
    user, org = seed_dispatcher
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    resp = await client.get("/api/v1/pp/waybills/WAY001", headers=auth_header(token))

    assert resp.status_code == 200
    assert resp.json()["already_assigned_to_trip"] is None


async def test_get_waybill_flags_reference_already_assigned_to_another_trip(
    client: AsyncClient, seed_dispatcher, seed_trip_with_consignment,
):
    user, org = seed_dispatcher
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    resp = await client.get("/api/v1/pp/waybills/WAY001", headers=auth_header(token))

    assert resp.status_code == 200
    assert resp.json()["already_assigned_to_trip"] == "FP-TEST-PP"
```

- [ ] **Step 7: Run the integration tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_pp_endpoints.py -k "unassigned_when_no_consignment or flags_reference_already_assigned" -v`
Expected: FAIL — the endpoint doesn't populate `already_assigned_to_trip` yet, so `test_get_waybill_flags_reference_already_assigned_to_another_trip` asserts `None == "FP-TEST-PP"` and fails. (The "unassigned" test may pass by coincidence since the field is absent/None by default — that's fine, it will stay green through Step 8.)

- [ ] **Step 8: Implement — wire the check into the endpoint**

In `backend/app/api/v1/endpoints/pp.py`, replace the imports:

```python
"""Dispatcher-facing Parcel Perfect lookup endpoints (wizard-time validation)."""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from app.auth.dependencies import get_current_dispatcher
from app.integrations.parcel_perfect import PPUnsupportedError, PPWaybillNotFoundError
from app.orchestration import pp_lookup_service
from app.schemas.people import UserRead
from app.schemas.pp import PPCapabilities, PPWaybillSummary
```

with:

```python
"""Dispatcher-facing Parcel Perfect lookup endpoints (wizard-time validation)."""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.integrations.parcel_perfect import PPUnsupportedError, PPWaybillNotFoundError
from app.orchestration import consignment_service, pp_lookup_service
from app.schemas.people import UserRead
from app.schemas.pp import PPCapabilities, PPWaybillSummary
```

Then replace `get_waybill_endpoint`:

```python
@router.get("/waybills/{waybill_number}", response_model=PPWaybillSummary,
            summary="Validate a PP waybill reference")
async def get_waybill_endpoint(
    waybill_number: str,
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PPWaybillSummary:
    try:
        return await pp_lookup_service.get_waybill_summary(waybill_number)
    except PPWaybillNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ValueError, httpx.HTTPError) as exc:
        # Real client raises ValueError (PP errorcode != 0) or httpx errors on outage.
        logger.warning("PP lookup failed for waybill %s: %s", waybill_number, exc)
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail=_PP_UNREACHABLE_DETAIL,
        ) from exc
```

with:

```python
@router.get("/waybills/{waybill_number}", response_model=PPWaybillSummary,
            summary="Validate a PP waybill reference")
async def get_waybill_endpoint(
    waybill_number: str,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PPWaybillSummary:
    try:
        summary = await pp_lookup_service.get_waybill_summary(waybill_number)
    except PPWaybillNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ValueError, httpx.HTTPError) as exc:
        # Real client raises ValueError (PP errorcode != 0) or httpx errors on outage.
        logger.warning("PP lookup failed for waybill %s: %s", waybill_number, exc)
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail=_PP_UNREACHABLE_DETAIL,
        ) from exc

    summary.already_assigned_to_trip = await consignment_service.get_assigned_trip_reference(
        db, waybill_number,
    )
    return summary
```

- [ ] **Step 9: Run the full pp test files to verify everything passes**

Run: `cd backend && pytest tests/integration/test_pp_endpoints.py tests/unit/test_consignment_service.py -v`
Expected: all tests PASS, including the pre-existing `test_get_waybill_returns_summary_with_no_extra_keys` (unaffected — it checks the key *set*, and `PPWaybillSummary.model_fields` now includes `already_assigned_to_trip` on both sides of that comparison).

- [ ] **Step 10: Run the full backend suite**

Run: `cd backend && pytest`
Expected: all tests PASS (no regressions elsewhere from the `pp.py` endpoint signature change).

- [ ] **Step 11: Stage**

```bash
git add backend/app/schemas/pp.py backend/app/orchestration/consignment_service.py backend/app/api/v1/endpoints/pp.py backend/tests/unit/test_consignment_service.py backend/tests/integration/test_pp_endpoints.py
```

Suggested commit message: `feat(orchestration): flag an already-assigned waybill at PP lookup time`

**Shared-file flag:** `PPWaybillSummary` (`backend/app/schemas/pp.py`) is a response schema other code may depend on — the change is additive (new optional field, default `None`), so existing consumers are unaffected, but flag it in TASK COMPLETE per CLAUDE.md.

---

### Task 8: Frontend wizard — warn on an already-assigned waybill at search time (item 7, frontend half)

**Depends on Task 7** (reads the `already_assigned_to_trip` field Task 7 adds to the API response).

**Files:**
- Modify: `frontend/shared/lib/types/pp.ts`
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx`

- [ ] **Step 1: Add the field to the shared type**

In `frontend/shared/lib/types/pp.ts`, replace:

```ts
// Wizard-time validation summary. Never the raw PP payload.
export interface PPWaybillSummary {
  waybill: string
  account_number: string
  customer_name: string
  parcel_count: number
  weight_kg: number | null
  declared_value: number | null
  dest_town: string
  dest_person: string
  manifest_number: number | null
  is_delivered: boolean
  has_delivery_failure: boolean
}
```

with:

```ts
// Wizard-time validation summary. Never the raw PP payload.
export interface PPWaybillSummary {
  waybill: string
  account_number: string
  customer_name: string
  parcel_count: number
  weight_kg: number | null
  declared_value: number | null
  dest_town: string
  dest_person: string
  manifest_number: number | null
  is_delivered: boolean
  has_delivery_failure: boolean
  // Set (to the owning trip's reference) when this waybill is already linked to
  // another trip. Checked FreightProof-side, not by Parcel Perfect itself.
  already_assigned_to_trip: string | null
}
```

- [ ] **Step 2: Add the `assigned` pull status**

In `frontend/dispatcher/app/(app)/trips/new/page.tsx`, replace:

```tsx
type PullStatus = 'idle' | 'loading' | 'success' | 'duplicate' | 'error'
```

with:

```tsx
type PullStatus = 'idle' | 'loading' | 'success' | 'duplicate' | 'assigned' | 'error'
```

- [ ] **Step 3: Branch on `already_assigned_to_trip` in `pullWaybill`**

Replace:

```tsx
    setPull({ status: 'loading', summary: null, unitCount: '', errorMessage: null })
    try {
      const summary = await api.get<PPWaybillSummary>(`/api/v1/pp/waybills/${encodeURIComponent(ref)}`)
      setPull({ status: 'success', summary, unitCount: String(summary.parcel_count), errorMessage: null })
    } catch (err) {
```

with:

```tsx
    setPull({ status: 'loading', summary: null, unitCount: '', errorMessage: null })
    try {
      const summary = await api.get<PPWaybillSummary>(`/api/v1/pp/waybills/${encodeURIComponent(ref)}`)
      // The summary still shows in full even when already assigned — the dispatcher
      // needs to see it's a real waybill, just one they can't claim for this trip.
      if (summary.already_assigned_to_trip) {
        setPull({ status: 'assigned', summary, unitCount: String(summary.parcel_count), errorMessage: null })
      } else {
        setPull({ status: 'success', summary, unitCount: String(summary.parcel_count), errorMessage: null })
      }
    } catch (err) {
```

- [ ] **Step 4: Render the assigned state — summary visible, Add disabled**

Replace:

```tsx
                  {pull.status === 'success' && pull.summary && (
                    <div className="rounded-lg bg-surf-low border border-outline-v/20 p-4 mt-3">
                      <div className="flex items-center gap-2 mb-3">
                        <Ic n="file" s={14} className="text-sec" />
                        <span className="text-[13px] font-[700] text-on-surf tabular-nums tracking-[0.04em]">
                          {pull.summary.waybill}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-x-4 mb-3">
                        <MiniField label="Customer" value={pull.summary.customer_name} />
                        <MiniField label="Parcels"  value={String(pull.summary.parcel_count)} mono />
                        <MiniField label="Weight"   value={pull.summary.weight_kg != null ? `${pull.summary.weight_kg} kg` : null} mono />
                        <MiniField label="Dest"     value={pull.summary.dest_town} />
                      </div>
                      <div className="flex gap-3 items-end">
                        <div className="flex-1">
                          <Lbl>Expected units (pallets)</Lbl>
                          <input
                            type="number"
                            min="1"
                            value={pull.unitCount}
                            onChange={e => setPull(p => ({ ...p, unitCount: e.target.value }))}
                            className={inp}
                          />
                        </div>
                        <Button onClick={addWaybill}>+ Add</Button>
                      </div>
                    </div>
                  )}
```

with:

```tsx
                  {(pull.status === 'success' || pull.status === 'assigned') && pull.summary && (
                    <div className="rounded-lg bg-surf-low border border-outline-v/20 p-4 mt-3">
                      <div className="flex items-center gap-2 mb-3">
                        <Ic n="file" s={14} className="text-sec" />
                        <span className="text-[13px] font-[700] text-on-surf tabular-nums tracking-[0.04em]">
                          {pull.summary.waybill}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-x-4 mb-3">
                        <MiniField label="Customer" value={pull.summary.customer_name} />
                        <MiniField label="Parcels"  value={String(pull.summary.parcel_count)} mono />
                        <MiniField label="Weight"   value={pull.summary.weight_kg != null ? `${pull.summary.weight_kg} kg` : null} mono />
                        <MiniField label="Dest"     value={pull.summary.dest_town} />
                      </div>
                      {pull.status === 'assigned' ? (
                        <p className="text-[11px] text-err font-[500]">
                          Already assigned to trip {pull.summary.already_assigned_to_trip}
                        </p>
                      ) : (
                        <div className="flex gap-3 items-end">
                          <div className="flex-1">
                            <Lbl>Expected units (pallets)</Lbl>
                            <input
                              type="number"
                              min="1"
                              value={pull.unitCount}
                              onChange={e => setPull(p => ({ ...p, unitCount: e.target.value }))}
                              className={inp}
                            />
                          </div>
                          <Button onClick={addWaybill}>+ Add</Button>
                        </div>
                      )}
                    </div>
                  )}
```

`addWaybill()` already guards `if (pull.status !== 'success' || !pull.summary) return`, so even without the button being hidden, an `'assigned'` pull could never be committed — this is defense in depth on top of the UI simply not offering the control.

- [ ] **Step 5: Typecheck**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual smoke**

In the trip creation wizard step 1: search a waybill reference that Task 7's backend change would flag (seed a trip with a consignment for a known mock waybill, e.g. `WAY001`, or temporarily point at a real already-assigned reference in a dev DB), confirm the summary card shows with customer/parcel/weight/dest fields populated, "Already assigned to trip {ref}" appears, and there is no unit-count input or "+ Add" button. Then search an unassigned waybill (e.g. `WAY002`) and confirm the normal Add flow still works.

- [ ] **Step 7: Stage**

```bash
git add frontend/shared/lib/types/pp.ts "frontend/dispatcher/app/(app)/trips/new/page.tsx"
```

Suggested commit message: `fix(dispatcher): warn about an already-assigned waybill at search time, not just on submit`

---

### Note: Item 6 (seal vs. parcel mismatch ordering) — no task

Per the spec's Decisions, item 6 requires no code change for this pass. It's recorded here so a future backlog item exists to point to, not because there's an implementation task to run.

---

## Self-Review

**Spec coverage:** item 1 → Tasks 3 (Activation anchor), 4 (Confirmation signature + anchor), 5 (Departure anchor). Item 2 → Tasks 5 (remove from Departure) + 6 (add to Loading). Item 3 → Task 1. Item 4 → Task 2. Item 5 → Task 3. Item 6 → no task (documented above). Item 7 → Tasks 7 (backend) + 8 (frontend). All seven spec items are covered.

**Placeholder scan:** no "TBD"/"TODO"/"add appropriate handling" language anywhere above; every step shows full, exact code, not a description of code.

**Type consistency:** `PullStatus` gains `'assigned'` consistently across its type definition (Task 8 Step 2), the `pullWaybill` branch (Step 3), and the render condition (Step 4). `PPWaybillSummary.already_assigned_to_trip` is `Optional[str] = None` on the backend (Task 7 Step 5) and `string | null` on the frontend (Task 8 Step 1) — consistent nullability across the wire. `get_assigned_trip_reference(db: AsyncSession, pp_reference: str) -> Optional[str]` — the name and signature used in the unit test import (Task 7 Step 1), the implementation (Step 3), and the endpoint call site (Step 8) all match exactly. `LoadingDetail`'s `artifactsById: Map<string, EvidenceArtifactWithUrl>` prop name matches what Task 6 Step 4 passes at the call site and what Task 6's tests supply.
