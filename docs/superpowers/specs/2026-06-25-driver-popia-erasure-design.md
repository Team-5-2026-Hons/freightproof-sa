# POPIA Driver Erasure

**Date:** 2026-06-25
**Author:** Ciaran
**Branch:** Ciaran
**Status:** Approved design — ready for implementation plan

## Goal

Give a driver's personal data an irreversible, POPIA-compliant erasure that
satisfies the data subject's right to be forgotten **without** destroying the
trip evidence the driver is bound to. Erasure wipes the personal-information
columns in place, leaves the row and its foreign keys intact, records an audit
marker, and is restricted to `admin_dispatcher`.

## Context

**POPIA, briefly.** The Protection of Personal Information Act gives a data
subject the right to have their personal information erased. A driver is a
person; their `full_name`, `id_number` (SA ID), `phone_number`,
`license_number`, `license_expiry`, and IDVS verification data are personal
information. A vehicle, by contrast, is company-asset data — so this feature
covers drivers only.

**Why not a hard delete.** The `drivers` row is referenced as evidence across
the chain, all NOT NULL except one:

- `trips.driver_id` (`db/models/trips.py:111`)
- `trips` substitution: `original_driver_id`, `substituting_driver_id`
  (`db/models/trips.py:175`, `:178`)
- `events.driver_id` (`db/models/events.py:50`)
- `evidence.captured_by_driver_id` (nullable) (`db/models/evidence.py:38`)

Hard-deleting either violates these FKs or cascade-destroys trip evidence —
fatal for an evidence platform. So erasure is **anonymisation in place**: the
row survives as a pseudonymous key, the personal columns are wiped. Any
SHA-256 hashes already anchored to Hedera remain valid and are not personal
data (a one-way hash is not reversible to the identity), so POPIA is satisfied
while the tamper-evident chain stays intact.

**Builds on** `2026-06-25-admin-only-fleet-mutations-design.md`: the erase
endpoint is born already gated with `require_admin_dispatcher`, and the erase
button is wrapped in that feature's `AdminOnly`. Build that feature first.

## Decisions (from brainstorming)

- **Two-tier model.** The existing `is_active` flag stays as the everyday,
  reversible "this driver is no longer with us" toggle. Erasure is a separate,
  **irreversible** action that wipes personal data. Deactivation ≠ erasure.
- **Block while in flight.** Erasure is refused (409) if the driver is bound to
  any trip not in a terminal/closed state — you cannot wipe the identity of
  someone mid-handshake.
- **Action endpoint, not `DELETE`.** `POST /drivers/{id}/erase` makes the
  irreversible intent explicit and leaves the `DELETE` verb unclaimed.
- **Double-erase is a 409**, not a silent no-op — surfaces an operator mistake
  rather than hiding it.

## Design

### Data model — two audit columns on `drivers`

Add to `db/models/people.py` `Driver`:

- `erased_at: Mapped[Optional[datetime]]` — `DateTime(timezone=True)`, nullable.
  Non-null marks the row as erased.
- `erased_by: Mapped[Optional[uuid.UUID]]` — `UUID`, nullable,
  `ForeignKey("users.id")`. The admin who performed the erasure (audit only).

**Alembic migration** named `2026_06_25_ciaran_add_driver_erasure.py`. Before
`alembic revision --autogenerate`: `git fetch origin`, check for unmerged
migrations on `dev`, rebase if any exist. No `db/models/__init__.py` change
(no new model).

### Sentinel constant

The four wiped string columns are NOT NULL, so they cannot be nulled. Define a
single placeholder, e.g. `ERASED_PLACEHOLDER = "[erased]"` in
`core/constants.py` (or the nearest existing constants module). It fits every
column width (`id_number` is `String(13)`, the placeholder is 8 chars).

### Orchestration — `erase_driver()` in `orchestration/driver_service.py`

```
erase_driver(db, driver_id, organization_id, current_user_id) -> DriverRead
```

1. Load the driver org-scoped → `ResourceNotFoundError` (→ 404) if missing or
   in another org.
2. If `driver.erased_at is not None` → raise `DriverAlreadyErasedError` (→ 409).
3. **Active-trip guard:** query for any trip with this `driver_id`
   (including substitution roles) whose status is not terminal/closed. If any
   exist → raise `DriverHasActiveTripsError` (→ 409). Use the trip state
   machine's terminal-state definition rather than a hardcoded literal.
