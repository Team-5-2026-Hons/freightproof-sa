# Precinct Create, Edit & Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an admin dispatcher a precincts surface — list, detail, create and edit — where a precinct's name, address, coordinates and geofence radius are set against their own organization, visualised on a map with the geofence drawn to scale, anchored to Hedera on every evidence-critical change, and read back by `GET /precincts` for trip creation.

**Architecture:** Three layers of the existing pattern. Constrained Pydantic v2 bodies that never accept an organization id from the client; a new `orchestration/precinct_service.py` that takes the org id from the authenticated caller and scopes every read and write to it; thin admin-gated endpoints. Writes append to a new `precinct_events` ledger and anchor critical-field changes to Hedera — a near-copy of `vehicle_service.py`. The dispatcher gets `/precincts` (list), `/precincts/[id]` (detail with map + change history), and `/precincts/new` + `/precincts/[id]/edit` (full-page form with a click-to-place map).

**Tech Stack:** Python 3.13, FastAPI 0.115+, SQLAlchemy 2.0 async, Alembic, Pydantic v2, pytest + pytest-asyncio (`asyncio_mode = auto`), Hedera HCS, Next.js 15 App Router, TypeScript 5.5+, Tailwind, vitest, Leaflet 1.9+.

---

## Context an engineer joining this task needs

**What a precinct is.** A physical depot or warehouse — the origin or destination of a trip. `trips.origin_precinct_id` and `trips.destination_precinct_id` point at it. Before this story, rows only ever arrived via `backend/scripts/seed_demo.py`; there was no write endpoint at all.

**Why this story exists.** FP-68 (Pulsit geofence corroboration) reads `precincts.geofence_radius_metres` and the precinct's coordinates to decide whether a handshake was signed inside the facility. FP-191 depends on those coordinates being right. Without this story, staging that demo means hand-writing a database row on demo day.

**The security shape.** `principal_organization_id` is the owner. `is_shared` is a cross-org visibility opt-in (SEC-PRECINCT-1). Reads and writes are scoped **differently on purpose**:

- **READ** — own org OR `is_shared`. A dispatcher can see a depot they do not own, which is what lets an operator plan trips into a client's facility.
- **WRITE** — own org only. A write against anything else returns **404, not 403**, matching how `get_trip_detail` and `update_vehicle` already scope by org at the DB level so existence is never leaked.

Visibility is not permission. A shared precinct is listed and unwritable.

**Settled — do not reopen.** Circle-and-radius only; polygon geofences were decided out on 26 Aug. Precincts already exist as the warehouse table. True many-to-many precinct ownership is not this iteration.

---

## Decisions taken

| # | Decision | Rationale |
|---|---|---|
| D1 | **Demo by creating a precinct**, not editing a seeded one. No `seed_demo.py` change. | Seeded precincts belong to `_CLIENT_ORG_ID` (`seed_demo.py:168`) while the demo dispatcher belongs to the operator org — so under the 404 rule an admin can see them and edit none. That is the security rule working. The story's demo line is a create anyway. |
| D2 | **Radius bounds: 50 m floor, 5000 m ceiling.** | `GPS_TOLERANCE_METRES` is 50, so a geofence narrower than the GPS agreement tolerance makes FP-68's check meaningless — every trip would fail it. The ceiling catches a kilometres-for-metres unit slip. |
| D3 | **`is_shared` exposed as a Switch, default off.** | It is the only way an operator-created precinct becomes visible to a client org. Default off keeps the safe choice automatic. |
| D4 | **Anchor precinct writes to Hedera**, with a `precinct_events` ledger. | Precincts would otherwise be the only mutable, evidence-bearing entity without one — `Vehicle` and `Driver` both have it. Reverses the original "no migration" scoping at the product owner's direction. |
| D5 | **Nav: standalone unlabelled group, route `/precincts`.** | "Fleet" means vehicles and drivers — things you own that move. A precinct is a fixed place. `NavGroup.label` is already optional (`Sidebar.tsx:186`), so this needs no new pattern, and it avoids inventing a group name before there is a second resident. Top-level route matches the API path and `/trips`, `/exceptions`, `/sla`. |
| D6 | **Map: raw Leaflet, Esri satellite default + OSM street toggle, SVG schematic fallback.** | `L.circle` takes a radius in **metres** natively — that is the whole geofence visualisation, correct at every zoom, free. Evaluated against MapLibre GL (pixel-radius circles; needs turf.js to draw a true 200 m circle, ~5× the bundle) and OpenLayers (capable but far heavier API). Raw Leaflet rather than `react-leaflet`: a second dependency whose only job is bindings, adding a React-19/Next-15 compat surface for no benefit. |
| D7 | **No address geocoding.** Click-to-place + paste-coordinates instead. | See "Recorded for later" below. |

---

## Findings that change the work

**1. `PrecinctCreate` is unsafe and must not be used as a request body.** It inherits `PrecinctBase`, which carries `principal_organization_id: UUID` as a required client-supplied field (`schemas/organisations.py:44`) — precisely the cross-org write hole this story guards against, pre-wired into the schema. `VehicleCreateBody` already solved this one file over: *"organization_id is injected from the dispatcher's JWT — not accepted from the client"* (`schemas/vehicles.py:74`). Task 1 replaces both precinct input schemas. Neither is imported anywhere except the `schemas/__init__.py` re-export.

**2. No validation exists on any of the three fields the story cares about.** `latitude`/`longitude` are `Numeric(10, 7)` — three digits before the decimal point — so a value ≥ 1000 raises a raw asyncpg `NumericValueOutOfRange` that surfaces as a **500, not a 422**. `geofence_radius_metres` has no floor, so radius 0 makes FP-68 fail every trip through that precinct with no visible cause.

**3. Two `else` fallthroughs will silently break the anchor.** Both return a plausible wrong answer rather than raising, so they survive shallow testing and fail at demo:

- `blockchain/subject_visibility.py:73` — an unhandled `SubjectType` raises `SubjectNotVisibleError`, which the endpoint maps to **404**. Without a `PRECINCT_EVENT` branch, every precinct receipt is invisible to the verify endpoint.
- `orchestration/verification_service.py:216` — an unhandled subject type returns `VerifyStatus.NO_RECEIPT`. Without a branch, a precinct event that **is** anchored on Hedera reports as never anchored.

Tasks 5 and 6 close both, with tests that fail first.

**4. `frontend/shared/lib/mocks/precincts.ts` types four rows as `Precinct[]`,** and `driver-pwa/lib/utils/precinct-name.ts` imports them. Adding a required field to the `Precinct` interface breaks typecheck on **both** surfaces. Task 8 updates them in the same commit and Task 8 Step 9 typechecks the driver PWA to prove it.

**5. `Sidebar.tsx:185` keys nav groups on `key={group.label}`.** An unlabelled group keys on `undefined` — fine with one, a React key collision with two. Task 10 changes it to key on the first item's href.

**6. Migrations live in `backend/migrations/versions/`, not `alembic/versions/`.** Current head is `ciaran_uniq_fleet_ids` (26 migrations). Confirmed clean — no other dev is holding an unmerged migration as of 2026-08-31.

---

## Anchoring design

Mirrors `vehicle_service.py`. A field is **critical** if changing it changes what the evidence means.

| | Fields | Behaviour |
|---|---|---|
| `PRECINCT_CRITICAL_FIELDS` | `latitude`, `longitude`, `geofence_radius_metres`, `is_shared` | Event row **and** Hedera anchor |
| `PRECINCT_COSMETIC_FIELDS` | `name`, `address` | Event row only, no anchor |

`is_shared` sits in critical deliberately: it is an access-control change, and `Vehicle` already treats `is_active` — also access-shaped, not evidence — as critical. Consistency beats a fine distinction.

**No PII hashing here, and that is worth a comment in the code.** `create_vehicle` hashes `pulsit_device_id` before the payload reaches Hedera. A precinct is a business address and a business coordinate — nothing personal — so the canonical payload carries its fields in the clear. Say so explicitly, or a later reader will assume the hashing was forgotten.

**Anchoring is not the same as reproducibility, and does not close the FP-68 gap.** The anchor proves *that a precinct changed and when*. It does **not** make a historical geofence verdict reproducible, because `phase_events` still stores only `pulsit_geofence_confirmed` (a boolean) with no record of the coordinates and radius the verdict was computed against. `compute_journey_lock_hash` locks precinct **ids** only (`crypto/hashing.py:18-30`), so moving a precinct leaves every journey lock still verifying.

Both are needed. **Raise this as an FP-68 acceptance criterion now, while it is free:** when FP-68 writes the verdict, it must also record the coordinates and radius it used, making the verdict self-contained.

---

## Recorded for later — deliberately deferred

**Address search / geocoding (D7).** Dropped from this story, not rejected forever. Two reasons, both worth preserving:

1. **A geocoder returns the wrong point for this use case.** Nominatim or Google for "12 Sookhai Place, Riverhorse Valley" gives a street centroid or postal address. For a large warehouse estate that is routinely 200–400 m from the actual gate — *the same order of magnitude as the geofence radius itself*. It would seed FP-68 with a plausible-looking wrong answer, which is worse than a blank field.
2. **It is a second integration, not a widget.** Per the layering rule an external API client belongs in `backend/app/integrations/` behind an endpoint — calling a geocoder from the browser leaks the dispatcher's IP to a third party and skips the layer. Done properly: a client, a mock/real switch (the `PULSE_USE_MOCK` pattern), rate limiting, caching and tests.

**What replaces it, and is arguably better:** click-to-place on the map (pan to the gate, click, coordinates fill in; drag to nudge) and paste-coordinates (copy `-29.7942, 30.9820` from Google Maps into either coordinate field and it splits across both). Both are in Task 12.

If geocoding is picked up later it slots in behind the same form as a search box, with no rework.

**Other follow-ups:**
- No `UniqueConstraint(principal_organization_id, name)` on `precincts` — Task 4's duplicate-name check is advisory and races.
- `DESIGN_SYSTEM.md` §10.9 says the sidebar group order is "Overview → Trips → Reporting"; the code has OVERVIEW / TRIPS / FLEET and now a fourth unlabelled group. The doc is stale independently of this story.
- `DESIGN_SYSTEM.md` §11 reference HTMLs are still marked "to be split" — never done.
- Esri World Imagery is used without a key and requires attribution. Standard practice, but its terms are less unambiguous than OSM's — confirm before the project is published publicly. Fallback if it ever becomes a problem: OSM street tiles + the schematic, a one-line tile-URL change.

---

## File Structure

### Backend

| File | Responsibility |
|---|---|
| `backend/app/schemas/organisations.py` *(modify)* | `PrecinctCreateBody` / `PrecinctUpdateBody` replacing the unsafe pair. Owns the coordinate and radius bounds as module-private constants, per the `schemas/vehicles.py` precedent. |
| `backend/app/schemas/__init__.py` *(modify)* | Re-export the new names. |
| `backend/app/schemas/events.py` *(modify)* | `PrecinctEventRead`. |
| `backend/app/db/models/enums.py` *(modify)* | `PrecinctEventType`; `SubjectType.PRECINCT_EVENT`; two `BlockchainReceiptType` members. |
| `backend/app/db/models/events.py` *(modify)* | `PrecinctEvent`, beside `VehicleEvent` / `DriverEvent`. |
| `backend/app/db/models/__init__.py` *(modify)* | Register `PrecinctEvent` — required or Alembic will not see it. |
| `backend/migrations/versions/2026_08_31_ciaran_add_precinct_events.py` *(create)* | `precinct_events` table. Head is `ciaran_uniq_fleet_ids`. |
| `backend/app/blockchain/critical_fields.py` *(modify)* | `PRECINCT_CRITICAL_FIELDS`, `PRECINCT_COSMETIC_FIELDS`. |
| `backend/app/blockchain/subject_visibility.py` *(modify)* | `PRECINCT_EVENT` branch — without it every precinct receipt 404s. |
| `backend/app/orchestration/verification_service.py` *(modify)* | `_reconstruct_precinct_event_payload` + dispatch branch — without it an anchored precinct event reports `NO_RECEIPT`. |
| `backend/app/orchestration/precinct_service.py` *(create)* | `list_precincts` (moved), `create_precinct`, `update_precinct`, `get_precinct_detail`. Org scoping and anchoring live here. |
| `backend/app/orchestration/resource_service.py` *(modify)* | Remove `list_precincts` and its now-unused imports; update the extraction docstring. |
| `backend/app/api/v1/endpoints/precincts.py` *(modify)* | GET list, POST, PATCH, GET detail. Thin: validate, call service, map exceptions. |
| `backend/app/core/limits.py` *(modify)* | `PRECINCT_MUTATION` budget. |

### Frontend

| File | Responsibility |
|---|---|
| `frontend/shared/lib/types/precinct.ts` *(modify)* | `is_shared` on `Precinct`; `PrecinctEvent`, `PrecinctDetail`. **Shared.** |
| `frontend/shared/lib/mocks/precincts.ts` *(modify)* | `is_shared` on the four mock rows, or both surfaces fail typecheck. **Shared.** |
| `frontend/shared/lib/validation/rules.ts` *(modify)* | `decimalInRange` primitive. **Shared.** |
| `frontend/shared/lib/validation/constants.ts` *(modify)* | Coordinate and radius bounds mirroring the backend. **Shared.** |
| `frontend/shared/lib/validation/precinct.ts` *(create)* | `validatePrecinctForm`, `parseCoordinatePair`. **Shared.** |
| `frontend/dispatcher/components/map/GeofenceMap.tsx` *(create)* | The only file that touches Leaflet. Tiles + `L.circle`, click-to-place, SVG schematic fallback. |
| `frontend/dispatcher/components/map/GeofenceSchematic.tsx` *(create)* | Zero-dependency SVG: circle to scale, metre scale bar. Fallback and list thumbnail. |
| `frontend/dispatcher/lib/hooks/usePrecincts.ts` *(modify)* | Expose `refetch`. Additive — four pages consume this hook. |
| `frontend/dispatcher/lib/hooks/usePrecinctDetail.ts` *(create)* | Detail fetch, mirroring `useVehicleDetail`. |
| `frontend/dispatcher/lib/constants/routes.ts` *(modify)* | `precincts`, `precinctDetail`, `precinctNew`, `precinctEdit`. |
| `frontend/dispatcher/components/layout/Sidebar.tsx` *(modify)* | Unlabelled nav group + the `key={group.label}` fix. |
| `frontend/dispatcher/app/(app)/precincts/page.tsx` *(create)* | List. |
| `frontend/dispatcher/app/(app)/precincts/[id]/page.tsx` *(create)* | Detail: map, info column, change history, blockchain card. |
| `frontend/dispatcher/app/(app)/precincts/new/page.tsx` *(create)* | Create form. |
| `frontend/dispatcher/app/(app)/precincts/[id]/edit/page.tsx` *(create)* | Edit form — same component, pre-filled. |
| `frontend/dispatcher/package.json` *(modify)* | `leaflet` + `@types/leaflet`. **Shared file — needs team agreement.** |

### Cross-dev risk

- **One migration.** Head confirmed clean at `ciaran_uniq_fleet_ids`. Still `git fetch origin` and re-check before autogenerate — the check is cheap and the failure is not.
- **Five files under `frontend/shared/`**, all additive, but `driver-pwa` imports from that directory. Flag every one in TASK COMPLETE.
- **`package.json`** is on the shared-files list. Leaflet needs team agreement before Task 9.
- `usePrecincts.ts` backs four dispatcher pages; adding a field to its return is backwards-compatible and no call site changes.

### Task order

Backend 1–7 then frontend 8–13. Task 9 (Leaflet) is the only one gated on an external decision, and nothing before it depends on that decision, so a "no" on the dependency costs only Tasks 9 and 12's map half.

| # | Task |
|---|---|
| 1 | Constrained request bodies |
| 2 | Migration, `PrecinctEvent` model, enums, critical fields |
| 3 | `precinct_service`: move `list_precincts`, add `create_precinct` + anchor |
| 4 | `update_precinct`: org-scoped 404, critical-diff anchor |
| 5 | `subject_visibility` — `PRECINCT_EVENT` branch |
| 6 | `verification_service` — precinct payload reconstruction |
| 7 | `get_precinct_detail` + endpoints + integration tests |
| 8 | Shared types, mocks, validation |
| 9 | `GeofenceSchematic` + `GeofenceMap` |
| 10 | Hooks, routes, nav |
| 11 | List page |
| 12 | Create / edit page |
| 13 | Detail page |

---

## Task 1: Constrained request bodies

**Files:**
- Modify: `backend/app/schemas/organisations.py:56-68`
- Modify: `backend/app/schemas/__init__.py:5`
- Test: `backend/tests/unit/test_schema_validators.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_schema_validators.py`:

```python
import pytest
from pydantic import ValidationError

from app.schemas.organisations import PrecinctCreateBody, PrecinctUpdateBody


def _valid_precinct_payload() -> dict:
    return {
        "name": "FedEx DBN — Riverhorse Valley",
        "address": "12 Sookhai Place, Durban",
        "latitude": -29.7942,
        "longitude": 30.9820,
        "geofence_radius_metres": 200,
    }


def test_precinct_create_body_rejects_client_supplied_organization_id():
    """The org id comes from the JWT. A body carrying one must not set it.

    Pydantic ignores unknown keys by default, so the assertion is that the field
    does not exist on the model at all — not that construction fails.
    """
    body = PrecinctCreateBody(
        **_valid_precinct_payload(),
        principal_organization_id="00000000-0000-0000-0000-0000000000ff",
    )

    assert not hasattr(body, "principal_organization_id")
    assert "principal_organization_id" not in body.model_dump()


def test_precinct_create_body_accepts_valid_payload():
    body = PrecinctCreateBody(**_valid_precinct_payload())

    assert body.latitude == -29.7942
    assert body.geofence_radius_metres == 200
    assert body.is_shared is False


def test_precinct_create_body_defaults_radius_to_200():
    payload = _valid_precinct_payload()
    del payload["geofence_radius_metres"]

    assert PrecinctCreateBody(**payload).geofence_radius_metres == 200


@pytest.mark.parametrize(
    "field,value",
    [
        ("latitude", 90.1), ("latitude", -90.1), ("latitude", 1000.0),
        ("longitude", 180.1), ("longitude", -180.1), ("longitude", 1000.0),
        ("geofence_radius_metres", 0),
        ("geofence_radius_metres", 49),
        ("geofence_radius_metres", 5001),
        ("name", "   "),
    ],
)
def test_precinct_create_body_rejects_out_of_range_field(field, value):
    payload = _valid_precinct_payload()
    payload[field] = value

    with pytest.raises(ValidationError):
        PrecinctCreateBody(**payload)


@pytest.mark.parametrize(
    "field,value",
    [("latitude", -90.0), ("latitude", 90.0),
     ("longitude", -180.0), ("longitude", 180.0),
     ("geofence_radius_metres", 50), ("geofence_radius_metres", 5000)],
)
def test_precinct_create_body_accepts_boundary_values(field, value):
    payload = _valid_precinct_payload()
    payload[field] = value

    assert getattr(PrecinctCreateBody(**payload), field) == value


def test_precinct_create_body_strips_surrounding_whitespace_from_name():
    payload = _valid_precinct_payload()
    payload["name"] = "  Riverhorse Valley  "

    assert PrecinctCreateBody(**payload).name == "Riverhorse Valley"


def test_precinct_update_body_allows_empty_patch():
    """Every field optional — exclude_unset is what makes a partial PATCH work."""
    assert PrecinctUpdateBody().model_dump(exclude_unset=True) == {}


def test_precinct_update_body_tracks_only_supplied_fields():
    body = PrecinctUpdateBody(geofence_radius_metres=350)

    assert body.model_dump(exclude_unset=True) == {"geofence_radius_metres": 350}


def test_precinct_update_body_cannot_transfer_ownership():
    body = PrecinctUpdateBody(
        principal_organization_id="00000000-0000-0000-0000-0000000000ff",
    )

    assert not hasattr(body, "principal_organization_id")
    assert body.model_dump(exclude_unset=True) == {}


@pytest.mark.parametrize("radius", [0, 49, 5001])
def test_precinct_update_body_rejects_out_of_range_radius(radius):
    with pytest.raises(ValidationError):
        PrecinctUpdateBody(geofence_radius_metres=radius)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/unit/test_schema_validators.py -k precinct -v
```

