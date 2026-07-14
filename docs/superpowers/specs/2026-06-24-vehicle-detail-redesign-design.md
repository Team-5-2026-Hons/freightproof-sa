# Vehicle Detail Page Redesign — Spec & Implementation Plan

**Date:** 2026-06-24
**Branch:** Ciaran
**Scope:** `frontend/dispatcher` vehicle detail page + small `vehicle_service.py` backend extension. Driver detail page, trip pages, and `frontend/shared/*` are out of scope.

---

## Problem

The vehicle detail page (`app/(app)/fleet/vehicles/[id]/page.tsx`) buries the vehicle info panel on the right at a fixed 450px while the immutable history sits on the left and gets the leftover space — the opposite of where a dispatcher looks first. The forensic-mode history (screenshot reviewed) is hard to read:

- Non-forensic dispatchers see only an event title + timestamp, no detail on what actually changed.
- "Cosmetic update" entries are vague — they only ever say *"Cosmetic (non-critical fields updated)"*, never which field or what it changed to. This is also a **data gap**: `make`/`model`/`year`/`gross_vehicle_mass_kg`/`length_m` changes only ever recorded the *new* value, never the *old* one, so a real diff isn't even possible today.
- The Hedera badge (`Hedera · seq #3` + eye icon) is technical and doesn't explain what "anchored" means for trust, and doesn't expose the actual hash so it can be manually cross-checked against HashScan.

---

## Goals

1. Vehicle Info panel moves to the left, wider by default, and user-resizable (same drag-to-resize interaction as the trip history table columns).
2. Immutable History moves to the right and shows real change detail (`field: old → new`) for **every** dispatcher, for **every** event type — not just forensic mode.
3. Cosmetic-field changes get genuine before/after diffs, which requires a small backend change to actually capture the "from" value (currently not stored).
4. The Hedera/forensic badge stays admin + forensic-mode-gated, but leads with plain language instead of raw terminology, and visibly exposes the SHA-256 hash (with copy + HashScan link) so it can be manually verified against the on-chain message.

## Non-goals