4. Wipe personal data:
   - `full_name`, `id_number`, `phone_number`, `license_number` →
     `ERASED_PLACEHOLDER`
   - `license_expiry`, `idvs_last_verified_at` → `None`
   - `idvs_status` → `IdvsStatus.PENDING`
   - `is_active` → `False`
   - `erased_at` → `func.now()`, `erased_by` → `current_user_id`
5. Commit, return `DriverRead`.

Two new domain exceptions in `core/exceptions.py`: `DriverHasActiveTripsError`,
`DriverAlreadyErasedError` (siblings of the existing `ResourceNotFoundError` /
`DuplicateResourceError`).

### Endpoint — `POST /drivers/{driver_id}/erase`

In `endpoints/drivers.py`, gated by `require_admin_dispatcher`:

```python
@router.post("/{driver_id}/erase", response_model=DriverRead)
async def erase_driver_endpoint(
    driver_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> DriverRead:
    try:
        return await erase_driver(
            db=db,
            driver_id=driver_id,
            organization_id=current_user.organization_id,
            current_user_id=current_user.id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (DriverHasActiveTripsError, DriverAlreadyErasedError) as exc:
        raise HTTPException(status_code=409, detail=str(exc))
```

### Schema

`DriverRead` (`schemas/people.py`) gains `erased_at: datetime | None` so the
frontend can badge an erased driver. `erased_by` is **not** exposed in the read
model — it is audit-only and stays server-side.

### Frontend

- Typed `eraseDriver(id)` method on the API client → `POST /drivers/{id}/erase`.
- Driver detail (`fleet/drivers/[id]/page.tsx`): an admin-only **"Erase
  personal data"** button wrapped in `AdminOnly` (from the foundation feature).
  Clicking opens a confirmation dialog that:
  - states the action is **irreversible**,
  - lists exactly which fields are wiped,
  - requires type-to-confirm (e.g. type the driver's name) before the confirm
    button enables.
- On success: show the erased state — an **"Personal data erased"** badge,
  the PII fields rendered as `[erased]`, and Edit/Erase actions disabled.
- On 409 (active trips): a clear message — "Close this driver's open trips
  before erasing their personal data." On 409 (already erased): refresh to the
  erased state.

An erased driver is `is_active = False`, so it already drops out of the
active-driver views; the badge distinguishes "erased" from a plain deactivation.

## Error handling

| Condition | Result |
| --- | --- |
| Non-admin calls erase | `403 Admin dispatcher role required.` |
| Driver not found / other org | `404` |
| Driver on an open/in-transit trip | `409` active-trips message |
| Driver already erased | `409` already-erased message |
| Admin erases an eligible driver | `200` + `DriverRead` with `erased_at` set |

## Testing

**Unit** (`tests/unit/test_driver_service_erase.py`, no HTTP):

- `test_erase_driver_wipes_personal_data` — all PII columns become the
  placeholder / null; `idvs_status` reset; `is_active` False; `erased_at` and
  `erased_by` set.
- `test_erase_driver_with_active_trip_raises` → `DriverHasActiveTripsError`,
  no columns mutated.
- `test_erase_already_erased_driver_raises` → `DriverAlreadyErasedError`.

**Integration** (`tests/integration/test_drivers_erase.py`):

- `test_erase_driver_admin_succeeds` → 200; assert DB row: PII gone,
  `is_active` False, `erased_at` set; FK rows on `trips`/`events` still resolve
  to the (now anonymised) driver.
- `test_erase_driver_non_admin_forbidden` → 403, row untouched.
- `test_erase_missing_driver` → 404.
- `test_erase_driver_with_open_trip` → 409, row untouched.
- `test_erase_already_erased` → 409.

Run `cd backend && pytest` before marking done.

## Out of scope

- Admin-gating of create/edit and the `AdminOnly` wrapper — delivered by the
  foundation feature.
- Vehicle deletion/erasure — not built; a vehicle is not personal data.
- A scheduled / automated erasure (e.g. retention-period expiry) — this feature
  is operator-initiated only.
- Cascade hard-delete of trips/events — explicitly rejected; the evidence chain
  is preserved.

## Cross-dev / shared-file flags

- **Alembic migration** on `drivers` — coordinate per CLAUDE.md: other devs may
  have pending migrations on `dev`; rebase-check before autogenerate; name the
  file with the author (`2026_06_25_ciaran_add_driver_erasure.py`).
- `db/models/people.py` (two columns), `schemas/people.py` (DriverRead +
  `erased_at`), `core/exceptions.py` (two exceptions), `core/constants.py`
  (placeholder), `orchestration/driver_service.py`, `endpoints/drivers.py` —
  fleet-owned; flag the model + schema touch.
- No `db/models/__init__.py` change.
