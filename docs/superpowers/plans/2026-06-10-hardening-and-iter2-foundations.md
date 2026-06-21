
# FreightProof SA — Hardening & Iteration 2 Foundations Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all security vulnerabilities, code quality issues, and architectural debt identified in the post-Iteration 1 audit before beginning Iteration 2 feature development.

**Architecture:** Four sequential phases, each producing a standalone PR to `dev`. Phases 1–3 are pure fixes with no new features. Phase 4 scaffolds the driver PWA foundation (login, trip list, handshake shell) needed before handshake screens can be built in Iteration 2.

**Tech Stack:** Python 3.13 / FastAPI 0.115 / SQLAlchemy 2.0 async / Pydantic v2 / pytest-asyncio / Next.js 15 / TypeScript 5.5 / Tailwind 3.4 / Capacitor 6 / Supabase Auth (ES256 JWTs) / Hedera HCS

---

## Pre-Flight Checklist (no code — run before touching anything)

- [ ] **Verify migration chain**

  ```bash
  cd backend && python -m alembic heads
  ```

  Expected: **exactly one line**. The chain is: `0001 → 0002 (driver_substitutions) → 0003 (tom_supabase_auth_schema) → 0004 (tom_rls_policies) → ciaran migrations`.

  If you see two heads:
  ```bash
  python -m alembic merge heads -m "merge_orphaned_head_pre_iter2"
  ```
  Pull-notify all developers before continuing.

- [ ] **Confirm all tests pass on current branch**

  ```bash
  cd backend && pytest -q
  ```

  Note the passing count. Every phase must end with this count equal or higher.

- [ ] **Create the hardening branch**

  ```bash
  git checkout dev && git pull && git checkout -b hardening/pre-iter2
  ```

---

## Phase 1 — Quick Wins

**Files touched:** `backend/app/auth/dependencies.py`, `backend/app/schemas/trips.py`, `backend/app/orchestration/resource_service.py`, `frontend/shared/lib/types/blockchain.ts`, `frontend/shared/lib/types/trip.ts`, `frontend/driver-pwa/package.json`

---

### Task 1.1 — Tighten DEMO_MODE guard to block staging/preview, not just production (SEC-4)

**File:** `backend/app/auth/dependencies.py:180–184`

- [ ] On line 180, change the guard condition:
  ```python
  # BEFORE
  if settings.DEMO_MODE and settings.ENVIRONMENT == "production":

  # AFTER — block everywhere except the two safe environments
  if settings.DEMO_MODE and settings.ENVIRONMENT not in {"development", "test"}:
  ```

- [ ] Update the error message on lines 181–184:
  ```python
  raise RuntimeError(
      f"DEMO_MODE=True is not permitted when ENVIRONMENT='{settings.ENVIRONMENT}'. "
      "DEMO_MODE may only be enabled in 'development' or 'test' environments. "
      "Set DEMO_MODE=False and configure Supabase Auth credentials."
  )
  ```

---

### Task 1.2 — Add `trailer_ids` validators: min 1 trailer, no duplicates (CQ-4, CQ-5)

**Files:** `backend/app/schemas/trips.py:239, 246–253` · `backend/tests/unit/test_schema_validators.py`

- [ ] In `trips.py` line 239, change:
  ```python
  # BEFORE
  trailer_ids: list[UUID] = []

  # AFTER
  trailer_ids: list[UUID] = Field(default_factory=list, min_length=1)
  ```

- [ ] Add a uniqueness check to the existing `validate_request` model_validator (lines 246–253):
  ```python
  @model_validator(mode="after")
  def validate_request(self) -> "TripCreateRequest":
      if self.origin_precinct_id == self.destination_precinct_id:
          raise ValueError("origin and destination precincts must differ")
      if self.planned_departure_at and self.planned_arrival_at:
          if self.planned_arrival_at <= self.planned_departure_at:
              raise ValueError("planned_arrival_at must be after planned_departure_at")
      if len(self.trailer_ids) != len(set(self.trailer_ids)):
          raise ValueError("trailer_ids must not contain duplicates")
      return self
  ```

- [ ] Add tests to `backend/tests/unit/test_schema_validators.py` (the file already imports `pytest`; add the `ValidationError` import shown below alongside the existing imports):
  ```python
  import uuid as _uuid

  import pytest
  from pydantic import ValidationError

  from app.schemas.trips import TripCreateRequest

  _ORIGIN = _uuid.uuid4()
  _DEST = _uuid.uuid4()
  _BASE = {
      "order_number": "ORD-001",
      "client_organization_id": str(_uuid.uuid4()),
      "driver_id": str(_uuid.uuid4()),
      "horse_id": str(_uuid.uuid4()),
      "origin_precinct_id": str(_ORIGIN),
      "destination_precinct_id": str(_DEST),
  }


  def test_trip_create_request_empty_trailer_ids_rejected() -> None:
      data = {**_BASE, "trailer_ids": []}
      with pytest.raises(ValidationError):
          TripCreateRequest.model_validate(data)


  def test_trip_create_request_single_trailer_accepted() -> None:
      data = {**_BASE, "trailer_ids": [str(_uuid.uuid4())]}
      req = TripCreateRequest.model_validate(data)
      assert len(req.trailer_ids) == 1


  def test_trip_create_request_duplicate_trailer_ids_rejected() -> None:
      shared = str(_uuid.uuid4())
      data = {**_BASE, "trailer_ids": [shared, shared]}
      with pytest.raises(ValidationError):
          TripCreateRequest.model_validate(data)
  ```

---

### Task 1.3 — Fix IntegrityError detection: SQLSTATE 23505 instead of string matching (CQ-8)

**File:** `backend/app/orchestration/resource_service.py:240–244`