- No change to the driver detail page, trip pages, or `frontend/shared/*` components, even though some are structurally similar.
- No persistence of the resized panel width across reloads (matches existing trip-table behavior, which also doesn't persist).
- No change to which fields trigger Hedera anchoring — cosmetic fields still skip anchoring; this is a display-detail fix, not an anchoring-policy change.

---

## Design

### 1. Layout swap

`app/(app)/fleet/vehicles/[id]/page.tsx`:

- Vehicle Info panel moves to the **left**. Default width 450px → 520px. Becomes user-resizable via a drag handle on its right edge, min 360px / max 720px, using the same `onMouseDown` → track `clientX` delta → `setState` pattern as `app/(app)/history/page.tsx`'s column resize (`startResize`/`onMove`/`onUp` with `window` mouse listeners). Width lives in local component state (`useState`), not persisted — consistent with the trip table, which also resets on reload.
- Immutable History moves to the **right** and becomes the flexible (`flex-1`) column.
- Everything currently inside each panel (Edit form, Trips list, Blockchain summary, `EventTimeline`) moves with its panel — no internal restructuring needed.

### 2. Always-visible event detail

`components/blockchain/EventTimeline.tsx`:

- The changed-field rows (currently `describeChange(e.changed_fields)` rendered inside `<ForensicOnly>`) move **outside** `ForensicOnly` — rendered for every dispatcher, every event.
- The `BlockchainBadge` stays inside `ForensicOnly` — only the chain-anchoring detail remains gated.
- `describeEvent()`: cosmetic-only events (`event_type === 'cosmetic_update'`) get retitled from `"Cosmetic update"` to `"Vehicle details updated"`, matching the label already used for multi-field critical edits. The field rows + (forensic-only) badge disambiguate anchored vs. not, so reusing one plain-language title is fine.

`lib/forensic/describeChange.ts`:

- Add `gross_vehicle_mass_kg` and `length_m` to the `FIELD_LABELS` map (`gross_vehicle_mass_kg: 'GVM'`, `length_m: 'Length'`). Both cosmetic fields are now rendered as `field: old → new` rows, but neither has a friendly label today, so they would fall through to `humanizeKey()` and display as `"Gross Vehicle Mass Kg"` / `"Length M"` — inconsistent with the info panel's `GVM` / `Length`. This is a 2-line addition; the rest of `describeChange.ts` (the `isFromToShape` branch and the `_no_critical_change`/`_patch` meta branch for driver events) stays untouched.

### 3. Backend: real diffs for cosmetic fields

`backend/app/orchestration/vehicle_service.py`, `update_vehicle()`:

Today `old`/`new` snapshots only cover the 6 critical fields (`registration`, `licence_disc_expiry`, `vehicle_type`, `vin_number`, `pulsit_device_id`, `is_active`). Cosmetic fields (`make`, `model`, `year`, `gross_vehicle_mass_kg`, `length_m`) only ever get their *new* value recorded via `_patch`, never the *old* one — a true diff is structurally impossible with today's data.

Fix:

- `backend/app/blockchain/critical_fields.py`: add `VEHICLE_COSMETIC_FIELDS = frozenset({"make", "model", "year", "gross_vehicle_mass_kg", "length_m"})` next to `VEHICLE_CRITICAL_FIELDS`, for symmetry and so the field list is documented in one place.
- In `update_vehicle()`, extend the existing `old`/`new` dicts to include all of `VEHICLE_CRITICAL_FIELDS | VEHICLE_COSMETIC_FIELDS` (one combined snapshot, taken before and after the patch — no second DB round-trip).
- Compute two diffs from the same `old`/`new` maps:
  - `critical_diff = diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS)` — **unchanged**, still drives `event_type` selection (`LICENSE_PLATE_CHANGED`, `VIN_UPDATED`, `DEACTIVATED`, `LICENSE_DISC_RENEWED`, `VEHICLE_UPDATED`) and still the only thing that reaches the Hedera canonical payload (anchoring policy unchanged — cosmetic fields still never anchored, no new Hedera fees, no POPIA exposure since these are non-PII vehicle attributes).
  - `full_diff = diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS | VEHICLE_COSMETIC_FIELDS)` — **new**, becomes `event.changed_fields` directly (`full_diff or {}`), replacing the old `diff or {"_no_critical_change": True, "_patch": patched}` fallback.
- `diff_critical_fields()` itself is generic (compares two maps over an arbitrary frozenset) — no change needed to the helper, just called with a broader field set.
- **The diff-rendering logic needs no change**: `describeChange.ts` already iterates any `{field: {from, to}}` shape via its existing `isFromToShape` branch, so a uniform full diff renders correctly without touching that branch. The only edit is the two-entry `FIELD_LABELS` addition above (`gross_vehicle_mass_kg`, `length_m`) so those two fields get friendly labels instead of auto-humanized ones — see §2. The `_no_critical_change`/`_patch` meta-shape branch in `describeChange.ts` stays in place untouched — it's still needed for driver cosmetic events (`driver_service.py` is intentionally not touched by this change; driver detail page is out of scope).
- Anchoring (`anchor_subject(...)`) call and its canonical payload (`_canonical_diff` built from `critical_diff`, with `pulsit_device_id` hashed for POPIA) are otherwise unchanged.

### 4. Forensic badge: plain language + visible hash

`components/blockchain/BlockchainBadge.tsx`:

- **Anchored state:** lead with `✓ Verified on blockchain` instead of `Hedera · seq #N`. Below that, on its own visible line (not hidden in a tooltip — the user needs to read and copy it to manually cross-check HashScan):
  - Truncated `data_hash` in monospace (first 8 / last 8 hex chars, same truncation as `trips/[id]/page.tsx`'s `ChainReceiptTag`), with a **Copy** button (`navigator.clipboard.writeText`, "✓ Copied" feedback for 2s — same pattern as `ChainReceiptTag.copyHash`).
  - The HashScan link (`Hedera · seq #N ↗`) stays as a secondary, smaller link next to or below the hash.
- **Unanchored state:** `— Not verified — minor change, skipped anchoring` instead of the bare `Not anchored` pill, so it explains *why*, not just *that*.
- This is a **same-file, additive change** to `BlockchainBadge.tsx` only — `ChainReceiptTag` on the trips page is not touched or refactored, even though the hash-display pattern is borrowed from it (no shared extraction; out of scope to refactor the trips page).
- The badge stays inside `ForensicOnly` everywhere it's already used (per-event in `EventTimeline`, and the right-panel "Blockchain" summary block) — only copy/layout changes, not who sees it.

---

## Implementation Plan

### Files to modify

- `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx` — layout swap, resizable panel state + drag handle.
- `frontend/dispatcher/components/blockchain/EventTimeline.tsx` — move change rows out of `ForensicOnly`; retitle cosmetic events.
- `frontend/dispatcher/lib/forensic/describeChange.ts` — add `gross_vehicle_mass_kg` and `length_m` to `FIELD_LABELS`.
- `frontend/dispatcher/components/blockchain/BlockchainBadge.tsx` — plain-language copy, visible hash + copy button, HashScan link kept as secondary.
- `backend/app/blockchain/critical_fields.py` — add `VEHICLE_COSMETIC_FIELDS`.
- `backend/app/orchestration/vehicle_service.py` — broaden `old`/`new` snapshots, compute `full_diff`, use it as `event.changed_fields`.

### Files to create

- `backend/tests/integration/test_vehicles_cosmetic_diff.py` — new integration tests (see Testing below).

### Steps

**Backend**

1. Add `VEHICLE_COSMETIC_FIELDS` to `critical_fields.py`.
2. In `vehicle_service.update_vehicle()`: extend `old`/`new` dicts to the combined field set; add `full_diff` computation; set `event.changed_fields = full_diff or {}`; keep `critical_diff` (renamed from `diff`) driving `event_type` and the anchoring payload exactly as before.

**Frontend**

3. `EventTimeline.tsx`: move the `changeRows` block out of `<ForensicOnly>` so it always renders; keep `BlockchainBadge` inside `ForensicOnly`; update `describeEvent()` cosmetic label to `"Vehicle details updated"`. In `describeChange.ts`, add `gross_vehicle_mass_kg: 'GVM'` and `length_m: 'Length'` to `FIELD_LABELS`.
4. `BlockchainBadge.tsx`: rewrite anchored/unanchored copy; add truncated-hash row with copy button and "✓ Copied" feedback state; keep HashScan link.
5. `vehicles/[id]/page.tsx`: swap the left/right panel order; add `panelWidth` state + `startResize`/`onMove`/`onUp` handlers modeled on `history/page.tsx`; replace the fixed `w-[450px]` with `style={{ width: panelWidth }}` and a drag handle on the panel's edge; everything currently rendered inside each panel moves with it unchanged.

### Testing

- `test_vehicles_cosmetic_diff.py`:
  - PATCH a vehicle changing only `make` → assert `VehicleEvent.changed_fields == {"make": {"from": "<old>", "to": "<new>"}}` and assert **no** `BlockchainReceipt` row is created for that event (cosmetic-only stays unanchored).
  - PATCH a vehicle changing both a critical field (`vin_number`) and a cosmetic field (`make`) in one request → assert `changed_fields` contains both, but `BlockchainReceipt.payload_json["fields"]` contains only the critical one.
- No frontend test framework exists in this repo (`frontend/dispatcher` has no `*.test.*` files or test script) — frontend changes are verified manually via dev server walkthrough, consistent with existing project convention.
- Run `cd backend && pytest` before marking done.

### Risk / shared files

- None of the modified files are on the shared-file list in `CLAUDE.md`. `critical_fields.py` and `vehicle_service.py` are vehicle-specific, not imported by driver or trip flows.
- `BlockchainBadge.tsx` is also used by the driver detail page (`fleet/drivers/[id]/page.tsx`) within the dispatcher app — the copy/hash changes will visibly affect that page too, since it's the same component. This is an in-scope-app, cross-page visual change worth flagging at review, even though it's not a "shared file" per the CLAUDE.md list and wasn't separately requested for the driver page.

### Suggested commits

> **Suggested commit:** `feat(vehicles): capture full field diff for cosmetic updates`
> **Suggested commit:** `feat(dispatcher): redesign vehicle detail layout and forensic badge`
