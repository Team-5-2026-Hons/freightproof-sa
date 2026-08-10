# Trip Detail UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every phase card on the dispatcher trip detail page into the evidence record for that phase, with the disclosure mechanism chosen per phase.

**Architecture:** Tasks 1–4 build the artifact read path, which four later cards depend on. Tasks 5–13 are vertical slices, one card each: shared type → hook → component → wired into the page. Pure derivation logic goes in `lib/phase/` with unit tests; per-phase presentation goes in one focused component per card under `components/domain/`.

**Tech Stack:** FastAPI 0.115+ / Pydantic v2 / SQLAlchemy 2.0 async / pytest-asyncio. Next.js 15 App Router / React 19 / TypeScript 5.5 / Tailwind 3.4.

**Spec:** `docs/superpowers/specs/2026-07-30-trip-detail-ui-design.md` — read it before Task 1.

**Branch base:** `Phase-refactor` @ `b26ebbb`.

---

## Domain rules that must survive every task

These are not style preferences. Violating one is a defect even if tests pass.

1. **Never assume a plan length.** Not 6, not 7. A plan's length is data. A three-stop cross-dock has two `loading` phases, two `in_transit` legs, two `unloading` phases.
2. **Never key anything off a plan index or a phase type alone.** Use `phase_event_id`. The same phase type occurs more than once per trip.
3. **A completed phase with `anchor_status === 'failed'` must never render as an unqualified success.** It owes a receipt. Say so.
4. **The driver never sees an expected cargo count.** This work is dispatcher-only, so it cannot break the rule, but do not add anything to `frontend/shared/` that would let the driver PWA read one.
5. **Do not touch `frontend/driver-pwa/` or `frontend/shared/lib/types/exception.ts`.** Both belong to Tim's Stage 5. See the spec's *Cross-branch dependencies*.

---

## Reuse and simplicity rules

The existing dispatcher frontend is plain, readable React: small components, explicit props, no
abstraction for its own sake. New code must be indistinguishable from it. This section is as binding
as the domain rules above.

### Read before writing

Before creating any component, check whether one exists. `frontend/dispatcher/components/ui/` has 25
components and `components/domain/` has 7. Opening the directory takes ten seconds and has already
prevented three duplications in this plan.

### Reuse these

| Need | Use | Not |
|---|---|---|
| Status pill | `ui/Chip` — has a `pending` type already | a hand-rolled span |
| Loading state | `ui/Spinner` | a custom spinner |
| Full-page empty state | `ui/EmptyState` | an ad-hoc styled div |
| Label/value row | `ui/InfoRow` | another copy of the same flex row |
| Date / time text | `@shared/lib/utils/datetime` (Task 4) | a sixth local `fmtTs` |
| Buttons | `ui/Button`, `ui/IconButton` | a styled `<button>` |
| Forensic-only content | `blockchain/ForensicOnly` | an inline role check |
| Panel resize | `lib/hooks/useResizablePanel` + its `DETAIL_PANEL_*` constants | new drag logic |
| Class merging | `@shared/lib/utils/cn` | template-string concatenation |

**`ui/InfoRow` is a near-exact duplicate of the hand-rolled sidebar rows at `page.tsx:412-428`.**
Task 7 is already editing the adjacent Cargo block, so it swaps that loop for `InfoRow` too.

`ui/EmptyState` is `py-16` with `text-xl` — correct for the full-page "Trip not found" case that
`page.tsx:239` already uses it for, and wrong inside a 520px side panel. The manifest panel's
"nothing pulled yet" message stays a compact inline div. Reuse is a judgement, not a reflex.

### Do not reuse these

- **`ui/Modal`** — a titled dialog with a header bar. Wrong shape for a full-bleed image lightbox,
  and it is built on the legacy token family (below). Task 4's lightbox stays hand-rolled.
- **`ui/Drawer`** — zero consumers, legacy tokens, and the manifest panel is an inline column, not
  an overlay drawer.
- **`ui/SecHead`** — a full-width page section bar (`px-6 py-[10px] bg-surf-low`), not an inline
  label. The uppercase labels in the sidebar and detail cards are a different element.
- **`domain/EvidencePacket`** — zero consumers, legacy tokens. Despite the name it has nothing to do
  with evidence artifacts; it is a generic card wrapper. Do not extend it.

### Design tokens: shorthand only

`tailwind.config.ts:12` documents two families and says which to use:

- **Shorthand — use these.** `surf`, `surf-low`, `surf-lowest`, `surf-high`, `on-surf`, `on-surf-v`,
  `outline-v`, `sec`, `ok`, `err`, `warn`, `chain`, `shadow-level-2`.
- **Legacy, backwards-compat, "remove once all components use shorthand names."** `surface-*`,
  `primary-*`, `secondary-*`, `outline-variant`, `shadow-ambient`.

Both resolve, so a legacy class produces no visible error — it just quietly deepens the debt. Every
line this plan adds uses shorthand. If you find yourself copying a snippet out of `Modal.tsx` or
`EvidencePacket.tsx`, translate the tokens.

### When to split a file

Split when a component does two things, not when it gets long. Concretely:

- A per-phase detail card that renders more than ~4 sections, or exceeds roughly 120 lines, is doing
  presentation *and* composition — lift the sections out.
- Any block appearing in two components goes into its own component the second time, not the third.
  Task 8b exists because three cards wanted the same coordinates block.
- Derivation and arithmetic live in `lib/phase/*.ts` with unit tests, never inside a `.tsx`. `geo.ts`
  is the model: pure, exported, tested.

### Comment the why, never the what

Match the density of the surrounding code — `page.tsx` and `phase.ts` comment domain reasoning
(*why* a phase anchors to a stop, *why* the cache must not be read) and never narrate syntax. A
comment explaining that `useState` holds state is noise; one explaining why null is not zero is the
point.

---

## File map

**Backend — create**
- `backend/tests/integration/test_trip_artifacts.py` — list endpoint coverage

**Backend — modify**
- `backend/app/storage/supabase_storage.py` — add `create_signed_url`
- `backend/app/core/config.py` — add `EVIDENCE_SIGNED_URL_TTL_SECONDS` *(shared file)*
- `backend/app/orchestration/artifact_service.py` — add `list_artifacts_for_trip`
- `backend/app/schemas/evidence.py` — add `EvidenceArtifactWithUrl`
- `backend/app/api/v1/endpoints/artifacts.py` — add trip-scoped router
- `backend/app/main.py` — register it *(shared file)*
- `backend/tests/unit/test_supabase_storage.py` — signed-URL cases

**Frontend — create**
- `frontend/shared/lib/utils/datetime.ts` — `fmtDateTime` / `fmtTime` / `fmtFull`
- `frontend/shared/lib/types/evidence.ts` → add `EvidenceArtifactWithUrl` *(additive, collision-safe)*
- `frontend/dispatcher/lib/hooks/useTripArtifacts.ts`
- `frontend/dispatcher/lib/hooks/useManifest.ts`
- `frontend/dispatcher/lib/phase/geo.ts` + `geo.test.ts`

Reusable pieces, each with one job and more than one consumer:

| File | Renders | Consumed by |
|---|---|---|
| `domain/PhaseDetailFields.tsx` | `Section`, `Field`, `CopyField`, `CoordFix` | every detail card |
| `domain/PhaseLocationSection.tsx` | both GPS fixes, separation, geofence verdict | activation, departure, confirmation |
| `domain/PhaseAnchorSection.tsx` | anchor status + receipt-owed warning | departure, confirmation |
| `domain/ReconciliationRows.tsx` | destination vs visual count + verdict | unloading panel, confirmation |
| `domain/EvidencePhoto.tsx` | thumbnail → lightbox | activation, departure, confirmation |
| `domain/EvidenceDocument.tsx` | document row + open link | confirmation |

Per-phase cards, thin by the time the shared pieces exist:

- `frontend/dispatcher/components/domain/ActivationDetail.tsx`
- `frontend/dispatcher/components/domain/DepartureDetail.tsx`
- `frontend/dispatcher/components/domain/ConfirmationDetail.tsx`
- `frontend/dispatcher/components/domain/InTransitTimeline.tsx`
- `frontend/dispatcher/components/domain/ManifestPanel.tsx`

**Frontend — modify**
- `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`
- `frontend/dispatcher/components/domain/TripCreatedDetail.tsx`

`lib/phase/derive.ts` is **not** modified. Per-leg in-transit rendering falls out of the existing
per-phase map, so no new derivation is needed — see Task 12.

---

## Task 1: Signed-URL storage function

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/storage/supabase_storage.py`
- Test: `backend/tests/unit/test_supabase_storage.py`

- [ ] **Step 1: Add the TTL setting**

In `backend/app/core/config.py`, alongside the other Supabase fields:

```python
    # Evidence images are fetched by the dispatcher's browser straight from Storage via a
    # short-lived signed URL. Kept deliberately short: for its lifetime the URL is a bearer
    # capability that carries no further auth check.
    EVIDENCE_SIGNED_URL_TTL_SECONDS: int = 300
```

**This is a shared file.** Flag it in TASK COMPLETE. No `.env` key is required — the field has a default.

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/unit/test_supabase_storage.py`:

