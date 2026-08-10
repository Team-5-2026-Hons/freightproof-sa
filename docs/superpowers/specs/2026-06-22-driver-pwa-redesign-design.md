# Driver PWA Redesign — Spec

**Date:** 2026-06-22
**Branch:** feature/gps-warehouse-geofencing (continuing — recent commits on this branch already touch driver-pwa)
**Approach:** Foundation-first, mirrors `docs/superpowers/specs/2026-05-13-dispatcher-ui-redesign.md`

---

## Goal

`frontend/driver-pwa/` has never been styled to the project's design system. Its `tailwind.config.ts` still uses the old Material-3-style token set (`surface.container-lowest`, `outline.variant`, `primary: #000000`, `success: #1a7c3e`) that `frontend/dispatcher/` had **before** its May 2026 redesign. Several pages (`ActiveTripPageClient.tsx`, `app/(app)/trips/page.tsx`) aren't styled to any spec at all — bare Tailwind defaults. Separately, interactions feel inert: captures resolve to a static colored box with no transition, no success feedback, no sense that an action registered.

This spec covers:
1. Migrating driver-pwa's token set to match dispatcher's (and therefore `docs/references/driver-*.html`).
2. Rebuilding every page that has a matching `docs/references/driver-*.html` file against that reference.
3. Adding a navigation shell (drawer nav + profile panel) that doesn't exist yet.
4. Adding a Trips list with Active/Upcoming/Past tabs and filters.
5. Adding real motion/feedback via `framer-motion`.
6. Restyling `panic` and `in-transit` flows, which have no HTML reference, to the same token/component language.

---

## Out of scope