Expected: collection error — `ImportError: cannot import name 'PrecinctCreateBody' from 'app.schemas.organisations'`.

- [ ] **Step 3: Replace the input schemas**

Extend the import block at the top of `backend/app/schemas/organisations.py`:

```python
from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
```

Replace lines 56-68 (the `PrecinctCreate` and `PrecinctUpdate` classes) with the following. Leave `PrecinctBase` and `PrecinctRead` untouched — `PrecinctBase` is the **read** shape and must keep `principal_organization_id`, because `GET /precincts` returns it.

```python
# Bounds mirrored from the DB column and the domain, so Pydantic answers with a 422
# before Postgres does. latitude/longitude are Numeric(10, 7) — precision 10, scale 7,
# so three digits before the point. Anything >= 1000 raises a raw asyncpg
# NumericValueOutOfRange that surfaces as a 500; the real world is tighter anyway.
_LATITUDE_MIN, _LATITUDE_MAX = -90.0, 90.0
_LONGITUDE_MIN, _LONGITUDE_MAX = -180.0, 180.0

# The floor is not arbitrary: GPS_TOLERANCE_METRES is 50, so a geofence narrower than
# the agreement tolerance itself makes the FP-68 corroboration check meaningless —
# every trip through it would fail. The ceiling catches a unit slip (km entered as m)
# and a stray digit; 5 km is well beyond any real facility.
_RADIUS_MIN_METRES = 50
_RADIUS_MAX_METRES = 5_000
_RADIUS_DEFAULT_METRES = 200

_NAME_MAX_LENGTH = 255  # mirrors String(255) on Precinct.name

PrecinctNameStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=_NAME_MAX_LENGTH)
]
LatitudeFloat = Annotated[float, Field(ge=_LATITUDE_MIN, le=_LATITUDE_MAX)]
LongitudeFloat = Annotated[float, Field(ge=_LONGITUDE_MIN, le=_LONGITUDE_MAX)]
RadiusMetresInt = Annotated[int, Field(ge=_RADIUS_MIN_METRES, le=_RADIUS_MAX_METRES)]


class PrecinctCreateBody(BaseModel):
    """Fields an admin dispatcher submits when mapping a new precinct.

    principal_organization_id is deliberately absent — ownership is injected from the
    caller's JWT and never accepted from the client, which is what stops a dispatcher
    creating a precinct under another organization's id (SEC-PRECINCT-1). Same rule and
    same reason as VehicleCreateBody in schemas/vehicles.py.
    """

    model_config = ConfigDict(from_attributes=True)

    name: PrecinctNameStr
    address: Optional[str] = None
    latitude: LatitudeFloat
    longitude: LongitudeFloat
    geofence_radius_metres: RadiusMetresInt = _RADIUS_DEFAULT_METRES
    is_shared: bool = False


class PrecinctUpdateBody(BaseModel):
    """Fields an admin dispatcher may change via PATCH /precincts/{id}.

    All optional — only supplied fields are applied, via model_dump(exclude_unset=True).
    principal_organization_id is absent here too: ownership is not transferable, so a
    precinct cannot be moved into or out of another org's control.
    """

    model_config = ConfigDict(from_attributes=True)

    name: Optional[PrecinctNameStr] = None
    address: Optional[str] = None
    latitude: Optional[LatitudeFloat] = None
    longitude: Optional[LongitudeFloat] = None
    geofence_radius_metres: Optional[RadiusMetresInt] = None
    is_shared: Optional[bool] = None
```

- [ ] **Step 4: Update the re-export**

`backend/app/schemas/__init__.py` line 5 currently reads:

```python
    PrecinctBase, PrecinctCreate, PrecinctUpdate, PrecinctRead,
```

Change to:

```python
    PrecinctBase, PrecinctCreateBody, PrecinctUpdateBody, PrecinctRead,
```

If `__all__` lists `"PrecinctCreate"` / `"PrecinctUpdate"`, rename those entries too.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && pytest tests/unit/test_schema_validators.py -k precinct -v
```

Expected: PASS, 24 tests after parametrize expansion.

- [ ] **Step 6: Verify nothing else imported the deleted names**

```bash
cd backend && grep -rn "PrecinctCreate\b\|PrecinctUpdate\b" app tests --include="*.py"
```

Expected: no output. (`PrecinctCreateBody` does not match `PrecinctCreate\b`.)

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/organisations.py backend/app/schemas/__init__.py backend/tests/unit/test_schema_validators.py
git commit -m "feat(api): add constrained precinct create/update bodies that reject a client-supplied org id"
```

---

## Task 2: Migration, `PrecinctEvent` model, enums, critical fields

**Files:**
- Modify: `backend/app/db/models/enums.py`
- Modify: `backend/app/db/models/events.py`
- Modify: `backend/app/db/models/__init__.py`
- Modify: `backend/app/blockchain/critical_fields.py`
- Modify: `backend/app/schemas/events.py`
- Create: `backend/migrations/versions/2026_08_31_ciaran_add_precinct_events.py`
- Test: `backend/tests/unit/test_precinct_event_model.py`

- [ ] **Step 1: Re-check the migration chain before writing anything**

```bash
cd backend && git fetch origin && git log --oneline origin/dev -5 -- migrations/versions/
```

Expected: nothing newer than `2026_08_31`. If another dev has landed a migration since this plan was written, the new file's `down_revision` must point at **their** revision, not `ciaran_uniq_fleet_ids`. Do not fix a diverged chain alone — flag it and coordinate, per CLAUDE.md.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/unit/test_precinct_event_model.py`:

```python
"""Model, enum and critical-field contract for precinct anchoring.

Pure assertions about declared structure — no DB. The migration is verified
separately by running it (Step 7).
"""

from app.blockchain.critical_fields import (
    PRECINCT_COSMETIC_FIELDS,
    PRECINCT_CRITICAL_FIELDS,
    diff_critical_fields,
)
from app.db.models import Base
from app.db.models.enums import BlockchainReceiptType, PrecinctEventType, SubjectType
from app.db.models.events import PrecinctEvent


def test_precinct_events_table_is_registered():
    """Registration in db/models/__init__.py is what makes Alembic see the table."""
    assert "precinct_events" in Base.metadata.tables


def test_precinct_event_carries_the_same_columns_as_vehicle_event():
    columns = {c.name for c in PrecinctEvent.__table__.columns}

    assert columns == {
        "id",
        "precinct_id",
        "event_type",
        "changed_fields",
        "changed_by_user_id",
        "blockchain_receipt_id",
        "created_at",
        "updated_at",
    }


def test_precinct_event_blockchain_receipt_is_nullable():
    """Cosmetic edits are recorded unanchored, so this column must allow null."""
    assert PrecinctEvent.__table__.columns["blockchain_receipt_id"].nullable is True


def test_subject_type_has_precinct_event():
    assert SubjectType.PRECINCT_EVENT.value == "precinct_event"


def test_receipt_types_exist_for_precinct():
    assert BlockchainReceiptType.PRECINCT_CREATED.value == "precinct_created"
    assert BlockchainReceiptType.PRECINCT_UPDATED.value == "precinct_updated"


def test_precinct_event_types_cover_every_meaningful_change():
    assert {e.value for e in PrecinctEventType} == {
        "created",
        "relocated",
        "geofence_resized",
        "sharing_changed",
        "cosmetic_update",
    }


def test_critical_and_cosmetic_fields_are_disjoint():
    assert PRECINCT_CRITICAL_FIELDS & PRECINCT_COSMETIC_FIELDS == frozenset()


def test_geofence_defining_fields_are_critical():
    """These three decide the FP-68 verdict — a change to any must be anchored."""
    assert {"latitude", "longitude", "geofence_radius_metres"} <= PRECINCT_CRITICAL_FIELDS


def test_sharing_is_critical_but_name_is_not():
    assert "is_shared" in PRECINCT_CRITICAL_FIELDS
    assert "name" in PRECINCT_COSMETIC_FIELDS
    assert "address" in PRECINCT_COSMETIC_FIELDS


def test_moving_a_precinct_is_a_critical_diff():
    old = {"latitude": -29.7942, "longitude": 30.9820, "geofence_radius_metres": 200, "is_shared": False}
    new = {"latitude": -26.0942, "longitude": 28.1342, "geofence_radius_metres": 200, "is_shared": False}

    diff = diff_critical_fields(old, new, PRECINCT_CRITICAL_FIELDS)

    assert diff is not None
    assert set(diff.keys()) == {"latitude", "longitude"}
    assert diff["latitude"] == {"from": -29.7942, "to": -26.0942}


def test_renaming_a_precinct_is_not_a_critical_diff():
    old = {"latitude": -29.7942, "longitude": 30.9820, "geofence_radius_metres": 200, "is_shared": False}

    assert diff_critical_fields(old, dict(old), PRECINCT_CRITICAL_FIELDS) is None
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && pytest tests/unit/test_precinct_event_model.py -v
```

Expected: collection error — `ImportError: cannot import name 'PrecinctEventType' from 'app.db.models.enums'`.

- [ ] **Step 4: Add the enums**

In `backend/app/db/models/enums.py`, add two members to `BlockchainReceiptType` (after `DRIVER_UPDATED`, line 142):

```python
    PRECINCT_CREATED    = "precinct_created"
    PRECINCT_UPDATED    = "precinct_updated"
```

Add one member to `SubjectType` (after `PHASE_EVENT`, line 151):

```python
    PRECINCT_EVENT  = "precinct_event"
```

Add a new enum after `DriverEventType` (line 168):

```python
class PrecinctEventType(str, enum.Enum):
    CREATED          = "created"
    # Coordinates moved. Named separately from a resize because the two have
    # different evidentiary meanings: one changes WHERE the facility is, the
    # other changes HOW CLOSE a handshake must be to count as inside it.
    RELOCATED        = "relocated"
    GEOFENCE_RESIZED = "geofence_resized"
    SHARING_CHANGED  = "sharing_changed"
    COSMETIC_UPDATE  = "cosmetic_update"
```

- [ ] **Step 5: Add the model**

Append to `backend/app/db/models/events.py`. Update the module docstring's first line to read *"Append-only event-log models for vehicles, drivers and precincts."*

```python
class PrecinctEvent(Base):
    """Append-only log of changes to a precinct.

    Same shape as VehicleEvent by design — a precinct is reference data that FP-68's
    geofence verdict depends on, so a change to its coordinates or radius is an
    evidentiary event, not a settings tweak.

    Unlike vehicle events there is nothing to hash before anchoring: a precinct holds
    a business address and a business coordinate, no personal data. See
    precinct_service.create_precinct for why the canonical payload is in the clear.
    """

    __tablename__ = "precinct_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    precinct_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    changed_fields: Mapped[Any] = mapped_column(JSONB, nullable=False)
    changed_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "blockchain_receipts.id",
            use_alter=True,
            name="fk_precinct_events_blockchain_receipt",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

Register it in `backend/app/db/models/__init__.py` alongside `VehicleEvent` and `DriverEvent` — **without this Alembic will not see the table** and Step 7 autogenerates an empty migration.

- [ ] **Step 6: Add the critical-field sets**

Append to `backend/app/blockchain/critical_fields.py`:

```python
# A precinct's position and radius are the inputs to FP-68's geofence verdict, so a
# change to either changes what every future handshake at this facility MEANS. That is
# the definition of critical here.
#
# is_shared is critical too, on the same grounds Vehicle treats is_active as critical:
# it is an access-control change rather than an evidence change, and an unanchored
# silent widening of who can see a facility is exactly the audit gap anchoring exists
# to close.
PRECINCT_CRITICAL_FIELDS: frozenset[str] = frozenset({
    "latitude",
    "longitude",
    "geofence_radius_metres",
    "is_shared",
})

# Labels for humans. Recorded in the event log for dispatcher visibility, never
# anchored — renaming a depot changes no verdict and should not cost a Hedera fee.
PRECINCT_COSMETIC_FIELDS: frozenset[str] = frozenset({
    "name",
    "address",
})
```

Append the read schema to `backend/app/schemas/events.py`, mirroring `VehicleEventRead`:

```python
class PrecinctEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    precinct_id: UUID
    event_type: str
    changed_fields: dict
    changed_by_user_id: UUID
    blockchain_receipt_id: Optional[UUID] = None
    created_at: datetime
```

Check the existing imports at the top of `schemas/events.py` cover `BaseModel`, `ConfigDict`, `UUID`, `datetime` and `Optional`; add whichever are missing.

- [ ] **Step 7: Generate and review the migration**

```bash
cd backend && alembic revision --autogenerate -m "add precinct_events"
```

Rename the generated file to `migrations/versions/2026_08_31_ciaran_add_precinct_events.py` and set its header to match the house style:

```python
"""add precinct_events table

Revision ID: ciaran_precinct_events
Revises: ciaran_uniq_fleet_ids
Create Date: 2026-08-31
"""