```python
@pytest.mark.asyncio
async def test_create_signed_url_returns_url_for_ttl(monkeypatch):
    captured: dict = {}

    class FakeStorageBucket:
        def create_signed_url(self, path, expires_in):
            captured["path"] = path
            captured["expires_in"] = expires_in
            return {"signedURL": f"https://storage.test/{path}?token=abc"}

    class FakeStorage:
        def from_(self, bucket):
            assert bucket == "evidence-artifacts"
            return FakeStorageBucket()

    class FakeSupabaseClient:
        storage = FakeStorage()

    monkeypatch.setattr("app.storage.supabase_storage._get_client", lambda: FakeSupabaseClient())

    url = await create_signed_url(
        s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1", ttl_seconds=300,
    )

    assert url == "https://storage.test/trip-1/artifact-1?token=abc"
    assert captured["path"] == "trip-1/artifact-1"
    assert captured["expires_in"] == 300


@pytest.mark.asyncio
async def test_create_signed_url_returns_none_when_storage_omits_url(monkeypatch):
    """A missing object yields a response with no signedURL. That degrades one artifact
    to metadata-only — it must not raise and abort the whole list."""
    class FakeStorageBucket:
        def create_signed_url(self, path, expires_in):
            return {"error": "Object not found"}

    class FakeStorage:
        def from_(self, bucket):
            return FakeStorageBucket()

    class FakeSupabaseClient:
        storage = FakeStorage()

    monkeypatch.setattr("app.storage.supabase_storage._get_client", lambda: FakeSupabaseClient())

    url = await create_signed_url(
        s3_bucket="evidence-artifacts", s3_key="trip-1/missing", ttl_seconds=300,
    )

    assert url is None
```

Update the import at the top of the file:

```python
from app.storage.supabase_storage import create_signed_url, upload_evidence_file
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_supabase_storage.py -v`
Expected: FAIL — `ImportError: cannot import name 'create_signed_url'`

- [ ] **Step 4: Implement it**

Add to `backend/app/storage/supabase_storage.py`:

```python
async def create_signed_url(*, s3_bucket: str, s3_key: str, ttl_seconds: int) -> str | None:
    """Mint a time-limited read URL for one stored object.

    Returns None when Storage declines to sign (missing object, storage error) rather than
    raising: the caller lists many artifacts and one unreadable object must degrade that row
    to metadata-only, not fail the request.
    """
    client = _get_client()
    response = client.storage.from_(s3_bucket).create_signed_url(s3_key, expires_in=ttl_seconds)

    signed = response.get("signedURL") if isinstance(response, dict) else None
    if not signed:
        logger.warning("Storage declined to sign %s/%s", s3_bucket, s3_key)
        return None
    return signed
```

If the module has no logger yet, add near the imports:

```python
import logging

logger = logging.getLogger(__name__)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_supabase_storage.py -v`
Expected: PASS, 3 tests

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/config.py backend/app/storage/supabase_storage.py backend/tests/unit/test_supabase_storage.py
git commit -m "feat(storage): short-lived signed URLs for evidence artifact reads"
```

---

## Task 2: Artifact list service and schema

**Files:**
- Modify: `backend/app/schemas/evidence.py`
- Modify: `backend/app/orchestration/artifact_service.py`
- Test: `backend/tests/integration/test_trip_artifacts.py` (created in Task 3; the service is covered through the endpoint)

- [ ] **Step 1: Add the read schema**

Append to `backend/app/schemas/evidence.py`:

```python
class EvidenceArtifactWithUrl(EvidenceArtifactRead):
    """Dispatcher read shape: metadata plus a short-lived signed URL.

    A subclass rather than a field on EvidenceArtifactRead, because that schema is the
    driver PWA's POST response and the driver has no business receiving read URLs.

    signed_url is None when Storage declined to sign — the artifact is still evidence and
    its hash still stands, so the row is returned with the image unavailable.
    """

    signed_url: Optional[str] = None
```

- [ ] **Step 2: Add the service function**

Append to `backend/app/orchestration/artifact_service.py`:

```python
async def list_artifacts_for_trip(
    db: AsyncSession, trip_id: uuid.UUID, *, operator_organization_id: uuid.UUID,
) -> list[EvidenceArtifactWithUrl]:
    """Every artifact on one trip, each with a freshly minted signed URL.

    Tenancy is enforced in the trip lookup, mirroring get_manifest_for_dispatcher: a trip
    belonging to another operator is indistinguishable from one that does not exist.
    """
    trip_result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == operator_organization_id)
    )
    if trip_result.scalar_one_or_none() is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    artifacts_result = await db.execute(
        select(EvidenceArtifact)
        .where(EvidenceArtifact.trip_id == trip_id)
        .order_by(EvidenceArtifact.captured_at)
    )

    out: list[EvidenceArtifactWithUrl] = []
    for artifact in artifacts_result.scalars().all():
        signed_url = await create_signed_url(
            s3_bucket=artifact.s3_bucket,
            s3_key=artifact.s3_key,
            ttl_seconds=settings.EVIDENCE_SIGNED_URL_TTL_SECONDS,
        )
        out.append(EvidenceArtifactWithUrl.model_validate(artifact, update={"signed_url": signed_url}))
    return out
```

Update the imports at the top of the same file:

```python
from app.core.config import settings
from app.schemas.evidence import EvidenceArtifactRead, EvidenceArtifactWithUrl
from app.storage.supabase_storage import create_signed_url, upload_evidence_file
```

- [ ] **Step 3: Verify nothing regressed**

Run: `cd backend && pytest tests/integration/test_artifacts.py tests/unit -q`
Expected: PASS — the upload path is untouched.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/evidence.py backend/app/orchestration/artifact_service.py
git commit -m "feat(storage): list a trip's artifacts with signed read URLs"
```

---

## Task 3: GET /trips/{trip_id}/artifacts

**Files:**
- Modify: `backend/app/api/v1/endpoints/artifacts.py`
- Modify: `backend/app/main.py` *(shared file)*
- Test: `backend/tests/integration/test_trip_artifacts.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/integration/test_trip_artifacts.py`:

```python
"""Integration tests for GET /api/v1/trips/{trip_id}/artifacts (dispatcher evidence list)."""

import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.db.models.enums import ArtifactType, IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def stub_signed_urls(monkeypatch):
    """Storage is out of scope for endpoint tests — Task 1 covers signing itself."""
    async def _fake(*, s3_bucket, s3_key, ttl_seconds):
        return f"https://storage.test/{s3_key}?ttl={ttl_seconds}"
    monkeypatch.setattr("app.orchestration.artifact_service.create_signed_url", _fake)


@pytest_asyncio.fixture
async def seed_trip_with_artifacts(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-TA", order_number="ORD-TA",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    seal_photo = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip.id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip.id}/seal", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg",
        captured_by_driver_id=driver.id, captured_at=datetime(2026, 7, 30, 8, 0, tzinfo=UTC),
    )
    pod = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip.id, artifact_type=ArtifactType.DOCUMENT,
        s3_key=f"{trip.id}/pod", s3_bucket="evidence-artifacts",
        file_hash="b" * 64, mime_type="application/pdf",
        captured_by_driver_id=driver.id, captured_at=datetime(2026, 7, 30, 14, 0, tzinfo=UTC),
    )
    db_session.add_all([seal_photo, pod])
    await db_session.flush()
    return trip, user, org, seal_photo, pod


@pytest.mark.asyncio
async def test_list_artifacts_returns_signed_urls_in_capture_order(client: AsyncClient, seed_trip_with_artifacts):
    trip, user, org, seal_photo, pod = seed_trip_with_artifacts
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    response = await client.get(f"/api/v1/trips/{trip.id}/artifacts", headers=auth_header(token))

    assert response.status_code == 200
    body = response.json()
    assert [a["id"] for a in body] == [str(seal_photo.id), str(pod.id)]
    assert body[0]["signed_url"] == f"https://storage.test/{trip.id}/seal?ttl=300"
    assert body[0]["file_hash"] == "a" * 64


@pytest.mark.asyncio
async def test_list_artifacts_requires_auth(client: AsyncClient, seed_trip_with_artifacts):
    trip, *_ = seed_trip_with_artifacts

    response = await client.get(f"/api/v1/trips/{trip.id}/artifacts")

    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_list_artifacts_404s_for_unknown_trip(client: AsyncClient, seed_trip_with_artifacts):
    _, user, org, *_ = seed_trip_with_artifacts
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    response = await client.get(f"/api/v1/trips/{uuid.uuid4()}/artifacts", headers=auth_header(token))

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_artifacts_404s_across_organisations(client: AsyncClient, db_session, seed_trip_with_artifacts):
    """Another operator's trip must be indistinguishable from a nonexistent one."""
    trip, *_ = seed_trip_with_artifacts
    other_org = Organization(id=uuid.uuid4(), name="Other", org_type=OrganizationType.OPERATOR)
    db_session.add(other_org)
    await db_session.flush()
    other_user = User(id=uuid.uuid4(), organization_id=other_org.id, email="o@test.co.za", full_name="O")
    db_session.add(other_user)
    await db_session.flush()
    token = make_token(sub=str(other_user.id), role="dispatcher", org_id=str(other_org.id))

    response = await client.get(f"/api/v1/trips/{trip.id}/artifacts", headers=auth_header(token))

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_artifacts_rejects_a_driver(client: AsyncClient, seed_trip_with_artifacts):
    """Drivers must never enumerate a trip's evidence."""
    trip, *_ = seed_trip_with_artifacts
    token = make_token(sub=str(uuid.uuid4()), role="driver")

    response = await client.get(f"/api/v1/trips/{trip.id}/artifacts", headers=auth_header(token))

    assert response.status_code in (401, 403)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_trip_artifacts.py -v`
Expected: FAIL — all 404, the route does not exist.

- [ ] **Step 3: Add the endpoint**