- [ ] Change the except block in `create_vehicle`:
  ```python
  # BEFORE
  except IntegrityError as exc:
      if "UniqueViolationError" not in str(exc):
          raise
      raise DuplicateResourceError("Vehicle", "registration", data.registration) from exc

  # AFTER — use SQLSTATE 23505; works with both asyncpg (.sqlstate) and psycopg2 (.pgcode)
  except IntegrityError as exc:
      orig = getattr(exc, "orig", None)
      pgcode = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
      if pgcode != "23505":
          raise
      raise DuplicateResourceError("Vehicle", "registration", data.registration) from exc
  ```

---

### Task 1.4 — Fix frontend type drift: VehicleEventType and Trip interface (CQ-6, CQ-7)

**Files:** `frontend/shared/lib/types/blockchain.ts:37–39` · `frontend/shared/lib/types/trip.ts:58–61`

- [ ] In `blockchain.ts`, add missing `VehicleEventType` values:
  ```typescript
  // Mirrors VehicleEventType enum in backend/app/db/models/enums.py exactly.
  export type VehicleEventType =
    | 'created' | 'license_plate_changed' | 'license_disc_renewed'
    | 'vin_updated' | 'vehicle_updated' | 'deactivated' | 'cosmetic_update';
  ```

- [ ] Before touching `trip.ts`, grep to confirm none of these fields are referenced anywhere in the dispatcher or driver-pwa:
  ```bash
  grep -r "operator_organization_id\|client_organization_id\|\.driver_id\|\.horse_id" \
    frontend/dispatcher/app frontend/driver-pwa/app 2>/dev/null
  ```
  If the grep returns hits, update each call site to use `trip.driver` / `trip.horse` instead. If empty, proceed.

- [ ] In `trip.ts`, delete the four absent fields (lines 58–61):
  ```typescript
  // DELETE these four lines — none are returned by TripDetailResponse:
  operator_organization_id: string
  client_organization_id: string
  driver_id: string
  horse_id: string
  ```
  The nested `driver: Driver | null` and `horse: Vehicle | null` objects (already present) carry this data.

---

### Task 1.5 — Align lucide-react and TypeScript versions across surfaces (CQ-9)

**File:** `frontend/driver-pwa/package.json`

- [ ] Update two version values:
  ```json
  "lucide-react": "^1.14.0",   ← was "^0.460.0" (dispatcher is ^1.14.0, align to it)
  "typescript": "^5.5.0"       ← was "^5.4.5" (in devDependencies)
  ```

- [ ] Install:
  ```bash
  cd frontend/driver-pwa && npm install
  ```

---

### Phase 1 — End-of-Phase Tests

```bash
cd backend && pytest -q
cd frontend/dispatcher && npx tsc --noEmit
cd frontend/driver-pwa && npx tsc --noEmit
```

All three must pass before proceeding to Phase 2.

---

## Phase 2 — Security Patches

**Files touched:** `backend/app/auth/dependencies.py`, `backend/app/orchestration/resource_service.py`, `backend/app/integrations/supabase_admin.py`

---

### Task 2.1 — Fix cross-org trip leakage in vehicle detail and driver detail (SEC-1) [CRITICAL]

**File:** `backend/app/orchestration/resource_service.py:464–467, 570–581, 627–629`
**Test:** Create `backend/tests/integration/test_vehicle_cross_org.py`

- [ ] Create `backend/tests/integration/test_vehicle_cross_org.py`:
  ```python
  """SEC-1: vehicle/driver detail must not return trip IDs from other organisations."""
  import uuid
  from decimal import Decimal

  import pytest
  from sqlalchemy.ext.asyncio import AsyncSession

  from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
  from app.db.models.organisations import Organization, Precinct
  from app.db.models.people import Driver, User
  from app.db.models.trips import Trip
  from app.db.models.vehicles import Vehicle


  async def _seed(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
      """Return (horse_id, driver_id, org_a_id, trip_b_id)."""
      org_a = Organization(id=uuid.uuid4(), name="Org A", org_type=OrganizationType.OPERATOR)
      org_b = Organization(id=uuid.uuid4(), name="Org B", org_type=OrganizationType.OPERATOR)
      db.add_all([org_a, org_b])
      await db.flush()

      # Trip.created_by_user_id is a NOT NULL FK to users — seed one creator.
      creator = User(
          id=uuid.uuid4(), organization_id=org_a.id,
          email="creator-a@example.com", full_name="Creator A", is_active=True,
      )
      db.add(creator)

      # Precinct uses principal_organization_id (not organization_id) and requires lat/long.
      pre_a = Precinct(
          id=uuid.uuid4(), principal_organization_id=org_a.id, name="Gate A",
          address="1 Rd", latitude=Decimal("-33.9249"), longitude=Decimal("18.4241"),
      )
      pre_b = Precinct(
          id=uuid.uuid4(), principal_organization_id=org_b.id, name="Gate B",
          address="2 Rd", latitude=Decimal("-26.2041"), longitude=Decimal("28.0473"),
      )
      db.add_all([pre_a, pre_b])

      horse = Vehicle(
          id=uuid.uuid4(), organization_id=org_a.id,
          registration="CA 123 GP", vehicle_type=VehicleType.HORSE,
          pulsit_device_id="DEV-001",
      )
      db.add(horse)

      driver = Driver(
          id=uuid.uuid4(), organization_id=org_a.id,
          full_name="Driver A", id_number="1234567890123",
          phone_number="+27821000001", license_number="LIC001",
      )
      db.add(driver)
      await db.flush()

      trip_a = Trip(
          id=uuid.uuid4(), operator_organization_id=org_a.id,
          client_organization_id=org_a.id,
          trip_reference="TRP-A-001", order_number="ORD-A",
          driver_id=driver.id, horse_id=horse.id,
          origin_precinct_id=pre_a.id, destination_precinct_id=pre_a.id,
          status=TripStatus.CREATED, idvs_check_status=IdvsStatus.PENDING,
          created_by_user_id=creator.id,
      )
      trip_b = Trip(
          id=uuid.uuid4(), operator_organization_id=org_b.id,
          client_organization_id=org_b.id,
          trip_reference="TRP-B-001", order_number="ORD-B",
          driver_id=driver.id, horse_id=horse.id,
          origin_precinct_id=pre_b.id, destination_precinct_id=pre_b.id,
          status=TripStatus.CREATED, idvs_check_status=IdvsStatus.PENDING,
          created_by_user_id=creator.id,
      )
      db.add_all([trip_a, trip_b])
      await db.flush()
      return horse.id, driver.id, org_a.id, trip_b.id


  @pytest.mark.asyncio
  async def test_vehicle_detail_excludes_other_org_trips(db_session: AsyncSession) -> None:
      from app.orchestration.resource_service import get_vehicle_detail
      horse_id, _, org_a_id, trip_b_id = await _seed(db_session)
      detail = await get_vehicle_detail(db_session, vehicle_id=horse_id, organization_id=org_a_id)
      assert trip_b_id not in detail.trip_ids, "Cross-org trip leaked into vehicle detail"


  @pytest.mark.asyncio
  async def test_driver_detail_excludes_other_org_trips(db_session: AsyncSession) -> None:
      from app.orchestration.resource_service import get_driver_detail
      _, driver_id, org_a_id, trip_b_id = await _seed(db_session)
      detail = await get_driver_detail(db_session, driver_id=driver_id, organization_id=org_a_id)
      assert trip_b_id not in detail.trip_ids, "Cross-org trip leaked into driver detail"
  ```