revision = "ciaran_precinct_events"
down_revision = "ciaran_uniq_fleet_ids"
branch_labels = None
depends_on = None
```

**Read the generated body before running it.** Autogenerate sometimes proposes unrelated drops when a model and the live schema have drifted. The upgrade should contain exactly one `create_table("precinct_events", ...)` plus its index, and nothing else. If it proposes anything touching another table, delete those lines. The expected body:

```python
def upgrade() -> None:
    op.create_table(
        "precinct_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("precinct_id", UUID(as_uuid=True), sa.ForeignKey("precincts.id"), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("changed_fields", JSONB, nullable=False),
        sa.Column("changed_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "blockchain_receipt_id",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "blockchain_receipts.id",
                use_alter=True,
                name="fk_precinct_events_blockchain_receipt",
            ),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_precinct_events_precinct_id", "precinct_events", ["precinct_id"])


def downgrade() -> None:
    op.drop_index("ix_precinct_events_precinct_id", table_name="precinct_events")
    op.drop_table("precinct_events")
```

Ensure the imports match `2026_05_17_ciaran_add_vehicle_driver_events.py`:

```python
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
```

- [ ] **Step 8: Run the migration up and back down**

```bash
cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head
```

Expected: three clean runs. The down-then-up proves `downgrade()` actually works — an untested downgrade is how a bad migration becomes unrecoverable on someone else's machine.

- [ ] **Step 9: Run the test to verify it passes**

```bash
cd backend && pytest tests/unit/test_precinct_event_model.py -v
```

Expected: PASS, 11 tests.

- [ ] **Step 10: Commit**

```bash
git add backend/app/db/models/enums.py backend/app/db/models/events.py backend/app/db/models/__init__.py backend/app/blockchain/critical_fields.py backend/app/schemas/events.py backend/migrations/versions/2026_08_31_ciaran_add_precinct_events.py backend/tests/unit/test_precinct_event_model.py
git commit -m "feat(db): add precinct_events ledger, enums and critical-field sets"
```

---

## Task 3: `precinct_service` — move `list_precincts`, add `create_precinct` with anchor

**Files:**
- Create: `backend/app/orchestration/precinct_service.py`
- Modify: `backend/app/orchestration/resource_service.py:1-51`
- Modify: `backend/app/api/v1/endpoints/precincts.py:12`
- Test: `backend/tests/unit/test_precinct_service.py`

Splitting this out of `resource_service.py` is not a unilateral restructure: that file's own docstring already records the same extraction for drivers and vehicles, and the endpoint is `list_precincts`'s only caller (verified — no other importer in the repo).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_precinct_service.py`:

```python
"""Unit tests for precinct service org scoping, write semantics and anchoring.

Uses the db_session fixture (real Postgres, rolled back per test) rather than mocks —
the whole point of these functions is the WHERE clause, and a mocked session would
assert nothing about it. anchor_subject is patched so no test hits Hedera.
"""

import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import BlockchainReceiptType, OrganizationType, SubjectType
from app.db.models.events import PrecinctEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import User
from app.orchestration.precinct_service import create_precinct, list_precincts
from app.schemas.organisations import PrecinctCreateBody


async def _seed(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """Return (own_org_id, other_org_id, user_id). The user belongs to own_org."""
    own = Organization(id=uuid.uuid4(), name="Own Org", org_type=OrganizationType.OPERATOR)
    other = Organization(id=uuid.uuid4(), name="Other Org", org_type=OrganizationType.PRINCIPAL)
    db.add_all([own, other])
    await db.flush()

    # changed_by_user_id is a NOT NULL FK to users — every write needs a real actor.
    user = User(
        id=uuid.uuid4(), organization_id=own.id,
        email="admin@own.co.za", full_name="Admin", is_active=True,
    )
    db.add(user)
    await db.flush()
    return own.id, other.id, user.id


def _body(**overrides) -> PrecinctCreateBody:
    payload = {
        "name": "Riverhorse Valley",
        "address": "12 Sookhai Place, Durban",
        "latitude": -29.7942,
        "longitude": 30.9820,
        "geofence_radius_metres": 200,
    }
    payload.update(overrides)
    return PrecinctCreateBody(**payload)


def _fake_receipt() -> BlockchainReceipt:
    """A receipt object with only the field the service reads back (.id)."""
    return BlockchainReceipt(id=uuid.uuid4())


async def test_create_precinct_saves_against_the_callers_org(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=_fake_receipt()),
    ):
        created = await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(), current_user_id=user_id,
        )

    assert created.principal_organization_id == own_org_id
    row = (
        await db_session.execute(select(Precinct).where(Precinct.id == created.id))
    ).scalar_one()
    assert row.principal_organization_id == own_org_id
    assert row.latitude == Decimal("-29.7942000")
    assert row.geofence_radius_metres == 200


async def test_create_precinct_writes_a_created_event_and_anchors_it(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)
    receipt = _fake_receipt()
    anchor = AsyncMock(return_value=receipt)

    with patch("app.orchestration.precinct_service.anchor_subject", new=anchor):
        created = await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(), current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent).where(PrecinctEvent.precinct_id == created.id)
        )
    ).scalar_one()
    assert event.event_type == "created"
    assert event.changed_by_user_id == user_id
    assert event.blockchain_receipt_id == receipt.id

    anchor.assert_awaited_once()
    kwargs = anchor.await_args.kwargs
    assert kwargs["subject_type"] == SubjectType.PRECINCT_EVENT
    assert kwargs["subject_id"] == event.id
    assert kwargs["receipt_type"] == BlockchainReceiptType.PRECINCT_CREATED


async def test_created_anchor_payload_carries_the_geofence_in_the_clear(db_session: AsyncSession):
    """No PII in a precinct, so nothing is hashed — and the payload must be the
    geofence, because that is what a later verification needs to reproduce."""
    own_org_id, _, user_id = await _seed(db_session)
    anchor = AsyncMock(return_value=_fake_receipt())

    with patch("app.orchestration.precinct_service.anchor_subject", new=anchor):
        await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(), current_user_id=user_id,
        )

    payload = anchor.await_args.kwargs["canonical_payload"]
    assert payload["fields"]["latitude"] == -29.7942
    assert payload["fields"]["longitude"] == 30.9820
    assert payload["fields"]["geofence_radius_metres"] == 200
    assert payload["event_type"] == "created"


async def test_created_precinct_appears_in_list_for_its_own_org(db_session: AsyncSession):
    """The FP-68 handoff: a precinct is useless until trip creation can see it."""
    own_org_id, _, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=_fake_receipt()),
    ):
        created = await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(name="Newly Mapped Depot"), current_user_id=user_id,
        )

    listed = await list_precincts(db=db_session, organization_id=own_org_id)

    assert [p.id for p in listed] == [created.id]
    assert listed[0].name == "Newly Mapped Depot"


async def test_created_precinct_is_private_to_its_org_by_default(db_session: AsyncSession):
    own_org_id, other_org_id, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=_fake_receipt()),
    ):
        await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(), current_user_id=user_id,
        )

    assert await list_precincts(db=db_session, organization_id=other_org_id) == []


async def test_created_precinct_is_visible_cross_org_when_shared(db_session: AsyncSession):
    own_org_id, other_org_id, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=_fake_receipt()),
    ):
        await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(is_shared=True), current_user_id=user_id,
        )

    seen = await list_precincts(db=db_session, organization_id=other_org_id)

    assert len(seen) == 1
    assert seen[0].principal_organization_id == own_org_id


async def test_create_rejects_a_duplicate_name_within_the_same_org(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=_fake_receipt()),
    ):
        await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(name="Depot A"), current_user_id=user_id,
        )

        with pytest.raises(DuplicateResourceError):
            await create_precinct(
                db=db_session, organization_id=own_org_id,
                data=_body(name="Depot A"), current_user_id=user_id,
            )


async def test_same_name_is_allowed_in_a_different_org(db_session: AsyncSession):
    """The check is per-org. Two companies may both have a 'Linbro Park' depot."""
    own_org_id, other_org_id, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=_fake_receipt()),
    ):
        await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(name="Depot A"), current_user_id=user_id,
        )
        created = await create_precinct(
            db=db_session, organization_id=other_org_id,
            data=_body(name="Depot A"), current_user_id=user_id,
        )

    assert created.name == "Depot A"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && pytest tests/unit/test_precinct_service.py -v
```

Expected: collection error — `ModuleNotFoundError: No module named 'app.orchestration.precinct_service'`.

If every test **skips** instead, `TEST_DATABASE_URL` is missing from `backend/.env`. These need a real database.

- [ ] **Step 3: Create the service**

Create `backend/app/orchestration/precinct_service.py`:

```python
"""Service functions for precinct resources.

Extracted from resource_service.py on the same grounds as driver_service.py and
vehicle_service.py before it — owns list/create/update/detail for Precinct.

Layering: imports db/, schemas/, blockchain/, core/exceptions only. Never api/ or auth/.

Org scoping is the whole job of this module and is deliberately asymmetric:

  READ  — own org OR is_shared. A dispatcher can see a depot they do not own, which
          is what lets an operator plan trips into a client's facility.
  WRITE — own org only. Ownership comes from the authenticated caller and is never
          read from the request body, so there is no way to create a precinct under
          another org's id or edit one you do not own (SEC-PRECINCT-1).

A write against a precinct owned by another org raises ResourceNotFoundError, which the
endpoint maps to 404 rather than 403 — the same choice get_trip_detail and update_vehicle
already make, so a caller cannot probe for the existence of another org's rows.

Anchoring mirrors vehicle_service: every write appends a PrecinctEvent, and changes to
PRECINCT_CRITICAL_FIELDS additionally anchor to Hedera.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject
from app.blockchain.critical_fields import (
    PRECINCT_COSMETIC_FIELDS, PRECINCT_CRITICAL_FIELDS, diff_critical_fields,
)
from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.models.enums import BlockchainReceiptType, PrecinctEventType, SubjectType
from app.db.models.events import PrecinctEvent
from app.db.models.organisations import Precinct
from app.schemas.organisations import PrecinctCreateBody, PrecinctRead, PrecinctUpdateBody


def _geofence_snapshot(precinct: Precinct) -> dict:
    """The precinct's state as plain JSON-safe values.

    latitude/longitude are Numeric columns, so a loaded row holds Decimal — which is
    not JSON-serialisable and would break the anchor payload. float() is safe here for
    the same reason PrecinctRead declares float: a GPS coordinate is at most 10
    significant digits and float64 carries ~15.65.
    """
    return {
        "name": precinct.name,
        "address": precinct.address,
        "latitude": float(precinct.latitude),
        "longitude": float(precinct.longitude),
        "geofence_radius_metres": precinct.geofence_radius_metres,
        "is_shared": precinct.is_shared,
    }


async def _assert_name_free(
    db: AsyncSession,
    organization_id: uuid.UUID,
    name: str,
    exclude_precinct_id: uuid.UUID | None = None,
) -> None:
    """Raise DuplicateResourceError if organization_id already has a precinct called `name`.

    ADVISORY ONLY — there is no unique constraint on precincts.name, so this is a check,
    not a guarantee: two concurrent creates can both pass it. It is here because the
    failure it prevents is a demo-day failure rather than a data-integrity one — two rows
    called "FedEx DBN" at different coordinates, with the dispatcher unable to tell which
    one trip creation just picked. Scoped per-org because two companies may legitimately
    both operate a depot of the same name.

    Making this real needs a UniqueConstraint(principal_organization_id, name) and a
    migration — tracked as follow-up.
    """
    query = select(Precinct.id).where(
        Precinct.principal_organization_id == organization_id,
        Precinct.name == name,
    )
    if exclude_precinct_id is not None:
        query = query.where(Precinct.id != exclude_precinct_id)

    if (await db.execute(query)).first() is not None:
        raise DuplicateResourceError("Precinct", "name", name)


async def list_precincts(db: AsyncSession, organization_id: uuid.UUID) -> list[PrecinctRead]:
    """Return precincts owned by organization_id, plus any precinct marked is_shared.

    Precincts default to private to their principal_organization_id — a precinct is only
    visible to other orgs' dispatchers if explicitly opted in via is_shared.
    """
    result = await db.execute(
        select(Precinct)
        .where(
            (Precinct.principal_organization_id == organization_id)
            | (Precinct.is_shared.is_(True))
        )
        .order_by(Precinct.name)
    )
    return [PrecinctRead.model_validate(p) for p in result.scalars().all()]


async def create_precinct(
    db: AsyncSession,
    organization_id: uuid.UUID,
    data: PrecinctCreateBody,
    current_user_id: uuid.UUID,
) -> PrecinctRead:
    """Create a precinct owned by organization_id, log it, and anchor the log entry.

    organization_id is the AUTHENTICATED caller's org, passed by the endpoint from the
    JWT-resolved user. PrecinctCreateBody has no such field, so no request body can
    influence ownership.
    """
    await _assert_name_free(db, organization_id=organization_id, name=data.name)

    precinct = Precinct(
        name=data.name,
        address=data.address,
        principal_organization_id=organization_id,
        latitude=data.latitude,
        longitude=data.longitude,
        geofence_radius_metres=data.geofence_radius_metres,
        is_shared=data.is_shared,
    )
    db.add(precinct)
    await db.flush()

    snapshot = _geofence_snapshot(precinct)
    event = PrecinctEvent(
        id=uuid.uuid4(),
        precinct_id=precinct.id,
        event_type=PrecinctEventType.CREATED.value,
        changed_fields=snapshot,
        changed_by_user_id=current_user_id,
    )
    db.add(event)
    await db.flush()

    # No hashing, unlike create_vehicle's pulsit_device_id. A precinct holds a business
    # address and a business coordinate — no personal data — so nothing here is subject
    # to the POPIA rule that keeps identifiers off-chain. The geofence is anchored in the
    # clear precisely so a later verification can reproduce it.
    canonical = {
        "precinct_event_id": str(event.id),
        "precinct_id": str(precinct.id),
        "event_type": PrecinctEventType.CREATED.value,
        "fields": snapshot,
        "changed_by_user_id": str(current_user_id),
        "timestamp": event.created_at.isoformat(),
    }
    receipt = await anchor_subject(
        db,
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event.id,
        canonical_payload=canonical,
        receipt_type=BlockchainReceiptType.PRECINCT_CREATED,
    )
    event.blockchain_receipt_id = receipt.id

    await db.refresh(precinct)
    return PrecinctRead.model_validate(precinct)
```

- [ ] **Step 4: Remove `list_precincts` from `resource_service.py`**

Delete lines 37-51 (the whole function), then delete these two now-unused imports:

```python
from app.db.models.organisations import Precinct
from app.schemas.organisations import PrecinctRead
```

Update the extraction note in the module docstring (lines 6-8):

```python
Driver, vehicle and precinct service functions have been extracted to:
  - orchestration/driver_service.py
  - orchestration/vehicle_service.py
  - orchestration/precinct_service.py
```

- [ ] **Step 5: Repoint the endpoint import**

`backend/app/api/v1/endpoints/precincts.py` line 12:

```python
from app.orchestration.precinct_service import list_precincts
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend && pytest tests/unit/test_precinct_service.py tests/integration/test_precincts.py -v
```

Expected: PASS. The four pre-existing `GET /precincts` tests must still pass — they are the regression guard on the move.

- [ ] **Step 7: Commit**

```bash
git add backend/app/orchestration/precinct_service.py backend/app/orchestration/resource_service.py backend/app/api/v1/endpoints/precincts.py backend/tests/unit/test_precinct_service.py
git commit -m "feat(orchestration): extract precinct_service and add anchored create_precinct"
```

---

## Task 4: `update_precinct` — org-scoped 404, critical-diff anchor

**Files:**
- Modify: `backend/app/orchestration/precinct_service.py`
- Test: `backend/tests/unit/test_precinct_service.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_precinct_service.py`:

```python
from app.db.models.enums import PrecinctEventType
from app.orchestration.precinct_service import update_precinct
from app.schemas.organisations import PrecinctUpdateBody

_ANCHOR = "app.orchestration.precinct_service.anchor_subject"


async def _create(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, **overrides):
    with patch(_ANCHOR, new=AsyncMock(return_value=_fake_receipt())):
        return await create_precinct(
            db=db, organization_id=org_id,
            data=_body(**overrides), current_user_id=user_id,
        )


async def test_update_precinct_applies_only_supplied_fields(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id, name="Original Name")

    with patch(_ANCHOR, new=AsyncMock(return_value=_fake_receipt())):
        updated = await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(geofence_radius_metres=350), current_user_id=user_id,
        )

    assert updated.geofence_radius_metres == 350
    assert updated.name == "Original Name"
    assert updated.latitude == -29.7942


async def test_moving_a_precinct_anchors_a_relocated_event(db_session: AsyncSession):
    """The FP-68 case: correcting a facility's position after a bad first entry."""
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)
    anchor = AsyncMock(return_value=_fake_receipt())

    with patch(_ANCHOR, new=anchor):
        updated = await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(latitude=-26.0942, longitude=28.1342),
            current_user_id=user_id,
        )

    assert updated.latitude == -26.0942

    events = (
        await db_session.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.precinct_id == created.id)
            .order_by(PrecinctEvent.created_at)
        )
    ).scalars().all()
    assert events[-1].event_type == PrecinctEventType.RELOCATED.value
    assert set(events[-1].changed_fields.keys()) == {"latitude", "longitude"}

    anchor.assert_awaited_once()
    assert anchor.await_args.kwargs["receipt_type"] == BlockchainReceiptType.PRECINCT_UPDATED


async def test_resizing_the_geofence_anchors_a_resized_event(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)
    anchor = AsyncMock(return_value=_fake_receipt())

    with patch(_ANCHOR, new=anchor):
        await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(geofence_radius_metres=350), current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.event_type == PrecinctEventType.GEOFENCE_RESIZED.value)
        )
    ).scalar_one()
    assert event.changed_fields["geofence_radius_metres"] == {"from": 200, "to": 350}
    anchor.assert_awaited_once()


async def test_toggling_sharing_anchors_a_sharing_event(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)
    anchor = AsyncMock(return_value=_fake_receipt())

    with patch(_ANCHOR, new=anchor):
        await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(is_shared=True), current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.event_type == PrecinctEventType.SHARING_CHANGED.value)
        )
    ).scalar_one()
    assert event.changed_fields["is_shared"] == {"from": False, "to": True}
    anchor.assert_awaited_once()


async def test_a_rename_is_logged_but_never_anchored(db_session: AsyncSession):
    """A cosmetic edit costs no Hedera fee. The absent receipt is the assertion."""
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)
    anchor = AsyncMock(return_value=_fake_receipt())

    with patch(_ANCHOR, new=anchor):
        await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(name="Renamed Depot"), current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.event_type == PrecinctEventType.COSMETIC_UPDATE.value)
        )
    ).scalar_one()
    assert event.blockchain_receipt_id is None
    assert event.changed_fields["name"] == {"from": "Riverhorse Valley", "to": "Renamed Depot"}
    anchor.assert_not_awaited()


async def test_a_move_and_a_resize_together_are_labelled_relocated(db_session: AsyncSession):
    """Priority is deliberate: a move is the more significant fact, and the full diff
    in changed_fields loses nothing by the label."""
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)

    with patch(_ANCHOR, new=AsyncMock(return_value=_fake_receipt())):
        await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(latitude=-26.0942, geofence_radius_metres=400),
            current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.event_type == PrecinctEventType.RELOCATED.value)
        )
    ).scalar_one()
    assert set(event.changed_fields.keys()) == {"latitude", "geofence_radius_metres"}


async def test_update_precinct_owned_by_another_org_raises_not_found(db_session: AsyncSession):
    """404, not 403 — a caller must not be able to probe another org's rows."""
    own_org_id, other_org_id, user_id = await _seed(db_session)
    theirs = await _create(db_session, other_org_id, user_id)

    with pytest.raises(ResourceNotFoundError):
        await update_precinct(
            db=db_session, precinct_id=theirs.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(geofence_radius_metres=350), current_user_id=user_id,
        )


async def test_update_shared_precinct_not_owned_raises_not_found(db_session: AsyncSession):
    """Visibility is not permission. is_shared lets you SEE it, never edit it."""
    own_org_id, other_org_id, user_id = await _seed(db_session)
    theirs = await _create(db_session, other_org_id, user_id, is_shared=True)

    visible = await list_precincts(db=db_session, organization_id=own_org_id)
    assert [p.id for p in visible] == [theirs.id]

    with pytest.raises(ResourceNotFoundError):
        await update_precinct(
            db=db_session, precinct_id=theirs.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(geofence_radius_metres=350), current_user_id=user_id,
        )


async def test_update_precinct_unknown_id_raises_not_found(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)

    with pytest.raises(ResourceNotFoundError):
        await update_precinct(
            db=db_session, precinct_id=uuid.uuid4(), organization_id=own_org_id,
            data=PrecinctUpdateBody(name="Ghost"), current_user_id=user_id,
        )


async def test_empty_patch_writes_no_event_and_no_anchor(db_session: AsyncSession):
    """Nothing changed, so there is nothing to record. An event log that fills with
    no-ops stops being readable as a history."""
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)
    anchor = AsyncMock(return_value=_fake_receipt())

    with patch(_ANCHOR, new=anchor):
        updated = await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(), current_user_id=user_id,
        )

    assert updated.name == created.name
    events = (
        await db_session.execute(
            select(PrecinctEvent).where(PrecinctEvent.precinct_id == created.id)
        )
    ).scalars().all()
    assert len(events) == 1  # the CREATED event only
    anchor.assert_not_awaited()


async def test_rename_onto_an_existing_name_in_the_same_org_raises_duplicate(
    db_session: AsyncSession,
):
    own_org_id, _, user_id = await _seed(db_session)
    await _create(db_session, own_org_id, user_id, name="Depot A")
    second = await _create(db_session, own_org_id, user_id, name="Depot B")

    with pytest.raises(DuplicateResourceError):
        await update_precinct(
            db=db_session, precinct_id=second.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(name="Depot A"), current_user_id=user_id,
        )
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && pytest tests/unit/test_precinct_service.py -v
```

Expected: collection error — `ImportError: cannot import name 'update_precinct'`.

- [ ] **Step 3: Add `update_precinct`**

Append to `backend/app/orchestration/precinct_service.py`:

```python
def _classify(changed: set[str]) -> PrecinctEventType:
    """Label a critical diff with the single fact that matters most about it.

    Priority is deliberate and total, so no combination falls through unlabelled. A move
    outranks a resize because relocating a facility invalidates more history than
    widening it. Nothing is lost to the label — changed_fields always carries the full
    diff, so the event_type is a heading and the diff is the record.
    """
    if {"latitude", "longitude"} & changed:
        return PrecinctEventType.RELOCATED
    if "geofence_radius_metres" in changed:
        return PrecinctEventType.GEOFENCE_RESIZED
    if "is_shared" in changed:
        return PrecinctEventType.SHARING_CHANGED
    return PrecinctEventType.COSMETIC_UPDATE


async def update_precinct(
    db: AsyncSession,
    precinct_id: uuid.UUID,
    organization_id: uuid.UUID,
    data: PrecinctUpdateBody,
    current_user_id: uuid.UUID,
) -> PrecinctRead:
    """Apply a partial update to a precinct owned by organization_id.

    The org filter is in the WHERE clause rather than checked after loading, so a
    precinct belonging to another org is indistinguishable from one that does not exist
    — including a shared one the caller can see in GET /precincts. Visibility is not
    permission.
    """
    precinct = (
        await db.execute(
            select(Precinct).where(
                Precinct.id == precinct_id,
                Precinct.principal_organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    if precinct is None:
        raise ResourceNotFoundError("Precinct", str(precinct_id))

    # exclude_unset, not exclude_none: a PATCH that explicitly sets address to null is a
    # deliberate clear, and must not be confused with one that omitted the field.
    patched = data.model_dump(exclude_unset=True)
    if "name" in patched:
        await _assert_name_free(
            db,
            organization_id=organization_id,
            name=patched["name"],
            exclude_precinct_id=precinct_id,
        )

    old = _geofence_snapshot(precinct)
    for field, value in patched.items():
        setattr(precinct, field, value)
    await db.flush()
    new = _geofence_snapshot(precinct)

    critical_diff = diff_critical_fields(old, new, PRECINCT_CRITICAL_FIELDS)
    full_diff = diff_critical_fields(
        old, new, PRECINCT_CRITICAL_FIELDS | PRECINCT_COSMETIC_FIELDS
    )

    # Nothing actually changed — a PATCH that set every field to its current value, or
    # an empty body. Recording it would fill the history with rows that say nothing.
    if full_diff is None:
        await db.refresh(precinct)
        return PrecinctRead.model_validate(precinct)

    event_type = (
        _classify(set(critical_diff.keys()))
        if critical_diff is not None
        else PrecinctEventType.COSMETIC_UPDATE
    )
    event = PrecinctEvent(
        id=uuid.uuid4(),
        precinct_id=precinct.id,
        event_type=event_type.value,
        changed_fields=full_diff,
        changed_by_user_id=current_user_id,
    )
    db.add(event)
    await db.flush()

    # Cosmetic-only changes are logged and left unanchored — same fee logic as
    # update_vehicle. No hashing on this path either; see create_precinct.
    if critical_diff is not None:
        canonical = {
            "precinct_event_id": str(event.id),
            "precinct_id": str(precinct.id),
            "event_type": event_type.value,
            "fields": critical_diff,
            "changed_by_user_id": str(current_user_id),
            "timestamp": event.created_at.isoformat(),
        }
        receipt = await anchor_subject(
            db,
            subject_type=SubjectType.PRECINCT_EVENT,
            subject_id=event.id,
            canonical_payload=canonical,
            receipt_type=BlockchainReceiptType.PRECINCT_UPDATED,
        )
        event.blockchain_receipt_id = receipt.id

    await db.refresh(precinct)
    return PrecinctRead.model_validate(precinct)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && pytest tests/unit/test_precinct_service.py -v
```

Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestration/precinct_service.py backend/tests/unit/test_precinct_service.py
git commit -m "feat(orchestration): add update_precinct with org-scoped 404 and critical-diff anchoring"
```

---

## Task 5: `subject_visibility` — the `PRECINCT_EVENT` branch

Without this, `assert_subject_visible` falls through to `else: raise SubjectNotVisibleError` (`subject_visibility.py:73`) and the blockchain endpoint returns **404 for every precinct receipt**. The anchor would exist and be unreachable.

**Files:**
- Modify: `backend/app/blockchain/subject_visibility.py`
- Test: `backend/tests/unit/test_subject_visibility.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_subject_visibility.py`. Reuse the file's existing org/user seeding helpers if it has them; the fixtures below are written standalone so they work either way.

```python
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.subject_visibility import assert_subject_visible
from app.core.exceptions import SubjectNotVisibleError
from app.db.models.enums import OrganizationType, SubjectType
from app.db.models.events import PrecinctEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import User


async def _seed_precinct_event(db: AsyncSession, *, is_shared: bool = False):
    """Return (event_id, owner_org_id, other_org_id)."""
    owner = Organization(id=uuid.uuid4(), name="Owner", org_type=OrganizationType.PRINCIPAL)
    other = Organization(id=uuid.uuid4(), name="Other", org_type=OrganizationType.OPERATOR)
    db.add_all([owner, other])
    await db.flush()

    user = User(
        id=uuid.uuid4(), organization_id=owner.id,
        email="a@b.co.za", full_name="A", is_active=True,
    )
    precinct = Precinct(
        id=uuid.uuid4(), principal_organization_id=owner.id, name="Depot",
        latitude="-29.7942", longitude="30.9820", is_shared=is_shared,
    )
    db.add_all([user, precinct])
    await db.flush()

    event = PrecinctEvent(
        id=uuid.uuid4(), precinct_id=precinct.id, event_type="created",
        changed_fields={}, changed_by_user_id=user.id,
    )
    db.add(event)
    await db.flush()
    return event.id, owner.id, other.id


async def test_precinct_event_visible_to_the_owning_org(db_session: AsyncSession):
    event_id, owner_org_id, _ = await _seed_precinct_event(db_session)

    await assert_subject_visible(
        db_session,
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event_id,
        organization_id=owner_org_id,
    )


async def test_precinct_event_not_visible_to_another_org(db_session: AsyncSession):
    event_id, _, other_org_id = await _seed_precinct_event(db_session)

    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db_session,
            subject_type=SubjectType.PRECINCT_EVENT,
            subject_id=event_id,
            organization_id=other_org_id,
        )


