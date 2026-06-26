# Admin-Only Fleet Mutations

**Date:** 2026-06-25
**Author:** Ciaran
**Branch:** Ciaran
**Status:** Approved design — ready for implementation plan

## Goal

Restrict creating and editing of drivers and vehicles to the
`admin_dispatcher` role. Normal dispatchers keep full read access — they can
view the fleet, open a driver or vehicle detail, and check licence/expiry
data — but the create and edit affordances disappear, and the corresponding
API calls are refused server-side.

This is the **foundation** feature. The companion POPIA driver-erasure feature
(`2026-06-25-driver-popia-erasure-design.md`) builds on the role-gating
pattern and the `AdminOnly` wrapper introduced here. Build this one first.

## Context

Two dispatcher roles exist in `DispatcherRole` (`db/models/enums.py`):
`dispatcher` and `admin_dispatcher`. The auth layer already distinguishes
them — `get_current_dispatcher` (`auth/dependencies.py:159`) accepts either,
and `require_admin_dispatcher` (`auth/dependencies.py:211`) raises 403 for
anyone who is not an admin. The latter is already used to gate blockchain
detail (`endpoints/blockchain.py`), so the dependency is proven.

Today every drivers and vehicles endpoint uses `get_current_dispatcher`, so
**any** dispatcher can create and edit. The only role distinction currently
applied to the fleet is that blockchain `receipts` are stripped from the
detail response for non-admins (`endpoints/drivers.py:82`,
`endpoints/vehicles.py:88`).

On the frontend, `useAuth().user.role` exposes `'dispatcher' |
'admin_dispatcher'` (`lib/types/user.ts`). There is an existing role-gating
wrapper pattern in `ForensicOnly` (`components/blockchain/ForensicOnly.tsx`)
that returns `null` when the gate fails — call sites stay dumb.

## Decisions (from brainstorming)

- **Split:** normal dispatchers can **view** the fleet; only `admin_dispatcher`
  can **create or edit** drivers and vehicles.
- **Server-side is the real gate.** UI hiding is cosmetic; the FastAPI
  dependency is authoritative. The UI must never be the only thing standing
  between a non-admin and a mutation.
- **Erase/delete is out of scope here** — there is no delete endpoint yet, and
  it is built (already admin-gated) in the erasure feature.

## Design

### Backend — swap the dependency on mutating routes

Change the route dependency from `get_current_dispatcher` to
`require_admin_dispatcher` on the **mutating** endpoints only:

- `endpoints/drivers.py`: `POST ""` (create), `PATCH "/{driver_id}"` (update)
- `endpoints/vehicles.py`: `POST ""` (create), `PATCH "/{vehicle_id}"` (update)

`require_admin_dispatcher` depends on `get_current_dispatcher`, so it still
yields a `UserRead` with `organization_id` and `id` — the existing handler
bodies need no change beyond the dependency swap. A non-admin now receives a
clean `403 Admin dispatcher role required.`

The four **GET** routes (list + detail, both surfaces) stay on
`get_current_dispatcher` — every dispatcher reads. The existing
receipt-stripping for non-admins on the detail GETs is unaffected.

### Frontend — `AdminOnly` wrapper + hide affordances

New component `components/auth/AdminOnly.tsx`, mirroring `ForensicOnly`:

```tsx
'use client'

import type { ReactNode } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'

interface AdminOnlyProps {
  children: ReactNode
}

/**
 * Renders children only when the current user has the admin_dispatcher role.
 * The single gate for admin-only affordances — call sites stay dumb.
 */
export function AdminOnly({ children }: AdminOnlyProps) {
  const { user } = useAuth()
  if (user?.role !== 'admin_dispatcher') return null
  return <>{children}</>
}
```

Wrap the mutation affordances in `AdminOnly`:

- **Add Driver** button (`fleet/drivers/page.tsx`)
- **Add Vehicle** button (`fleet/vehicles/page.tsx`)
- **Edit** button on driver detail (`fleet/drivers/[id]/page.tsx`)
- **Edit** button on vehicle detail (`fleet/vehicles/[id]/page.tsx`)

When the control is hidden, the create modal / edit form simply never opens,
so the existing form code needs no role awareness.

### Defence in depth

A non-admin who forges a request (or whose UI fails to hide a button) still
hits the `require_admin_dispatcher` 403. The typed API client should surface
that 403 with a clear "You don't have permission" message rather than a raw
error, so the rare race (role changed mid-session) degrades gracefully.

## Error handling

| Condition | Result |
| --- | --- |
| Non-admin calls create/edit (drivers or vehicles) | `403 Admin dispatcher role required.` |
| Admin calls create/edit | unchanged from today (201 / 200, or existing 409/422/502/504) |
| Any dispatcher calls list/detail GET | unchanged from today |

## Testing

**Backend integration** (`httpx.AsyncClient` + `ASGITransport`):

- `test_create_driver_non_admin_forbidden` → 403, no row created.
- `test_update_driver_non_admin_forbidden` → 403, row unchanged.
- `test_create_vehicle_non_admin_forbidden` → 403, no row created.
- `test_update_vehicle_non_admin_forbidden` → 403, row unchanged.
- `test_create_driver_admin_succeeds` → 201 (regression: gating didn't break the happy path).
- `test_update_vehicle_admin_succeeds` → 200.
- `test_list_drivers_non_admin_allowed` → 200 (view stays open).

Drive the role via the auth dependency the tests already use to inject a
dispatcher; supply a `dispatcher`-role user for the forbidden cases and an
`admin_dispatcher` for the allowed cases.

**Frontend:** typecheck (`npx tsc --noEmit`) must stay green. `AdminOnly`
rendering is verified by manual smoke (sign in as each role, confirm the
buttons appear/disappear) — no test runner is set up in `dispatcher/` for
component tests, so this is documented manual verification, not an automated
suite.

## Out of scope

- The driver erasure endpoint, service, migration, and erase UI — see
  `2026-06-25-driver-popia-erasure-design.md`.
- Vehicle deletion/erasure — not built (a vehicle is not personal data;
  `is_active` covers decommissioning).
- Any change to the driver/vehicle create or edit **form** logic — only the
  visibility of the entry-point buttons changes.
- Role management / assigning the admin role — handled by Supabase
  `app_metadata`, outside this codebase.

## Cross-dev / shared-file flags

- `endpoints/drivers.py`, `endpoints/vehicles.py` — fleet-owned; dependency
  swap only, no signature changes.
- No migration, no model change, no `db/models/__init__.py` change.
- New frontend files only (`components/auth/AdminOnly.tsx`); existing fleet
  pages gain `AdminOnly` wrappers around buttons that already exist.