- [ ] Fix `get_vehicle_detail` trip query (~line 570) — add `Trip.operator_organization_id == organization_id`:
  ```python
  # BEFORE
  trips = (
      await db.execute(
          select(Trip).where(
              or_(
                  Trip.horse_id == vehicle_id,
                  Trip.id.in_(
                      select(TripTrailer.trip_id).where(TripTrailer.trailer_id == vehicle_id)
                  ),
              )
          ).order_by(Trip.created_at.desc())
      )
  ).scalars().all()

  # AFTER
  trips = (
      await db.execute(
          select(Trip).where(
              Trip.operator_organization_id == organization_id,
              or_(
                  Trip.horse_id == vehicle_id,
                  Trip.id.in_(
                      select(TripTrailer.trip_id).where(TripTrailer.trailer_id == vehicle_id)
                  ),
              )
          ).order_by(Trip.created_at.desc())
      )
  ).scalars().all()
  ```

- [ ] Fix `get_driver_detail` trip query (~line 627):
  ```python
  # BEFORE
  trips = (
      await db.execute(
          select(Trip).where(Trip.driver_id == driver_id).order_by(Trip.created_at.desc())
      )
  ).scalars().all()

  # AFTER
  trips = (
      await db.execute(
          select(Trip).where(
              Trip.driver_id == driver_id,
              Trip.operator_organization_id == organization_id,
          ).order_by(Trip.created_at.desc())
      )
  ).scalars().all()
  ```

- [ ] Fix `get_trip_detail` — move org filter to DB query (~line 464):
  ```python
  # BEFORE
  result = await db.execute(select(Trip).where(Trip.id == trip_id))
  trip = result.scalar_one_or_none()
  if trip is None or trip.operator_organization_id != operator_organization_id:
      raise ResourceNotFoundError("Trip", str(trip_id))

  # AFTER
  result = await db.execute(
      select(Trip).where(
          Trip.id == trip_id,
          Trip.operator_organization_id == operator_organization_id,
      )
  )
  trip = result.scalar_one_or_none()
  if trip is None:
      raise ResourceNotFoundError("Trip", str(trip_id))
  ```

---

### Task 2.2 — Replace JWKS lru_cache with TTL-bounded cache + key-rotation refresh (SEC-2)

**File:** `backend/app/auth/dependencies.py:19, 56–74`
**Test:** Create `backend/tests/unit/test_auth_jwks_cache.py`

- [ ] Create `backend/tests/unit/test_auth_jwks_cache.py`:
  ```python
  """Unit tests for JWKS TTL cache and key-rotation refresh."""
  import time
  import pytest
  import app.auth.dependencies as deps


  def test_jwks_cache_serves_from_cache_within_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
      fetch_count = 0

      def mock_fetch() -> dict:
          nonlocal fetch_count
          fetch_count += 1
          return {"keys": [{"kid": "key1"}]}

      monkeypatch.setattr(deps, "_fetch_jwks", mock_fetch)
      monkeypatch.setattr(deps, "_jwks_cache", None)
      monkeypatch.setattr(deps, "_jwks_fetched_at", 0.0)

      deps._get_jwks()
      deps._get_jwks()
      assert fetch_count == 1, "Cache should serve second call without fetching"


  def test_jwks_cache_refetches_after_ttl_expires(monkeypatch: pytest.MonkeyPatch) -> None:
      fetch_count = 0

      def mock_fetch() -> dict:
          nonlocal fetch_count
          fetch_count += 1
          return {"keys": [{"kid": f"key{fetch_count}"}]}

      monkeypatch.setattr(deps, "_fetch_jwks", mock_fetch)
      monkeypatch.setattr(deps, "_jwks_cache", None)
      monkeypatch.setattr(deps, "_jwks_fetched_at", 0.0)

      deps._get_jwks()
      assert fetch_count == 1
      monkeypatch.setattr(deps, "_jwks_fetched_at", time.monotonic() - deps._JWKS_TTL_SECONDS - 1)
      deps._get_jwks()
      assert fetch_count == 2, "Cache should re-fetch after TTL"


  def test_get_signing_key_refreshes_on_unknown_kid(monkeypatch: pytest.MonkeyPatch) -> None:
      fetch_count = 0

      def mock_fetch() -> dict:
          nonlocal fetch_count
          fetch_count += 1
          return {"keys": [{"kid": "new-key", "kty": "EC"}]}

      monkeypatch.setattr(deps, "_fetch_jwks", mock_fetch)
      monkeypatch.setattr(deps, "_jwks_cache", {"keys": [{"kid": "old-key"}]})
      monkeypatch.setattr(deps, "_jwks_fetched_at", time.monotonic())

      key = deps._get_signing_key("new-key")
      assert key["kid"] == "new-key"
      assert fetch_count == 1, "Should refresh once on unknown kid"
  ```