In `backend/app/api/v1/endpoints/artifacts.py`, add below the existing router and its endpoint:

```python
# Trip-scoped read router. Separate from the /artifacts upload router because the prefix
# differs and the auth differs — upload is driver-only, listing is dispatcher-only.
# Follows the pattern manifest.py sets for trip-scoped routes.
trip_artifacts_router = APIRouter(prefix="/trips/{trip_id}/artifacts", tags=["artifacts"])


@trip_artifacts_router.get("", response_model=list[EvidenceArtifactWithUrl])
async def list_trip_artifacts_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_dispatcher: UserRead = Depends(get_current_dispatcher),
) -> list[EvidenceArtifactWithUrl]:
    try:
        return await list_artifacts_for_trip(
            db, trip_id, operator_organization_id=current_dispatcher.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
```

Extend the imports at the top of the file:

```python
from app.auth.dependencies import get_current_dispatcher, get_current_driver
from app.orchestration.artifact_service import (
    MAX_FILE_SIZE_BYTES, create_artifact, list_artifacts_for_trip,
)
from app.schemas.evidence import EvidenceArtifactRead, EvidenceArtifactWithUrl
from app.schemas.people import DriverRead, UserRead
```

`UserRead` is defined at `backend/app/schemas/people.py:35` and is the annotation `trips.py:46` already uses for `get_current_dispatcher`.

- [ ] **Step 4: Register the router**

In `backend/app/main.py`, import `trip_artifacts_router` alongside the existing `artifacts_router` and add:

```python
app.include_router(trip_artifacts_router, prefix="/api/v1")
```

**This is a shared file.** Flag it in TASK COMPLETE.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_trip_artifacts.py -v`
Expected: PASS, 5 tests

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && pytest`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/v1/endpoints/artifacts.py backend/app/main.py backend/tests/integration/test_trip_artifacts.py
git commit -m "feat(api): dispatcher endpoint listing a trip's evidence artifacts"
```

---

## Task 4: Frontend artifact plumbing

**Files:**
- Create: `frontend/shared/lib/utils/datetime.ts`
- Modify: `frontend/shared/lib/types/evidence.ts`
- Create: `frontend/dispatcher/lib/hooks/useTripArtifacts.ts`
- Create: `frontend/dispatcher/components/domain/EvidencePhoto.tsx`
- Create: `frontend/dispatcher/components/domain/EvidenceDocument.tsx`

- [ ] **Step 1: Extract the date formatters**

Five files already define a private `fmtTs` / `fmtDate` / `fmt` with the same `en-ZA` options:
`app/(app)/trips/[id]/page.tsx`, `app/(app)/exceptions/page.tsx`,
`app/(app)/exceptions/[id]/page.tsx`, `app/(app)/trips/new/page.tsx`,
`components/domain/TripCreatedDetail.tsx`. This plan adds four more consumers, so the formatter goes
somewhere shared before the first one is written.

Create `frontend/shared/lib/utils/datetime.ts`:

```ts
// Date and time formatting for the dispatcher UI. One locale, one set of option shapes.
//
// Extracted because five files had grown a private copy of the same three-line function,
// which is how two of them ended up showing a different format for the same field.

const LOCALE = 'en-ZA'