- Backend, `frontend/dispatcher/`, orchestration/handshake business logic and ordering.
- Enforcing "one active trip at a time" as a new rule — this is a **display** convention only (the Active tab shows at most one card, because in practice the backend's `TripStatus` state machine only allows one trip per driver to be non-terminal at a time). No new validation/orchestration code is added.
- Changing `frontend/shared/lib/types/trip.ts` — see note below, this was considered and rejected.

---

## 1. Token migration

**File:** `frontend/driver-pwa/tailwind.config.ts`

Port the same shorthand tokens dispatcher already has: `canvas`, `surf`, `surf-low`, `surf-lowest`, `surf-high`, `on-surf`, `on-surf-v`, `sec`/`ok`/`err`/`warn`/`chain` (each with `DEFAULT`/`c`/`on`/`onc`), `outline.v`. Keep backwards-compat aliases (`primary`, `secondary`, `success`, `error`, `surface`, `outline.variant`) mapped to the corrected hex values during the rebuild, same transitional pattern dispatcher used — existing component class names keep working while pages are migrated one at a time. Radii become `r-sm/md/lg/xl` (3/6/10/14px) replacing the current 2/4/4/8/12px scale.

---

## 2. Shared primitives rebuild

**Files:** `components/ui/*`, `components/handshake/*`

Rebuild to match the reference HTML's primitive patterns:
- `GpsCapture` → adopt the reference's `GPS` row pattern (icon + status text in a `surf-low` pill) with a `.pulse`-equivalent animation (via framer-motion, see §5) while acquiring.
- `HoldButton` → keep the existing radial-progress mechanic (it already works well), add a completion flourish (scale/flash) on confirm.
- `SealInput`, capture-box components (`CameraCapture`, photo capture in step components) → adopt the reference's dashed-border-to-solid-on-capture treatment, animated.
- `Chip`/status badges → adopt reference's dot+label status chip pattern using the new `ok`/`err`/`warn` tokens.
- New: `ChainTag`-equivalent for any blockchain-receipt display, ported from the reference pattern.

---

## 3. Page rewrites against references

One page ↔ one reference file:

| Page | Reference |
|---|---|
| `app/(app)/trips/[id]/.../HandshakeStepPageClient.tsx` (H1 steps) | `driver-h1-gate-in.html` |
| (H2 steps) | `driver-h2-loading.html` |
| (H3 steps) | `driver-h3-gate-out.html` |
| (H4 steps) | `driver-h4-dest-gate-in.html` |
| (H5 steps) | `driver-h5-unloading.html` |
| `ActiveTripPageClient.tsx` → becomes "Home" | `driver-trip-home.html` |
| in-transit checkpoint page | `driver-checkpoint.html` |

`app/login/page.tsx`, `app/otp/page.tsx` have no dedicated reference — restyled using the new tokens/primitives for visual consistency, no structural reference to match against.

---

## 4. Navigation shell (new)

**Files (create):** `components/layout/AppShell.tsx`, `components/layout/NavDrawer.tsx`, `components/layout/ProfilePanel.tsx`
**Files (modify):** `app/(app)/layout.tsx`

- Top bar: hamburger icon (left) opens `NavDrawer`, app title/trip reference (center), profile icon (right) opens `ProfilePanel`.
- `NavDrawer`: slide-over, mirrors dispatcher's mobile overlay mechanics. Items: **Home** (`ROUTES.home`), **Trips** (`ROUTES.trips`), **Settings** (`ROUTES.settings`).
- `ProfilePanel`: slide-over or modal (not the same component as `NavDrawer`). Shows driver name, assigned vehicle/trailer (from `trip.horse`/`trip.trailers` of the active trip, or driver's default vehicle if none active), contact number, period stats (trips completed, distance — derived from `mockTrips` filtered by driver), and a **Logout** action (clears `AuthContext`, routes to `ROUTES.login`).
- `app/settings/page.tsx` (new): app version, support contact. No account/auth settings — driver has no account surface beyond OTP login per CLAUDE.md domain rules.

---

## 5. Trips list — Active / Upcoming / Past tabs + filters

**File:** `app/(app)/trips/page.tsx` (rewrite)

- Tabs component (reuse/extend existing `components/ui/Tabs.tsx`): **Active**, **Upcoming**, **Past**.
- **Active**: trips where `status` is not `'closed'`/`'cancelled'` and not `'created'`. At most one card expected; if more than one exists in mock data, show all but this is a data anomaly, not a UI feature.
- **Upcoming**: trips where `status === 'created'` (dispatcher has assigned the trip, driver hasn't started gate-in yet). Sorted by `planned_departure_at`. "Start Trip" action is disabled with an inline note if an Active trip already exists — this reflects existing state, no new logic enforced.
- **Past**: trips where `status === 'closed'` or `'cancelled'`. Filters: date range (`planned_departure_at`/`actual_arrival_at`) and origin/destination search (matches `origin_precinct_id`/`destination_precinct_id` display names).
- **No shared-type changes.** Confirmed `frontend/shared/lib/types/trip.ts` already supports this via existing `TripStatus` values and `planned_departure_at` — adding a synthetic "upcoming" status would violate the file's documented contract ("Mirrors backend TripStatus exactly — 10 states, no simplification"). Filtering by existing fields is sufficient and keeps this entirely within `frontend/driver-pwa/`.

---

## 6. Motion & feedback pass

**New dependency:** `framer-motion` in `frontend/driver-pwa/package.json` only.

- GPS-acquiring state: pulsing ring animation on the satellite icon (mirrors reference `.pulse` keyframe).
- Capture confirmation (photo/GPS/seal): animated checkmark + border color transition, not an instant swap.
- Step-to-step transition: slide/fade between handshake steps.
- `HoldButton` completion: scale+flash on confirm.
- Toast entrance/exit: slide-in/fade, replacing instant mount/unmount.
- Respect `prefers-reduced-motion` (already handled globally in `globals.css` — framer-motion's `useReducedMotion` hook should be used to short-circuit non-essential animations).

---

## 7. Panic & in-transit restyle

**Files:** `app/(app)/trip/[id]/panic/*`, `app/(app)/trip/[id]/in-transit/*` (excluding checkpoint, covered in §3)

No HTML reference exists for these. Restyle using the same tokens/primitives established in §1–2 for visual consistency. No structural/flow changes — existing tests in `panic/__tests__/page.test.tsx` must continue passing unmodified (or updated only for class-name changes, not behavior).

---

## Testing

No new business logic is introduced, so no new unit/integration test suites are required. Existing component tests (`panic/__tests__/page.test.tsx`, any others under driver-pwa) must pass unmodified in behavior — only styling/class changes are expected to touch them, and only if they assert on class names (unlikely; check before changing).

---

## Risk / cross-dev impact

- Touches only `frontend/driver-pwa/`. No changes to `frontend/shared/`, `frontend/dispatcher/`, or backend.
- New dependency (`framer-motion`) — flagged per CLAUDE.md, added to `frontend/driver-pwa/package.json` only (not a shared/root manifest).
- Continuing on `feature/gps-warehouse-geofencing` per user decision — branch name doesn't match scope, but recent commit history already includes driver-pwa work on this branch.