- [ ] In `dependencies.py`, remove `from functools import lru_cache` from imports and add `import time`.

- [ ] Replace the entire `_get_jwks` and `_get_signing_key` block (lines 56–74) with:
  ```python
  _jwks_cache: dict | None = None
  _jwks_fetched_at: float = 0.0
  _JWKS_TTL_SECONDS: float = 3600.0  # 1-hour TTL; force-refresh on unknown kid for rotation.


  def _fetch_jwks() -> dict:
      """Network request to Supabase JWKS. Called only by _get_jwks."""
      url = f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
      with urllib.request.urlopen(url, timeout=10) as resp:
          return json.loads(resp.read())


  def _get_jwks() -> dict:
      """Return Supabase JWKS, re-fetching if the TTL has expired."""
      global _jwks_cache, _jwks_fetched_at
      if _jwks_cache is None or time.monotonic() - _jwks_fetched_at > _JWKS_TTL_SECONDS:
          _jwks_cache = _fetch_jwks()
          _jwks_fetched_at = time.monotonic()
      return _jwks_cache


  def _get_signing_key(kid: str) -> dict:
      """Return the JWK for kid. Forces one refresh on cache miss to handle key rotation."""
      for key in _get_jwks().get("keys", []):
          if key.get("kid") == kid:
              return key
      # Not found — key may have rotated since last TTL refresh. Refresh once.
      global _jwks_cache, _jwks_fetched_at
      _jwks_cache = _fetch_jwks()
      _jwks_fetched_at = time.monotonic()
      for key in _jwks_cache.get("keys", []):
          if key.get("kid") == kid:
              return key
      raise HTTPException(
          status_code=status.HTTP_401_UNAUTHORIZED,
          detail="Invalid token.",
          headers={"WWW-Authenticate": "Bearer"},
      )
  ```

---

### Task 2.3 — Mask driver phone number in logs and exclude from event JSONB (SEC-3)

**Files:** `backend/app/integrations/supabase_admin.py:45–46, 56` · `backend/app/orchestration/resource_service.py:175`

- [ ] In `supabase_admin.py` line 45–46, mask the phone in the warning log:
  ```python
  # BEFORE
  logger.warning("Supabase auth user already exists for phone=%s", phone)

  # AFTER
  _masked = f"***{phone[-4:]}" if len(phone) >= 4 else "****"
  logger.warning("Supabase auth user already exists for phone=%s", _masked)
  ```

- [ ] In `supabase_admin.py` line 56, remove phone from the info log entirely:
  ```python
  # BEFORE
  logger.info("Created Supabase auth user id=%s for driver phone=%s", auth_id, phone)

  # AFTER
  logger.info("Created Supabase auth user id=%s for new driver", auth_id)
  ```

- [ ] At the top of `resource_service.py` (below the imports), add the PII constant:
  ```python
  # POPIA: these fields must never appear in JSONB event audit logs.
  _DRIVER_PII_FIELDS: frozenset[str] = frozenset({"license_number", "phone_number"})
  ```

- [ ] In `update_driver` (~line 175), update the safe_patch filter:
  ```python
  # BEFORE
  safe_patch = {k: v for k, v in patched.items() if k != "license_number"}

  # AFTER
  safe_patch = {k: v for k, v in patched.items() if k not in _DRIVER_PII_FIELDS}
  ```

---

### Task 2.4 — Hash Pulsit device ID in BlockchainReceipt.payload_json (SEC-5)

**File:** `backend/app/orchestration/resource_service.py:267–274`
**Test:** Add to the existing `backend/tests/integration/test_vehicles_anchor.py`

- [ ] Append to `backend/tests/integration/test_vehicles_anchor.py`. This file already imports
  `patch`, `AsyncClient`, `ASGITransport`, `app`, `HederaReceipt`, `pytest`, `AsyncSession`, and
  defines the `seed_org` fixture and the `override_get_db` autouse fixture — reuse them, do not
  redefine. Mirror the existing test's mock target (`app.blockchain.anchor_service.HederaService`):
  ```python
  @pytest.mark.asyncio
  async def test_create_vehicle_payload_json_hashes_pulsit_device_id(
      db_session: AsyncSession, seed_org,
  ) -> None:
      """SEC-5: GPS device ID must be hashed in payload_json, never stored in plaintext."""
      from sqlalchemy import select
      from app.db.models.blockchain import BlockchainReceipt
      from app.db.models.enums import SubjectType

      secret_id = "SECRET-TRACKER-001"
      vehicle_payload = {
          "registration": "CA 999 XYZ",
          "vehicle_type": "horse",
          "pulsit_device_id": secret_id,
      }
      fake_receipt = HederaReceipt(
          topic_id="0.0.12345",
          sequence_number=44,
          consensus_timestamp=None,
          transaction_id="0.0.12345@1715865602.0",
      )

      with patch("app.blockchain.anchor_service.HederaService") as MockService:
          MockService.return_value.submit_hash.return_value = fake_receipt
          async with AsyncClient(
              transport=ASGITransport(app=app), base_url="http://test"
          ) as client:
              resp = await client.post(
                  "/api/v1/vehicles",
                  json=vehicle_payload,
                  headers={"Authorization": "Bearer demo"},
              )
              assert resp.status_code == 201

      receipt = (
          await db_session.execute(
              select(BlockchainReceipt).where(
                  BlockchainReceipt.subject_type == SubjectType.VEHICLE_EVENT
              )
          )
      ).scalars().first()
      assert receipt is not None
      fields = receipt.payload_json.get("fields", {})
      assert "pulsit_device_id" not in fields, "plaintext pulsit_device_id must not be in payload_json"
      assert "pulsit_device_id_sha256" in fields, "hash of pulsit_device_id must be present"
      assert fields["pulsit_device_id_sha256"] != secret_id
  ```

