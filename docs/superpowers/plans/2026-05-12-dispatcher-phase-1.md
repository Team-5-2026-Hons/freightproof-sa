# FreightProof SA — Dispatcher Portal Phase 1 Build Plan

> **Prerequisite:** Phase 0 must be complete — token map, types, mocks, hooks, UI primitives, and `/dev/tokens` all passing.
>
> **Key references:** `docs/FreightProof_Frontend_Spec_v1.md` §5.3 + §7 · `frontend/DESIGN_SYSTEM.md` · `docs/FreightProof_Full_Picture_v6.md`

---

## Build order

Each task is one chat session. Reference the spec section in your prompt. Tick off as you go.

### Shell & Auth

- [ ] **Task 1: `DispatcherShell` + `Sidebar` + `PageHeader` + `PageShell`** — Spec §5.3. The layout frame every page sits in. 240 px sidebar at `lg+`, 64 px icon rail at `md`, hamburger below `md`. Black sidebar with blue active accent. Sidebar items: Active Trips, Trip History, Exceptions, SLA Reports, Fleet, Settings. Wire `ToastViewport` into the shell.

- [ ] **Task 2: Login page** — Spec §7.1. Route `/login` in `(public)` group. Email + password inputs, 600 ms mock delay, redirect to `/`. Shake animation on error.

### Core trip loop (demo-critical)

- [ ] **Task 3: Active Trips page** — Spec §7.2. Route `/` (alias `/trips`). The landing page. `DataTable` of `ChecklistRow`s with status chip, `TripIdStamp`, driver, route, compact `HandshakeChain`, latest event timestamp. Headline metric strip at top (active count, open exceptions count, on-time %). Filters: status, driver, route, has-exceptions. `useTrips()` hook. Loading skeleton + empty state + no-results state.

- [ ] **Task 4: Domain components batch 1** — Build alongside Trip Detail: `HandshakeChain` (horizontal, 6 nodes), `EvidencePacket`, `TripIdStamp` (with copy-to-clipboard), `BlockchainReceipt`, `ExceptionBanner`, `TimestampWithIcon`, `ChecklistRow`. These live in `components/domain/`. Spec §5.2.

- [ ] **Task 5: Trip Detail page** — Spec §7.3. Route `/trips/[id]`. Full `HandshakeChain` at top, `Tabs` (Timeline / Manifest / Exceptions / Blockchain), `EvidencePacket` per event, `BlockchainReceipt` per anchor. Back button + breadcrumb. States: loading, not found (404), closed (read-only banner), active exception (banner above tabs).

- [ ] **Task 6: Trip Creation page** — Spec §7.4. Route `/trips/new`. Two-column: form left, live summary card right. Order number input, template toggle, driver/horse/trailer/precinct selects (populated from `useDrivers()`, `useVehicles()`, `usePrecincts()` hooks), slot times. All required except slot times. 600 ms mock submit → success toast → redirect to `/trips/[new-id]`.

### Fleet management

- [ ] **Task 7: Fleet: Vehicles page** — Spec §7.10. Route `/fleet/vehicles`. `DataTable` of vehicles (type chip, registration, Pulsit device ID, active status). Add/edit via `Modal`. Type filter (horse/trailer), active status filter.

- [ ] **Task 8: Fleet: Drivers page** — Spec §7.11. Route `/fleet/drivers`. `DataTable` of drivers (name, masked ID, phone, licence, IDVS chip, active status). Add/edit via `Modal`. IDVS status is read-only.

### Secondary pages

- [ ] **Task 9: Trip History page** — Spec §7.5. Route `/history`. Same `DataTable`/`ChecklistRow` as Active Trips but for closed trips. `DateRangePicker`, search, multi-select filters (date, driver, vehicle, route, client, order number, exception type). Tapping a row opens `/trips/[id]`.

- [ ] **Task 10: Exceptions list page** — Spec §7.6. Route `/exceptions`. Triage queue. `DataTable` with severity chip, type, trip ID, driver, timestamp. Filters: severity, type, source, date range, status (open/resolved). "All clear" empty state when no exceptions.

- [ ] **Task 11: Exception Detail page** — Spec §7.7. Route `/exceptions/[id]`. Full exception context + trip summary + last checkpoint. Action buttons: override, escalate, resolve, add note (modal with `TextArea`). Mock actions → toast + redirect.

- [ ] **Task 12: SLA Reports page** — Spec §7.8. Route `/sla`. `DateRangePicker` + client `Select` + 4 `SLAChartCard`s (recharts: on-time pickup line, on-time delivery line, exceptions bar, completion donut). `useSLAMetrics()` derives stats from fixture trips. Each chart has `aria-label` + toggle to `DataTable` view. "Export PDF" button → mock toast.

- [ ] **Task 13: Settings page** — Spec §7.9. Route `/settings`. Name, email (read-only), sign-out button. Minimal.

### System pages

- [ ] **Task 14: 404 + Error pages** — Spec §7.12. `not-found.tsx` and `error.tsx`. `EmptyState` with `AlertTriangle` and "Back to Active Trips" button.

### Polish

- [ ] **Task 15: Loading skeletons** — Add `Skeleton` loading states to every list and detail page.
- [ ] **Task 16: Empty states** — Add `EmptyState` to every zero-data view and no-results-after-filter view.
- [ ] **Task 17: Accessibility pass** — Run axe-core on every page. Fix contrast, focus, aria issues.

---

## Done checklist

- [ ] All 13 dispatcher pages render without console errors
- [ ] `npm run type-check` passes with zero errors
- [ ] `npm run lint` passes with zero errors
- [ ] Every list page has loading, empty, and no-results states
- [ ] Navigation between all pages works (sidebar, breadcrumbs, row clicks, back buttons)
- [ ] The canonical trip `TRP-2026-0041` (JHB→DBN, S. Dlamini) is visible in Active Trips and opens correctly in Trip Detail