/** Date and time, e.g. "30 Jul, 14:05". The default for timeline events. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(LOCALE, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** Time only, e.g. "14:05". For events already grouped under a date. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

/** Full date and time including the year — for records, not for timelines. */
export function fmtFull(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
```

All three take `null | undefined` and return an em-dash, because every caller was writing that guard
itself.

**New code in this plan uses these three and defines no local formatter.** Migrating the five
existing files is deliberately out of scope — it would touch four pages this work has no other reason
to open. Note it as a follow-up in TASK COMPLETE.

Exception: `page.tsx`'s existing local `fmtTs` stays for now; Task 5 and Task 7 already modify that
file for other reasons and swapping its formatter would widen those diffs for no behavioural gain.

- [ ] **Step 2: Add the shared type**

Append to `frontend/shared/lib/types/evidence.ts`:

```ts
// Dispatcher read shape — metadata plus a short-lived signed Storage URL.
// Mirrors backend EvidenceArtifactWithUrl. `signed_url` is null when Storage declined to
// sign: the artifact is still evidence and its hash still stands, so render the record
// with the image unavailable rather than hiding it.
export interface EvidenceArtifactWithUrl extends EvidenceArtifact {
  signed_url: string | null
}
```

This is additive — no existing shape changes — so it is safe to land while Tim is on Stage 5.

- [ ] **Step 3: Add the hook**

Create `frontend/dispatcher/lib/hooks/useTripArtifacts.ts`:

```ts
'use client'

import { useMemo } from 'react'
import { api } from '@/lib/api/client'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { useAsyncData } from './useAsyncData'

export interface UseTripArtifactsResult {
  artifacts: EvidenceArtifactWithUrl[]
  // Lookup by artifact id, because that is how phases reference their evidence:
  // PhaseDescriptor carries seal_photo_artifact_id and four siblings, and the list
  // itself carries no phase attribution.
  byId: Map<string, EvidenceArtifactWithUrl>
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useTripArtifacts(tripId: string): UseTripArtifactsResult {
  const { data, isLoading, error, refetch } = useAsyncData<EvidenceArtifactWithUrl[]>(
    () => api.get<EvidenceArtifactWithUrl[]>(`/api/v1/trips/${tripId}/artifacts`),
    [],
  )

  const byId = useMemo(
    () => new Map(data.map(a => [a.id as string, a])),
    [data],
  )

  return { artifacts: data, byId, isLoading, error, refetch }
}
```

- [ ] **Step 4: Add the photo component**

Create `frontend/dispatcher/components/domain/EvidencePhoto.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Ic } from '@/components/ui/Ic'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

interface Props {
  label: string
  artifact: EvidenceArtifactWithUrl | undefined
}

/**
 * One captured photo: thumbnail expanding to a lightbox.
 *
 * Three distinct states, deliberately all visible rather than collapsed into one:
 *   no artifact      — nothing was captured at this step
 *   no signed_url    — evidence exists, the image could not be served
 *   both present     — the photo
 * Conflating the middle case with the first would hide a storage failure behind
 * "nothing was captured", which on an evidence platform is the wrong lie.
 */
export function EvidencePhoto({ label, artifact }: Props) {
  const [isOpen, setIsOpen] = useState(false)

  if (!artifact) {
    return (
      <div>
        <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
        <div className="text-[12px] text-on-surf-v">Not captured</div>
      </div>
    )
  }

  if (!artifact.signed_url) {
    return (
      <div>
        <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
        <div className="flex items-center gap-[5px] text-[12px] text-warn">
          <Ic n="warn" s={12} className="text-warn" />
          Recorded, image unavailable
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[3px]">{label}</div>
      <button
        onClick={() => setIsOpen(true)}
        className="block rounded-md overflow-hidden border border-outline-v/30 hover:border-outline-v transition-colors"
      >
        {/* Plain <img>: the signed URL is an external host with a short TTL, which
            next/image's optimiser cannot cache or revalidate usefully. */}
        <img
          src={artifact.signed_url}
          alt={label}
          className="w-[96px] h-[96px] object-cover"
        />
      </button>

      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-zoom-out"
        >
          <img
            src={artifact.signed_url}
            alt={label}
            className="max-w-full max-h-full object-contain rounded-md"
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add the document component**

Create `frontend/dispatcher/components/domain/EvidenceDocument.tsx`:

```tsx
'use client'

import { Ic } from '@/components/ui/Ic'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

interface Props {
  label: string
  artifact: EvidenceArtifactWithUrl | undefined
}

export function EvidenceDocument({ label, artifact }: Props) {
  if (!artifact) {
    return (
      <div>
        <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
        <div className="text-[12px] text-on-surf-v">Not captured</div>
      </div>
    )
  }

  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[3px]">{label}</div>
      <div className="flex items-center gap-[8px]">
        <Ic n="file" s={14} className="text-on-surf-v" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-[500] text-on-surf truncate">{artifact.mime_type}</div>
          <div className="text-[10px] text-on-surf-v tabular-nums">{fmtDateTime(artifact.captured_at)}</div>
        </div>
        {artifact.signed_url ? (
          <a
            href={artifact.signed_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center rounded px-[6px] py-[2px] text-[9px] font-[600] bg-surf-high text-on-surf-v border border-outline-v/30 hover:bg-outline-v/20 transition-colors"
          >
            Open ↗
          </a>
        ) : (
          <span className="shrink-0 text-[10px] text-warn">Unavailable</span>
        )}
      </div>
    </div>
  )
}
```

`Ic`'s full glyph set is: `home plus file clock bars warn check lock truck user cam box hex shield sat siren back chev map eye dl filter search gear`. There is no `doc`, hence `file`. Never invent a glyph name — an unknown `n` renders nothing and fails silently.

- [ ] **Step 6: Typecheck**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors. `node_modules` must be installed first — an unresolved-module error is not a pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/lib/utils/datetime.ts frontend/shared/lib/types/evidence.ts frontend/dispatcher/lib/hooks/useTripArtifacts.ts frontend/dispatcher/components/domain/EvidencePhoto.tsx frontend/dispatcher/components/domain/EvidenceDocument.tsx
git commit -m "feat(dispatcher): artifact hook and evidence photo/document components"
```

---

## Task 5: Status pill replaces the em-dash

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx:159-169, 342-346, 372-378`

- [ ] **Step 1: Give TimelineEvent a status pill slot**

In the `TimelineEventProps` interface, add:

```ts
  statusPill?: React.ReactNode
```

In the header row of `TimelineEvent` (currently `page.tsx:159-169`), replace the label div with:

```tsx
          <div className="flex items-start justify-between gap-3 mb-[5px]">
            <div className="flex items-center gap-[8px] min-w-0">
              <div className={`text-[15px] font-[700] leading-snug ${nodeType === 'pending' ? 'text-on-surf-v' : 'text-on-surf'}`}>
                {label}
              </div>
              {statusPill}
            </div>
```

Add `statusPill` to the destructured parameter list.

- [ ] **Step 2: Pass the bare phase name and a Chip**

Replace the `label={...}` expression at `page.tsx:372-378` with:

```tsx
                  label={name}
                  statusPill={
                    item.nodeType === 'active'  ? <Chip type="transit" label="In progress" /> :
                    item.nodeType === 'pending' ? <Chip type="pending" label="Pending" /> :
                    item.nodeType === 'warn'    ? <Chip type="exception" label="Exception" /> :
                    undefined
                  }
```

A completed phase gets no pill — the checkmark node already says so, and a "Complete" chip on every finished row is noise.

`Chip` is already imported at `page.tsx:6` and already has a `pending` type. No new variants.

- [ ] **Step 3: Stop printing the status twice**

Replace the `meta` expression at `page.tsx:342-346` with:

```tsx
            // Status now lives in the pill, so meta carries the stop only — leaving the
            // status word here printed it twice.
            const meta = stopLabel
```

- [ ] **Step 4: Verify in the browser**

Run: `cd frontend/dispatcher && npm run dev`, open the seeded cross-dock trip.
Expected: pending rows read `Activation` with a grey `Pending` pill beside it, no em-dash, and the stop shown once.

- [ ] **Step 5: Commit**

```bash
git add "frontend/dispatcher/app/(app)/trips/[id]/page.tsx"
git commit -m "refactor(dispatcher): phase status as a chip rather than an em-dash suffix"
```

---

## Task 6: Extract the shared field primitives

**Files:**
- Create: `frontend/dispatcher/components/domain/PhaseDetailFields.tsx`
- Modify: `frontend/dispatcher/components/domain/TripCreatedDetail.tsx:7-74`

`Section`, `Field` and `CopyField` currently live unexported inside `TripCreatedDetail.tsx`, whose own comment says they "establish the pattern for future per-phase detail components". Four more components need them, so they move out before the first one is written.

- [ ] **Step 1: Create the shared module**

Create `frontend/dispatcher/components/domain/PhaseDetailFields.tsx` containing `Section`, `Field` and `CopyField` moved verbatim from `TripCreatedDetail.tsx:10-74`, each with `export` added, plus `'use client'` at the top (CopyField uses `useState`) and the import `import { useState } from 'react'`.

Add one new primitive for the coordinate pairs that Tasks 8, 11 and 13 all need:

```tsx
/**
 * A GPS fix with its distance from the expected geofence.
 *
 * `offsetMetres` is signed: negative means inside the fence by that many metres, positive
 * means outside by that many. Null means the offset could not be computed (no fix, or no
 * precinct coordinates) — which is different from an offset of zero and must not render
 * as "on the boundary".
 */
export function CoordFix({
  label, lat, lng, offsetMetres,
}: {
  label: string
  lat: number | null
  lng: number | null
  offsetMetres: number | null
}) {
  if (lat === null || lng === null) {
    return <Field label={label} value="No fix recorded" />
  }

  const isOutside = offsetMetres !== null && offsetMetres > 0

  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
      <div className="font-mono text-[12px] tracking-[0.04em] text-on-surf tabular-nums">
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </div>
      {offsetMetres !== null && (
        <div className={`text-[10px] tabular-nums ${isOutside ? 'text-warn' : 'text-ok'}`}>
          {isOutside
            ? `${Math.round(offsetMetres)} m outside geofence`
            : `${Math.round(Math.abs(offsetMetres))} m inside geofence`}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update TripCreatedDetail**

Delete `Section`, `Field` and `CopyField` from `TripCreatedDetail.tsx` and import them:

```tsx
import { CopyField, Field, Section } from './PhaseDetailFields'
```

`useState` is no longer used in `TripCreatedDetail.tsx` — remove that import too.

- [ ] **Step 3: Typecheck and eyeball**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors. Open a trip and expand Trip Created — it must look byte-for-byte as it did.

- [ ] **Step 4: Commit**

```bash
git add frontend/dispatcher/components/domain/PhaseDetailFields.tsx frontend/dispatcher/components/domain/TripCreatedDetail.tsx
git commit -m "refactor(dispatcher): extract phase-detail field primitives for reuse"
```

---

## Task 7: Trip Creation card — consignments

**Files:**
- Modify: `frontend/dispatcher/components/domain/TripCreatedDetail.tsx`
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx:467-478` (sidebar Cargo block)

- [ ] **Step 1: Add the consignments section**

In `TripCreatedDetail.tsx`, insert this above the `Blockchain` section:

```tsx
      {/* Consignments — what was committed to this truck at creation. This belongs on the
          creation event rather than in the sidebar because it describes the state that was
          hashed into the journey lock, not current state. */}
      {trip.consignments.length > 0 && (
        <div className="py-3">
          <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[6px]">
            Consignments ({trip.consignments.length})
          </div>
          <div className="divide-y divide-outline-v/15">
            {trip.consignments.map(c => (
              <div key={c.id} className="py-[7px] first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[12px] font-[600] tracking-[0.04em] text-on-surf">
                    {c.parcel_perfect_reference}
                  </span>
                  <span className="text-[11px] text-on-surf-v tabular-nums shrink-0">
                    {c.unit_count_expected ?? '—'} units · {c.parcel_count_expected ?? '—'} parcels
                  </span>
                </div>
                <div className="text-[10px] text-on-surf-v mt-[2px] tabular-nums">
                  {c.declared_value !== null && `Declared R${c.declared_value.toLocaleString('en-ZA')} · `}
                  {c.pp_manifest_number !== null && `PP manifest ${c.pp_manifest_number}`}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-baseline justify-between gap-3 pt-[8px] mt-[4px] border-t border-outline-v/20">
            <span className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v">Total</span>
            <span className="text-[11px] font-[600] text-on-surf tabular-nums">
              {totalUnits} units · {totalParcels} parcels
            </span>
          </div>
        </div>
      )}
```

Above the `return`, add the totals. Both counts are nullable per consignment, so a missing value contributes zero rather than poisoning the sum to `NaN`:

```tsx
  const totalUnits   = trip.consignments.reduce((n, c) => n + (c.unit_count_expected ?? 0), 0)
  const totalParcels = trip.consignments.reduce((n, c) => n + (c.parcel_count_expected ?? 0), 0)
```

- [ ] **Step 2: Upgrade the sidebar Cargo summary**

Replace the Cargo block body at `page.tsx:470-478` with:

```tsx
          <div className="bg-surf-lowest rounded-md p-[10px_12px] mb-4 text-[13px] shadow-level-2">
            <div className="font-[600] text-on-surf tabular-nums">
              {trip.consignments.length} waybill{trip.consignments.length === 1 ? '' : 's'}
            </div>
            <div className="text-[11px] text-on-surf-v tabular-nums mt-[2px]">
              {parcelCount} parcels
            </div>
            {originLoad?.status === 'completed' && (
              <div className="text-[11px] text-ok mt-[3px] flex items-center gap-1">
                <Ic n="check" s={11} className="text-ok" />
                All scanned out at origin ✓
              </div>
            )}
          </div>
```

`parcelCount` and `originLoad` are already derived at `page.tsx:273-274`. Leave them alone.

- [ ] **Step 3: Replace the hand-rolled Trip Info rows with `InfoRow`**

The loop at `page.tsx:412-428` reimplements `ui/InfoRow` — same flex row, same tokens, same
`mono` variant, plus a manual last-child border the component already handles with `last:border-0`.
Replace the whole `([...] as const).map(...)` block with:

```tsx
            <InfoRow label="Order"       value={trip.order_number}                mono />
            <InfoRow label="Driver"      value={trip.driver?.full_name ?? '—'} />
            <InfoRow label="Horse"       value={trip.horse?.registration ?? '—'}  mono />
            <InfoRow label="Origin"      value={originShort} />
            <InfoRow label="Destination" value={destShort} />
```

Import it: `import { InfoRow } from '@/components/ui/InfoRow'`.

Leave the `sealNumber` block below it alone — it is a badge, not a label/value row, and `InfoRow`
takes a `string` value with no slot for one.

- [ ] **Step 4: Verify against the cross-dock seed**

Run: `cd frontend/dispatcher && npm run dev`, open the seeded cross-dock trip, expand Trip Created.
Expected: every booked waybill listed with its own units/parcels, totals matching the sidebar.

- [ ] **Step 5: Commit**

```bash
git add frontend/dispatcher/components/domain/TripCreatedDetail.tsx "frontend/dispatcher/app/(app)/trips/[id]/page.tsx"
git commit -m "feat(dispatcher): waybill breakdown on the trip-creation event"
```

---

## Task 8: Geofence distance helper

**Files:**
- Create: `frontend/dispatcher/lib/phase/geo.ts`
- Test: `frontend/dispatcher/lib/phase/geo.test.ts`

Pure functions with unit tests, in `lib/phase/` beside `derive.ts`, because three cards need them and a distance bug that silently reads "12 m inside" instead of "1200 m outside" is exactly the kind of defect no UI review catches.

- [ ] **Step 1: Write the failing tests**

Create `frontend/dispatcher/lib/phase/geo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { geofenceOffsetMetres, haversineMetres, separationMetres } from './geo'

// Cape Town CBD and a point ~1.11 km due north (0.01° of latitude).
const CAPE_TOWN = { lat: -33.9249, lng: 18.4241 }
const NORTH_1KM = { lat: -33.9149, lng: 18.4241 }

describe('haversineMetres', () => {
  it('returns zero for identical points', () => {
    expect(haversineMetres(CAPE_TOWN, CAPE_TOWN)).toBe(0)
  })

  it('measures 0.01 degrees of latitude as roughly 1.11 km', () => {
    expect(haversineMetres(CAPE_TOWN, NORTH_1KM)).toBeGreaterThan(1100)
    expect(haversineMetres(CAPE_TOWN, NORTH_1KM)).toBeLessThan(1120)
  })

  it('is symmetric', () => {
    expect(haversineMetres(CAPE_TOWN, NORTH_1KM)).toBeCloseTo(haversineMetres(NORTH_1KM, CAPE_TOWN), 6)
  })
})

describe('geofenceOffsetMetres', () => {
  it('is negative when the fix is inside the fence', () => {
    const offset = geofenceOffsetMetres(CAPE_TOWN, { ...CAPE_TOWN, radiusMetres: 500 })
    expect(offset).toBe(-500)
  })

  it('is positive when the fix is outside the fence', () => {
    const offset = geofenceOffsetMetres(NORTH_1KM, { ...CAPE_TOWN, radiusMetres: 500 })
    expect(offset).toBeGreaterThan(600)
  })

  it('returns null when the fix is missing, rather than defaulting to zero', () => {
    expect(geofenceOffsetMetres(null, { ...CAPE_TOWN, radiusMetres: 500 })).toBeNull()
  })

  it('returns null when the precinct is unknown', () => {
    expect(geofenceOffsetMetres(CAPE_TOWN, null)).toBeNull()
  })
})

describe('separationMetres', () => {
  it('returns null unless both fixes exist', () => {
    expect(separationMetres(CAPE_TOWN, null)).toBeNull()
    expect(separationMetres(null, CAPE_TOWN)).toBeNull()
  })

  it('measures the gap between two fixes', () => {
    expect(separationMetres(CAPE_TOWN, NORTH_1KM)).toBeGreaterThan(1100)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run lib/phase/geo.test.ts`
Expected: FAIL — cannot resolve `./geo`.

Vitest 3 is already a dev dependency and `npm test` maps to `vitest run` (`package.json:11`), the same runner `lib/phase/derive.test.ts` uses.

- [ ] **Step 3: Implement**

Create `frontend/dispatcher/lib/phase/geo.ts`:

```ts
// Distance maths for comparing a captured GPS fix against a precinct's geofence.
//
// Pure and unit-tested on purpose: a sign error here reads as "12 m inside the fence" when
// the truth is "1200 m outside", which looks entirely plausible on screen and would quietly
// turn a mismatch into a pass.

export interface Coords {
  lat: number
  lng: number
}

export interface Geofence extends Coords {
  radiusMetres: number
}

const EARTH_RADIUS_METRES = 6_371_008.8

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** Great-circle distance in metres between two fixes. */
export function haversineMetres(a: Coords, b: Coords): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const latA = toRadians(a.lat)
  const latB = toRadians(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(h))
}

/**
 * Signed distance from the geofence boundary: negative inside, positive outside.
 *
 * Null when either input is missing. Null is NOT zero — zero means "exactly on the
 * boundary", which is a real and different claim.
 */
export function geofenceOffsetMetres(fix: Coords | null, fence: Geofence | null): number | null {
  if (fix === null || fence === null) return null
  return haversineMetres(fix, fence) - fence.radiusMetres
}

/**
 * Distance between the driver's phone and the horse's GPS.
 *
 * This gap is evidence in its own right: the driver standing at the gate while the truck
 * sits three kilometres away is precisely what this platform exists to record.
 */
export function separationMetres(a: Coords | null, b: Coords | null): number | null {
  if (a === null || b === null) return null
  return haversineMetres(a, b)
}

/** Narrow a nullable lat/lng pair into Coords, or null if either half is missing. */
export function toCoords(lat: number | null, lng: number | null): Coords | null {
  if (lat === null || lng === null) return null
  return { lat, lng }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run lib/phase/geo.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/dispatcher/lib/phase/geo.ts frontend/dispatcher/lib/phase/geo.test.ts
git commit -m "feat(dispatcher): geofence distance helpers with unit tests"
```

---

## Task 8b: Shared phase-detail sections

**Files:**
- Create: `frontend/dispatcher/components/domain/PhaseLocationSection.tsx`
- Create: `frontend/dispatcher/components/domain/PhaseAnchorSection.tsx`
- Create: `frontend/dispatcher/components/domain/ReconciliationRows.tsx`

Runs between Tasks 8 and 9. Exists because three of the four detail cards want an identical
coordinates block and two want an identical anchor block. Writing this now means Tasks 9, 11 and 13
each shrink to the fields that are genuinely theirs.

- [ ] **Step 1: The location section**

Create `frontend/dispatcher/components/domain/PhaseLocationSection.tsx`:

```tsx
'use client'

import { CoordFix, Field, Section } from './PhaseDetailFields'
import { geofenceOffsetMetres, separationMetres, toCoords } from '@/lib/phase/geo'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  // The precinct this phase is anchored to. Undefined when the stop or precinct cannot be
  // resolved — distances are then omitted rather than computed against a guess.
  precinct: Precinct | undefined
  title?: string
}

/**
 * Where the driver's phone and the truck each were when this phase completed.
 *
 * Shared by activation, departure and confirmation. All three ask the same question, so
 * they ask it in the same words — and a fix to the geofence display lands in one place.
 */
export function PhaseLocationSection({ phase, precinct, title = 'Observed location' }: Props) {
  const driverFix = toCoords(phase.driver_phone_lat, phase.driver_phone_lng)
  const horseFix  = toCoords(phase.horse_gps_lat, phase.horse_gps_lng)

  const fence = precinct
    ? { lat: precinct.latitude, lng: precinct.longitude, radiusMetres: precinct.geofence_radius_metres }
    : null

  const separation = separationMetres(driverFix, horseFix)

  return (
    <Section title={title}>
      <CoordFix
        label="Driver phone"
        lat={phase.driver_phone_lat}
        lng={phase.driver_phone_lng}
        offsetMetres={geofenceOffsetMetres(driverFix, fence)}
      />
      <CoordFix
        label="Horse GPS"
        lat={phase.horse_gps_lat}
        lng={phase.horse_gps_lng}
        offsetMetres={geofenceOffsetMetres(horseFix, fence)}
      />
      {/* The gap between the two fixes is evidence, not a diagnostic: a driver at the gate
          while the truck sits kilometres away is exactly what this platform records. */}
      <Field
        label="Driver / vehicle separation"
        value={separation === null ? 'Not computable' : `${Math.round(separation)} m`}
      />
      <Field
        label="Pulsit geofence"
        value={
          phase.pulsit_geofence_confirmed === null ? 'Awaiting Pulsit'
          : phase.pulsit_geofence_confirmed ? 'Confirmed ✓'
          : 'Mismatch ✗'
        }
      />
    </Section>
  )
}
```

- [ ] **Step 2: The anchor section**

Create `frontend/dispatcher/components/domain/PhaseAnchorSection.tsx`:

```tsx
import { Field, Section } from './PhaseDetailFields'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

/**
 * Anchor state for the phases that carry a Hedera receipt.
 *
 * Departure and confirmation are both fail-open: the phase completes even when anchoring
 * fails, so `completed` and `failed` can be true at once. That pairing is what makes the
 * policy honest and it must never render as an unqualified success.
 */
export function PhaseAnchorSection({ phase }: { phase: PhaseDescriptor }) {
  return (
    <Section title="Anchor">
      <Field label="Status" value={phase.anchor_status} />
      {phase.anchor_status === 'failed' && (
        <div className="col-span-2 text-[11px] font-[600] text-warn">
          ⚠ Anchor failed — receipt still owed
        </div>
      )}
    </Section>
  )
}
```

- [ ] **Step 3: The reconciliation rows**

Both the unloading panel and the confirmation card compare the same two counts. Create
`frontend/dispatcher/components/domain/ReconciliationRows.tsx`:

```tsx
interface Props {
  countedAtDestination: number | null | undefined
  driverVisualCount: number | null | undefined
}

/**
 * Destination count against the driver's visual count.
 *
 * A discrepancy between these two is the entire purpose of the unloading handshake, so the
 * verdict is stated explicitly. Both counts are nullable and a null is NOT a zero — with
 * either missing there is no verdict to give, only two rows.
 */
export function ReconciliationRows({ countedAtDestination, driverVisualCount }: Props) {
  const hasBoth =
    countedAtDestination !== null && countedAtDestination !== undefined &&
    driverVisualCount   !== null && driverVisualCount   !== undefined

  return (
    <>
      <div className="flex justify-between text-[11px] py-[2px]">
        <span className="text-on-surf-v">Counted at destination</span>
        <span className="text-on-surf tabular-nums">{countedAtDestination ?? '—'}</span>
      </div>
      <div className="flex justify-between text-[11px] py-[2px]">
        <span className="text-on-surf-v">Driver visual count</span>
        <span className="text-on-surf tabular-nums">{driverVisualCount ?? '—'}</span>
      </div>
      {hasBoth && (
        <div className={`text-[11px] font-[600] mt-[4px] ${
          countedAtDestination === driverVisualCount ? 'text-ok' : 'text-warn'
        }`}>
          {countedAtDestination === driverVisualCount
            ? 'Counts agree ✓'
            : `Discrepancy of ${Math.abs(countedAtDestination - driverVisualCount)} ✗`}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors. Nothing consumes these yet — Tasks 9, 11 and 13 do.

- [ ] **Step 5: Commit**

```bash
git add frontend/dispatcher/components/domain/PhaseLocationSection.tsx frontend/dispatcher/components/domain/PhaseAnchorSection.tsx frontend/dispatcher/components/domain/ReconciliationRows.tsx
git commit -m "feat(dispatcher): shared location, anchor and reconciliation sections"
```

---

## Task 9: Activation card

**Files:**
- Create: `frontend/dispatcher/components/domain/ActivationDetail.tsx`
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/dispatcher/components/domain/ActivationDetail.tsx`:

```tsx
'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Field, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'
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

const IDVS_LABELS: Record<Trip['idvs_check_status'], string> = {
  pending:  'Pending',
  verified: 'Verified ✓',
  failed:   'Failed ✗',
}

export function ActivationDetail({ phase, trip, precinct, artifactsById }: Props) {
  const stop = phase.stop_sequence === null
    ? undefined
    : trip.stops.find(s => s.sequence === phase.stop_sequence)

  return (
    <div className="mt-3 pt-3 border-t border-outline-v/20 divide-y divide-outline-v/15">

      <Section title="Expected location">
        <Field label="Precinct"  value={precinct?.name} span />
        <Field label="Address"   value={precinct?.address} span />
        <Field label="Slot time" value={fmtDateTime(stop?.slot_time)} />
        <Field label="Arrived"   value={phase.completed_at ? fmtDateTime(phase.completed_at) : 'Not yet'} />
      </Section>

      <PhaseLocationSection phase={phase} precinct={precinct} />

      <Section title="Verification">
        <Field label="Identity check" value={IDVS_LABELS[trip.idvs_check_status]} />
        <Field label="Anchor"         value={phase.anchor_status} />
        <EvidencePhoto
          label="Gate photo"
          artifact={phase.gate_photo_artifact_id ? artifactsById.get(phase.gate_photo_artifact_id) : undefined}
        />
      </Section>

      {/* An override means a human bypassed a check. It is never a footnote. */}
      {phase.dispatcher_override_note && (
        <Section title="Dispatcher override">
          <Field label="Note" value={phase.dispatcher_override_note} span />
        </Section>
      )}

    </div>
  )
}
```

- [ ] **Step 2: Wire it into the page**

In `page.tsx`, add the artifacts hook beside the existing hooks:

```tsx
  const { byId: artifactsById } = useTripArtifacts(tripId)
```

Add a helper beside `precinctForStop` that returns the whole precinct rather than just its short name, since `ActivationDetail` needs coordinates and radius:

```tsx
  // precinctForStop returns a display name; the detail cards need the record itself
  // (coordinates, geofence radius, address).
  function precinctRecordForStop(stopSequence: number | null): Precinct | undefined {
    if (stopSequence === null) return undefined
    const stop = trip!.stops.find(s => s.sequence === stopSequence)
    return stop ? precincts.find(p => p.id === stop.precinct_id) : undefined
  }
```

Inside the `timelineItems.map`, add an `expandedContent` for activation:

```tsx
                  expandedContent={
                    phase.phase_type === 'activation'
                      ? <ActivationDetail
                          phase={phase}
                          trip={trip}
                          precinct={precinctRecordForStop(phase.stop_sequence)}
                          artifactsById={artifactsById}
                        />
                      : undefined
                  }
```

Tasks 11 and 13 extend this same ternary. Import `ActivationDetail`, `useTripArtifacts` and the `Precinct` type.

- [ ] **Step 3: Verify**

Run: `cd frontend/dispatcher && npx tsc --noEmit && npm run dev`
Expected: clicking Activation expands it; coordinates, distances and separation render; a phase with no fix reads "No fix recorded", not "0.00000, 0.00000".

- [ ] **Step 4: Commit**

```bash
git add frontend/dispatcher/components/domain/ActivationDetail.tsx "frontend/dispatcher/app/(app)/trips/[id]/page.tsx"
git commit -m "feat(dispatcher): activation card with observed location and geofence offsets"
```

---

## Task 10: Manifest panel — layout and loading

**Files:**
- Create: `frontend/dispatcher/lib/hooks/useManifest.ts`
- Create: `frontend/dispatcher/components/domain/ManifestPanel.tsx`
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx:315` (the flex row)

- [ ] **Step 1: Add the manifest hook**

Create `frontend/dispatcher/lib/hooks/useManifest.ts`:

```ts
'use client'

import { api } from '@/lib/api/client'
import type { Manifest } from '@shared/lib/types/manifest'
import { useAsyncData } from './useAsyncData'

export interface UseManifestResult {
  manifest: Manifest | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

/**
 * GET /trips/{id}/manifest, dispatcher shape.
 *
 * The endpoint 404s before loading has started, which is a legitimate state and not a
 * failure — the panel presents it as "no manifest pulled yet".
 */
export function useManifest(tripId: string): UseManifestResult {
  const { data, isLoading, error, refetch } = useAsyncData<Manifest | null>(
    () => api.get<Manifest>(`/api/v1/trips/${tripId}/manifest`),
    null,
  )
  return { manifest: data, isLoading, error, refetch }
}
```

- [ ] **Step 2: Create the panel**

Create `frontend/dispatcher/components/domain/ManifestPanel.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Ic } from '@/components/ui/Ic'
import { Spinner } from '@/components/ui/Spinner'
import { useManifest } from '@/lib/hooks/useManifest'
import { ReconciliationRows } from './ReconciliationRows'
import { fmtFull, fmtTime } from '@shared/lib/utils/datetime'
import type { ConsignmentManifest, Parcel } from '@shared/lib/types/manifest'

// Which scan column this phase cares about. Loading proves parcels left the origin;
// unloading proves they arrived. One component, two emphases.
export type ManifestMode = 'loading' | 'unloading'

interface Props {
  tripId: string
  mode: ManifestMode
  heading: string
  width: number
  onStartResize: (e: React.MouseEvent) => void
  onClose: () => void
}

export function ManifestPanel({ tripId, mode, heading, width, onStartResize, onClose }: Props) {
  const { manifest, isLoading, error } = useManifest(tripId)

  return (
    <div
      className="relative bg-surf-low border-l border-outline-v/20 shrink-0 overflow-y-auto"
      style={{ width }}
    >
      {/* Drag handle on the left edge only — Trip Info is fixed-width, so a right-hand
          divider would have no width to trade with. */}
      <div
        onMouseDown={onStartResize}
        className="absolute left-0 top-0 bottom-0 w-[4px] cursor-col-resize hover:bg-sec/30 transition-colors z-10"
      />

      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
            {heading}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 inline-flex items-center rounded px-[6px] py-[2px] text-[10px] font-[600] bg-surf-high text-on-surf-v border border-outline-v/30 hover:bg-outline-v/20 transition-colors"
          >
            ✕ Close
          </button>
        </div>

        {isLoading && (
          <div className="flex justify-center py-8"><Spinner size="md" /></div>
        )}

        {/* A 404 before loading starts is a state, not a failure. */}
        {!isLoading && (error || !manifest) && (
          <div className="text-[12px] text-on-surf-v bg-surf-lowest rounded-md p-[12px_14px]">
            No manifest pulled from Parcel Perfect yet.
          </div>
        )}

        {!isLoading && manifest && (
          <>
            {manifest.consignments.map(c => (
              <ConsignmentRow key={c.consignment_id} consignment={c} mode={mode} />
            ))}

            <div className="flex items-baseline justify-between gap-3 pt-[10px] mt-[8px] border-t border-outline-v/20">
              <span className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v">Total</span>
              <span className="text-[12px] font-[600] text-on-surf tabular-nums">
                {manifest.total_parcel_count} parcels
              </span>
            </div>
            <div className={`text-[11px] mt-[4px] ${manifest.origin_scan_complete ? 'text-ok' : 'text-on-surf-v'}`}>
              {manifest.origin_scan_complete ? 'Origin scan complete ✓' : 'Origin scan in progress'}
            </div>
            <div className="text-[10px] text-on-surf-v mt-[6px] tabular-nums">
              Pulled {fmtFull(manifest.pulled_at)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ConsignmentRow({ consignment, mode }: { consignment: ConsignmentManifest; mode: ManifestMode }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="bg-surf-lowest rounded-md mb-2 shadow-level-2">
      <button
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center gap-[8px] p-[10px_12px] text-left"
      >
        {/* `chev` points right; rotate it for the open state. There is no down variant. */}
        <Ic
          n="chev"
          s={12}
          className={`text-on-surf-v shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <span className="font-mono text-[12px] font-[600] tracking-[0.04em] text-on-surf flex-1 truncate">
          {consignment.parcel_perfect_reference}
        </span>
        <span className="text-[11px] text-on-surf-v tabular-nums shrink-0">
          {consignment.unit_count_expected ?? '—'} units · {consignment.total_parcel_count} parcels
        </span>
      </button>

      {isOpen && (
        <div className="px-[12px] pb-[10px]">
          {consignment.stops.map(stop => (
            <div key={stop.delivery_stop} className="mt-[6px]">
              <div className="text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v mb-[3px]">
                {stop.delivery_stop} · {stop.parcel_count}
              </div>
              {stop.parcels.map(p => <ParcelRow key={p.id} parcel={p} mode={mode} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ParcelRow({ parcel, mode }: { parcel: Parcel; mode: ManifestMode }) {
  // Loading is proven by scan-out, unloading by scan-in. Showing the wrong timestamp
  // would make an unscanned parcel look accounted for.
  const scanAt = mode === 'loading' ? parcel.pp_scan_out_at : parcel.pp_scan_in_at
  const isScanned = scanAt !== null

  return (
    <div className="flex items-center gap-[8px] py-[3px] text-[11px]">
      <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${isScanned ? 'bg-ok' : 'bg-outline-v'}`} />
      <span className="font-mono tracking-[0.04em] text-on-surf tabular-nums flex-1 truncate">
        {parcel.barcode}
      </span>
      <span className={`shrink-0 tabular-nums ${isScanned ? 'text-ok' : 'text-on-surf-v'}`}>
        {isScanned ? fmtTime(scanAt) : parcel.status}
      </span>
    </div>
  )
}
```

Run tests with `npm test` (`vitest run`) — see `frontend/dispatcher/package.json:11`.

- [ ] **Step 3: Wire the third column into the page**

Add to the page's state and hooks:

```tsx
  const [selectedManifestPhase, setSelectedManifestPhase] = useState<PhaseEventId | null>(null)
  const { width: manifestWidth, startResize: startManifestResize } = useResizablePanel(
    DETAIL_PANEL_DEFAULT_W, { min: DETAIL_PANEL_MIN_W, max: DETAIL_PANEL_MAX_W },
  )
```

After the timeline `</div>` and before the sidebar, insert:

```tsx
        {/* ── MIDDLE: Manifest panel (only while a loading/unloading card is selected) ── */}
        {selectedManifest && (
          <ManifestPanel
            tripId={trip.id as string}
            mode={selectedManifest.phase_type === 'loading' ? 'loading' : 'unloading'}
            heading={`Manifest · ${PHASE_NAMES[selectedManifest.phase_type]}${
              selectedManifest.stop_sequence === null
                ? ''
                : ` · Stop ${selectedManifest.stop_sequence} · ${precinctForStop(selectedManifest.stop_sequence)}`
            }`}
            width={manifestWidth}
            onStartResize={startManifestResize}
            onClose={() => setSelectedManifestPhase(null)}
          />
        )}
```

Derive the selected phase from the plan, so a stale id cannot render a panel for a phase that no longer exists:

```tsx
  // Resolved from the plan by id, never held as an object in state — a refetch replaces
  // the descriptors and a captured object would go stale.
  const selectedManifest = selectedManifestPhase
    ? plan.find(p => p.phase_event_id === selectedManifestPhase) ?? null
    : null
```

Give the timeline column a floor so the panel cannot crush it — change `className="flex-1 overflow-y-auto p-6 bg-surf-lowest"` to add `min-w-[420px]`.

- [ ] **Step 3b: Narrow-viewport fallback**

`min-w-[420px]` alone makes the row overflow horizontally below roughly 1100px instead of degrading. The spec's rule is that the panel overlays Trip Info rather than compressing the timeline, so hide Trip Info while the panel is open at narrow widths.

On the Trip Info sidebar wrapper at `page.tsx:406`, make the class conditional:

```tsx
        <div className={`w-[256px] bg-surf-low p-5 overflow-y-auto shrink-0 border-l border-outline-v/20${
          selectedManifest ? ' hidden xl:block' : ''
        }`}>
```

Tailwind's `xl` is 1280px, which clears 420 + 520 + 256 with room for the app chrome. Trip Info returns as soon as the panel closes, so nothing is permanently lost.

Verify by narrowing the browser to ~1000px with a manifest open: the timeline must stay readable, Trip Info must disappear rather than the page scrolling sideways.

- [ ] **Step 4: Make loading cards open the panel**

Inside `timelineItems.map`, pass a click handler for loading and unloading. Add to `TimelineEventProps`:

```ts
  onCardClick?: () => void
```

In `TimelineEvent`, a card is interactive when it has either expandable content or a click handler:

```tsx
  const isExpandable  = !!expandedContent
  const isInteractive = isExpandable || !!onCardClick
```

and the card's `onClick` becomes:

```tsx
          onClick={
            onCardClick ? onCardClick
            : isExpandable ? () => setIsExpanded(e => !e)
            : undefined
          }
```

Replace `isExpandable` with `isInteractive` in the `className` ternary on the same element. Then in the map:

```tsx
                  onCardClick={
                    phase.phase_type === 'loading' || phase.phase_type === 'unloading'
                      ? () => setSelectedManifestPhase(
                          current => current === phase.phase_event_id ? null : phase.phase_event_id,
                        )
                      : undefined
                  }
```

Clicking the open card again closes the panel.

- [ ] **Step 5: Verify against the cross-dock seed**

Run: `cd frontend/dispatcher && npx tsc --noEmit && npm run dev`
Expected, on the seeded cross-dock trip:
- Both loading cards open a panel, each headed with its **own** stop.
- The divider drags and clamps between 360 and 720.
- The timeline never narrows past 420px.
- Clicking the open card, or ✕, closes the panel.

- [ ] **Step 6: Commit**

```bash
git add frontend/dispatcher/lib/hooks/useManifest.ts frontend/dispatcher/components/domain/ManifestPanel.tsx "frontend/dispatcher/app/(app)/trips/[id]/page.tsx"
git commit -m "feat(dispatcher): resizable manifest panel for the loading phase"
```

---

## Task 11: Unloading panel and departure card

**Files:**
- Create: `frontend/dispatcher/components/domain/DepartureDetail.tsx`
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`

Unloading needs no new component — Task 10's handler already covers it and `mode` switches the scan column. This task adds its reconciliation strip and the departure dropdown.

- [ ] **Step 1: Add the unloading reconciliation strip**

In `ManifestPanel.tsx`, add two optional props:

```ts
  // Unloading only: the counts the phase itself recorded. A mismatch between them is the
  // whole point of the unloading handshake, so it is stated, never inferred.
  parcelCountDestination?: number | null
  driverVisualCount?: number | null
```

Render above the totals block, and only when `mode === 'unloading'`:

```tsx
            {mode === 'unloading' && (
              <div className="bg-surf-lowest rounded-md p-[10px_12px] mb-2 shadow-level-2">
                <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[5px]">
                  Reconciliation
                </div>
                <ReconciliationRows
                  countedAtDestination={parcelCountDestination}
                  driverVisualCount={driverVisualCount}
                />
              </div>
            )}
```

Import it: `import { ReconciliationRows } from './ReconciliationRows'`. The confirmation card
(Task 13) renders the same component, so the two views cannot drift.

Pass them from the page:

```tsx
            parcelCountDestination={selectedManifest.parcel_count_destination}
            driverVisualCount={selectedManifest.driver_visual_count}
```

- [ ] **Step 2: Create the departure card**

Create `frontend/dispatcher/components/domain/DepartureDetail.tsx`:

```tsx
'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Section } from './PhaseDetailFields'
import { PhaseAnchorSection } from './PhaseAnchorSection'
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
    <div className="mt-3 pt-3 border-t border-outline-v/20 divide-y divide-outline-v/15">

      {/* Each departure carries its OWN seal, so a cross-dock trip visibly shows a
          different seal per leg. Never hoist this to the trip. */}
      <Section title="Seal">
        <div className="col-span-2">
          <div className="text-[10px] text-on-surf-v mb-[3px]">Seal number</div>
          {phase.seal_number ? (
            <span className="font-mono tracking-[0.06em] font-[700] text-[13px] bg-primary text-white rounded-[var(--r-sm)] px-[10px] py-[3px]">
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
        <EvidencePhoto
          label="Waybill photo"
          artifact={phase.waybill_photo_artifact_id ? artifactsById.get(phase.waybill_photo_artifact_id) : undefined}
        />
      </Section>

      <PhaseLocationSection phase={phase} precinct={precinct} title="Location at departure" />

      <PhaseAnchorSection phase={phase} />

    </div>
  )
}
```

- [ ] **Step 3: Extend the page's expandedContent ternary**

```tsx
                  expandedContent={
                    phase.phase_type === 'activation'
                      ? <ActivationDetail
                          phase={phase} trip={trip}
                          precinct={precinctRecordForStop(phase.stop_sequence)}
                          artifactsById={artifactsById}
                        />
                    : phase.phase_type === 'departure'
                      ? <DepartureDetail
                          phase={phase}
                          precinct={precinctRecordForStop(phase.stop_sequence)}
                          artifactsById={artifactsById}
                        />
                    : undefined
                  }
```

- [ ] **Step 4: Verify**

Run: `cd frontend/dispatcher && npx tsc --noEmit && npm run dev`
Expected: on the cross-dock trip each departure card shows its own seal; both unloading cards open a panel with the reconciliation strip.

- [ ] **Step 5: Commit**

```bash
git add frontend/dispatcher/components/domain/DepartureDetail.tsx frontend/dispatcher/components/domain/ManifestPanel.tsx "frontend/dispatcher/app/(app)/trips/[id]/page.tsx"
git commit -m "feat(dispatcher): departure evidence card and unloading reconciliation"
```

---

## Task 12: In-transit mini timeline

**Files:**
- Create: `frontend/dispatcher/components/domain/InTransitTimeline.tsx`
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`

**No new derivation helper.** Per-leg rendering already falls out of the page's existing
`timelinePhases.map`: every `in_transit` phase is its own row, so a two-leg cross-dock already
produces two cards and each gets its own timeline. A `transitLegs()` filter would be an exported
function with no caller. The plan-length regression cover in `derive.test.ts` stays as it is.

- [ ] **Step 1: Create the mini timeline**

Create `frontend/dispatcher/components/domain/InTransitTimeline.tsx`:

```tsx
'use client'

import { Ic } from '@/components/ui/Ic'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'

interface Props {
  phase: PhaseDescriptor
  // Exceptions belonging to this leg. Placement is currently approximate — see the page.
  exceptions: TripException[]
  originName: string
  destinationName: string
}

type MiniNode = {
  key: string
  kind: 'departed' | 'exception' | 'arrived' | 'awaiting'
  label: string
  timestamp: string | null
  detail?: string
}

/**
 * The journey between two stops, always expanded.
 *
 * Two provable nodes today: departure (this leg's creation) and arrival (its completion).
 * Weighbridges, driver and vehicle substitutions and periodic checkpoints are all
 * Pulsit- or checkpoint-sourced; `checkpoints` is write-only and Pulsit is not integrated,
 * so they are absent rather than faked. The node list is built to extend.
 */
export function InTransitTimeline({ phase, exceptions, originName, destinationName }: Props) {
  const nodes: MiniNode[] = [
    {
      key: 'departed',
      kind: 'departed',
      label: `Departed ${originName}`,
      timestamp: phase.created_at,
    },
    ...exceptions.map(exc => ({
      key: exc.id as string,
      kind: 'exception' as const,
      label: exc.exception_type.replace(/_/g, ' '),
      timestamp: exc.created_at,
      detail: exc.description,
    })),
    phase.completed_at
      ? {
          key: 'arrived',
          kind: 'arrived' as const,
          label: `Arrived ${destinationName}`,
          timestamp: phase.completed_at,
        }
      : {
          key: 'awaiting',
          kind: 'awaiting' as const,
          label: `En route to ${destinationName}`,
          timestamp: null,
        },
  ]

  const dotStyle: Record<MiniNode['kind'], string> = {
    departed:  'bg-ok',
    exception: 'bg-warn',
    arrived:   'bg-ok',
    awaiting:  'bg-sec animate-pulse',
  }

  return (
    <div className="mt-3 pt-3 border-t border-outline-v/20">
      <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[8px]">
        Journey
      </div>

      {nodes.map((node, i) => (
        <div key={node.key} className="flex gap-[10px]">
          <div className="flex flex-col items-center shrink-0">
            <div className={`w-[8px] h-[8px] rounded-full mt-[5px] ${dotStyle[node.kind]}`} />
            {i < nodes.length - 1 && <div className="w-0.5 flex-1 min-h-[16px] my-[3px] bg-outline-v/30" />}
          </div>

          <div className="flex-1 pb-[8px] min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`text-[12px] font-[600] capitalize ${
                node.kind === 'exception' ? 'text-warn-onc' : 'text-on-surf'
              }`}>
                {node.label}
              </span>
              <span className="text-[11px] font-[600] text-sec tabular-nums shrink-0">
                {fmtDateTime(node.timestamp)}
              </span>
            </div>
            {node.detail && (
              <div className="text-[11px] text-on-surf-v mt-[2px]">{node.detail}</div>
            )}
          </div>
        </div>
      ))}

      {/* Named absence. Without this the card silently implies nothing happened en route. */}
      <div className="flex items-center gap-[6px] text-[10px] text-on-surf-v mt-[2px]">
        <Ic n="clock" s={10} className="text-on-surf-v" />
        Weighbridges, driver and vehicle changes await the Pulsit integration.
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render it always-expanded**

In `page.tsx`, in-transit is neither a dropdown nor a panel. Add to `TimelineEventProps`:

```ts
  // Rendered unconditionally, unlike expandedContent which needs a click.
  alwaysExpandedContent?: React.ReactNode
```

Render it in `TimelineEvent` immediately after the `{isExpanded && expandedContent}` line:

```tsx
          {alwaysExpandedContent}
```

In the map:

```tsx
                  alwaysExpandedContent={
                    phase.phase_type === 'in_transit'
                      ? <InTransitTimeline
                          phase={phase}
                          exceptions={item.exceptions}
                          originName={precinctForStop(phase.stop_sequence)}
                          destinationName={precinctForStop(
                            phase.stop_sequence === null ? null : phase.stop_sequence + 1,
                          )}
                        />
                      : undefined
                  }
```

`in_transit` anchors to the stop it departs from, so the leg's destination is the next stop in sequence. `precinctForStop` already returns `'—'` for an unresolvable stop.

- [ ] **Step 3: Comment the known inaccuracy**

Above the exception-attachment loop at `page.tsx:299-302`, add:

```tsx
  // APPROXIMATE, and knowingly so. Exceptions are bolted onto the last done/warn row
  // because the shared TripException type still declares `handshake_event_id` while the
  // backend has moved to `phase_event_id` (schemas/transit.py:77). Once Stage 5 renames
  // that field, attach by exc.phase_event_id and delete this loop. Until then the
  // in-transit timeline shows index-guessed placement, which must not be presented as
  // phase-accurate.
```

Do not do the rename here — it touches three driver-pwa files and collides with Stage 5.

- [ ] **Step 4: Verify**

Run: `cd frontend/dispatcher && npx vitest run && npx tsc --noEmit && npm run dev`
Expected: on the cross-dock trip both in-transit cards are expanded with no click, each naming its own origin and destination; an incomplete leg reads "En route to …" with a pulsing dot.

- [ ] **Step 5: Commit**

```bash
git add frontend/dispatcher/components/domain/InTransitTimeline.tsx "frontend/dispatcher/app/(app)/trips/[id]/page.tsx"
git commit -m "feat(dispatcher): per-leg in-transit journey timeline, always expanded"
```

---

## Task 13: Confirmation card

**Files:**
- Create: `frontend/dispatcher/components/domain/ConfirmationDetail.tsx`
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/dispatcher/components/domain/ConfirmationDetail.tsx`:

```tsx
'use client'

import { EvidenceDocument } from './EvidenceDocument'
import { EvidencePhoto } from './EvidencePhoto'
import { Section } from './PhaseDetailFields'
import { PhaseAnchorSection } from './PhaseAnchorSection'
import { PhaseLocationSection } from './PhaseLocationSection'
import { ReconciliationRows } from './ReconciliationRows'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  precinct: Precinct | undefined
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

export function ConfirmationDetail({ phase, precinct, artifactsById }: Props) {
  return (
    <div className="mt-3 pt-3 border-t border-outline-v/20 divide-y divide-outline-v/15">

      <Section title="Proof of delivery">
        <EvidencePhoto
          label="POD photo"
          artifact={phase.pod_photo_artifact_id ? artifactsById.get(phase.pod_photo_artifact_id) : undefined}
        />
        <EvidenceDocument
          label="POD signature"
          artifact={phase.pod_signature_artifact_id ? artifactsById.get(phase.pod_signature_artifact_id) : undefined}
        />
      </Section>

      {/* Same component the unloading panel uses, so the two verdicts cannot disagree. */}
      <div className="py-3">
        <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[6px]">
          Reconciliation
        </div>
        <ReconciliationRows
          countedAtDestination={phase.parcel_count_destination}
          driverVisualCount={phase.driver_visual_count}
        />
      </div>

      <PhaseLocationSection phase={phase} precinct={precinct} title="Location at confirmation" />

      <PhaseAnchorSection phase={phase} />

    </div>
  )
}
```

- [ ] **Step 2: Extend the ternary**

```tsx
                    : phase.phase_type === 'confirmation'
                      ? <ConfirmationDetail
                          phase={phase}
                          precinct={precinctRecordForStop(phase.stop_sequence)}
                          artifactsById={artifactsById}
                        />
```

- [ ] **Step 3: Full verification**

```bash
cd backend && pytest
cd ../frontend/dispatcher && npx vitest run && npx tsc --noEmit
```
Expected: all green.

Then walk the seeded cross-dock trip in the browser and confirm each of the seven card behaviours from the spec.

- [ ] **Step 4: Commit**

```bash
git add frontend/dispatcher/components/domain/ConfirmationDetail.tsx "frontend/dispatcher/app/(app)/trips/[id]/page.tsx"
git commit -m "feat(dispatcher): confirmation card with POD evidence and reconciliation"
```

---

## Deferred, with reasons

Recorded here so they are not silently dropped. Each is in the spec's *Known gaps*.

| Deferred | Blocker |
|---|---|
| Arbitrary documents in their phase | `evidence_artifacts` has no `phase_event_id`; needs an Alembic migration |
| Checkpoints, weighbridges, substitutions in transit | `endpoints/checkpoints.py` is `POST`-only and `Checkpoint[]` is absent from `TripDetailResponse` |
| Phase-accurate exception placement | Shared `TripException.handshake_event_id` → `phase_event_id` belongs to Stage 5 |
| Client-side hash verification of fetched artifacts | Optional extra from the spec; cut unless time allows |
| Map with a pin | Out of scope; coordinates render as text |
| Migrating the 5 existing local date formatters to `@shared/lib/utils/datetime` | Would open four pages this work has no other reason to touch |
| Retiring the legacy `surface-*` / `outline-variant` token family from `Modal`, `Drawer`, `EvidencePacket` | Pre-existing; `Drawer` and `EvidencePacket` have zero consumers and could simply be deleted |

## Shared files touched

Flag all three in TASK COMPLETE.

- `backend/app/core/config.py` — Task 1
- `backend/app/main.py` — Task 3
- `frontend/shared/lib/types/evidence.ts` — Task 4 (additive only, collision-safe)