- [ ] In `create_vehicle`, after building `snapshot` and `vehicle_event`, change the `canonical` dict to hash the device ID:
  ```python
  # Build payload-safe fields: hash the GPS device ID.
  # snapshot in vehicle_event.changed_fields keeps plaintext (Supabase DB, POPIA-compliant).
  # canonical (→ payload_json in BlockchainReceipt) uses the hash only.
  _canonical_fields = {
      **snapshot,
      "pulsit_device_id_sha256": hashlib.sha256(
          (snapshot.get("pulsit_device_id") or "").encode("utf-8")
      ).hexdigest() if snapshot.get("pulsit_device_id") else None,
  }
  _canonical_fields.pop("pulsit_device_id", None)

  canonical = {
      "vehicle_event_id": str(vehicle_event.id),
      "vehicle_id": str(vehicle.id),
      "event_type": VehicleEventType.CREATED.value,
      "fields": _canonical_fields,
      "changed_by_user_id": str(current_user_id),
      "timestamp": vehicle_event.created_at.isoformat(),
  }
  ```

- [ ] In `update_vehicle`, if `pulsit_device_id` appears in `diff`, hash it before writing to canonical:
  ```python
  if diff is not None:
      _canonical_diff = dict(diff)
      if "pulsit_device_id" in _canonical_diff:
          entry = _canonical_diff.pop("pulsit_device_id")
          # entry is {"from": "...", "to": "..."} — hash both sides
          _canonical_diff["pulsit_device_id_sha256"] = {
              k: hashlib.sha256((v or "").encode()).hexdigest()
              for k, v in entry.items()
          }
      canonical = {
          "vehicle_event_id": str(event.id),
          "vehicle_id": str(vehicle.id),
          "event_type": event_type.value,
          "fields": _canonical_diff,
          "changed_by_user_id": str(current_user_id),
          "timestamp": event.created_at.isoformat(),
      }
  ```

---

### Phase 2 — End-of-Phase Tests

```bash
cd backend && pytest -q
```

Count must be equal or higher than Phase 1 baseline.

---

## Phase 3 — Architectural Refactors

> ⚠ Post in team chat before starting: "Splitting resource_service.py and blockchain.py — nobody touch these files until PR is merged."

---

### Task 3.1 — Split resource_service.py into driver_service.py and vehicle_service.py (CQ-1)

**Files:**
- Create: `backend/app/orchestration/driver_service.py`
- Create: `backend/app/orchestration/vehicle_service.py`
- Modify: `backend/app/orchestration/resource_service.py` (remove extracted functions)
- Modify: `backend/app/api/v1/endpoints/drivers.py`
- Modify: `backend/app/api/v1/endpoints/vehicles.py`

- [ ] Create `backend/app/orchestration/driver_service.py`. Copy into it — verbatim, no logic changes — these four functions from `resource_service.py`: `list_drivers`, `create_driver`, `update_driver`, `get_driver_detail`.

  File header and imports:
  ```python
  """Service functions for driver resources.

  Extracted from resource_service.py — owns list/create/update/detail for Driver.
  Layering: imports db/, schemas/, core/exceptions, integrations/ only.
  """

  import hashlib
  import uuid

  from sqlalchemy import select
  from sqlalchemy.exc import IntegrityError
  from sqlalchemy.ext.asyncio import AsyncSession

  from app.blockchain.anchor_service import anchor_subject
  from app.blockchain.critical_fields import diff_critical_fields
  from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
  from app.integrations.supabase_admin import create_driver_auth_user
  from app.db.models.blockchain import BlockchainReceipt
  from app.db.models.enums import (
      BlockchainReceiptType, DriverEventType, IdvsStatus, SubjectType,
  )
  from app.db.models.events import DriverEvent
  from app.db.models.people import Driver
  from app.db.models.trips import Trip
  from app.schemas.blockchain import BlockchainReceiptRead
  from app.schemas.events import DriverEventRead
  from app.schemas.people import DriverCreateBody, DriverDetailResponse, DriverRead, DriverUpdateBody

  # POPIA: these fields must never appear in JSONB event audit logs.
  _DRIVER_PII_FIELDS: frozenset[str] = frozenset({"license_number", "phone_number"})
  ```

  Paste all four function bodies verbatim. The Phase 2 SEC-1 and SEC-3 fixes must already be in the function bodies before pasting.

- [ ] Create `backend/app/orchestration/vehicle_service.py`. Copy these four functions verbatim: `list_vehicles`, `create_vehicle`, `update_vehicle`, `get_vehicle_detail`.

  File header and imports:
  ```python
  """Service functions for vehicle resources.

  Extracted from resource_service.py — owns list/create/update/detail for Vehicle.
  """

  import hashlib
  import uuid

  from sqlalchemy import or_, select
  from sqlalchemy.exc import IntegrityError
  from sqlalchemy.ext.asyncio import AsyncSession

  from app.blockchain.anchor_service import anchor_subject
  from app.blockchain.critical_fields import VEHICLE_CRITICAL_FIELDS, diff_critical_fields
  from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
  from app.db.models.blockchain import BlockchainReceipt
  from app.db.models.enums import (
      BlockchainReceiptType, SubjectType, VehicleEventType,
  )
  from app.db.models.events import VehicleEvent
  from app.db.models.trips import Trip, TripTrailer
  from app.db.models.vehicles import Vehicle
  from app.schemas.blockchain import BlockchainReceiptRead
  from app.schemas.events import VehicleEventRead
  from app.schemas.vehicles import VehicleCreateBody, VehicleDetailResponse, VehicleRead, VehicleUpdateBody
  ```

  Paste all four function bodies verbatim. Phase 2 SEC-1 and SEC-5 fixes must already be applied.