async def test_a_shared_precincts_events_stay_private_to_its_owner(db_session: AsyncSession):
    """is_shared governs the precinct list, never its audit trail. Another org may
    plan trips into this facility; it does not get to read who moved its gate."""
    event_id, _, other_org_id = await _seed_precinct_event(db_session, is_shared=True)

    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db_session,
            subject_type=SubjectType.PRECINCT_EVENT,
            subject_id=event_id,
            organization_id=other_org_id,
        )


async def test_unknown_precinct_event_id_is_not_visible(db_session: AsyncSession):
    _, owner_org_id, _ = await _seed_precinct_event(db_session)

    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db_session,
            subject_type=SubjectType.PRECINCT_EVENT,
            subject_id=uuid.uuid4(),
            organization_id=owner_org_id,
        )
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && pytest tests/unit/test_subject_visibility.py -k precinct -v
```

Expected: `test_precinct_event_visible_to_the_owning_org` FAILS with `SubjectNotVisibleError` — the owner is refused because the `else` branch catches the new subject type. The three negative tests pass for the wrong reason; that is exactly why the positive one has to exist.

- [ ] **Step 3: Add the branch**

In `backend/app/blockchain/subject_visibility.py`, extend the imports:

```python
from app.db.models.events import DriverEvent, PrecinctEvent, VehicleEvent
from app.db.models.organisations import Precinct
```

Insert before the final `else` (after the `PHASE_EVENT` branch, line 72):

```python
    elif subject_type == SubjectType.PRECINCT_EVENT:
        # Scoped to the precinct's OWNER, not to who can see it. is_shared governs the
        # precinct list; it never opens the audit trail to another organisation.
        query = (
            select(PrecinctEvent.id)
            .join(Precinct, Precinct.id == PrecinctEvent.precinct_id)
            .where(
                PrecinctEvent.id == subject_id,
                Precinct.principal_organization_id == organization_id,
            )
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && pytest tests/unit/test_subject_visibility.py -v
```

Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add backend/app/blockchain/subject_visibility.py backend/tests/unit/test_subject_visibility.py
git commit -m "fix(blockchain): make precinct event receipts visible to their owning org"
```

---

## Task 6: `verification_service` — precinct payload reconstruction

Without this, `verify_subject` falls through to `else: return VerifyOutcome(status=VerifyStatus.NO_RECEIPT)` (`verification_service.py:216`) — so a precinct event genuinely anchored on Hedera reports as never anchored. A wrong answer, delivered confidently.

**Files:**
- Modify: `backend/app/orchestration/verification_service.py`
- Test: `backend/tests/unit/test_verification_service.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_verification_service.py`, matching the fixtures and Hedera stubbing the file already uses for `test_verify_vehicle_event_*`:

```python
async def test_verify_precinct_event_returns_verified_when_row_is_unchanged(
    db_session: AsyncSession,
):
    """The anchored payload and the live row still agree."""
    event_id = await _seed_anchored_precinct_event(db_session)

    outcome = await verify_subject(
        db_session,
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event_id,
        hedera_service=_stub_hedera_matching(db_session),
    )

    assert outcome.status == VerifyStatus.VERIFIED


async def test_verify_precinct_event_detects_a_tampered_event_row(db_session: AsyncSession):
    """Rewriting the logged diff after anchoring must surface as DB_MISMATCH, not as
    a clean verify. This is the whole point of anchoring a precinct at all."""
    event_id = await _seed_anchored_precinct_event(db_session)

    event = (
        await db_session.execute(select(PrecinctEvent).where(PrecinctEvent.id == event_id))
    ).scalar_one()
    event.changed_fields = {"geofence_radius_metres": {"from": 200, "to": 99999}}
    await db_session.flush()

    outcome = await verify_subject(
        db_session,
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event_id,
        hedera_service=_stub_hedera_matching(db_session),
    )

    assert outcome.status == VerifyStatus.DB_MISMATCH
    assert outcome.current_hash != outcome.expected_hash


async def test_verify_precinct_event_with_no_receipt_reports_no_receipt(
    db_session: AsyncSession,
):
    """A cosmetic rename is logged unanchored — verifying it is not an error."""
    event_id = await _seed_unanchored_precinct_event(db_session)

    outcome = await verify_subject(
        db_session,
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event_id,
    )

    assert outcome.status == VerifyStatus.NO_RECEIPT
```

Write the two seed helpers beside the file's existing ones. `_seed_anchored_precinct_event` must build the event row **and** a `BlockchainReceipt` whose `data_hash` is `_hash_payload` of the exact canonical dict `create_precinct` would have anchored:

```python
async def _seed_anchored_precinct_event(db: AsyncSession) -> uuid.UUID:
    """A precinct event plus a receipt whose data_hash matches the live row.

    The payload must be byte-identical in shape to the one precinct_service builds, or
    this test verifies a hash that production never produces.
    """
    event_id = await _seed_unanchored_precinct_event(db)
    event = (
        await db.execute(select(PrecinctEvent).where(PrecinctEvent.id == event_id))
    ).scalar_one()

    payload = {
        "precinct_event_id": str(event.id),
        "precinct_id": str(event.precinct_id),
        "event_type": event.event_type,
        "fields": event.changed_fields,
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }
    receipt = BlockchainReceipt(
        id=uuid.uuid4(),
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event.id,
        receipt_type=BlockchainReceiptType.PRECINCT_UPDATED,
        payload_json=payload,
        data_hash=_hash_payload(payload),
    )
    db.add(receipt)
    await db.flush()
    event.blockchain_receipt_id = receipt.id
    await db.flush()
    return event.id
```

Check `BlockchainReceipt`'s required columns in `app/db/models/blockchain.py` before writing this — if `topic_id`, `transaction_id` or `consensus_timestamp` are non-nullable, populate them with the same stub values the existing vehicle-event verification tests use.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && pytest tests/unit/test_verification_service.py -k precinct -v
```

Expected: `test_verify_precinct_event_returns_verified_when_row_is_unchanged` and `..._detects_a_tampered_event_row` both FAIL with `assert VerifyStatus.NO_RECEIPT == VerifyStatus.VERIFIED` / `== DB_MISMATCH` — the `else` branch swallowing the new subject type. The third passes for the wrong reason.

- [ ] **Step 3: Add the reconstruction and the dispatch branch**

In `backend/app/orchestration/verification_service.py`, extend the events import:

```python
from app.db.models.events import DriverEvent, PrecinctEvent, VehicleEvent
```

Add after `_reconstruct_driver_event_payload` (line 124):

```python
async def _reconstruct_precinct_event_payload(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[str, Any] | None:
    """Rebuild the canonical payload precinct_service anchored, from the live row.

    Key order and value shapes must match create_precinct/update_precinct exactly —
    _hash_payload sorts keys, but a renamed key or a Decimal where a float was anchored
    produces a different hash and reports a mismatch that never happened.
    """
    event = (
        await db.execute(select(PrecinctEvent).where(PrecinctEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        return None
    return {
        "precinct_event_id": str(event.id),
        "precinct_id": str(event.precinct_id),
        "event_type": event.event_type,
        "fields": event.changed_fields,
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }
```

Add the dispatch branch in `verify_subject`, after the `PHASE_EVENT` branch and before the final `else`:

```python
    elif subject_type == SubjectType.PRECINCT_EVENT:
        rebuilt = await _reconstruct_precinct_event_payload(db, subject_id)
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && pytest tests/unit/test_verification_service.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestration/verification_service.py backend/tests/unit/test_verification_service.py
git commit -m "fix(blockchain): verify precinct event receipts instead of reporting them unanchored"
```

---

## Task 7: `get_precinct_detail`, endpoints, integration tests

**Files:**
- Modify: `backend/app/schemas/organisations.py` (append `PrecinctDetailResponse`)
- Modify: `backend/app/orchestration/precinct_service.py` (append `get_precinct_detail`)
- Modify: `backend/app/core/limits.py` (append)
- Modify: `backend/app/api/v1/endpoints/precincts.py` (rewrite)
- Modify: `backend/tests/integration/test_precincts.py`

Note for the engineer: `get_current_dispatcher` resolves the org from the **`User` row**, not from the token's `app_metadata.org_id`. Seeding a user into the right organization is what sets the caller's org; `org_id=` on `make_token` is cosmetic here. The existing fixtures do this correctly — follow them.

- [ ] **Step 1: Add the detail schema**

Append to `backend/app/schemas/organisations.py`. The deferred import mirrors the identical circular-import dance at the bottom of `schemas/vehicles.py`:

```python
# Imported here rather than at the top of the module to keep the schema dependency
# graph acyclic — same reason and same placement as in schemas/vehicles.py.
from app.schemas.blockchain import BlockchainReceiptRead  # noqa: E402
from app.schemas.events import PrecinctEventRead  # noqa: E402


class PrecinctDetailResponse(PrecinctRead):
    """Extended shape returned by GET /precincts/{id}.

    Carries the full change history and its linked receipts, which is what makes a
    precinct's coordinates auditable rather than merely current.
    """

    events: list[PrecinctEventRead] = []
    receipts: list[BlockchainReceiptRead] = []
```

- [ ] **Step 2: Add `get_precinct_detail`**

Append to `backend/app/orchestration/precinct_service.py`, extending its imports with `BlockchainReceipt`, `BlockchainReceiptRead`, `PrecinctEventRead` and `PrecinctDetailResponse`:

```python
async def get_precinct_detail(
    db: AsyncSession,
    precinct_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> PrecinctDetailResponse:
    """Return a precinct the caller may SEE, with its change history.

    Read scoping, not write scoping: own-org OR is_shared, matching list_precincts. A
    dispatcher planning a trip into a client's shared depot can open it and see where
    its geofence sits — they simply cannot edit it, and cannot verify its receipts
    (see subject_visibility, which scopes the audit trail to the owner alone).
    """
    precinct = (
        await db.execute(
            select(Precinct).where(
                Precinct.id == precinct_id,
                (
                    (Precinct.principal_organization_id == organization_id)
                    | (Precinct.is_shared.is_(True))
                ),
            )
        )
    ).scalar_one_or_none()
    if precinct is None:
        raise ResourceNotFoundError("Precinct", str(precinct_id))

    events = (
        await db.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.precinct_id == precinct_id)
            .order_by(PrecinctEvent.created_at.desc(), PrecinctEvent.id)
        )
    ).scalars().all()

    event_ids = [e.id for e in events]
    receipts = []
    if event_ids:
        receipts = (
            await db.execute(
                select(BlockchainReceipt)
                .where(
                    BlockchainReceipt.subject_type == SubjectType.PRECINCT_EVENT,
                    BlockchainReceipt.subject_id.in_(event_ids),
                )
                .order_by(BlockchainReceipt.created_at.desc())
            )
        ).scalars().all()

    return PrecinctDetailResponse(
        **PrecinctRead.model_validate(precinct).model_dump(),
        events=[PrecinctEventRead.model_validate(e) for e in events],
        receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
    )
```

- [ ] **Step 3: Add the rate-limit budget**

Append to `backend/app/core/limits.py`:

```python
# Precinct mutations. Unlike FLEET_MUTATION this is not primarily about cost, though it
# does anchor: it is a blast-radius cap on an admin-only write that FP-68's geofence
# verdict depends on. A precinct's coordinates and radius decide whether a handshake is
# judged inside the facility, so no client should be able to rewrite them hundreds of
# times a minute.
PRECINCT_MUTATION = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="precinct_mutation")
```

- [ ] **Step 4: Rewrite the endpoints module**

Replace all of `backend/app/api/v1/endpoints/precincts.py`:

```python
"""FastAPI router for precinct endpoints.

GET   /precincts       — precincts owned by the caller's organization plus any
                         precinct marked is_shared (origin/destination gates).
GET   /precincts/{id}  — one precinct the caller may see, with its change history.
POST  /precincts       — map a new precinct. Admin dispatcher only.
PATCH /precincts/{id}  — correct an existing one. Admin dispatcher only.

Reads and writes are scoped differently on purpose: a dispatcher can SEE a shared
precinct owned by another organization, but may only WRITE to one their own org owns.
A write against anything else returns 404 rather than 403 — see precinct_service.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher, require_admin_dispatcher
from app.core.exceptions import (
    DuplicateResourceError,
    HederaServiceError,
    HederaTimeoutError,
    ResourceNotFoundError,
)
from app.core.limits import PRECINCT_MUTATION
from app.core.rate_limit import rate_limit
from app.db.models.enums import DispatcherRole
from app.db.session import get_db
from app.orchestration.precinct_service import (
    create_precinct, get_precinct_detail, list_precincts, update_precinct,
)
from app.schemas.organisations import (
    PrecinctCreateBody, PrecinctDetailResponse, PrecinctRead, PrecinctUpdateBody,
)
from app.schemas.people import UserRead

router = APIRouter(prefix="/precincts", tags=["precincts"])


@router.get(
    "",
    response_model=list[PrecinctRead],
    summary="List the caller's organization's physical depots and warehouses, plus shared precincts",
)
async def list_precincts_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[PrecinctRead]:
    return await list_precincts(db=db, organization_id=current_user.organization_id)


@router.post(
    "",
    response_model=PrecinctRead,
    status_code=status.HTTP_201_CREATED,
    summary="Map a new precinct against the caller's organization",
    dependencies=[Depends(rate_limit(PRECINCT_MUTATION))],
)
async def create_precinct_endpoint(
    body: PrecinctCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> PrecinctRead:
    try:
        return await create_precinct(
            db=db,
            organization_id=current_user.organization_id,
            data=body,
            current_user_id=current_user.id,
        )
    except DuplicateResourceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except HederaTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc))
    except HederaServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.patch(
    "/{precinct_id}",
    response_model=PrecinctRead,
    summary="Correct a precinct owned by the caller's organization",
    dependencies=[Depends(rate_limit(PRECINCT_MUTATION))],
)
async def update_precinct_endpoint(
    precinct_id: UUID,
    body: PrecinctUpdateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> PrecinctRead:
    try:
        return await update_precinct(
            db=db,
            precinct_id=precinct_id,
            organization_id=current_user.organization_id,
            data=body,
            current_user_id=current_user.id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except DuplicateResourceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except HederaTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc))
    except HederaServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get(
    "/{precinct_id}",
    response_model=PrecinctDetailResponse,
    summary="One precinct with its change history and blockchain receipts",
)
async def get_precinct_detail_endpoint(
    precinct_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PrecinctDetailResponse:
    try:
        detail = await get_precinct_detail(
            db=db,
            precinct_id=precinct_id,
            organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    # Receipts are withheld from non-admins, matching get_vehicle_detail_endpoint.
    # A precinct visible only via is_shared is never the caller's own, so its receipts
    # are withheld from that caller too — subject_visibility would refuse them anyway,
    # and showing a hash the viewer cannot verify is worse than showing nothing.
    is_owner = detail.principal_organization_id == current_user.organization_id
    if current_user.role != DispatcherRole.ADMIN_DISPATCHER or not is_owner:
        detail = detail.model_copy(update={"receipts": []})
    return detail
```

Route order matters: `POST ""` and `PATCH "/{precinct_id}"` are declared before `GET "/{precinct_id}"`, and `GET ""` before everything. FastAPI matches in declaration order, so a `/{precinct_id}` GET declared first would still be fine here (different methods and paths), but keeping list-then-write-then-detail matches `endpoints/vehicles.py` and stays readable.

`precincts_router` is already registered in `main.py:31` — no change needed there.

- [ ] **Step 5: Write the integration tests**

Append to `backend/tests/integration/test_precincts.py`, and widen the module docstring to `"""Integration tests for /api/v1/precincts."""`. Add `import pytest`, `from sqlalchemy import select`, and `from unittest.mock import AsyncMock, patch` at the top.

```python
_ANCHOR = "app.orchestration.precinct_service.anchor_subject"


def _admin_headers(seed: dict) -> dict:
    return auth_header(
        make_token(sub=str(seed["user"].id), role="admin_dispatcher", org_id=str(seed["org"].id))
    )


def _valid_body() -> dict:
    return {
        "name": "Riverhorse Valley",
        "address": "12 Sookhai Place, Durban",
        "latitude": -29.7942,
        "longitude": 30.9820,
        "geofence_radius_metres": 200,
    }


def _stub_anchor():
    """Patch the anchor so no integration test reaches Hedera."""
    from app.db.models.blockchain import BlockchainReceipt
    return patch(_ANCHOR, new=AsyncMock(return_value=BlockchainReceipt(id=uuid.uuid4())))


async def test_create_precinct_returns_201_and_appears_in_list(client: AsyncClient, seed_orgs):
    """The demo path end to end: map a facility, then find it available for a trip."""
    with _stub_anchor():
        create_resp = await client.post(
            "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
        )

    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == "Riverhorse Valley"
    assert created["geofence_radius_metres"] == 200
    assert created["principal_organization_id"] == str(seed_orgs["org"].id)

    list_resp = await client.get("/api/v1/precincts", headers=_auth_headers(seed_orgs))
    assert [p["id"] for p in list_resp.json()] == [created["id"]]


async def test_create_precinct_ignores_a_client_supplied_organization_id(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    """SEC-PRECINCT-1. A dispatcher must not create under another org's id."""
    body = {**_valid_body(), "principal_organization_id": str(seed_orgs["client_org"].id)}

    with _stub_anchor():
        resp = await client.post(
            "/api/v1/precincts", json=body, headers=_admin_headers(seed_orgs),
        )

    assert resp.status_code == 201
    assert resp.json()["principal_organization_id"] == str(seed_orgs["org"].id)

    row = (
        await db_session.execute(
            select(Precinct).where(Precinct.id == uuid.UUID(resp.json()["id"]))
        )
    ).scalar_one()
    assert row.principal_organization_id == seed_orgs["org"].id


async def test_create_precinct_as_non_admin_returns_403(client: AsyncClient, seed_orgs):
    resp = await client.post(
        "/api/v1/precincts", json=_valid_body(), headers=_auth_headers(seed_orgs),
    )

    assert resp.status_code == 403


async def test_create_precinct_without_a_token_returns_403(client: AsyncClient, seed_orgs):
    resp = await client.post("/api/v1/precincts", json=_valid_body())

    assert resp.status_code == 403


@pytest.mark.parametrize(
    "field,value",
    [
        ("latitude", 91.0), ("latitude", -91.0),
        ("longitude", 181.0), ("longitude", -181.0),
        ("geofence_radius_metres", 0),
        ("geofence_radius_metres", 49),
        ("geofence_radius_metres", 5001),
        ("name", "   "),
    ],
)
async def test_create_precinct_rejects_invalid_field_with_422(
    client: AsyncClient, seed_orgs, field, value
):
    resp = await client.post(
        "/api/v1/precincts",
        json={**_valid_body(), field: value},
        headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 422


async def test_create_precinct_duplicate_name_in_same_org_returns_409(
    client: AsyncClient, seed_orgs
):
    with _stub_anchor():
        await client.post(
            "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
        )
        resp = await client.post(
            "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
        )

    assert resp.status_code == 409


async def test_update_precinct_changes_radius_and_returns_200(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    with _stub_anchor():
        created = (
            await client.post(
                "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
            )
        ).json()

        resp = await client.patch(
            f"/api/v1/precincts/{created['id']}",
            json={"geofence_radius_metres": 350},
            headers=_admin_headers(seed_orgs),
        )

    assert resp.status_code == 200
    assert resp.json()["geofence_radius_metres"] == 350
    assert resp.json()["name"] == "Riverhorse Valley"

    row = (
        await db_session.execute(
            select(Precinct).where(Precinct.id == uuid.UUID(created["id"]))
        )
    ).scalar_one()
    assert row.geofence_radius_metres == 350


async def test_update_precinct_owned_by_another_org_returns_404(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    """404, not 403 — matching the existing query scoping."""
    theirs = Precinct(
        name="Private Client Warehouse",
        principal_organization_id=seed_orgs["client_org"].id,
        latitude="-29.8587", longitude="31.0218", is_shared=False,
    )
    db_session.add(theirs)
    await db_session.flush()

    resp = await client.patch(
        f"/api/v1/precincts/{theirs.id}",
        json={"geofence_radius_metres": 350},
        headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 404


async def test_update_a_visible_shared_precinct_still_returns_404(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    """Visibility is not permission: listed by GET, and still unwritable."""
    theirs = Precinct(
        name="Shared Client Depot",
        principal_organization_id=seed_orgs["client_org"].id,
        latitude="-29.8587", longitude="31.0218", is_shared=True,
    )
    db_session.add(theirs)
    await db_session.flush()

    listed = await client.get("/api/v1/precincts", headers=_auth_headers(seed_orgs))
    assert [p["id"] for p in listed.json()] == [str(theirs.id)]

    resp = await client.patch(
        f"/api/v1/precincts/{theirs.id}",
        json={"geofence_radius_metres": 350},
        headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 404


async def test_update_precinct_as_non_admin_returns_403(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    mine = Precinct(
        name="Own Depot", principal_organization_id=seed_orgs["org"].id,
        latitude="-29.8587", longitude="31.0218",
    )
    db_session.add(mine)
    await db_session.flush()

    resp = await client.patch(
        f"/api/v1/precincts/{mine.id}",
        json={"geofence_radius_metres": 350},
        headers=_auth_headers(seed_orgs),
    )

    assert resp.status_code == 403


async def test_update_precinct_unknown_id_returns_404(client: AsyncClient, seed_orgs):
    resp = await client.patch(
        f"/api/v1/precincts/{uuid.uuid4()}",
        json={"geofence_radius_metres": 350},
        headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 404


async def test_detail_returns_the_change_history_with_receipts_for_the_owning_admin(
    client: AsyncClient, seed_orgs
):
    with _stub_anchor():
        created = (
            await client.post(
                "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
            )
        ).json()
        await client.patch(
            f"/api/v1/precincts/{created['id']}",
            json={"geofence_radius_metres": 350},
            headers=_admin_headers(seed_orgs),
        )

    resp = await client.get(
        f"/api/v1/precincts/{created['id']}", headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 200
    body = resp.json()
    assert [e["event_type"] for e in body["events"]] == ["geofence_resized", "created"]
    assert len(body["receipts"]) == 2


async def test_detail_withholds_receipts_from_a_non_admin(client: AsyncClient, seed_orgs):
    with _stub_anchor():
        created = (
            await client.post(
                "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
            )
        ).json()

    resp = await client.get(
        f"/api/v1/precincts/{created['id']}", headers=_auth_headers(seed_orgs),
    )

    assert resp.status_code == 200
    assert resp.json()["receipts"] == []
    assert len(resp.json()["events"]) == 1


async def test_detail_of_a_precinct_in_another_org_returns_404(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    theirs = Precinct(
        name="Private", principal_organization_id=seed_orgs["client_org"].id,
        latitude="-29.8587", longitude="31.0218", is_shared=False,
    )
    db_session.add(theirs)
    await db_session.flush()

    resp = await client.get(
        f"/api/v1/precincts/{theirs.id}", headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 404
```

- [ ] **Step 6: Prove the role tests have teeth**

These would pass on arrival, which is the wrong order for TDD. Break the gate deliberately and watch them fail:

```bash
cd backend
sed -i '' 's/Depends(require_admin_dispatcher)/Depends(get_current_dispatcher)/g' app/api/v1/endpoints/precincts.py
pytest tests/integration/test_precincts.py -k non_admin -v
```

Expected: both `..._as_non_admin_returns_403` tests FAIL with `assert 201 == 403` / `assert 200 == 403`. Then restore:

```bash
git checkout backend/app/api/v1/endpoints/precincts.py
```

- [ ] **Step 7: Verify routes and run the full backend suite**

```bash
cd backend && python -c "
from app.main import app
for r in sorted(app.routes, key=lambda r: getattr(r, 'path', '')):
    p = getattr(r, 'path', '')
    if 'precinct' in p: print(sorted(r.methods - {'HEAD','OPTIONS'}), p)
"
pytest
```

Expected routes:
```
['GET', 'POST'] /api/v1/precincts
['GET', 'PATCH'] /api/v1/precincts/{precinct_id}
```
Expected suite: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/organisations.py backend/app/orchestration/precinct_service.py backend/app/core/limits.py backend/app/api/v1/endpoints/precincts.py backend/tests/integration/test_precincts.py
git commit -m "feat(api): add precinct create, update and detail endpoints"
```

---

## Task 8: Shared types, mocks and validation

**All five modified/created files are under `frontend/shared/` and are imported by `driver-pwa` as well as the dispatcher. Flag every one in TASK COMPLETE.**

**Files:**
- Modify: `frontend/shared/lib/types/precinct.ts:18-27`
- Modify: `frontend/shared/lib/mocks/precincts.ts:11-52`
- Modify: `frontend/shared/lib/validation/rules.ts` (append)
- Modify: `frontend/shared/lib/validation/constants.ts` (append)
- Create: `frontend/shared/lib/validation/precinct.ts`
- Test: `frontend/dispatcher/lib/validation/__tests__/precinct.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/dispatcher/lib/validation/__tests__/precinct.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'

import {
  validatePrecinctForm,
  parseCoordinatePair,
  PRECINCT_FIELD_ORDER,
  type PrecinctFormValues,
} from '@shared/lib/validation/precinct'

function values(overrides: Partial<PrecinctFormValues> = {}): PrecinctFormValues {
  return {
    name: 'Riverhorse Valley',
    address: '12 Sookhai Place, Durban',
    latitude: '-29.7942',
    longitude: '30.9820',
    geofence_radius_metres: '200',
    ...overrides,
  }
}

describe('validatePrecinctForm', () => {
  it('accepts a well-formed precinct', () => {
    expect(Object.values(validatePrecinctForm(values())).every((e) => e === null)).toBe(true)
  })

  it('requires a name', () => {
    expect(validatePrecinctForm(values({ name: '   ' })).name).not.toBeNull()
  })

  it('rejects a latitude outside -90..90', () => {
    expect(validatePrecinctForm(values({ latitude: '91' })).latitude).not.toBeNull()
    expect(validatePrecinctForm(values({ latitude: '-91' })).latitude).not.toBeNull()
  })

  it('rejects a longitude outside -180..180', () => {
    expect(validatePrecinctForm(values({ longitude: '181' })).longitude).not.toBeNull()
    expect(validatePrecinctForm(values({ longitude: '-181' })).longitude).not.toBeNull()
  })

  it('accepts the boundary coordinates', () => {
    const errors = validatePrecinctForm(values({ latitude: '-90', longitude: '180' }))

    expect(errors.latitude).toBeNull()
    expect(errors.longitude).toBeNull()
  })

  it('rejects a non-numeric coordinate', () => {
    expect(validatePrecinctForm(values({ latitude: 'south' })).latitude).not.toBeNull()
  })

  it('requires both coordinates', () => {
    const errors = validatePrecinctForm(values({ latitude: '', longitude: '' }))

    expect(errors.latitude).not.toBeNull()
    expect(errors.longitude).not.toBeNull()
  })

  it('rejects a radius outside the backend bounds', () => {
    expect(validatePrecinctForm(values({ geofence_radius_metres: '49' })).geofence_radius_metres).not.toBeNull()
    expect(validatePrecinctForm(values({ geofence_radius_metres: '5001' })).geofence_radius_metres).not.toBeNull()
  })

  it('accepts the radius boundaries', () => {
    expect(validatePrecinctForm(values({ geofence_radius_metres: '50' })).geofence_radius_metres).toBeNull()
    expect(validatePrecinctForm(values({ geofence_radius_metres: '5000' })).geofence_radius_metres).toBeNull()
  })

  it('lists every validated field in the focus order', () => {
    expect([...PRECINCT_FIELD_ORDER].sort()).toEqual(Object.keys(validatePrecinctForm(values())).sort())
  })
})

describe('parseCoordinatePair', () => {
  it('splits a comma-separated pair pasted from a maps app', () => {
    expect(parseCoordinatePair('-29.7942, 30.9820')).toEqual({ lat: '-29.7942', lng: '30.9820' })
  })

  it('tolerates missing and extra whitespace', () => {
    expect(parseCoordinatePair('-29.7942,30.9820')).toEqual({ lat: '-29.7942', lng: '30.9820' })
    expect(parseCoordinatePair('  -29.7942 ,  30.9820  ')).toEqual({ lat: '-29.7942', lng: '30.9820' })
  })

  it('returns null for a plain single number, so normal typing is untouched', () => {
    expect(parseCoordinatePair('-29.7942')).toBeNull()
    expect(parseCoordinatePair('-29.')).toBeNull()
    expect(parseCoordinatePair('')).toBeNull()
  })

  it('returns null when either half is not a number', () => {
    expect(parseCoordinatePair('south, 30.98')).toBeNull()
    expect(parseCoordinatePair('-29.79, east')).toBeNull()
  })

  it('returns null when the pair is out of range, rather than filling in nonsense', () => {
    expect(parseCoordinatePair('999, 30.98')).toBeNull()
    expect(parseCoordinatePair('-29.79, 999')).toBeNull()
  })

  it('ignores a three-part string', () => {
    expect(parseCoordinatePair('-29.79, 30.98, 12')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend/dispatcher && npx vitest run lib/validation/__tests__/precinct.test.ts
```

Expected: FAIL — `Failed to resolve import "@shared/lib/validation/precinct"`.

- [ ] **Step 3: Extend the shared types**

Replace the `Precinct` interface in `frontend/shared/lib/types/precinct.ts` (lines 18-27) and append the two new types:

```typescript
export interface Precinct {
  id: PrecinctId
  name: string
  principal_organization_id: OrganizationId
  address: string | null
  latitude: number
  longitude: number
  geofence_radius_metres: number
  // Cross-org visibility opt-in (SEC-PRECINCT-1). False means only the principal
  // organization's own dispatchers see this precinct in GET /precincts. Visibility is
  // not permission — a shared precinct is still writable only by its owner.
  is_shared: boolean
  created_at: string
}

import type { BlockchainReceipt, PrecinctEvent } from './blockchain'

export interface PrecinctDetail extends Precinct {
  events: PrecinctEvent[]
  // Empty for non-admins and for a precinct visible only via is_shared — the server
  // withholds them, so an empty array does not mean "never anchored".
  receipts: BlockchainReceipt[]
}
```

**`PrecinctEvent` goes in `frontend/shared/lib/types/blockchain.ts`, not here** — that is where `VehicleEvent` and `DriverEvent` already live, and where `EventTimeline` imports its event union from. Splitting it into `precinct.ts` would be the one inconsistency that stops Task 13 reusing the existing timeline. Extend the two unions in place and append the event type:

```typescript
export type SubjectType =
  | 'trip' | 'vehicle' | 'driver' | 'vehicle_event' | 'driver_event'
  | 'precinct_event';

export type BlockchainReceiptType =
  | 'journey_lock' | 'pickup' | 'delivery' | 'checkpoint_batch'
  | 'exception_batch' | 'driver_substitution'
  | 'vehicle_created' | 'vehicle_updated'
  | 'driver_created' | 'driver_updated'
  | 'precinct_created' | 'precinct_updated';

// Mirrors PrecinctEventType in backend/app/db/models/enums.py exactly.
// A relocation and a resize are separate types because they mean different things
// evidentially: one changes where the facility is, the other changes how close a
// handshake must be to count as inside it.
export type PrecinctEventType =
  | 'created' | 'relocated' | 'geofence_resized'
  | 'sharing_changed' | 'cosmetic_update';

export type PrecinctEvent = {
  id: string;
  precinct_id: string;
  event_type: PrecinctEventType;
  // {field: {from, to}} for updates; a flat snapshot for 'created'.
  changed_fields: Record<string, unknown>;
  changed_by_user_id: string;
  // Null for cosmetic edits, which are logged but never anchored. The absence is
  // information — it is why no anchor badge renders on that row.
  blockchain_receipt_id: string | null;
  created_at: string;
};
```

Add `frontend/shared/lib/types/blockchain.ts` to this task's file list and to the shared-file flags in TASK COMPLETE.

- [ ] **Step 4: Update the mocks so both surfaces still typecheck**

`frontend/shared/lib/mocks/precincts.ts` types four rows as `Precinct[]` and `driver-pwa/lib/utils/precinct-name.ts` imports them — without this the driver PWA fails to compile. Add `is_shared: true,` immediately after each `geofence_radius_metres` line (lines 19, 29, 39, 49). They model client-owned depots visible to the operator, which is the shared case.

- [ ] **Step 5: Add the decimal range rule**

`rules.ts` has `intInRange`, but coordinates are decimal. Append to `frontend/shared/lib/validation/rules.ts`:

```typescript
const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/

/**
 * Fails when a non-empty value isn't a decimal number within [min, max]. Empty values
 * are skipped — compose with `required` separately, exactly as `intInRange` does. Used
 * for GPS coordinates, where `intInRange` would reject every real value.
 */
export function decimalInRange(min: number, max: number, message?: string): Rule {
  const errorMessage = message ?? `Must be a number between ${min} and ${max}.`
  return (value: string): string | null => {
    if (value.length === 0) {
      return null
    }
    if (!DECIMAL_STRING_PATTERN.test(value.trim())) {
      return errorMessage
    }
    const parsed = parseFloat(value)
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
      return errorMessage
    }
    return null
  }
}
```

- [ ] **Step 6: Add the shared constants**

Append to `frontend/shared/lib/validation/constants.ts`:

```typescript
// ── Precinct field constraints ──
// Mirror backend/app/schemas/organisations.py. The backend stays authoritative; these
// exist so the form surfaces the same problem before a 422 round-trip.
export const LATITUDE_MIN = -90
export const LATITUDE_MAX = 90
export const LONGITUDE_MIN = -180
export const LONGITUDE_MAX = 180

// The floor mirrors GPS_TOLERANCE_METRES (50): a geofence narrower than the GPS
// agreement tolerance makes the corroboration check meaningless. The ceiling catches a
// kilometres-for-metres unit slip.
export const GEOFENCE_RADIUS_MIN = 50
export const GEOFENCE_RADIUS_MAX = 5000
export const GEOFENCE_RADIUS_DEFAULT = 200

export const PRECINCT_NAME_MAX = 255
```

- [ ] **Step 7: Create the validator**

Create `frontend/shared/lib/validation/precinct.ts`:

```typescript
// Precinct-specific validation, built from the generic primitives in rules.ts and the
// backend-mirrored constraints in constants.ts.
//
// `address` is deliberately excluded from PrecinctField: it is a free-text label with
// no server-side constraint beyond the Text column, and nothing computes on it.
// `is_shared` is a boolean Switch and cannot be invalid by construction.

import { required, maxLength, decimalInRange, intInRange } from './rules'
import {
  LATITUDE_MIN,
  LATITUDE_MAX,
  LONGITUDE_MIN,
  LONGITUDE_MAX,
  GEOFENCE_RADIUS_MIN,
  GEOFENCE_RADIUS_MAX,
  PRECINCT_NAME_MAX,
} from './constants'

export type PrecinctField =
  | 'name'
  | 'latitude'
  | 'longitude'
  | 'geofence_radius_metres'

// Callers supply only the string-valued fields being validated — all form inputs are
// controlled <input> values, hence all strings. `address` is present so a form's state
// object satisfies this type directly, but it is never validated.
export type PrecinctFormValues = Record<PrecinctField, string> & { address: string }

// Display order of the validated fields, shared by the create and edit forms to focus
// the first invalid field on submit — kept next to PrecinctField so the two can't drift.
export const PRECINCT_FIELD_ORDER: readonly PrecinctField[] = [
  'name',
  'latitude',
  'longitude',
  'geofence_radius_metres',
]

// Defined locally rather than shared. That is the established pattern here, not an
// oversight: driver.ts:82 and vehicle.ts:102 each carry their own private copy, and
// matching two existing files beats hoisting a third variant into rules.ts as a
// drive-by change to a file this story has no other reason to restructure.
/** Returns the first error from `rules` for `value`, or null when all pass. */
function firstError(value: string, rules: ReadonlyArray<(v: string) => string | null>): string | null {
  for (const rule of rules) {
    const error = rule(value)
    if (error !== null) {
      return error
    }
  }
  return null
}

/**
 * Validates a precinct form's string fields and returns the first error per field (or
 * null if valid). Mirrors backend/app/schemas/organisations.py so the client surfaces
 * the same problems before submit instead of round-tripping a 422.
 */
export function validatePrecinctForm(
  values: PrecinctFormValues,
): Record<PrecinctField, string | null> {
  return {
    name: firstError(values.name, [required(), maxLength(PRECINCT_NAME_MAX)]),
    latitude: firstError(values.latitude, [
      required(),
      decimalInRange(LATITUDE_MIN, LATITUDE_MAX, 'Latitude must be between -90 and 90.'),
    ]),
    longitude: firstError(values.longitude, [
      required(),
      decimalInRange(LONGITUDE_MIN, LONGITUDE_MAX, 'Longitude must be between -180 and 180.'),
    ]),
    geofence_radius_metres: firstError(values.geofence_radius_metres, [
      required(),
      intInRange(
        GEOFENCE_RADIUS_MIN,
        GEOFENCE_RADIUS_MAX,
        `Radius must be between ${GEOFENCE_RADIUS_MIN} m and ${GEOFENCE_RADIUS_MAX} m.`,
      ),
    ]),
  }
}

const COORDINATE_PAIR_PATTERN = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/

/**
 * Splits "lat, lng" — the format every maps app puts on the clipboard — into two field
 * values, or null if the input is not such a pair.
 *
 * This is the replacement for address geocoding (see the plan's D7). A geocoder returns
 * a street centroid, which for a warehouse estate can sit hundreds of metres from the
 * gate — the same order as the geofence radius itself. A pasted coordinate is the exact
 * point the dispatcher chose.
 *
 * Returns null rather than a partial result for anything that is not a complete, in-range
 * pair, so a dispatcher typing a single latitude by hand is never interfered with.
 */
export function parseCoordinatePair(raw: string): { lat: string; lng: string } | null {
  const match = COORDINATE_PAIR_PATTERN.exec(raw)
  if (match === null) {
    return null
  }
  const [, lat, lng] = match
  const latNum = parseFloat(lat)
  const lngNum = parseFloat(lng)
  if (latNum < LATITUDE_MIN || latNum > LATITUDE_MAX) return null
  if (lngNum < LONGITUDE_MIN || lngNum > LONGITUDE_MAX) return null
  return { lat, lng }
}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd frontend/dispatcher && npx vitest run lib/validation/__tests__/precinct.test.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 9: Typecheck both surfaces**

Step 4 is the change that can break the driver PWA. Prove it did not:

```bash
cd frontend/dispatcher && npm run type-check
cd ../driver-pwa && npm run type-check
```

Expected: no errors from either.

- [ ] **Step 10: Commit**

```bash
git add frontend/shared/lib/types/precinct.ts frontend/shared/lib/mocks/precincts.ts frontend/shared/lib/validation/rules.ts frontend/shared/lib/validation/constants.ts frontend/shared/lib/validation/precinct.ts frontend/dispatcher/lib/validation/__tests__/precinct.test.ts
git commit -m "feat(shared): add precinct event types, is_shared, and a precinct form validator"
```

---

## Task 9: `GeofenceSchematic` and `GeofenceMap`

Two layers. The schematic has **no dependencies and always renders** — it answers *"how big is 200 m here"*. The map adds real tiles and answers *"is the pin on the actual building"*, and falls back to the schematic when tiles fail. That fallback is not defensive padding: a demo on venue wifi that cannot reach a tile server should degrade to a correct diagram, not a grey void.

**`GeofenceMap.tsx` is the only file in the codebase that may import Leaflet.** Keeping the dependency behind one component is what makes the tile source — or the whole library — swappable later without touching a page.

**Files:**
- Create: `frontend/dispatcher/components/map/GeofenceSchematic.tsx`
- Create: `frontend/dispatcher/components/map/GeofenceMap.tsx`
- Modify: `frontend/dispatcher/package.json`
- Test: `frontend/dispatcher/components/map/__tests__/GeofenceSchematic.test.tsx`

- [ ] **Step 1: Confirm the dependency is agreed**

`package.json` is on CLAUDE.md's shared-files list and Leaflet is a new dependency. Do not run the install until the team has agreed. If the answer is no, build `GeofenceSchematic` (Steps 2–5) and stop — Task 12 works with the schematic alone, and Task 13's map slot degrades to it.

```bash
cd frontend/dispatcher && npm install leaflet && npm install --save-dev @types/leaflet
```

- [ ] **Step 2: Write the failing test**

Create `frontend/dispatcher/components/map/__tests__/GeofenceSchematic.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GeofenceSchematic, niceScaleMetres } from '../GeofenceSchematic'

describe('niceScaleMetres', () => {
  it('rounds down to a readable 1/2/5 step', () => {
    expect(niceScaleMetres(237)).toBe(200)
    expect(niceScaleMetres(96)).toBe(50)
    expect(niceScaleMetres(12)).toBe(10)
    expect(niceScaleMetres(640)).toBe(500)
  })

  it('never returns zero, so the scale bar always has a label', () => {
    expect(niceScaleMetres(3)).toBeGreaterThan(0)
    expect(niceScaleMetres(0.4)).toBeGreaterThan(0)
  })
})

describe('GeofenceSchematic', () => {
  it('labels the radius it was given', () => {
    render(<GeofenceSchematic radiusMetres={200} />)

    expect(screen.getByText('200 m')).toBeInTheDocument()
  })

  it('renders a scale bar label', () => {
    render(<GeofenceSchematic radiusMetres={200} />)

    // Scale is derived from the radius, so it must exist and end in "m".
    expect(screen.getByTestId('schematic-scale-label').textContent).toMatch(/^\d+ m$/)
  })

  it('describes itself for screen readers', () => {
    render(<GeofenceSchematic radiusMetres={350} />)

    expect(screen.getByRole('img', { name: /350 m geofence/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd frontend/dispatcher && npx vitest run components/map/__tests__/GeofenceSchematic.test.tsx
```

Expected: FAIL — `Failed to resolve import "../GeofenceSchematic"`.

- [ ] **Step 4: Create the schematic**

Create `frontend/dispatcher/components/map/GeofenceSchematic.tsx`:

```tsx
'use client'

import React from 'react'

// The circle always occupies the same fraction of the box, whatever the radius — the
// diagram's job is to make the radius legible against a scale bar, not to imply a
// zoom level it does not have. Everything else is derived from these two numbers.
const VIEWBOX = 200
const CIRCLE_RADIUS_PX = 62

interface GeofenceSchematicProps {
  radiusMetres: number
  className?: string
}

/**
 * Rounds `metres` down to the nearest 1/2/5 × power of ten.
 *
 * A scale bar reading "63 m" is noise; one reading "50 m" is a ruler. Exported for
 * testing because the rounding is the only logic here worth getting wrong.
 */
export function niceScaleMetres(metres: number): number {
  if (metres <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(metres)))
  const normalised = metres / magnitude
  const step = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1
  return Math.max(1, step * magnitude)
}

/**
 * Zero-dependency geofence diagram: the fence circle drawn against a metre scale bar.
 *
 * Serves three roles — the list-card thumbnail, the fallback when map tiles cannot be
 * reached, and the always-correct answer to "how far is 200 m". It deliberately shows
 * no basemap: it makes no claim about what is on the ground, only about distance.
 */
export function GeofenceSchematic({ radiusMetres, className }: GeofenceSchematicProps) {
  const metresPerPixel = radiusMetres / CIRCLE_RADIUS_PX
  const scaleMetres = niceScaleMetres(metresPerPixel * (VIEWBOX * 0.3))
  const scaleWidthPx = scaleMetres / metresPerPixel

  const centre = VIEWBOX / 2

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className={className}
      role="img"
      aria-label={`Diagram of a ${radiusMetres} m geofence`}
    >
      {/* Fence. --sec because this is the element under edit, not a status. */}
      <circle
        cx={centre}
        cy={centre}
        r={CIRCLE_RADIUS_PX}
        fill="var(--sec)"
        fillOpacity={0.1}
        stroke="var(--sec)"
        strokeWidth={1.5}
      />

      {/* Radius rule, centre to edge, with the measurement on it. */}
      <line
        x1={centre}
        y1={centre}
        x2={centre + CIRCLE_RADIUS_PX}
        y2={centre}
        stroke="var(--sec)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <text
        x={centre + CIRCLE_RADIUS_PX / 2}
        y={centre - 6}
        textAnchor="middle"
        fill="var(--on-surf-v)"
        fontSize={11}
        fontWeight={700}
        letterSpacing="0.03em"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {radiusMetres} m
      </text>

      {/* Centre pin. */}
      <circle cx={centre} cy={centre} r={4} fill="var(--sec)" />

      {/* Scale bar, bottom left. */}
      <g transform={`translate(14, ${VIEWBOX - 18})`}>
        <line x1={0} y1={0} x2={scaleWidthPx} y2={0} stroke="var(--on-surf-v)" strokeWidth={1.5} />
        <line x1={0} y1={-3} x2={0} y2={3} stroke="var(--on-surf-v)" strokeWidth={1.5} />
        <line
          x1={scaleWidthPx}
          y1={-3}
          x2={scaleWidthPx}
          y2={3}
          stroke="var(--on-surf-v)"
          strokeWidth={1.5}
        />
        <text
          data-testid="schematic-scale-label"
          x={scaleWidthPx / 2}
          y={-6}
          textAnchor="middle"
          fill="var(--on-surf-v)"
          fontSize={9}
          fontWeight={700}
          letterSpacing="0.06em"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {scaleMetres} m
        </text>
      </g>
    </svg>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd frontend/dispatcher && npx vitest run components/map/__tests__/GeofenceSchematic.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Create the map**

Create `frontend/dispatcher/components/map/GeofenceMap.tsx`. There is no unit test for this component — it is a thin imperative wrapper over a third-party library whose behaviour a jsdom test would only mock back at itself. It is verified in the browser in Task 12 Step 5 and Task 13 Step 4.

```tsx
'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker, Circle, TileLayer } from 'leaflet'

import { GeofenceSchematic } from './GeofenceSchematic'

// Tile sources. Both are keyless; attribution is required by each provider's terms and
// is rendered by Leaflet's own attribution control, so do not strip it.
//
// Satellite is the default because the task is "put this pin on that building", and a
// street map cannot answer it. Street is the toggle for reading road access and names.
const TILE_SOURCES = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri',
    maxZoom: 19,
  },
  street: {
    label: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
} as const

type TileSourceKey = keyof typeof TILE_SOURCES

const DEFAULT_ZOOM = 16

interface GeofenceMapProps {
  latitude: number
  longitude: number
  radiusMetres: number
  /** Supplied only by the create/edit form. Omit for a read-only view. */
  onPositionChange?: (next: { latitude: number; longitude: number }) => void
  className?: string
}

/**
 * The precinct's position and geofence on a real basemap.
 *
 * The only module permitted to import Leaflet — everything else takes this component,
 * so the tile provider or the library itself can change without touching a page.
 *
 * Leaflet is loaded with a dynamic import inside an effect rather than a static import
 * because it touches `window` at module scope, which breaks any server render. The
 * import also gives us the failure signal for the schematic fallback: if the chunk or
 * the tiles cannot be fetched, we show a correct diagram instead of an empty grey box.
 *
 * `L.circle` takes its radius in METRES, which is the entire reason this library was
 * chosen — the fence stays true at every zoom with no projection maths of our own.
 */
export function GeofenceMap({
  latitude,
  longitude,
  radiusMetres,
  onPositionChange,
  className,
}: GeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const circleRef = useRef<Circle | null>(null)
  const tileRef = useRef<TileLayer | null>(null)

  const [source, setSource] = useState<TileSourceKey>('satellite')
  const [failed, setFailed] = useState(false)

  // Held in a ref so the map-init effect never re-runs when the callback identity
  // changes — re-initialising Leaflet on every parent render would fight the user's pan.
  const onPositionChangeRef = useRef(onPositionChange)
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange
  }, [onPositionChange])

  // Init once. Position, radius and tile changes are applied by the effects below
  // rather than by tearing the map down and rebuilding it.
  useEffect(() => {
    let cancelled = false

    async function init(): Promise<void> {
      try {
        const L = await import('leaflet')
        await import('leaflet/dist/leaflet.css')
        if (cancelled || containerRef.current === null || mapRef.current !== null) return

        const map = L.map(containerRef.current, {
          center: [latitude, longitude],
          zoom: DEFAULT_ZOOM,
          // The pin is placed by clicking, so a scroll-wheel zoom that fires while the
          // dispatcher is scrolling the FORM past the map is pure annoyance.
          scrollWheelZoom: false,
        })

        const chosen = TILE_SOURCES.satellite
        tileRef.current = L.tileLayer(chosen.url, {
          attribution: chosen.attribution,
          maxZoom: chosen.maxZoom,
        }).addTo(map)

        circleRef.current = L.circle([latitude, longitude], {
          radius: radiusMetres,
          color: 'var(--sec)',
          weight: 1.5,
          fillColor: 'var(--sec)',
          fillOpacity: 0.1,
        }).addTo(map)

        markerRef.current = L.marker([latitude, longitude], {
          draggable: onPositionChangeRef.current !== undefined,
        }).addTo(map)

        if (onPositionChangeRef.current !== undefined) {
          map.on('click', (e) => {
            onPositionChangeRef.current?.({ latitude: e.latlng.lat, longitude: e.latlng.lng })
          })
          markerRef.current.on('dragend', () => {
            const pos = markerRef.current?.getLatLng()
            if (pos) onPositionChangeRef.current?.({ latitude: pos.lat, longitude: pos.lng })
          })
        }

        mapRef.current = map
      } catch {
        // Chunk or stylesheet unreachable. The schematic is a correct answer to a
        // narrower question, which beats a blank frame.
        if (!cancelled) setFailed(true)
      }
    }

    void init()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // Deliberately empty: this effect builds the map once. The effects below keep it
    // in sync. Re-running it on a coordinate change would reset the user's pan mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the form's coordinates without re-centring the map — the dispatcher may have
  // panned deliberately, and yanking the viewport back on every keystroke is hostile.
  useEffect(() => {
    markerRef.current?.setLatLng([latitude, longitude])
    circleRef.current?.setLatLng([latitude, longitude])
  }, [latitude, longitude])

  useEffect(() => {
    circleRef.current?.setRadius(radiusMetres)
  }, [radiusMetres])

  useEffect(() => {
    async function swapTiles(): Promise<void> {
      if (mapRef.current === null) return
      const L = await import('leaflet')
      const chosen = TILE_SOURCES[source]
      tileRef.current?.remove()
      tileRef.current = L.tileLayer(chosen.url, {
        attribution: chosen.attribution,
        maxZoom: chosen.maxZoom,
      }).addTo(mapRef.current)
    }
    void swapTiles()
  }, [source])

  if (failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-surf-low rounded-lg ${className ?? ''}`}>
        <GeofenceSchematic radiusMetres={radiusMetres} className="w-[200px] h-[200px]" />
        <p className="text-[11px] text-on-surf-v">
          Map unavailable — showing the geofence to scale.
        </p>
      </div>
    )
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden" />
      <div className="absolute top-3 right-3 z-[400] flex items-center gap-[2px] bg-surf-lowest rounded-md p-[3px] shadow-level-1">
        {(Object.keys(TILE_SOURCES) as TileSourceKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSource(key)}
            className={
              source === key
                ? 'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase bg-surf-low text-on-surf'
                : 'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v hover:text-on-surf'
            }
          >
            {TILE_SOURCES[key].label}
          </button>
        ))}
      </div>
    </div>
  )
}
```

Leaflet's own panes sit at `z-index` 400–700, which is why the tile toggle is `z-[400]`. If it renders under the map, raise it — do not lower Leaflet's panes.

- [ ] **Step 7: Typecheck and lint**

```bash
cd frontend/dispatcher && npm run type-check && npm run lint
```

Expected: no errors. If `await import('leaflet/dist/leaflet.css')` trips the TS resolver, add a `declare module '*.css'` to the app's `global.d.ts` rather than casting to `any` — CLAUDE.md forbids `any`.

- [ ] **Step 8: Commit**

```bash
git add frontend/dispatcher/components/map frontend/dispatcher/package.json frontend/dispatcher/package-lock.json
git commit -m "feat(dispatcher): add geofence schematic and Leaflet map with satellite/street tiles"
```

---

## Task 10: Hooks, routes and nav

**Files:**
- Modify: `frontend/dispatcher/lib/hooks/usePrecincts.ts:11-48`
- Create: `frontend/dispatcher/lib/hooks/usePrecinctDetail.ts`
- Modify: `frontend/dispatcher/lib/constants/routes.ts:13`
- Modify: `frontend/dispatcher/components/layout/Sidebar.tsx:27-47,185`
- Test: `frontend/dispatcher/lib/hooks/usePrecincts.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/dispatcher/lib/hooks/usePrecincts.test.tsx`, inside the existing top-level `describe`. Read the file first and reuse its mocking of `@/lib/api/client` rather than inventing a second setup; `mockGet` below must match the name it already uses for the mocked `api.get`.

```typescript
  it('exposes a refetch that re-requests the precinct list', async () => {
    const { result } = renderHook(() => usePrecincts())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const callsAfterMount = mockGet.mock.calls.length

    act(() => {
      result.current.refetch()
    })

    await waitFor(() => expect(mockGet.mock.calls.length).toBe(callsAfterMount + 1))
  })
```

Ensure `act`, `renderHook` and `waitFor` are imported from `@testing-library/react` at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend/dispatcher && npx vitest run lib/hooks/usePrecincts.test.tsx
```

Expected: FAIL — `result.current.refetch is not a function`.

- [ ] **Step 3: Expose `refetch`**

In `frontend/dispatcher/lib/hooks/usePrecincts.ts`, add to the `UsePrecincts` interface after the `error` field (line 18):

```typescript
  // Exposed so a mutation on the precincts pages can refresh the list in place. The
  // one-shot retry below is unaffected: it resets only on a completed success, so a
  // manual refetch cannot re-arm it.
  refetch: () => void
```

Change the return statement (line 48) from `return { precincts: data, isLoading, error }` to:

```typescript
  return { precincts: data, isLoading, error, refetch }
```

`refetch` is already destructured from `useAsyncData` on line 22 — nothing else changes.

- [ ] **Step 4: Create the detail hook**

Create `frontend/dispatcher/lib/hooks/usePrecinctDetail.ts`, mirroring `useVehicleDetail.ts` — read that file and match its shape:

```typescript
'use client'

import { useCallback } from 'react'

import { api } from '@/lib/api/client'
import type { PrecinctDetail } from '@shared/lib/types/precinct'
import { useAsyncData } from './useAsyncData'

export interface UsePrecinctDetail {
  precinct: PrecinctDetail | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function usePrecinctDetail(precinctId: string): UsePrecinctDetail {
  const fetcher = useCallback(
    () => api.get<PrecinctDetail>(`/api/v1/precincts/${precinctId}`),
    [precinctId],
  )
  const { data, isLoading, error, refetch } = useAsyncData<PrecinctDetail | null>(fetcher, null)

  return { precinct: data, isLoading, error, refetch }
}
```

- [ ] **Step 5: Add the routes**

In `frontend/dispatcher/lib/constants/routes.ts`, add after line 14 (`fleetDrivers`):

```typescript
  precincts:       '/precincts',
  precinctDetail:  (id: string) => `/precincts/${id}`,
  precinctNew:     '/precincts/new',
  precinctEdit:    (id: string) => `/precincts/${id}/edit`,
```

- [ ] **Step 6: Add the nav entry and fix the group key**

A precinct is a fixed place, not fleet — "Fleet" means vehicles and drivers. `NavGroup.label` is optional and `Sidebar.tsx:186` already guards on it, so an unlabelled group renders its items with no header and needs no new pattern. Append to `NAV_GROUPS` after the FLEET group (line 47):

```typescript
  {
    // Deliberately unlabelled. A precinct belongs under neither TRIPS nor FLEET, and
    // inventing a group name before there is a second resident would be guessing at a
    // taxonomy. When organisations or partners arrive, give this group a label.
    items: [
      { label: 'Precincts', href: ROUTES.precincts, icon: 'map', activePatterns: ['/precincts'] },
    ],
  },
```

`'map'` is a valid `IconName` and its glyph is a map pin (`components/ui/Ic.tsx:34`) — verified. `IconName` is a closed union; an unknown key renders nothing.

Then fix line 185. It currently reads `<div key={group.label}>`, which keys an unlabelled group on `undefined` — fine with one such group, a React key collision with two:

```tsx
        {NAV_GROUPS.map(group => (
          // Keyed on the first item's href, not the label: groups may be unlabelled,
          // and two unlabelled groups would otherwise collide on an `undefined` key.
          <div key={group.label ?? group.items[0].href}>
```

- [ ] **Step 7: Run the tests and typecheck**

```bash
cd frontend/dispatcher && npx vitest run lib/hooks/usePrecincts.test.tsx && npm run type-check && npm run lint
```

Expected: PASS, no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/dispatcher/lib/hooks/usePrecincts.ts frontend/dispatcher/lib/hooks/usePrecincts.test.tsx frontend/dispatcher/lib/hooks/usePrecinctDetail.ts frontend/dispatcher/lib/constants/routes.ts frontend/dispatcher/components/layout/Sidebar.tsx
git commit -m "feat(dispatcher): add precinct routes, detail hook and nav entry"
```

---

## Task 11: List page

Cards rather than a table: a precinct is a place, and the schematic thumbnail is the fastest scan. The Mine/Shared filter exists to make the ownership split visible — it is what explains why some cards offer no way in to editing.

**Files:**
- Create: `frontend/dispatcher/app/(app)/precincts/page.tsx`

Read `app/(app)/fleet/vehicles/page.tsx` before starting — the `TopBar`, `AdminOnly`, `EmptyState`, spinner and fetch-error idioms all come from it.

- [ ] **Step 1: Create the page**

```tsx
'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Plus, AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { TopBar } from '@/components/ui/TopBar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { AdminOnly } from '@/components/auth/AdminOnly'
import { GeofenceSchematic } from '@/components/map/GeofenceSchematic'
import { useAuth } from '@/lib/hooks/useAuth'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { useToast } from '@/lib/hooks/useToast'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'
import type { Precinct } from '@shared/lib/types/precinct'

type OwnerFilter = 'all' | 'mine' | 'shared'

export default function PrecinctsPage(): React.JSX.Element {
  const router = useRouter()
  const { precincts, isLoading, error: fetchError, refetch } = usePrecincts()
  const { user } = useAuth()
  const { notify } = useToast()

  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (fetchError) {
      notify({ kind: 'error', title: 'Failed to load precincts', body: fetchError })
    }
  }, [fetchError, notify])

  // Ownership drives what a dispatcher can do with a row, so it is worth showing
  // rather than leaving them to discover it from a 404.
  function isOwned(precinct: Precinct): boolean {
    return String(precinct.principal_organization_id) === String(user?.organization_id)
  }

  const mineCount = precincts.filter(isOwned).length
  const sharedCount = precincts.length - mineCount

  const visible = useMemo(() => {
    const byOwner = precincts.filter((p) => {
      if (ownerFilter === 'mine') return isOwned(p)
      if (ownerFilter === 'shared') return !isOwned(p)
      return true
    })
    const query = search.trim().toLowerCase()
    if (query.length === 0) return byOwner
    return byOwner.filter((p) =>
      [p.name, p.address].filter(Boolean).some((f) => f!.toLowerCase().includes(query)),
    )
    // isOwned closes over `user`, which is why it is in the dependency list.
  }, [precincts, ownerFilter, search, user])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Precincts">
        <AdminOnly>
          <Button
            size="sm"
            iconLeft={<Plus className="w-4 h-4" />}
            onClick={() => router.push(ROUTES.precinctNew)}
          >
            Add Precinct
          </Button>
        </AdminOnly>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-[2px] bg-surf-low rounded-md p-[3px] shrink-0">
            {([
              { id: 'all', label: `All (${precincts.length})` },
              { id: 'mine', label: `Mine (${mineCount})` },
              { id: 'shared', label: `Shared (${sharedCount})` },
            ] as { id: OwnerFilter; label: string }[]).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setOwnerFilter(opt.id)}
                className={cn(
                  'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase transition-colors',
                  ownerFilter === opt.id
                    ? 'bg-surf-lowest text-on-surf shadow-level-1'
                    : 'text-on-surf-v hover:text-on-surf',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[140px]">
            <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
            <input
              type="text"
              placeholder="Name or address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-4 py-2 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf placeholder:text-on-surf-v/60 outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : fetchError ? (
          <EmptyState
            icon={<AlertCircle />}
            title="Failed to load"
            body={fetchError}
            cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>}
          />
        ) : precincts.length === 0 ? (
          <EmptyState
            icon={<Ic n="map" s={32} />}
            title="No precincts"
            body="No depots or warehouses mapped yet."
            cta={
              <AdminOnly>
                <Button size="sm" onClick={() => router.push(ROUTES.precinctNew)}>
                  Add the first precinct
                </Button>
              </AdminOnly>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Ic n="search" s={32} />}
            title="No matches"
            body="No precincts match your filters."
            cta={
              <Button size="sm" variant="ghost" onClick={() => { setOwnerFilter('all'); setSearch('') }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(ROUTES.precinctDetail(p.id))}
                className="text-left flex gap-3 p-4 rounded-lg bg-surf-lowest border border-outline-v/30 shadow-level-3 hover:brightness-[1.02] transition-[filter] duration-[120ms]"
              >
                <GeofenceSchematic
                  radiusMetres={p.geofence_radius_metres}
                  className="w-[72px] h-[72px] shrink-0"
                />
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-[15px] font-[800] text-on-surf truncate">{p.name}</span>
                  {p.address && (
                    <span className="text-[12px] text-on-surf-v line-clamp-2">{p.address}</span>
                  )}
                  {/* Tabular nums + tracking per DESIGN_SYSTEM 5.2 — this is an identifier. */}
                  <span
                    className="text-[11px] text-on-surf-v"
                    style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.03em' }}
                  >
                    {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                  </span>
                  <span className="text-[11px] text-on-surf-v">
                    Geofence {p.geofence_radius_metres} m
                    {!isOwned(p) && ' · shared with you'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
cd frontend/dispatcher && npm run type-check && npm run lint
```

Expected: no errors. If `useAuth`'s user type has no `organization_id`, drop `isOwned` back to always-true and remove the Mine/Shared filter rather than casting — the server is the real gate and a compile error is not acceptable. Note the reduction in TASK COMPLETE if so.

- [ ] **Step 3: Commit**

```bash
git add "frontend/dispatcher/app/(app)/precincts/page.tsx"
git commit -m "feat(dispatcher): add the precincts list page"
```

---

## Task 12: Create / edit page

A full page rather than a modal, because this is a **spatial** task — place a point, size a circle, confirm both against imagery — and a 560 px modal is hostile to that. Vehicles and drivers keep their modals: those are eight short text fields with nothing to look at. `/trips/new` is the precedent for going full-page when there is.

One form component serves both routes; edit mode is the same form pre-filled.

**Files:**
- Create: `frontend/dispatcher/components/precincts/PrecinctForm.tsx`
- Create: `frontend/dispatcher/app/(app)/precincts/new/page.tsx`
- Create: `frontend/dispatcher/app/(app)/precincts/[id]/edit/page.tsx`

- [ ] **Step 1: Create the form component**

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'

import { TopBar } from '@/components/ui/TopBar'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Switch } from '@/components/ui/Switch'
import { GeofenceMap } from '@/components/map/GeofenceMap'
import { useToast } from '@/lib/hooks/useToast'
import { api } from '@/lib/api/client'
import { ROUTES } from '@/lib/constants/routes'
import type { Precinct } from '@shared/lib/types/precinct'
import {
  validatePrecinctForm,
  parseCoordinatePair,
  PRECINCT_FIELD_ORDER,
  type PrecinctField,
} from '@shared/lib/validation/precinct'
import {
  GEOFENCE_RADIUS_DEFAULT,
  GEOFENCE_RADIUS_MIN,
  GEOFENCE_RADIUS_MAX,
} from '@shared/lib/validation/constants'

// Johannesburg. Only ever the STARTING viewport for a brand-new precinct — the
// dispatcher's first click replaces it. Never submitted as-is: latitude and longitude
// start empty and are required, so an untouched map cannot be saved.
const DEFAULT_MAP_CENTRE = { latitude: -26.2041, longitude: 28.0473 }

interface PrecinctFormState {
  name: string
  address: string
  latitude: string
  longitude: string
  geofence_radius_metres: string
  is_shared: boolean
}

const EMPTY_FORM: PrecinctFormState = {
  name: '',
  address: '',
  latitude: '',
  longitude: '',
  geofence_radius_metres: String(GEOFENCE_RADIUS_DEFAULT),
  is_shared: false,
}

function formFromPrecinct(precinct: Precinct): PrecinctFormState {
  return {
    name: precinct.name,
    address: precinct.address ?? '',
    latitude: String(precinct.latitude),
    longitude: String(precinct.longitude),
    geofence_radius_metres: String(precinct.geofence_radius_metres),
    is_shared: precinct.is_shared,
  }
}

/** Parse a coordinate field for the map, falling back to the default centre. */
function coordOr(value: string, fallback: number): number {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

interface PrecinctFormProps {
  /** Absent = create. Present = edit that precinct. */
  precinct?: Precinct
}

export function PrecinctForm({ precinct }: PrecinctFormProps): React.JSX.Element {
  const router = useRouter()
  const { notify } = useToast()
  const isEdit = precinct !== undefined

  const [form, setForm] = useState<PrecinctFormState>(
    precinct ? formFromPrecinct(precinct) : EMPTY_FORM,
  )
  const [touched, setTouched] = useState<Set<PrecinctField>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const errors = validatePrecinctForm(form)
  const hasErrors = Object.values(errors).some((e) => e !== null)

  const mapLat = coordOr(form.latitude, DEFAULT_MAP_CENTRE.latitude)
  const mapLng = coordOr(form.longitude, DEFAULT_MAP_CENTRE.longitude)
  const mapRadius = coordOr(form.geofence_radius_metres, GEOFENCE_RADIUS_DEFAULT)

  function setField(name: keyof PrecinctFormState, value: string): void {
    setForm((prev) => ({ ...prev, [name]: value }))
    setTouched((prev) => new Set(prev).add(name as PrecinctField))
  }

  /**
   * FormField's onChange, with one extra behaviour on the coordinate fields: pasting
   * "lat, lng" — what every maps app puts on the clipboard — fills BOTH fields.
   *
   * This is the deliberate replacement for address geocoding: a geocoder returns a
   * street centroid, which for a warehouse estate can sit hundreds of metres from the
   * gate. parseCoordinatePair returns null for anything that is not a complete in-range
   * pair, so ordinary single-number typing is never interfered with.
   */
  function handleFieldChange(name: string, value: string): void {
    if (name === 'latitude' || name === 'longitude') {
      const pair = parseCoordinatePair(value)
      if (pair !== null) {
        setForm((prev) => ({ ...prev, latitude: pair.lat, longitude: pair.lng }))
        setTouched((prev) => new Set(prev).add('latitude').add('longitude'))
        return
      }
    }
    setField(name as keyof PrecinctFormState, value)
  }

  function handleMapPosition(next: { latitude: number; longitude: number }): void {
    // 5 dp ≈ 1 m — finer than any geofence decision and finer than a click is accurate.
    setForm((prev) => ({
      ...prev,
      latitude: next.latitude.toFixed(5),
      longitude: next.longitude.toFixed(5),
    }))
    setTouched((prev) => new Set(prev).add('latitude').add('longitude'))
  }

  async function handleSubmit(): Promise<void> {
    if (hasErrors) {
      setTouched(new Set(PRECINCT_FIELD_ORDER))
      const firstInvalid = PRECINCT_FIELD_ORDER.find((f) => errors[f] !== null)
      if (firstInvalid) {
        document.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus()
      }
      return
    }

    setSubmitting(true)
    setFormError(null)
    try {
      const body = {
        name: form.name,
        address: form.address || null,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        geofence_radius_metres: parseInt(form.geofence_radius_metres, 10),
        is_shared: form.is_shared,
      }

      if (isEdit) {
        await api.patch(`/api/v1/precincts/${precinct.id}`, body)
        notify({ kind: 'success', title: 'Precinct updated', body: form.name })
        router.push(ROUTES.precinctDetail(String(precinct.id)))
      } else {
        const created = await api.post<Precinct>('/api/v1/precincts', body)
        notify({ kind: 'success', title: 'Precinct created', body: form.name })
        router.push(ROUTES.precinctDetail(String(created.id)))
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : `Failed to ${isEdit ? 'update' : 'create'} precinct`,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title={isEdit ? 'Edit Precinct' : 'Add Precinct'}>
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          Cancel
        </Button>
        {/* One gradient CTA per view — DESIGN_SYSTEM 10.5. */}
        <Button size="sm" loading={submitting} disabled={hasErrors || submitting} onClick={handleSubmit}>
          {isEdit ? 'Save Changes' : 'Save Precinct'}
        </Button>
      </TopBar>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <div className="w-full lg:w-[380px] shrink-0 overflow-y-auto p-6 flex flex-col gap-4 border-r border-outline-v/30">
          {formError && <p className="text-sm text-red-500">{formError}</p>}

          <FormField
            label="Name"
            name="name"
            value={form.name}
            onChange={handleFieldChange}
            placeholder="FedEx DBN — Riverhorse Valley"
            required
            error={touched.has('name') ? errors.name ?? undefined : undefined}
          />
          <FormField
            label="Address"
            name="address"
            value={form.address}
            onChange={handleFieldChange}
            placeholder="12 Sookhai Place, Riverhorse Valley, Durban"
            helperText="A label for people. Nothing is computed from it."
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Latitude"
              name="latitude"
              inputMode="decimal"
              value={form.latitude}
              onChange={handleFieldChange}
              placeholder="-29.79420"
              required
              error={touched.has('latitude') ? errors.latitude ?? undefined : undefined}
            />
            <FormField
              label="Longitude"
              name="longitude"
              inputMode="decimal"
              value={form.longitude}
              onChange={handleFieldChange}
              placeholder="30.98200"
              required
              error={touched.has('longitude') ? errors.longitude ?? undefined : undefined}
            />
          </div>
          <p className="text-[11px] text-on-surf-v -mt-2">
            Click the map to place the pin, or paste “lat, lng” from a maps app.
          </p>

          <div className="flex flex-col gap-2">
            <FormField
              label="Geofence radius (m)"
              name="geofence_radius_metres"
              type="number"
              inputMode="numeric"
              value={form.geofence_radius_metres}
              onChange={handleFieldChange}
              required
              helperText="How close a handshake must be to count as at this facility."
              error={
                touched.has('geofence_radius_metres')
                  ? errors.geofence_radius_metres ?? undefined
                  : undefined
              }
            />
            {/* Slider and number together: the slider grows the circle under your eye,
                the field keeps it exact and typeable. */}
            <input
              type="range"
              min={GEOFENCE_RADIUS_MIN}
              max={GEOFENCE_RADIUS_MAX}
              step={10}
              value={mapRadius}
              onChange={(e) => setField('geofence_radius_metres', e.target.value)}
              aria-label="Geofence radius in metres"
              className="w-full accent-[var(--sec)]"
            />
            <div
              className="flex justify-between text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              <span>{GEOFENCE_RADIUS_MIN} m</span>
              <span>{GEOFENCE_RADIUS_MAX} m</span>
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 pt-2 border-t border-outline-v/30">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-surface-on-variant">
                Share with other organisations
              </span>
              <span className="text-[11px] text-on-surf-v">
                Lets other organisations select this precinct when creating a trip. They
                still cannot edit it.
              </span>
            </div>
            <Switch
              checked={form.is_shared}
              onCheckedChange={(next) => setForm((prev) => ({ ...prev, is_shared: next }))}
              ariaLabel="Share this precinct with other organisations"
            />
          </div>
        </div>

        <div className="flex-1 min-h-[320px] p-6">
          <GeofenceMap
            latitude={mapLat}
            longitude={mapLng}
            radiusMetres={mapRadius}
            onPositionChange={handleMapPosition}
            className="w-full h-full min-h-[320px]"
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the two route pages**

`frontend/dispatcher/app/(app)/precincts/new/page.tsx`:

```tsx
'use client'

import React from 'react'

import { PrecinctForm } from '@/components/precincts/PrecinctForm'

export default function NewPrecinctPage(): React.JSX.Element {
  return <PrecinctForm />
}
```

`frontend/dispatcher/app/(app)/precincts/[id]/edit/page.tsx`:

```tsx
'use client'

import React from 'react'
import { useParams } from 'next/navigation'

import { PrecinctForm } from '@/components/precincts/PrecinctForm'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePrecinctDetail } from '@/lib/hooks/usePrecinctDetail'

export default function EditPrecinctPage(): React.JSX.Element {
  const params = useParams<{ id: string }>()
  const { precinct, isLoading, error } = usePrecinctDetail(params.id)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Spinner size="lg" />
      </div>
    )
  }
  if (error !== null || precinct === null) {
    // A precinct the caller cannot see returns 404, so this covers both "gone" and
    // "not yours" without distinguishing them — which is the point of the 404.
    return <EmptyState title="Precinct unavailable" body={error ?? 'Not found.'} />
  }

  return <PrecinctForm precinct={precinct} />
}
```

- [ ] **Step 3: Typecheck and lint**

```bash
cd frontend/dispatcher && npm run type-check && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Verify the create path in the browser**

```bash
cd backend && uvicorn app.main:app --reload --port 8000
# second terminal
cd frontend/dispatcher && npm run dev
```

Signed in as an **admin dispatcher**, confirm:
1. `/precincts` shows "Add Precinct"; a plain dispatcher does not see it.
2. `/precincts/new` renders the form and a satellite map centred on Johannesburg.
3. Clicking the map fills latitude and longitude; the pin and circle move.
4. Dragging the pin updates both fields.
5. Pasting `-29.7942, 30.9820` into the **latitude** field fills **both**.
6. The radius slider resizes the circle live; the number field stays in step.
7. Latitude `91` shows an inline error and Save is disabled.
8. Saving redirects to the new precinct's detail page.
9. The new precinct appears in the origin/destination pickers on `/trips/new`.
10. Killing network access to the tile host shows the schematic with "Map unavailable", not a grey box.

- [ ] **Step 5: Verify the edit path**

11. `/precincts/[id]/edit` on an owned precinct is pre-filled.
12. Changing the radius to 350 and saving persists across a reload.
13. Opening the edit route for a **shared, non-owned** precinct saves with a 404 error surfaced in `formError` — the server refuses it. (Task 13 hides the Edit button for these; this confirms the server is the real gate.)

- [ ] **Step 6: Commit**

```bash
git add frontend/dispatcher/components/precincts "frontend/dispatcher/app/(app)/precincts/new" "frontend/dispatcher/app/(app)/precincts/[id]/edit"
git commit -m "feat(dispatcher): add the precinct create/edit page with click-to-place map"
```

---

## Task 13: Detail page

The detail page is the argument for anchoring, made visible: a rename sits in the history with no anchor badge, a geofence resize sits there with one. Per `DESIGN_SYSTEM.md` §10.3 the absence of a chain marker is itself the information.

**Reuse, do not rebuild.** `components/blockchain/EventTimeline.tsx` already renders exactly this — an ordered event list with humanised diffs and forensic-gated `BlockchainBadge`s. It needs `PrecinctEvent` added to its union, not a sibling component. `VerifyButton` already takes `subjectType`/`subjectId` and works as-is once `'precinct_event'` is in the shared `SubjectType`.

**Files:**
- Modify: `frontend/dispatcher/components/blockchain/EventTimeline.tsx`
- Modify: `frontend/dispatcher/lib/forensic/describeChange.ts`
- Create: `frontend/dispatcher/app/(app)/precincts/[id]/page.tsx`

- [ ] **Step 1: Extend `EventTimeline` to accept precinct events**

Three surgical changes. Update the component's leading comment from *"vehicle or driver events"* to *"vehicle, driver or precinct events"*.

Extend the import and the union:

```typescript
import type {
  BlockchainReceipt, DriverEvent, PrecinctEvent, VehicleEvent,
} from '@shared/lib/types/blockchain'

type Event = VehicleEvent | DriverEvent | PrecinctEvent
```

Extend the receipt filter so precinct receipts are matched to their events — without this the badges never render:

```typescript
    if (
      r.subject_type === 'vehicle_event' ||
      r.subject_type === 'driver_event' ||
      r.subject_type === 'precinct_event'
    ) {
      receiptByEvent.set(r.subject_id, r)
    }
```

Extend `describeEvent`. `'created'` and `'cosmetic_update'` are shared across all three entity types, so both need to discriminate on the id field the way `cosmetic_update` already does:

```typescript
function describeEvent(e: Event): string {
  const t = e.event_type
  const isPrecinct = 'precinct_id' in e
  if (t === 'created') return isPrecinct ? 'Precinct mapped' : 'Created'
  if (t === 'license_plate_changed') return 'Licence plate changed'
  if (t === 'license_disc_renewed') return 'Licence disc renewed'
  if (t === 'license_renewed') return 'Driver licence renewed'
  if (t === 'vin_updated') return 'VIN updated'
  if (t === 'vehicle_updated') return 'Vehicle details updated'
  if (t === 'deactivated') return 'Deactivated'
  if (t === 'relocated') return 'Location corrected'
  if (t === 'geofence_resized') return 'Geofence radius changed'
  if (t === 'sharing_changed') return 'Cross-organisation sharing changed'
  if (t === 'cosmetic_update') {
    if (isPrecinct) return 'Precinct details updated'
    return 'vehicle_id' in e ? 'Vehicle details updated' : 'Driver details updated'
  }
  return t
}
```

- [ ] **Step 2: Add precinct field labels to `describeChange`**

Read `frontend/dispatcher/lib/forensic/describeChange.ts` and add the four precinct fields to whatever label map it uses, so the history reads in English rather than in column names:

| Field | Label |
|---|---|
| `latitude` | Latitude |
| `longitude` | Longitude |
| `geofence_radius_metres` | Geofence radius (m) |
| `is_shared` | Shared with other organisations |

If the file has no map and formats keys generically, leave it alone and note that in TASK COMPLETE — a generic `geofence_radius_metres` row is readable enough and is not worth restructuring a forensic helper for.

- [ ] **Step 3: Create the detail page**

```tsx
'use client'

import React from 'react'
import { useRouter, useParams } from 'next/navigation'

import { TopBar } from '@/components/ui/TopBar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { SecHead } from '@/components/ui/SecHead'
import { InfoRow } from '@/components/ui/InfoRow'
import { AdminOnly } from '@/components/auth/AdminOnly'
import { GeofenceMap } from '@/components/map/GeofenceMap'
import { EventTimeline } from '@/components/blockchain/EventTimeline'
import { useAuth } from '@/lib/hooks/useAuth'
import { usePrecinctDetail } from '@/lib/hooks/usePrecinctDetail'
import { ROUTES } from '@/lib/constants/routes'

export default function PrecinctDetailPage(): React.JSX.Element {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { precinct, isLoading, error, refetch } = usePrecinctDetail(params.id)
  const { user } = useAuth()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error !== null || precinct === null) {
    return (
      <EmptyState
        title="Precinct unavailable"
        body={error ?? 'Not found.'}
        cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>}
      />
    )
  }

  // A precinct listed via is_shared is owned by another org: the API answers 404 on a
  // write. Hiding Edit is not the security control — the server is — but offering a
  // button that can only fail is worse than not offering it.
  const isOwner =
    String(precinct.principal_organization_id) === String(user?.organization_id)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title={precinct.name}>
        {isOwner && (
          <AdminOnly>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(ROUTES.precinctEdit(String(precinct.id)))}
            >
              Edit
            </Button>
          </AdminOnly>
        )}
      </TopBar>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col lg:overflow-y-auto">
          <div className="p-6 pb-0">
            <GeofenceMap
              latitude={precinct.latitude}
              longitude={precinct.longitude}
              radiusMetres={precinct.geofence_radius_metres}
              className="w-full h-[320px]"
            />
          </div>

          <div className="p-6">
            <SecHead title="Change history" />
            {/* The point of the ledger: a rename appears here with no anchor badge, a
                geofence change with one. DESIGN_SYSTEM 10.3 — the absence is the information. */}
            <EventTimeline events={precinct.events} receipts={precinct.receipts} />
          </div>
        </div>

        <div className="w-full lg:w-[256px] shrink-0 bg-surf-low p-5 flex flex-col gap-4 border-l border-outline-v/30">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
              Precinct
            </span>
            <InfoRow label="Address" value={precinct.address ?? '—'} />
            {/* Identifiers: tabular-nums per DESIGN_SYSTEM 5.2 / 10.4. */}
            <InfoRow
              label="Latitude"
              value={precinct.latitude.toFixed(5)}
              valueClassName="tabular-nums tracking-[0.03em]"
            />
            <InfoRow
              label="Longitude"
              value={precinct.longitude.toFixed(5)}
              valueClassName="tabular-nums tracking-[0.03em]"
            />
            <InfoRow
              label="Geofence"
              value={`${precinct.geofence_radius_metres} m`}
              valueClassName="tabular-nums tracking-[0.03em]"
            />
            <InfoRow label="Shared" value={precinct.is_shared ? 'Yes' : 'No'} />
            {!isOwner && (
              <p className="text-[11px] text-on-surf-v">
                Shared with your organisation by its owner. You can plan trips to it but
                not change it.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

Check `InfoRow`'s actual props before running this — if it has no `valueClassName`, apply the tabular-nums style inline via `style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.03em' }}` on a wrapping span instead, or pass a `ReactNode` value if it accepts one. Do not skip the numeric styling; §10.4 makes it mandatory for coordinates.


- [ ] **Step 4: Typecheck, lint and verify in the browser**

```bash
cd frontend/dispatcher && npm run type-check && npm run lint
```

With both servers running, as an **admin dispatcher** on an owned precinct:
1. `/precincts/[id]` shows the map with the geofence circle at the right radius.
2. The change history lists "Precinct mapped" for the create.
3. Editing the radius, then returning, adds "Geofence radius changed" with a from → to row.
4. Renaming it adds "Precinct details updated" **with no anchor badge** — the cosmetic path.
5. Anchor badges appear only with forensic mode ON (they are inside `ForensicOnly`).
6. Opening a **shared, non-owned** precinct shows the map and history, **no Edit button**, and the "Shared with your organisation" note.
7. As a plain dispatcher, no Edit button and `receipts` is empty.

- [ ] **Step 5: Commit**

```bash
git add frontend/dispatcher/components/blockchain/EventTimeline.tsx frontend/dispatcher/lib/forensic/describeChange.ts "frontend/dispatcher/app/(app)/precincts/[id]/page.tsx"
git commit -m "feat(dispatcher): add the precinct detail page with map and anchored change history"
```

---

## Final verification

- [ ] **Full backend suite**

```bash
cd backend && pytest
```

Expected: PASS, no new skips.

- [ ] **Both frontend surfaces**

```bash
cd frontend/dispatcher && npm run type-check && npm run lint && npm test
cd ../driver-pwa && npm run type-check && npm test
```

Expected: PASS. The driver PWA is checked because Tasks 8 touched five files under `frontend/shared/`.

- [ ] **Migration is the only schema change, and reversible**

```bash
cd backend && git status --short migrations/ && alembic downgrade -1 && alembic upgrade head
```

Expected: exactly one new file under `migrations/versions/`, and a clean down-and-up.

- [ ] **End-to-end demo rehearsal**

The story's demo line is *"an admin maps the destination facility, and the same handshake that passed from a car park 3 km away now fails."* Walk it once, start to finish, before calling this done:

1. Sign in as an admin dispatcher.
2. `/precincts` → Add Precinct.
3. Click the satellite map on a real building; set the radius to 200 m.
4. Save. Confirm the detail page shows the circle and an anchored "Precinct mapped".
5. `/trips/new` → confirm the new precinct is selectable as a destination.

- [ ] **Do not rebuild the graph** unless you are the merge-to-`main` maintainer. Per CLAUDE.md's Team Graph Policy, `/graphify .` is run by the merging developer only.

---

## TASK COMPLETE notes for the implementer

Fill in the CLAUDE.md TASK COMPLETE block. These entries are already known:

**Shared files touched:**
- `frontend/shared/lib/types/precinct.ts`, `frontend/shared/lib/types/blockchain.ts`, `frontend/shared/lib/mocks/precincts.ts`, `frontend/shared/lib/validation/rules.ts`, `frontend/shared/lib/validation/constants.ts` — all additive; `driver-pwa` imports from this directory.
- `frontend/dispatcher/package.json` — **new dependency (`leaflet`, `@types/leaflet`)**, needs team agreement.
- `backend/app/db/models/__init__.py` — `PrecinctEvent` registered.
- `backend/app/schemas/__init__.py` — re-export renamed.
- `backend/app/core/config.py` — **untouched**, no new settings.

**Migrations:** one — `2026_08_31_ciaran_add_precinct_events.py`, `down_revision = "ciaran_uniq_fleet_ids"`.

**New .env keys:** none. Both tile sources are keyless, which was part of why they were chosen.

**Follow-ups to raise, not fix here:**
1. **FP-68 acceptance criterion** — the geofence verdict must record the coordinates and radius it was computed against. Anchoring proves a precinct *changed*; only that snapshot makes a historical verdict *reproducible*. See "Anchoring design".
2. **Address geocoding** — deferred with reasons, see "Recorded for later".
3. No `UniqueConstraint(principal_organization_id, name)` on `precincts`; the name check races.
4. `DESIGN_SYSTEM.md` §10.9 sidebar group order is stale, and §11's reference HTMLs were never split.
5. Confirm Esri World Imagery's terms before the project is published publicly.

---

## Self-review

Run against the spec with fresh eyes before starting Task 1.

**Spec coverage.** Every acceptance criterion maps to a task: *add a precinct* (1, 3, 7, 12) · *edit one* (1, 4, 7, 12) · *name, address, coordinates, radius* (1, 12) · *saved against their organization* (3, 7) · *appears in `GET /precincts` for trip creation* (3 Step 1 test, 7 test, 12 Step 4 item 9) · *cross-org writes return 404 not 403* (4, 5, 7) · *`require_admin_dispatcher` gate* (7, and Step 6 proves the tests have teeth) · *circle and radius only* (no polygon anywhere) · *anchoring like driver and vehicle* (2–6).

**Type consistency.** `PrecinctCreateBody` / `PrecinctUpdateBody` / `PrecinctDetailResponse` are used under those names in every task that references them. `create_precinct(db, organization_id, data, current_user_id)` and `update_precinct(db, precinct_id, organization_id, data, current_user_id)` keep the same signatures in Tasks 3, 4 and 7. The canonical anchor payload dict has identical keys in `create_precinct`, `update_precinct`, `_reconstruct_precinct_event_payload` and the Task 6 test helper — **if you change one, change all four, or verification reports a mismatch that never happened.**

**Known ordering hazard.** Task 8 must land before Tasks 11–13, and `SubjectType` must gain `'precinct_event'` in the shared types (Task 8 Step 3) before `VerifyButton` can be pointed at a precinct.
