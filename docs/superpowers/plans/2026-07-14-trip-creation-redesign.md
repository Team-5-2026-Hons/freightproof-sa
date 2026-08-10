# Trip Creation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-14-trip-creation-redesign-design.md` — read it before starting.

**Goal:** Rebuild trip creation so the dispatcher enters only load-bearing data (order number, waybill refs + unit counts, crew, route), cargo detail comes from Parcel Perfect (mocked), empty legs are first-class, trailers are optional, and every created trip is readable by the driver app.

**Architecture:** Backend-first in five phases: (1) data model + hashing + schemas, (2) PP mock fixture library + aspirational manifest lookup, (3) services + endpoints, (4) dispatcher wizard, (5) verification. Layering per CLAUDE.md: endpoints → orchestration → integrations → db. H0 anchoring stays fail-closed; PP sync at creation is fail-closed; handshakes are out of scope here (fail-open conversion is the H1 plan's job).

**Tech Stack:** FastAPI 0.115+, SQLAlchemy 2.0 async (`Mapped`), Pydantic v2, Alembic, pytest + pytest-asyncio (auto mode), Next.js 15 App Router, TypeScript 5.5+.

**Conventions for this plan (per project preferences):**
- **No git commands during execution** — the developer stages/commits. Each phase ends with a `> **Suggested commit:**` line only.
- **Tests are written inside tasks but run once at the end of each phase**, not after every step. A single Final Verification section closes the plan.
- Migration prerequisite: `git fetch origin` and check `origin/dev` for unmerged migrations before creating the migration file (4-dev rule).

---

## Phase 1 — Data model, migration, hashing, schemas

### Task 1: `TripType` enum + three DB changes + migration

**Files:**
- Modify: `backend/app/db/models/enums.py`
- Modify: `backend/app/db/models/trips.py` (Trip + Consignment)
- Modify: `backend/app/db/models/organisations.py`
- Create: `backend/migrations/versions/2026_07_14_ciaran_trip_creation_redesign.py`

- [ ] **Step 1.1: Add `TripType` to `enums.py`** (place after `TripStatus`):

```python
class TripType(str, enum.Enum):
    """Loaded = normal cargo run; empty_leg = repositioning, no consignments."""
    LOADED    = "loaded"
    EMPTY_LEG = "empty_leg"
```

- [ ] **Step 1.2: Add `trip_type` to the `Trip` model** in `db/models/trips.py`, next to `status`. Follow the file's existing column style:

```python
trip_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default=TripType.LOADED.value)
```

Import `TripType` from `app.db.models.enums` (extend the existing enums import line).

- [ ] **Step 1.3: Make `Consignment.client_organization_id` nullable** in the same file — change its `mapped_column(..., nullable=False)` to `nullable=True` and the annotation to `Mapped[Optional[uuid.UUID]]`. Update the model docstring line for the field: client org is resolved from the PP account number and may be unknown (warning surfaced, not an error).

- [ ] **Step 1.4: Add `pp_account_number` to `Organization`** in `db/models/organisations.py`:

```python
# PP `accnum` (string[6] in the v28 spec) — lets consignment sync resolve the
# client organization from the waybill instead of trusting a caller-supplied ID.
pp_account_number: Mapped[Optional[str]] = mapped_column(String(6), nullable=True, unique=True)
```

- [ ] **Step 1.5: Create the migration.** First: `git fetch origin` and inspect `git log origin/dev --oneline -- backend/migrations/versions/` for anything not on this branch — stop and coordinate if found. Then confirm the current head: `cd backend && alembic heads` (expected: the revision inside `2026_07_02_ciaran_add_exception_scoping.py`; open that file and copy its `revision` string as `down_revision` below). Create the file by hand (don't autogenerate — three small ops, and autogenerate against Supabase can pick up noise):

```python
"""Trip creation redesign: trip_type, org pp_account_number, nullable consignment client org.

Revision ID: 2026_07_14_ciaran_tcr
Revises: <head revision string from alembic heads>
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_07_14_ciaran_tcr"
down_revision = "<head revision string>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "trips",
        sa.Column("trip_type", sa.String(length=20), nullable=False, server_default="loaded"),
    )
    op.add_column(
        "organizations",
        sa.Column("pp_account_number", sa.String(length=6), nullable=True),
    )
    op.create_unique_constraint(
        "uq_organizations_pp_account_number", "organizations", ["pp_account_number"]
    )
    op.alter_column(
        "consignments",
        "client_organization_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "consignments",
        "client_organization_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.drop_constraint(
        "uq_organizations_pp_account_number", "organizations", type_="unique"
    )
    op.drop_column("organizations", "pp_account_number")
    op.drop_column("trips", "trip_type")
```

- [ ] **Step 1.6: Apply it:** `cd backend && alembic upgrade head` (against the dev `DATABASE_URL`; migration state is per-database).

### Task 2: Hashing — optional trailers + versioned `trip_type`

**Files:**
- Modify: `backend/app/crypto/hashing.py` (**shared — flag to Chiko/WP7 in the PR**)
- Modify: `backend/app/orchestration/verification_service.py`
- Test: `backend/tests/unit/test_hashing.py` (extend existing)

**Why versioned:** `verification_service._reconstruct_trip_payload` recomputes the canonical payload from live DB rows and compares its hash to the anchored one. If `trip_type` were added unconditionally, every pre-existing trip would recompute a different hash → false `db_mismatch` ("tampering") on all old receipts. So `trip_type` is an *optional* payload key: always set for new trips, included at verification only when the stored receipt's payload has it.

- [ ] **Step 2.1: In `hashing.py`**, add `trip_type: str | None = None` keyword-only param to **both** `compute_trip_canonical_payload` and `compute_journey_lock_hash` (the latter passes it through). In `compute_trip_canonical_payload`, after building the dict:

```python
if trip_type is not None:
    payload["trip_type"] = trip_type
```

- [ ] **Step 2.2: Remove the empty-trailer guard** in `compute_journey_lock_hash` — delete:

```python
if not trailer_ids:
    raise ValueError("trailer_ids must not be empty")
```

Update the function docstring: an empty `trailers` list is a valid canonical value (rigid trucks / integrated bodies run without trailers).

- [ ] **Step 2.3: In `verification_service.py`**, change `_reconstruct_trip_payload` to accept the receipt so it can version-dispatch:

```python
async def _reconstruct_trip_payload(
    db: AsyncSession, trip_id: uuid.UUID, *, anchored_payload: dict[str, Any] | None
) -> dict[str, Any] | None:
```

and pass `trip_type` conditionally when calling `compute_trip_canonical_payload`:

```python
include_trip_type = bool(anchored_payload) and "trip_type" in anchored_payload
...
    trip_type=trip.trip_type if include_trip_type else None,
```

Find the call site inside `verify_subject` (it already holds the receipt from `_latest_receipt`) and pass `anchored_payload=receipt.payload_json`.

- [ ] **Step 2.4: Extend `tests/unit/test_hashing.py`:**

```python
def test_empty_trailer_list_produces_stable_hash():
    kwargs = _base_kwargs()  # reuse the file's existing fixture/helper pattern
    kwargs["trailer_ids"] = []

    h1 = compute_journey_lock_hash(**kwargs)
    h2 = compute_journey_lock_hash(**kwargs)

    assert h1 == h2
    assert len(h1) == 64


def test_trip_type_changes_hash_only_when_provided():
    kwargs = _base_kwargs()

    without = compute_journey_lock_hash(**kwargs)
    with_type = compute_journey_lock_hash(**kwargs, trip_type="loaded")

    assert without != with_type


def test_payload_omits_trip_type_key_when_none():
    payload = compute_trip_canonical_payload(**_base_kwargs())

    assert "trip_type" not in payload
```

(If the file has no `_base_kwargs` helper, write one returning the full valid kwargs dict with `uuid4()` values and a fixed `datetime`.)

### Task 3: Request/response schemas

**Files:**
- Modify: `backend/app/schemas/trips.py` (**shared — flag in PR**)
- Modify: `backend/app/schemas/organizations.py` (add `pp_account_number: Optional[str] = None` to `OrganizationBase`/`OrganizationRead` — check actual class layout in the file)
- Test: `backend/tests/unit/test_trip_schemas.py` (create; move/extend any existing TripCreateRequest validator tests found in `tests/unit/` — search `grep -rn "TripCreateRequest" backend/tests/unit/`)

- [ ] **Step 3.1: Add `TripConsignmentInput`** above `TripCreateRequest`:

```python
class TripConsignmentInput(BaseModel):
    """One waybill on the trip. pp_reference is the PP waybill number (string[24]
    in the v28 spec); unit_count_expected is the dispatcher-entered consolidated
    unit (pallet) count — PP has no pallet grain, so this cannot be derived."""

    pp_reference: str = Field(..., min_length=1, max_length=24)
    unit_count_expected: int = Field(..., ge=1)
```

- [ ] **Step 3.2: Reshape `TripCreateRequest`:**
  - **Remove** `client_organization_id` (derived from PP `accnum` per consignment now).
  - **Remove** `pp_reference` (Tim's singular field — superseded; his tests are updated in Task 6).
  - **Add** `trip_type: TripType = TripType.LOADED` (import from `app.db.models.enums`).
  - **Add** `consignments: list[TripConsignmentInput] = Field(default_factory=list)`.
  - **Change** `trailer_ids` to `Field(default_factory=list)` — no `min_length`.
  - **Extend** `validate_request` with (keep all existing checks):

```python
if self.trip_type == TripType.LOADED and not self.consignments:
    raise ValueError("a loaded trip requires at least one consignment (PP waybill)")
if self.trip_type == TripType.EMPTY_LEG and self.consignments:
    raise ValueError("an empty leg cannot carry consignments")
refs = [c.pp_reference for c in self.consignments]
if len(refs) != len(set(refs)):
    raise ValueError("duplicate pp_reference values in consignments")
```

- [ ] **Step 3.3: Extend the read shapes:**
  - `TripDetailResponse`: add `trip_type: TripType`, `consignments: list[ConsignmentRead] = []`, `warnings: list[str] = []` (warnings are creation-transient: populated by POST, always `[]` on GET).
  - `TripListItemResponse`: add `trip_type: TripType`.

- [ ] **Step 3.4: Write `tests/unit/test_trip_schemas.py`** — pure Pydantic, no DB:

```python
"""Unit tests for TripCreateRequest validation (trip creation redesign)."""
import uuid

import pytest
from pydantic import ValidationError

from app.db.models.enums import TripType
from app.schemas.trips import TripConsignmentInput, TripCreateRequest


def _payload(**overrides):
    base = dict(
        order_number="ORD-1",
        driver_id=uuid.uuid4(),
        horse_id=uuid.uuid4(),
        trailer_ids=[uuid.uuid4()],
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
        consignments=[{"pp_reference": "WAY001", "unit_count_expected": 4}],
    )
    base.update(overrides)
    return base


def test_loaded_without_consignments_rejected():
    with pytest.raises(ValidationError, match="at least one consignment"):
        TripCreateRequest(**_payload(consignments=[]))


def test_empty_leg_with_consignments_rejected():
    with pytest.raises(ValidationError, match="cannot carry consignments"):
        TripCreateRequest(**_payload(trip_type=TripType.EMPTY_LEG))


def test_empty_leg_without_consignments_valid():
    req = TripCreateRequest(**_payload(trip_type=TripType.EMPTY_LEG, consignments=[]))

    assert req.trip_type == TripType.EMPTY_LEG


def test_duplicate_pp_references_rejected():
    dup = [
        {"pp_reference": "WAY001", "unit_count_expected": 4},
        {"pp_reference": "WAY001", "unit_count_expected": 2},
    ]
    with pytest.raises(ValidationError, match="duplicate pp_reference"):
        TripCreateRequest(**_payload(consignments=dup))


def test_zero_trailers_valid():
    req = TripCreateRequest(**_payload(trailer_ids=[]))

    assert req.trailer_ids == []


def test_client_organization_id_removed():
    assert "client_organization_id" not in TripCreateRequest.model_fields


def test_pp_reference_field_removed():
    assert "pp_reference" not in TripCreateRequest.model_fields


def test_unit_count_must_be_positive():
    with pytest.raises(ValidationError):
        TripConsignmentInput(pp_reference="WAY001", unit_count_expected=0)
```

**Phase 1 check:** `cd backend && pytest tests/unit/test_hashing.py tests/unit/test_trip_schemas.py -q` — new tests green; expect *other* suites red until Phase 3 (services still reference removed fields — that's the next phases' job, don't chase them yet).

> **Suggested commit:** `feat(db): trip_type + org pp_account_number + nullable consignment client org; versioned lock hash; TripCreateRequest consignments[]`

---

## Phase 2 — PP integration layer (mock fixtures + manifest lookup)

### Task 4: Fixture library, not-found parity, `get_waybills_by_manifest`

**Files:**
- Modify: `backend/app/integrations/parcel_perfect.py`
- Test: `backend/tests/unit/test_pp_mock.py` (create)

- [ ] **Step 4.1: Add the three missing v28 fields to `PPWaybillDetails`** (they're in the real response; org resolution and manifest capture need them):

```python
# Customer account holding the booking — resolves the client Organization.
accnum: str = ""
custname: str = ""
# PP "last manifest number"; 0/absent = not manifested → normalised to None.
manifest: Optional[int] = None
```

Then in `ParcelPerfectClient._parse_waybill_response`, populate them from the raw `details` dict (`raw_details.get("accnum", "")`, `raw_details.get("custname", "")`, and `manifest = int(m) if (m := raw_details.get("manifest")) and int(m) > 0 else None`). Also add the three fields to `consignment_service._serialise_waybill`'s `details` dict (Task 5 touches that file anyway; do the serialise edit there if you prefer — just don't forget it).

- [ ] **Step 4.2: Add error + capability types** near the existing exceptions/top of file:

```python
class PPWaybillNotFoundError(Exception):
    """Raised when PP has no waybill for the given reference."""

    def __init__(self, waybill_number: str) -> None:
        self.waybill_number = waybill_number
        super().__init__(f"Waybill {waybill_number!r} not found in Parcel Perfect")


class PPUnsupportedError(Exception):
    """Raised when a capability doesn't exist on the real PP v28 API."""
```

In the **real** client's `get_single_waybill`, find where an empty/`errorcode != 0` result is currently handled and raise `PPWaybillNotFoundError(waybill_number)` for the not-found case (keep other errors as they are).

- [ ] **Step 4.3: Replace the single fixture with a keyed library.** Keep `MOCK_WAYBILL_RESPONSE` (Tim's tests import it) but build it via a factory and register it:

```python
def _mock_waybill(
    *,
    waybill: str,
    accnum: str,
    custname: str,
    manifest: Optional[int],
    parcel_count: int,
    contents: list[PPContents],
    dest_town: str,
    dest_person: str,
    weight_kg: float,
    declared_value: Optional[float] = None,
    poddate: str = "",
    failtype: Optional[str] = None,
) -> PPWaybillResponse:
    """Fixture factory — field shapes strictly follow the v28 getSingleWaybill spec."""
    return PPWaybillResponse(
        details=PPWaybillDetails(
            waybill=waybill,
            waydate="01.07.2026",
            pieces=parcel_count,
            duedate="03.07.2026",
            declared_value=declared_value,
            dest_address="1 Delivery Road",
            dest_town=dest_town,
            dest_person=dest_person,
            dest_contact="0210000001",
            orig_person="CGY Warehouse",
            orig_town="JOHANNESBURG",
            orig_address="1 Depot Street, Linbro Park",
            service="ONX",
            actual_weight_kg=weight_kg,
            freight_total=None,
            poddate=poddate,
            failtype=failtype,
            client_reference=f"REF-{waybill}",
            accnum=accnum,
            custname=custname,
            manifest=manifest,
        ),
        contents=contents,
        tracks=[
            PPTrack(trackno=f"{waybill}{n:04d}", parcelno=n, item=1)
            for n in range(1, parcel_count + 1)
        ],
        wayrefs=[],
    )


# accnum "MOCK01" maps to the seeded demo principal org; "UNMAP9" deliberately
# has no Organization row — it exercises the unmapped-client warning path.
MOCK_WAYBILLS: dict[str, PPWaybillResponse] = {
    w.details.waybill: w
    for w in [
        _mock_waybill(waybill="WAY001", accnum="MOCK01", custname="CGY Logistics",
                      manifest=69, parcel_count=5, dest_town="DURBAN",
                      dest_person="DC Receiving", weight_kg=620.0, declared_value=15000.0,
                      contents=[PPContents(item=1, description="Steel brackets", actmass=620.0, pieces=5)]),
        _mock_waybill(waybill="WAY002", accnum="MOCK01", custname="CGY Logistics",
                      manifest=69, parcel_count=14, dest_town="DURBAN",
                      dest_person="DC Receiving", weight_kg=210.5,
                      contents=[PPContents(item=1, description="Electronics", actmass=180.5, pieces=10),
                                PPContents(item=2, description="Cables", actmass=30.0, pieces=4)]),
        _mock_waybill(waybill="WAY003", accnum="MOCK01", custname="CGY Logistics",
                      manifest=69, parcel_count=1, dest_town="PINETOWN",
                      dest_person="Store 12", weight_kg=8.0,
                      contents=[PPContents(item=1, description="Documents", actmass=8.0, pieces=1)]),
        _mock_waybill(waybill="WAY004", accnum="UNMAP9", custname="Unmapped Client (Pty) Ltd",
                      manifest=70, parcel_count=3, dest_town="CAPE TOWN",
                      dest_person="Goods Inwards", weight_kg=95.0,
                      contents=[PPContents(item=1, description="Textiles", actmass=95.0, pieces=3)]),
        _mock_waybill(waybill="WAY005", accnum="MOCK01", custname="CGY Logistics",
                      manifest=70, parcel_count=2, dest_town="CAPE TOWN",
                      dest_person="Goods Inwards", weight_kg=1450.0, declared_value=80000.0,
                      contents=[PPContents(item=1, description="Machine parts", actmass=1450.0, pieces=2)]),
        _mock_waybill(waybill="WAYPOD1", accnum="MOCK01", custname="CGY Logistics",
                      manifest=None, parcel_count=2, dest_town="DURBAN",
                      dest_person="DC Receiving", weight_kg=44.0, poddate="10.07.2026",
                      contents=[PPContents(item=1, description="Spares", actmass=44.0, pieces=2)]),
        _mock_waybill(waybill="WAYFAIL1", accnum="MOCK01", custname="CGY Logistics",
                      manifest=None, parcel_count=1, dest_town="DURBAN",
                      dest_person="DC Receiving", weight_kg=12.0, failtype="Receiver not home",
                      contents=[PPContents(item=1, description="Samples", actmass=12.0, pieces=1)]),
    ]
}
# Back-compat: existing tests reference MOCKWAY001 / MOCK_WAYBILL_RESPONSE.
MOCK_WAYBILLS[MOCK_WAYBILL_RESPONSE.details.waybill] = MOCK_WAYBILL_RESPONSE
```

Also set `accnum="MOCK01"`, `custname="CGY Logistics"`, `manifest=69` on the existing `MOCK_WAYBILL_RESPONSE` literal (new dataclass fields need values there too).

- [ ] **Step 4.4: Rework `MockParcelPerfectClient` and add the capability seam:**

```python
class MockParcelPerfectClient:
    """Fixture-backed stub — no network. PP_USE_MOCK=True selects it via get_pp_client().

    Unknown references raise PPWaybillNotFoundError, matching the real client, so
    the fail-closed 422 path behaves identically in dev/CI and against live PP.
    """

    supports_manifest_lookup: bool = True

    async def get_single_waybill(self, waybill_number: str) -> PPWaybillResponse:
        try:
            return MOCK_WAYBILLS[waybill_number]
        except KeyError as exc:
            raise PPWaybillNotFoundError(waybill_number) from exc

    async def get_waybills_by_manifest(self, manifest_number: int) -> list[PPWaybillResponse]:
        """ASPIRATIONAL — PP v28 has no such endpoint (ask #1, July visit).
        Mock-only so the wizard can demo manifest-keyed trip creation."""
        return sorted(
            (w for w in MOCK_WAYBILLS.values() if w.details.manifest == manifest_number),
            key=lambda w: w.details.waybill,
        )
```

On the **real** `ParcelPerfectClient`, add:

```python
supports_manifest_lookup: bool = False

async def get_waybills_by_manifest(self, manifest_number: int) -> list[PPWaybillResponse]:
    raise PPUnsupportedError(
        "PP v28 exposes no manifest-contents endpoint — requested from PP (ask #1, July visit)"
    )
```

- [ ] **Step 4.5: Write `tests/unit/test_pp_mock.py`:**

```python
"""Unit tests for the PP mock fixture library and manifest lookup."""
import pytest

from app.integrations.parcel_perfect import (
    MOCK_WAYBILLS,
    MockParcelPerfectClient,
    ParcelPerfectClient,
    PPUnsupportedError,
    PPWaybillNotFoundError,
)


async def test_known_reference_returns_fixture():
    client = MockParcelPerfectClient()

    result = await client.get_single_waybill("WAY001")

    assert result.details.waybill == "WAY001"
    assert result.details.accnum == "MOCK01"


async def test_unknown_reference_raises_not_found():
    client = MockParcelPerfectClient()

    with pytest.raises(PPWaybillNotFoundError):
        await client.get_single_waybill("NOPE999")


async def test_manifest_lookup_groups_fixtures():
    client = MockParcelPerfectClient()

    result = await client.get_waybills_by_manifest(69)

    assert [w.details.waybill for w in result] == ["MOCKWAY001", "WAY001", "WAY002", "WAY003"]


async def test_manifest_lookup_unknown_number_returns_empty():
    client = MockParcelPerfectClient()

    assert await client.get_waybills_by_manifest(9999) == []


async def test_real_client_manifest_lookup_unsupported():
    client = ParcelPerfectClient()

    with pytest.raises(PPUnsupportedError):
        await client.get_waybills_by_manifest(69)


def test_capability_flags():
    assert MockParcelPerfectClient.supports_manifest_lookup is True
    assert ParcelPerfectClient.supports_manifest_lookup is False


def test_every_fixture_has_tracks_matching_pieces():
    for ref, w in MOCK_WAYBILLS.items():
        assert len(w.tracks) == w.details.pieces, ref
```

(If `ParcelPerfectClient()` requires config in `__init__`, instantiate with whatever its signature needs — check the merged constructor — or call the method on an instance built with dummy settings via monkeypatch.)

**Phase 2 check:** `cd backend && pytest tests/unit/test_pp_mock.py tests/unit/test_parcel_perfect_client.py -q` — both green (the second is Tim's existing suite; if the new dataclass fields break its fixtures, add the three fields to its literals).

> **Suggested commit:** `feat(integrations): PP mock fixture library, not-found parity, aspirational manifest lookup + capability flag`

---

## Phase 3 — Services and endpoints

### Task 5: Consignment sync — accnum resolution, unit count, manifest capture

**Files:**
- Modify: `backend/app/orchestration/consignment_service.py`
- Modify: `backend/app/tasks/parcel_perfect.py` (caller — signature change)
- Test: `backend/tests/unit/test_consignment_service.py` (extend Tim's suite)

- [ ] **Step 5.1: Change the signature and return type.** Replace caller-supplied `client_organization_id` with internal resolution; add `unit_count_expected`:

```python
@dataclass(frozen=True)
class ConsignmentSyncResult:
    consignment: Consignment
    warning: str | None  # e.g. unmapped PP account — surfaced, never fatal


async def fetch_and_sync_consignment(
    db: AsyncSession,
    pp_reference: str,
    *,
    trip_id: Optional[uuid.UUID] = None,
    unit_count_expected: Optional[int] = None,
    origin_precinct_id: Optional[uuid.UUID] = None,
    destination_precinct_id: Optional[uuid.UUID] = None,
) -> ConsignmentSyncResult:
```

- [ ] **Step 5.2: Resolve the client org from the waybill** (after the PP fetch, before the upsert):

```python
warning: str | None = None
client_org_id: Optional[uuid.UUID] = None
accnum = waybill.details.accnum
if accnum:
    org_result = await db.execute(
        select(Organization.id).where(Organization.pp_account_number == accnum)
    )
    client_org_id = org_result.scalar_one_or_none()
if client_org_id is None:
    warning = (
        f"PP account {accnum or 'unknown'!r} ({waybill.details.custname or 'no name'}) "
        f"has no matching organization — consignment {pp_reference!r} saved without a client org"
    )
    logger.warning(warning)
```

Import `Organization` from `app.db.models.organisations`.

- [ ] **Step 5.3: Rekey the idempotency lookup on `pp_reference` alone** (the old key included the caller-supplied client org, which no longer exists; PP waybill numbers are unique within a PP instance):

```python
existing_result = await db.execute(
    select(Consignment).where(Consignment.parcel_perfect_reference == pp_reference)
)
```

- [ ] **Step 5.4: Persist the new fields.** On insert, set `client_organization_id=client_org_id`, `unit_count_expected=unit_count_expected`, `pp_manifest_number=waybill.details.manifest`. On the update branch, always refresh `pp_raw_json`, `parcel_count_expected`, `pp_manifest_number`, and re-resolve `client_organization_id` when currently `None`; set `unit_count_expected` **only when the param is not None** (the Celery refresh poll must not blank a dispatcher-entered count). Keep the existing trip_id-only-if-none rule and parcel dedup logic. Return `ConsignmentSyncResult(consignment=consignment, warning=warning)`.

- [ ] **Step 5.5: If Task 4 didn't already, add `accnum`/`custname`/`manifest` to `_serialise_waybill`'s details dict** (they must land in `pp_raw_json` — WP7 hashes that snapshot).

- [ ] **Step 5.6: Update the Celery caller.** In `tasks/parcel_perfect.py`, find the `fetch_and_sync_consignment(...)` call in the refresh loop: drop the `client_organization_id=` argument, don't pass `unit_count_expected`, and unwrap the result (`result.consignment`). Log `result.warning` if set.

- [ ] **Step 5.7: Update Tim's `tests/unit/test_consignment_service.py`** to the new signature (remove `client_organization_id=` args; assert via `result.consignment`). Add:

```python
async def test_accnum_resolves_client_org(...):
    # seed/mock an Organization row with pp_account_number="MOCK01"
    # sync "WAY001" → result.consignment.client_organization_id == that org id
    # result.warning is None

async def test_unmapped_accnum_warns_and_saves_null_client(...):
    # sync "WAY004" (accnum UNMAP9, no org row)
    # → client_organization_id is None, result.warning mentions "UNMAP9"

async def test_unit_count_and_manifest_persisted(...):
    # sync "WAY001" with unit_count_expected=4
    # → consignment.unit_count_expected == 4, pp_manifest_number == 69

async def test_refresh_does_not_blank_unit_count(...):
    # sync with unit_count_expected=4, then sync again without the param
    # → unit_count_expected still 4
```

Follow the file's existing mock/DB pattern for these (it already fakes the PP client and session).

### Task 6: Trip service — consignment loop, empty legs, response assembly

**Files:**
- Modify: `backend/app/orchestration/trip_service.py`
- Modify: `backend/app/orchestration/resource_service.py` (`get_trip_detail`)
- Test: `backend/tests/unit/test_trip_service.py` (Tim's — update), `backend/tests/integration/test_trips.py`, `backend/tests/integration/test_trips_multistop.py`, `backend/tests/integration/test_trips_anchor.py`, `backend/tests/integration/test_blockchain_verify.py` (payload builders)

- [ ] **Step 6.1: Replace the merged `pp_reference` block** in `create_trip` (currently `if payload.pp_reference: ...`) with the loop (same position — after the first `db.flush()`, before the H0 event):

```python
# Sync every consignment from PP (loaded trips). Fail-closed and atomic: any PP
# error rolls back the whole trip — a trip whose cargo plan couldn't be pulled
# has no manifest, no linehaul, and no evidence value. Local import avoids a
# module-load cycle (trip_service → consignment_service → parcel_perfect).
consignment_results: list[ConsignmentSyncResult] = []
if payload.consignments:
    from app.orchestration.consignment_service import ConsignmentSyncResult, fetch_and_sync_consignment

    for entry in payload.consignments:
        try:
            consignment_results.append(
                await fetch_and_sync_consignment(
                    db,
                    pp_reference=entry.pp_reference,
                    trip_id=trip.id,
                    unit_count_expected=entry.unit_count_expected,
                    origin_precinct_id=trip.origin_precinct_id,
                    destination_precinct_id=trip.destination_precinct_id,
                )
            )
        except Exception as exc:
            logger.error("PP sync failed for pp_ref=%s: %s", entry.pp_reference, exc)
            raise PPSyncError(entry.pp_reference, str(exc)) from exc
```

Move the `PPSyncError` import to module level (the cycle concern is only `consignment_service`). Delete the old singular block entirely.

- [ ] **Step 6.2: Persist and hash `trip_type`.** Add `trip_type=payload.trip_type.value` to the `Trip(...)` constructor and drop `client_organization_id=payload.client_organization_id` (the field is gone; pass `client_organization_id=None`). Pass `trip_type=payload.trip_type.value` to **both** `compute_journey_lock_hash` and `compute_trip_canonical_payload` calls.

- [ ] **Step 6.3: Assemble the response** — add to the returned `TripDetailResponse`:

```python
trip_type=TripType(trip.trip_type),
consignments=[ConsignmentRead.model_validate(r.consignment) for r in consignment_results],
warnings=[r.warning for r in consignment_results if r.warning],
```

(Imports: `TripType` from enums, `ConsignmentRead` from `app.schemas.trips`.)

- [ ] **Step 6.4: `resource_service.get_trip_detail`** — add a consignments query (`select(Consignment).where(Consignment.trip_id == trip_id).order_by(Consignment.created_at)`) and include `trip_type=TripType(trip.trip_type)`, `consignments=[...]`, `warnings=[]` in its `TripDetailResponse`. Add `trip_type=TripType(trip.trip_type)` wherever `list_trips` builds `TripListItemResponse`.

- [ ] **Step 6.5: Update the test payload builders.** In each integration file's `_make_trip_payload`/`_single_leg_payload`/`_multi_stop_payload`: remove `client_organization_id`; add `"consignments": [{"pp_reference": "MOCKWAY001", "unit_count_expected": 2}]`. `PP_USE_MOCK` defaults true, so the fixture resolves without network. In Tim's `tests/unit/test_trip_service.py`, replace `pp_reference="..."` cases with the list shape and assert `PPSyncError` still raises on unknown refs (use `"NOPE999"`).

- [ ] **Step 6.6: New integration tests** (in `tests/integration/test_trips.py`, following its seeding pattern):

```python
async def test_create_trip_persists_consignments_and_parcels(...):
    # POST with consignments=[MOCKWAY001 (units 2), WAY001 (units 4)]
    # → 201; two Consignment rows with unit_count_expected 2 and 4;
    #   Parcel rows match each fixture's tracks; response.consignments has 2 entries

async def test_create_trip_unknown_waybill_rolls_back_everything(...):
    # POST with consignments=[{"pp_reference": "NOPE999", ...}]
    # → 422; no Trip, TripStop, Consignment, or HandshakeEvent rows exist after

async def test_create_trip_unmapped_accnum_returns_warning(...):
    # POST with WAY004 → 201; response.warnings non-empty, mentions "UNMAP9";
    #   consignment row has client_organization_id NULL

async def test_create_empty_leg_no_consignments_no_pp_call(...):
    # POST trip_type="empty_leg", consignments=[] → 201; zero Consignment rows;
    #   monkeypatch get_pp_client to raise if called (proves PP untouched)

async def test_create_trip_zero_trailers(...):
    # POST trailer_ids=[] → 201; no TripTrailer rows; journey_lock_hash present
```

### Task 7: Manifest service — empty-leg read side

**Files:**
- Modify: `backend/app/orchestration/manifest_service.py`
- Test: `backend/tests/integration/test_manifest.py` (extend)

- [ ] **Step 7.1: `get_linehaul_for_driver`** — after the trip ownership check, load horse + driver first, then branch before `_load_consignments_and_parcels`:

```python
if trip.trip_type == TripType.EMPTY_LEG.value:
    # Repositioning run: no cargo by definition — a defined zero, not a 404.
    return LinehaulResponse(
        trip_id=trip_id,
        vehicle_registration=horse.registration,
        vehicle_type=str(horse.vehicle_type),
        driver_full_name=driver.full_name,
        consolidated_unit_count=0,
        origin_scan_complete=False,
        pulled_at=trip.updated_at,
    )
```

- [ ] **Step 7.2: `get_manifest_for_dispatcher`** — same branch after the trip check:

```python
if trip.trip_type == TripType.EMPTY_LEG.value:
    return ManifestResponse(
        trip_id=trip_id, total_parcel_count=0, origin_scan_complete=False,
        consignments=[], pulled_at=trip.updated_at,
    )
```

(The dispatcher path currently discards the trip row — capture it: `trip = trip_result.scalar_one_or_none()`.) Loaded trips with zero consignments keep the existing 404 (legacy data only — the schema now prevents new ones).

- [ ] **Step 7.3: Tests** in `test_manifest.py` (reuse its seeding helpers): empty-leg trip → linehaul 200 with `consolidated_unit_count == 0`; dispatcher manifest 200 with `consignments == []`.

### Task 8: PP lookup endpoints + trips error mapping

**Files:**
- Create: `backend/app/schemas/pp.py`
- Create: `backend/app/orchestration/pp_lookup_service.py`
- Create: `backend/app/api/v1/endpoints/pp.py`
- Modify: `backend/app/main.py` (**shared — router registration, flag in PR**)
- Modify: `backend/app/api/v1/endpoints/trips.py`
- Test: `backend/tests/integration/test_pp_endpoints.py` (create)

- [ ] **Step 8.1: `schemas/pp.py`** — dispatcher-shaped summary; deliberately excludes receiver contact detail and raw PP JSON:

```python
"""Pydantic v2 schemas for the dispatcher-facing Parcel Perfect lookup endpoints."""
from typing import Optional

from pydantic import BaseModel


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


class PPCapabilities(BaseModel):
    manifest_lookup: bool
```

- [ ] **Step 8.2: `orchestration/pp_lookup_service.py`:**

```python
"""Wizard-time PP lookups. Layering: orchestration → integrations only."""
from app.integrations.parcel_perfect import PPWaybillResponse, get_pp_client
from app.schemas.pp import PPCapabilities, PPWaybillSummary


def _to_summary(w: PPWaybillResponse) -> PPWaybillSummary:
    d = w.details
    return PPWaybillSummary(
        waybill=d.waybill, account_number=d.accnum, customer_name=d.custname,
        parcel_count=d.pieces, weight_kg=d.actual_weight_kg,
        declared_value=d.declared_value, dest_town=d.dest_town,
        dest_person=d.dest_person, manifest_number=d.manifest,
        is_delivered=w.is_delivered, has_delivery_failure=w.has_delivery_failure,
    )


async def get_waybill_summary(waybill_number: str) -> PPWaybillSummary:
    return _to_summary(await get_pp_client().get_single_waybill(waybill_number))


async def get_manifest_summaries(manifest_number: int) -> list[PPWaybillSummary]:
    waybills = await get_pp_client().get_waybills_by_manifest(manifest_number)
    return [_to_summary(w) for w in waybills]


def get_capabilities() -> PPCapabilities:
    return PPCapabilities(manifest_lookup=get_pp_client().supports_manifest_lookup)
```

- [ ] **Step 8.3: `endpoints/pp.py`** — thin, dispatcher-auth, read-only:

```python
"""Dispatcher-facing Parcel Perfect lookup endpoints (wizard-time validation)."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from app.auth.dependencies import get_current_dispatcher
from app.integrations.parcel_perfect import PPUnsupportedError, PPWaybillNotFoundError
from app.orchestration import pp_lookup_service
from app.schemas.people import UserRead
from app.schemas.pp import PPCapabilities, PPWaybillSummary

router = APIRouter(prefix="/pp", tags=["parcel-perfect"])


@router.get("/capabilities", response_model=PPCapabilities, summary="PP client capabilities")
async def get_capabilities_endpoint(
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PPCapabilities:
    return pp_lookup_service.get_capabilities()


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


@router.get("/manifests/{manifest_number}", response_model=list[PPWaybillSummary],
            summary="List waybills on a PP manifest (mock-only capability)")
async def get_manifest_endpoint(
    manifest_number: int,
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[PPWaybillSummary]:
    try:
        return await pp_lookup_service.get_manifest_summaries(manifest_number)
    except PPUnsupportedError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
```

Register in `main.py` exactly the way the other routers are registered (copy the `trips` pattern, same API prefix).

- [ ] **Step 8.4: Trips endpoint error mapping** — in `create_trip_endpoint`, add before the `SQLAlchemyError` handler (imports from `app.blockchain.hedera`):

```python
except HederaTimeoutError as exc:
    raise HTTPException(
        status_code=http_status.HTTP_504_GATEWAY_TIMEOUT,
        detail="Blockchain anchoring timed out — the trip was not created. Please retry.",
    ) from exc
except HederaServiceError as exc:
    logger.error("Hedera anchoring failed during trip creation: %s", exc)
    raise HTTPException(
        status_code=http_status.HTTP_502_BAD_GATEWAY,
        detail="Blockchain anchoring is unavailable — the trip was not created. Please retry.",
    ) from exc
```

- [ ] **Step 8.5: `tests/integration/test_pp_endpoints.py`** (mirror the auth/db harness of `test_precincts.py`): capabilities → `{"manifest_lookup": true}` in mock mode; `GET /pp/waybills/WAY001` → 200 with `account_number == "MOCK01"` and no `dest_contact`-style keys beyond the schema; `GET /pp/waybills/NOPE999` → 404; `GET /pp/manifests/69` → 4 rows; 401 without a token (standard check).

- [ ] **Step 8.6: Seed** — in `backend/scripts/seed_demo.py`, set `pp_account_number="MOCK01"` on the seeded principal org (find the org insert; one kwarg).

**Phase 3 check:** `cd backend && pytest -q` — full suite green. This is the point where every pre-existing suite must pass again.

> **Suggested commit:** `feat(orchestration): consignments[] trip creation with accnum org resolution, empty legs, PP lookup endpoints, Hedera 504/502 mapping`

---

## Phase 4 — Dispatcher wizard

### Task 9: Shared types

**Files:**
- Modify: `frontend/shared/lib/types/trip.ts`
- Create: `frontend/shared/lib/types/pp.ts`

- [ ] **Step 9.1: `trip.ts`** — add to both the list-item and detail `Trip` shapes (match backend):

```typescript
export type TripType = 'loaded' | 'empty_leg'
// on the Trip interfaces:
trip_type: TripType
```

Add the creation payload types (exported for the wizard):

```typescript
export interface TripConsignmentInput {
  pp_reference: string
  unit_count_expected: number
}

export interface TripCreatePayload {
  order_number: string
  trip_type: TripType
  driver_id: string
  horse_id: string
  trailer_ids: string[]
  origin_precinct_id: string
  destination_precinct_id: string
  consignments: TripConsignmentInput[]
  planned_departure_at: string | null
  planned_arrival_at: string | null
}
```

- [ ] **Step 9.2: `pp.ts`** — mirror `schemas/pp.py`:

```typescript
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

export interface PPCapabilities {
  manifest_lookup: boolean
}
```

### Task 10: Wizard rebuild — Step 1, payload, review

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx`
- Create: `frontend/dispatcher/lib/hooks/usePpCapabilities.ts`

- [ ] **Step 10.1: `usePpCapabilities.ts`** (copy the shape of an existing small hook like `usePrecincts`):

```typescript
'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import type { PPCapabilities } from '@shared/lib/types/pp'

// Manifest lookup only exists on the mock PP client today (PP v28 has no such
// endpoint) — the wizard renders the manifest field only when the backend says so.
export function usePpCapabilities(): PPCapabilities {
  const [caps, setCaps] = useState<PPCapabilities>({ manifest_lookup: false })
  useEffect(() => {
    let cancelled = false
    api.get<PPCapabilities>('/api/v1/pp/capabilities')
      .then(c => { if (!cancelled) setCaps(c) })
      .catch(() => { /* degraded: hide the manifest field */ })
    return () => { cancelled = true }
  }, [])
  return caps
}
```

- [ ] **Step 10.2: Delete the dead state and UI** in `page.tsx`: `commodity`, `weightKg`, `unitCount`, `showReceiver`, `receiverName`, `receiverContact` — their `useState` lines, their Step 1/Step 3 form fields ("Cargo Details" card, receiver section), and their review rows/summary entries.

- [ ] **Step 10.3: New Step 1 state:**

```typescript
interface WaybillRow {
  reference: string
  unitCount: string           // input string; parsed on submit
  summary: PPWaybillSummary | null
  error: string | null        // 'not found' | lookup failure message
  loading: boolean
}

const [isEmptyLeg, setIsEmptyLeg]   = useState(false)
const [waybills, setWaybills]       = useState<WaybillRow[]>([{ reference: '', unitCount: '', summary: null, error: null, loading: false }])
const [manifestNo, setManifestNo]   = useState('')
const [manifestBusy, setManifestBusy] = useState(false)
const caps = usePpCapabilities()
```

Row lookup on blur, and manifest fetch (each row keeps dispatcher-entered unit counts editable):

```typescript
async function lookupRow(index: number) {
  const ref = waybills[index].reference.trim()
  if (!ref) return
  setWaybills(rows => rows.map((r, i) => i === index ? { ...r, loading: true, error: null } : r))
  try {
    const summary = await api.get<PPWaybillSummary>(`/api/v1/pp/waybills/${encodeURIComponent(ref)}`)
    setWaybills(rows => rows.map((r, i) => i === index ? { ...r, summary, loading: false } : r))
  } catch (err) {
    const msg = err instanceof ApiError && err.status === 404
      ? 'Waybill not found in Parcel Perfect'
      : 'Lookup failed — you can still submit; the reference is verified on create'
    setWaybills(rows => rows.map((r, i) => i === index ? { ...r, summary: null, error: msg, loading: false } : r))
  }
}

async function fetchManifest() {
  const n = parseInt(manifestNo, 10)
  if (isNaN(n)) return
  setManifestBusy(true)
  try {
    const summaries = await api.get<PPWaybillSummary[]>(`/api/v1/pp/manifests/${n}`)
    if (summaries.length > 0) {
      setWaybills(summaries.map(s => ({
        reference: s.waybill, unitCount: '', summary: s, error: null, loading: false,
      })))
    }
  } catch {
    notify({ kind: 'error', title: 'Manifest not found' })
  } finally {
    setManifestBusy(false)
  }
}
```

- [ ] **Step 10.4: Step 1 JSX** (replace the old Order/Cargo cards; reuse `FormCard`, `CardTitle`, `Lbl`, `inp`, `MiniField` already in the file):

```tsx
{step === 1 && (
  <>
    <FormCard>
      <CardTitle icon="file">Order</CardTitle>
      <Lbl>Order Number *</Lbl>
      <input value={orderNumber} onChange={e => setOrderNumber(e.target.value)}
             placeholder="e.g. FDX-JHB-DBN-8821" className={inp} />
      <label className="flex items-center gap-2 mt-4 cursor-pointer">
        <input type="checkbox" checked={isEmptyLeg}
               onChange={e => setIsEmptyLeg(e.target.checked)}
               className="w-4 h-4 accent-sec" />
        <span className="text-[13px] font-[600] text-on-surf">
          Empty leg (repositioning — no cargo)
        </span>
      </label>
    </FormCard>

    {!isEmptyLeg && (
      <FormCard>
        <CardTitle icon="box">Waybills (Parcel Perfect)</CardTitle>

        {caps.manifest_lookup && (
          <div className="flex gap-2 items-end mb-4 pb-4 border-b border-outline-v/20">
            <div className="flex-1">
              <Lbl>Fetch by manifest number</Lbl>
              <input value={manifestNo} onChange={e => setManifestNo(e.target.value)}
                     placeholder="e.g. 69" className={inp} />
            </div>
            <Button variant="secondary" onClick={fetchManifest} loading={manifestBusy}>
              Fetch waybills
            </Button>
          </div>
        )}

        {waybills.map((row, i) => (
          <div key={i} className="mb-4">
            <div className="flex gap-3">
              <div className="flex-[2]">
                <Lbl>PP waybill reference *</Lbl>
                <input value={row.reference}
                       onChange={e => setWaybills(rows => rows.map((r, j) => j === i ? { ...r, reference: e.target.value, summary: null, error: null } : r))}
                       onBlur={() => lookupRow(i)}
                       placeholder="e.g. WAY001" className={inp} />
              </div>
              <div className="flex-1">
                <Lbl>Expected units (pallets) *</Lbl>
                <input type="number" min="1" value={row.unitCount}
                       onChange={e => setWaybills(rows => rows.map((r, j) => j === i ? { ...r, unitCount: e.target.value } : r))}
                       placeholder="0" className={inp} />
              </div>
              {waybills.length > 1 && (
                <button type="button" className="text-err text-[12px] font-[600] self-end pb-2"
                        onClick={() => setWaybills(rows => rows.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
            {row.loading && <p className="text-[11px] text-on-surf-v mt-1">Checking Parcel Perfect…</p>}
            {row.error && <p className="text-[11px] text-err mt-1 font-[500]">{row.error}</p>}
            {row.summary && (
              <div className="rounded-lg bg-surf-low p-[10px_12px] border border-outline-v/20 mt-2 grid grid-cols-4 gap-x-4">
                <MiniField label="Customer" value={row.summary.customer_name} />
                <MiniField label="Parcels"  value={String(row.summary.parcel_count)} mono />
                <MiniField label="Weight"   value={row.summary.weight_kg != null ? `${row.summary.weight_kg} kg` : null} mono />
                <MiniField label="Dest"     value={row.summary.dest_town} />
              </div>
            )}
          </div>
        ))}

        <button type="button"
                className="text-[13px] font-[600] text-sec hover:opacity-75 transition-opacity"
                onClick={() => setWaybills(rows => [...rows, { reference: '', unitCount: '', summary: null, error: null, loading: false }])}>
          + Add waybill
        </button>
      </FormCard>
    )}
  </>
)}
```

- [ ] **Step 10.5: Validation + submit.** Step 1 validity becomes:

```typescript
const waybillsValid = isEmptyLeg || (
  waybills.length > 0 &&
  waybills.every(r => r.reference.trim() && parseInt(r.unitCount, 10) >= 1) &&
  new Set(waybills.map(r => r.reference.trim())).size === waybills.length
)
const stepValid = [true, !!(orderNumber && waybillsValid), /* step 2, 3 entries unchanged */ ...]
```

`handleSubmit` posts the typed payload (import `TripCreatePayload`, `Trip` from shared types):

```typescript
await api.post<Trip>('/api/v1/trips', {
  order_number: orderNumber,
  trip_type: isEmptyLeg ? 'empty_leg' : 'loaded',
  driver_id: driverId,
  horse_id: horseId,
  trailer_ids: trailerIds,
  origin_precinct_id: originId,
  destination_precinct_id: destId,
  consignments: isEmptyLeg ? [] : waybills.map(r => ({
    pp_reference: r.reference.trim(),
    unit_count_expected: parseInt(r.unitCount, 10),
  })),
  planned_departure_at: plannedDeparture ? new Date(plannedDeparture).toISOString() : null,
  planned_arrival_at: expectedArrival ? new Date(expectedArrival).toISOString() : null,
} satisfies TripCreatePayload)
```

Extend the catch: `422` → `notify({ kind: 'error', title: 'Parcel Perfect rejected a waybill — check the references' })`; `502/504` → `'Blockchain anchoring unavailable — trip was not created. Try again.'`; keep the 409/404 handlers.

- [ ] **Step 10.6: Review step.** Replace the "Order & Cargo" review card with an "Order & Waybills" card: order number row, `Empty leg` row when `isEmptyLeg`, else one row per waybill — `WAY001 · CGY Logistics · 5 parcels · 620 kg → Durban · 4 units` (from `row.summary` when present, else just ref + units), marked with a small "from Parcel Perfect" caption. Update the dark summary panel's `Cargo` line to `${waybills.length} waybill(s) · ${totalUnits} units` (or `Empty leg`), where `totalUnits` sums the parsed unit counts.

- [ ] **Step 10.7: Type-check and lint:** `cd frontend/dispatcher && npx tsc --noEmit && npm run lint` — clean. If the dispatcher has a test runner configured (check `package.json` scripts), run it.

> **Suggested commit:** `feat(dispatcher): wizard rebuild — waybill rows w/ PP validation, manifest fetch, empty-leg toggle; drop dead cargo/receiver fields`

---

## Phase 5 — Final verification (single gate)

- [ ] `cd backend && pytest` — entire suite green.
- [ ] `cd frontend/dispatcher && npx tsc --noEmit && npm run lint` — clean.
- [ ] Grep gates (all must return nothing):
  - `grep -rn "pp_reference" backend/app/schemas/trips.py` (field removed)
  - `grep -rn "client_organization_id" frontend/dispatcher/app` (wizard no longer sends it)
  - `grep -n "receiverName\|commodity\|weightKg" "frontend/dispatcher/app/(app)/trips/new/page.tsx"` (dead inputs gone)
  - `grep -rn "weight\|commodity\|dest_person" backend/app/schemas/trips.py | grep -i linehaul` (driver linehaul untouched by PP detail)
- [ ] Manual smoke (backend running, `PP_USE_MOCK=true`, dispatcher dev server):
  1. Create a loaded trip with `WAY001` + `WAY004` → 201, warning toast/notice for the unmapped account, trip detail shows 2 consignments.
  2. Create via manifest `69` → three rows auto-filled, enter unit counts, submit → 201.
  3. Create an empty leg → 201; driver linehaul endpoint for that trip returns `consolidated_unit_count: 0`.
  4. Submit an unknown ref `NOPE999` → 422 toast, no trip created.
- [ ] Spec-coverage pass: re-read the spec's Key Decisions table — each row maps to a landed change (PP-first ✓ T4–6/T10, consignments[] ✓ T3/T6, unit count ✓ T5, driver visibility ✓ T7 + grep gate, trailers ✓ T2/T3, client org ✓ T1/T5, Hedera fail-closed + 504/502 ✓ T8, PP fail-closed ✓ T6, mock strategy ✓ T4, empty legs ✓ T1a/T3/T6/T7/T10, Pulsit deferral ✓ no code touched).

**Out of scope for this plan (tracked elsewhere):** converting merged H2/H5 anchoring to fail-open (H1 plan's `anchor_subject_fail_open`), WP7 journey-lock v2, precinct management, PP polling reconciliation with WP2.