- [ ] Delete `list_drivers`, `create_driver`, `update_driver`, `get_driver_detail`, `list_vehicles`, `create_vehicle`, `update_vehicle`, `get_vehicle_detail` from `resource_service.py`. Remove any now-unused imports from that file (Driver, Vehicle, DriverEvent, VehicleEvent, etc.). Keep only what `list_precincts`, `list_trips`, and `get_trip_detail` need.

- [ ] Update `backend/app/api/v1/endpoints/drivers.py` — change the import line:
  ```python
  from app.orchestration.driver_service import (
      list_drivers, create_driver, update_driver, get_driver_detail,
  )
  ```

- [ ] Update `backend/app/api/v1/endpoints/vehicles.py`:
  ```python
  from app.orchestration.vehicle_service import (
      list_vehicles, create_vehicle, update_vehicle, get_vehicle_detail,
  )
  ```

---

### Task 3.2 — Move `_assert_subject_visible` out of the endpoint file (CQ-2)

**Files:**
- Create: `backend/app/blockchain/subject_visibility.py`
- Modify: `backend/app/core/exceptions.py`
- Modify: `backend/app/api/v1/endpoints/blockchain.py`
- Test: Create `backend/tests/unit/test_subject_visibility.py`

- [ ] Add `SubjectNotVisibleError` to `backend/app/core/exceptions.py`:
  ```python
  class SubjectNotVisibleError(Exception):
      """Raised when a dispatcher queries a blockchain subject outside their organisation."""
      def __init__(self, subject_type: str, subject_id: str) -> None:
          self.subject_type = subject_type
          self.subject_id = subject_id
          super().__init__(f"Subject {subject_type}/{subject_id} not visible to caller's org")
  ```

- [ ] Create `backend/app/blockchain/subject_visibility.py`:
  ```python
  """Organisation-scoped visibility check for blockchain subjects.

  Raises SubjectNotVisibleError — endpoint layer translates this to HTTP 404
  so no information about other orgs is leaked.
  """

  import uuid

  from sqlalchemy import select
  from sqlalchemy.ext.asyncio import AsyncSession

  from app.core.exceptions import SubjectNotVisibleError
  from app.db.models.enums import SubjectType
  from app.db.models.events import DriverEvent, VehicleEvent
  from app.db.models.people import Driver
  from app.db.models.trips import Trip
  from app.db.models.vehicles import Vehicle


  async def assert_subject_visible(
      db: AsyncSession,
      *,
      subject_type: SubjectType,
      subject_id: uuid.UUID,
      organization_id: uuid.UUID,
  ) -> None:
      """Raise SubjectNotVisibleError if subject is outside the caller's organisation."""
      if subject_type == SubjectType.TRIP:
          query = select(Trip.id).where(
              Trip.id == subject_id,
              Trip.operator_organization_id == organization_id,
          )
      elif subject_type == SubjectType.VEHICLE:
          query = select(Vehicle.id).where(
              Vehicle.id == subject_id,
              Vehicle.organization_id == organization_id,
          )
      elif subject_type == SubjectType.DRIVER:
          query = select(Driver.id).where(
              Driver.id == subject_id,
              Driver.organization_id == organization_id,
          )
      elif subject_type == SubjectType.VEHICLE_EVENT:
          query = (
              select(VehicleEvent.id)
              .join(Vehicle, Vehicle.id == VehicleEvent.vehicle_id)
              .where(
                  VehicleEvent.id == subject_id,
                  Vehicle.organization_id == organization_id,
              )
          )
      elif subject_type == SubjectType.DRIVER_EVENT:
          query = (
              select(DriverEvent.id)
              .join(Driver, Driver.id == DriverEvent.driver_id)
              .where(
                  DriverEvent.id == subject_id,
                  Driver.organization_id == organization_id,
              )
          )
      else:
          raise SubjectNotVisibleError(str(subject_type), str(subject_id))

      result = await db.execute(query.limit(1))
      if result.scalar_one_or_none() is None:
          raise SubjectNotVisibleError(str(subject_type), str(subject_id))
  ```

- [ ] Create `backend/tests/unit/test_subject_visibility.py`:
  ```python
  """Unit tests for blockchain subject visibility — no HTTP layer."""
  import uuid
  import pytest
  from unittest.mock import AsyncMock, MagicMock

  from app.blockchain.subject_visibility import assert_subject_visible
  from app.core.exceptions import SubjectNotVisibleError
  from app.db.models.enums import SubjectType


  @pytest.mark.asyncio
  async def test_visible_subject_does_not_raise() -> None:
      db = AsyncMock()
      result = MagicMock()
      result.scalar_one_or_none.return_value = uuid.uuid4()
      db.execute.return_value = result
      await assert_subject_visible(
          db, subject_type=SubjectType.TRIP,
          subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
      )


  @pytest.mark.asyncio
  async def test_invisible_subject_raises() -> None:
      db = AsyncMock()
      result = MagicMock()
      result.scalar_one_or_none.return_value = None
      db.execute.return_value = result
      with pytest.raises(SubjectNotVisibleError):
          await assert_subject_visible(
              db, subject_type=SubjectType.TRIP,
              subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
          )


  @pytest.mark.asyncio
  async def test_unknown_subject_type_raises() -> None:
      db = AsyncMock()
      with pytest.raises(SubjectNotVisibleError):
          await assert_subject_visible(
              db, subject_type="nonexistent",  # type: ignore[arg-type]
              subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
          )
  ```

- [ ] In `backend/app/api/v1/endpoints/blockchain.py`:

  Add imports:
  ```python
  from app.blockchain.subject_visibility import assert_subject_visible
  from app.core.exceptions import SubjectNotVisibleError
  ```

  Remove the entire `_assert_subject_visible` function (the ~50-line block starting around line 24).

  Remove these imports now only needed inside `subject_visibility.py`:
  ```python
  from app.db.models.events import DriverEvent, VehicleEvent
  from app.db.models.people import Driver
  from app.db.models.trips import Trip
  from app.db.models.vehicles import Vehicle
  ```

  Replace both call sites (`list_receipts` and `verify_endpoint`) with:
  ```python
  try:
      await assert_subject_visible(
          db, subject_type=subject_type,
          subject_id=subject_id, organization_id=current_user.organization_id,
      )
  except SubjectNotVisibleError:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Blockchain subject not found")
  ```

---

### Phase 3 — End-of-Phase Tests

```bash
cd backend && pytest -q
```

Count must be equal or higher than Phase 2 baseline.

---

## Phase 4 — Driver PWA Foundations

All pages must be `'use client'` — required by Capacitor's `output: 'export'` static build.

---

### Task 4.1 — Add Supabase client to driver-pwa

**Files:** `frontend/driver-pwa/package.json` · Create `frontend/driver-pwa/lib/supabase.ts`

- [ ] In `package.json` `dependencies`, add `"@supabase/supabase-js": "^2.43.0"`, then install:
  ```bash
  cd frontend/driver-pwa && npm install
  ```

- [ ] Create `frontend/driver-pwa/lib/supabase.ts`:
  ```typescript
  import { createClient } from '@supabase/supabase-js'

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  export const supabase = createClient(supabaseUrl, supabaseAnonKey)
  ```

---

### Task 4.2 — Phone login and OTP verification pages

**Files:** Create `frontend/driver-pwa/app/login/page.tsx` · `frontend/driver-pwa/app/otp/page.tsx`

- [ ] Create `frontend/driver-pwa/app/login/page.tsx`:
  ```tsx
  'use client'

  import { useState } from 'react'
  import { useRouter } from 'next/navigation'
  import { supabase } from '@/lib/supabase'
  import { Button } from '@/components/ui/Button'
  import { Input } from '@/components/ui/Input'

  export default function LoginPage() {
    const router = useRouter()
    const [phone, setPhone] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleSendOtp(e: React.FormEvent) {
      e.preventDefault()
      setLoading(true)
      setError(null)
      const { error } = await supabase.auth.signInWithOtp({
        phone,
        options: { channel: 'sms' },
      })
      setLoading(false)
      if (error) { setError(error.message); return }
      router.push(`/otp?phone=${encodeURIComponent(phone)}`)
    }

    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <h1 className="text-2xl font-semibold mb-8">FreightProof Driver</h1>
        <form onSubmit={handleSendOtp} className="w-full max-w-sm flex flex-col gap-4">
          <Input
            label="Phone number"
            type="tel"
            placeholder="+27 82 000 0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" disabled={loading || !phone}>
            {loading ? 'Sending…' : 'Send OTP'}
          </Button>
        </form>
      </main>
    )
  }
  ```

- [ ] Create `frontend/driver-pwa/app/otp/page.tsx`:
  ```tsx
  'use client'

  import { useState } from 'react'
  import { useRouter, useSearchParams } from 'next/navigation'
  import { supabase } from '@/lib/supabase'
  import { Button } from '@/components/ui/Button'
  import { Input } from '@/components/ui/Input'

  export default function OtpPage() {
    const router = useRouter()
    const params = useSearchParams()
    const phone = params.get('phone') ?? ''
    const [token, setToken] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleVerify(e: React.FormEvent) {
      e.preventDefault()
      setLoading(true)
      setError(null)
      const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
      setLoading(false)
      if (error) { setError(error.message); return }
      router.replace('/trips')
    }

    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <h1 className="text-2xl font-semibold mb-2">Enter OTP</h1>
        <p className="text-sm text-gray-500 mb-8">Sent to {phone}</p>
        <form onSubmit={handleVerify} className="w-full max-w-sm flex flex-col gap-4">
          <Input
            label="6-digit code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={token}
            onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
            required
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" disabled={loading || token.length < 6}>
            {loading ? 'Verifying…' : 'Verify'}
          </Button>
        </form>
      </main>
    )
  }
  ```

---

### Task 4.3 — Trip list, active trip overview, and handshake step shell

**Files:** Create `frontend/driver-pwa/app/trips/page.tsx` · `frontend/driver-pwa/app/trips/[id]/page.tsx` · `frontend/driver-pwa/app/trips/[id]/handshake/[step]/page.tsx`

All three use mock data from `@shared/lib/mocks/`. API wiring happens in Iteration 2.

- [ ] Create `frontend/driver-pwa/app/trips/page.tsx`:
  ```tsx
  'use client'

  import { useRouter } from 'next/navigation'
  import { mockTrips } from '@shared/lib/mocks/trips'
  import type { Trip } from '@shared/lib/types/trip'

  export default function TripsPage() {
    const router = useRouter()
    // TODO Iter 2: replace with GET /driver/trips using authenticated session.
    // mockTrips is typed Trip[] in the shared lib (not TripSummary[]).
    const trips: Trip[] = mockTrips

    if (trips.length === 0) {
      return (
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-gray-500">No active trips assigned to you.</p>
        </main>
      )
    }

    return (
      <main className="min-h-screen p-4">
        <h1 className="text-xl font-semibold mb-4">My Trips</h1>
        <ul className="flex flex-col gap-3">
          {trips.map((trip) => (
            <li key={trip.id}>
              <button
                className="w-full text-left rounded-xl border border-gray-200 p-4 bg-white shadow-sm"
                onClick={() => router.push(`/trips/${trip.id}`)}
              >
                <p className="font-medium">{trip.trip_reference}</p>
                <p className="text-sm text-gray-500">{trip.order_number}</p>
                <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs">
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

- [ ] Create `frontend/driver-pwa/app/trips/[id]/page.tsx`:
  ```tsx
  'use client'

  import { useParams, useRouter } from 'next/navigation'
  import { mockTrips } from '@shared/lib/mocks/trips'
  import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'

  // H1–H5 are the driver-facing handshakes (H0 is dispatcher-only). STEP_SLUGS is a
  // Record keyed by handshake number; STEP_SLUGS[n][0] is that handshake's first step slug.
  const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

  export default function ActiveTripPage() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    // TODO Iter 2: fetch from GET /driver/trips/{id}
    const trip = mockTrips.find((t) => t.id === id)

    if (!trip) {
      return (
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-gray-500">Trip not found.</p>
        </main>
      )
    }

    return (
      <main className="min-h-screen p-4">
        <button onClick={() => router.back()} className="mb-4 text-sm text-blue-600">← Back</button>
        <h1 className="text-xl font-semibold">{trip.trip_reference}</h1>
        <p className="text-sm text-gray-500 mb-4">{trip.order_number}</p>

        <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-1 text-sm font-medium">Status</p>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{trip.status}</span>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium">Handshakes</h2>
          <ul className="flex flex-col gap-2">
            {HANDSHAKE_NUMBERS.map((n) => (
              <li key={n}>
                <button
                  className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left text-sm"
                  onClick={() => router.push(`/trips/${id}/handshake/${STEP_SLUGS[n][0]}`)}
                >
                  <span className="font-medium">H{n}:</span> {HANDSHAKE_NAMES[n]}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    )
  }
  ```

- [ ] Create `frontend/driver-pwa/app/trips/[id]/handshake/[step]/page.tsx`:
  ```tsx
  'use client'

  import { useParams, useRouter } from 'next/navigation'
  import { HANDSHAKE_NAMES, STEP_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'

  const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

  export default function HandshakeStepPage() {
    const { id, step } = useParams<{ id: string; step: string }>()
    const router = useRouter()

    // STEP_SLUGS is keyed by handshake number; find which handshake owns this slug.
    const handshakeNumber = HANDSHAKE_NUMBERS.find((n) => STEP_SLUGS[n].includes(step))
    const stepIndex = handshakeNumber ? STEP_SLUGS[handshakeNumber].indexOf(step) : -1
    const handshakeName = handshakeNumber ? HANDSHAKE_NAMES[handshakeNumber] : step
    const stepName =
      handshakeNumber && stepIndex >= 0 ? STEP_NAMES[handshakeNumber][stepIndex] : step

    return (
      <main className="min-h-screen p-4">
        <button onClick={() => router.back()} className="mb-4 text-sm text-blue-600">← Back</button>
        <p className="text-sm text-gray-500">{handshakeName}</p>
        <h1 className="text-xl font-semibold mb-1">{stepName}</h1>
        <p className="mb-6 text-sm text-gray-500">Trip: {id}</p>

        {/* Replace in Iter 2 with real checklist + hold-to-confirm per step (FP-67–FP-92) */}
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400">
          <p className="text-sm">Handshake UI for <strong>{step}</strong></p>
          <p className="mt-1 text-xs">Implement in Iteration 2</p>
        </div>
      </main>
    )
  }
  ```

---

### Phase 4 — End-of-Phase Tests

```bash
cd frontend/driver-pwa && npx tsc --noEmit && npm run lint
```

---

## Final Verification (run once after all four phases)

```bash
# Backend suite
cd backend && pytest -q

# Type checks
cd frontend/dispatcher && npx tsc --noEmit
cd frontend/driver-pwa && npx tsc --noEmit

# Migration chain — must be exactly one head
cd backend && python -m alembic heads

# No secrets in tracked files
git diff origin/dev --name-only | xargs grep -l "SUPABASE_SERVICE_ROLE\|HEDERA_OPERATOR" 2>/dev/null || echo "clean"
```

> **Suggested commit messages (for your reference — stage and commit yourself):**
> - Phase 1: `fix(api,auth,shared): SEC-4 demo guard, CQ-4/5 trailer validators, CQ-8 pgcode, CQ-6/7 types, CQ-9 versions`
> - Phase 2: `fix(auth,orchestration,integrations): SEC-1 cross-org trips, SEC-2 JWKS TTL, SEC-3 phone masking, SEC-5 pulsit hash`
> - Phase 3: `refactor(orchestration,blockchain): split resource_service, extract subject_visibility`
> - Phase 4: `feat(driver-pwa): Supabase client, phone OTP login, trip list and handshake shell pages`

---

## Deferred — Needs Team Design Session Before Any Code

### ITER2-3 — Handshake transition service

Before writing `handshake_service.py`, decide:
1. State transition matrix: which `TripStatus` values allow which `HandshakeType`? Draw it as a table.
2. Which handshakes anchor to Hedera sync vs Celery async? (Suggestion: H0 and H5 sync; H1–H4 async.)
3. Driver API contract: what does `POST /driver/trips/{id}/handshakes` accept per step?
4. Lock TripStop design first — it changes the payload schema.

### ITER2-5 — TripStop / multi-leg model (FP-112)

Before writing any migration:
1. Are intermediate stops included in the journey lock hash? **Yes = must version the hash function** (add a `hash_version` field). No = simpler migration.
2. Is `TripStop` additive? (Single-leg trips continue to work — confirm with demo scope JHB→DBN.)
3. `TripStop` fields at minimum: `precinct_id`, `sequence_number`, `planned_arrival_at`, `planned_departure_at`.

### ITER2-2 — Celery async blockchain anchoring

Before refactoring `anchor_service.py`:
1. Failure mode if a Celery task fails: does the handshake state roll back, or stay committed with `receipt_pending=True`?
2. What does the frontend poll to know when anchoring completes?

---

*Covers: SEC-1 SEC-2 SEC-3 SEC-4 SEC-5 CQ-1 CQ-2 CQ-4 CQ-5 CQ-6 CQ-7 CQ-8 CQ-9 ITER2-4 ITER2-6. Deferred: ITER2-2 ITER2-3 ITER2-5.*
