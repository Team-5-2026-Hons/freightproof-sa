# Seal OCR and Linehaul Scan to PDF: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the seal number from the seal photo with on-device OCR, and scan the linehaul sheet into a PDF whose hash is anchored to Hedera alongside the scan image.

**Architecture:** The driver app moves to Capacitor 7. Native plugins do OCR (`@capacitor-community/image-to-text`) and document scanning (`@capgo/capacitor-document-scanner`), and `pdf-lib` builds the PDF on the phone. The backend stores `seal_number_source` (not anchored) and `linehaul_pdf_artifact_id`, and the loading anchor payload moves to v3 with `linehaul_pdf_sha256`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, pytest (backend). Next.js 15, React 19, Capacitor 7, vitest (driver app).

**Spec:** `docs/superpowers/specs/2026-10-15-seal-ocr-and-linehaul-scan-design.md`
**Branch:** `feat/fp-300-seal-ocr-linehaul-scan`

---

## Ground rules for whoever executes this

- **Never run `git commit`, `git push`, `git checkout`, `git stash`, `git reset` or `git restore`.** Each task ends by staging the named files with `git add <files>` and printing the suggested commit message for Tim to commit himself (project CLAUDE.md).
- **Never run `alembic upgrade`** against `DATABASE_URL`, the shared Supabase dev DB. The migration is applied from `dev` after merge.
- **Never read `.env`.**
- **Backend tests:** `cd backend && TEST_DATABASE_URL="postgresql+asyncpg://timgultig@localhost:5433/freightproof_test" .venv/bin/pytest -q <path>`. Without `TEST_DATABASE_URL`, DB tests silently skip. Use `.venv/bin/pytest`, never a bare `pytest`. "Event loop is closed" noise from redis at teardown is not a failure; read the `passed/failed` summary line.
- **Driver app commands** need Node 22. Check with `node -v` before running `npm`, and switch with `nvm use 22` if needed.
- **Cross-owner files** (flag these in the PR description and tell Ciaran):
  - `frontend/driver-pwa/package.json`
  - `frontend/shared/lib/types/evidence.ts`
  - `frontend/shared/lib/types/phase.ts`
  - `frontend/shared/lib/constants/phase-meta.ts`
  - `frontend/dispatcher/lib/phase/act-wording.ts`
  - `frontend/dispatcher/lib/phase/act-wording.test.ts`

## File map

**Backend**

| File | Change |
|---|---|
| `backend/app/db/models/enums.py` | `SealNumberSource`, `EvidenceRole.LINEHAUL_PDF` |
| `backend/app/db/models/phases.py` | `seal_number_source`, `linehaul_pdf_artifact_id` columns |
| `backend/migrations/versions/2026_10_15_tim_add_seal_source_and_linehaul_pdf.py` | new migration |
| `backend/app/schemas/phases.py` | request and read fields |
| `backend/app/orchestration/phases/advance_departure.py`, `advance_arrival.py` | store `seal_number_source` |
| `backend/app/core/phase_meta.py` | loading accepts `linehaul_pdf` |
| `backend/app/orchestration/phases/artifacts.py` | PDF role must be a stored PDF |
| `backend/app/orchestration/phases/payloads.py` | loading v3 builder |
| `backend/app/orchestration/phases/advance_loading.py` | cite the PDF, anchor v3 |
| `backend/app/orchestration/verification/phase_payloads.py` | verify loading v3 |
| `backend/app/orchestration/audit_packs/builder.py`, `backend/app/schemas/audit_pack.py` | linehaul tiers, PDF role |
| Tests | `tests/unit/test_phase_model_schema.py`, `tests/integration/test_phases.py`, `tests/unit/test_phase_anchor_payload.py`, `tests/baseline/test_b3_canonical_hashes.py`, `tests/integration/test_audit_pack_builder.py`, `tests/integration/test_every_phase_anchoring.py`, `tests/baseline/snapshots/openapi.json` (regenerated) |

**Driver app** (`frontend/driver-pwa/`)

| File | Change |
|---|---|
| `package.json`, `android/**`, `ios/**` | Capacitor 7 and the three new packages |
| `lib/ocr/parseSeal.ts` | new: text to seal candidates |
| `lib/ocr/sealSource.ts` | new: capture tag and the overwrite rule |
| `lib/ocr/readSeal.ts` | new: native OCR wrapper |
| `lib/hooks/useSealOcr.ts` | new: reading state and stale-result guard |
| `lib/scan/buildLinehaulPdf.ts` | new: A4 PDF from a JPEG |
| `lib/scan/scanLinehaulSheet.ts` | new: native scanner wrapper |
| `lib/types/evidence-draft.ts`, `app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx` | draft fields |
| `lib/api/phases.ts`, `lib/api/artifacts.ts` | wire fields, filename extension |
| `components/phase/CameraCapture.tsx` | optional `nativeSource` |
| `components/phase/SealInput.tsx`, `components/phase/steps/departure/CaptureSeal.tsx`, `components/phase/steps/arrival/SealVerify.tsx`, `components/phase/steps/loading/Linehaul.tsx` | step changes |

**Shared and dispatcher:** `frontend/shared/lib/types/evidence.ts`, `frontend/shared/lib/types/phase.ts`, `frontend/shared/lib/constants/phase-meta.ts`, `frontend/dispatcher/lib/phase/act-wording.ts` and its test.

---

# Stage A: Capacitor 6 → 7

### Task A1: Upgrade the driver app to Capacitor 7

**Files:**
- Modify: `frontend/driver-pwa/package.json`, `frontend/driver-pwa/package-lock.json`
- Modify (by `cap migrate`): `frontend/driver-pwa/android/variables.gradle`, `android/build.gradle`, `android/gradle/wrapper/gradle-wrapper.properties`, `android/app/**`, `ios/App/**`

- [ ] **Step 1: Check the toolchain**

Run: `cd frontend/driver-pwa && node -v && java -version`
Expected: Node `v22.x`, and Java 21 (Capacitor 7's Android build needs JDK 21). If Java is older, stop and tell Tim. Android Studio Ladybug or later bundles JDK 21.

- [ ] **Step 2: Bump the Capacitor packages in `package.json`**

In `dependencies`:
```json
"@capacitor/android": "^7.6.9",
"@capacitor/camera": "^7.0.5",
"@capacitor/core": "^7.6.9",
"@capacitor/geolocation": "^7.1.8",
"@capacitor/haptics": "^7.0.5",
"@capacitor/ios": "^7.6.9",
"@capacitor/push-notifications": "^7.0.7",
"@capacitor/status-bar": "^7.0.6",
```
In `devDependencies`:
```json
"@capacitor/cli": "^7.6.9",
```

- [ ] **Step 3: Install**

Run: `cd frontend/driver-pwa && npm install`
Expected: no peer-dependency errors for `@capacitor/*`.

- [ ] **Step 4: Migrate the native projects**

Run: `cd frontend/driver-pwa && npx cap migrate`
Then: `git diff --stat -- android ios`
Expected: `android/variables.gradle` now has `minSdkVersion = 23`, `compileSdkVersion = 35` and `targetSdkVersion = 35`. The AGP classpath is `8.7.x` and the Gradle wrapper `8.11.x`. If `cap migrate` reports a step it could not apply, copy its message into the task report and stop.

- [ ] **Step 5: Web build and tests**

Run: `cd frontend/driver-pwa && npm run type-check && npm run lint && npm test && npm run build`
Expected: all pass. Capacitor 7's JS API for the plugins used here is unchanged, so no code edits should be needed. If type-check fails on a plugin type, report the exact error. Do not work around it.

- [ ] **Step 6: Sync both platforms**

Run: `cd frontend/driver-pwa && npm run cap:sync && npm run cap:sync:ios`
Expected: both finish with "Sync finished".

- [ ] **Step 7: Device check (Tim, manual)**

On a real Android phone and the iPhone, install and log in, then check:
- the trip page loads
- a photo step opens the camera, and cancelling is silent
- the location prompt still appears
- push permission is requested
- the status bar is still black

- [ ] **Step 8: Stage**

```bash
git add frontend/driver-pwa/package.json frontend/driver-pwa/package-lock.json frontend/driver-pwa/android frontend/driver-pwa/ios
```
Suggested commit: `chore(driver-pwa): upgrade Capacitor 6 to 7`

---

# Stage B: Seal OCR

### Task B1: Backend columns and migration (for both stages)

**Files:**
- Modify: `backend/app/db/models/enums.py`
- Modify: `backend/app/db/models/phases.py`
- Create: `backend/migrations/versions/2026_10_15_tim_add_seal_source_and_linehaul_pdf.py`
- Test: `backend/tests/unit/test_phase_model_schema.py`

- [ ] **Step 1: Write the failing test** (append to `backend/tests/unit/test_phase_model_schema.py`; add the imports if missing)

```python
from app.db.models.enums import SealNumberSource
from app.db.models.phases import PhaseEvent


def test_seal_number_source_values_are_the_three_capture_methods():
    assert {s.value for s in SealNumberSource} == {"ocr_confirmed", "ocr_corrected", "typed"}


def test_phase_events_has_nullable_seal_source_and_linehaul_pdf_columns():
    columns = PhaseEvent.__table__.c

    assert columns.seal_number_source.nullable is True
    assert columns.linehaul_pdf_artifact_id.nullable is True
    (fk,) = columns.linehaul_pdf_artifact_id.foreign_keys
    assert fk.target_fullname == "evidence_artifacts.id"
    assert fk.name == "fk_phase_linehaul_pdf"
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && .venv/bin/pytest -q tests/unit/test_phase_model_schema.py -k "seal_number_source or linehaul_pdf"`
Expected: FAIL with `ImportError: cannot import name 'SealNumberSource'`.

- [ ] **Step 3: Add the enum** in `backend/app/db/models/enums.py`, directly after `class SealCondition`:

```python
class SealNumberSource(str, enum.Enum):
    """How the seal number on a departure or arrival row was entered on the phone.

    Recorded, never anchored: it describes the capture, not the seal, and keeping it out
    of the payload leaves the departure and arrival anchor contracts unchanged."""

    OCR_CONFIRMED = "ocr_confirmed"
    OCR_CORRECTED = "ocr_corrected"
    TYPED         = "typed"
```

- [ ] **Step 4: Add the columns** in `backend/app/db/models/phases.py`

After the `seal_condition` column:
```python
    # Departure and arrival only: how seal_number was entered (SealNumberSource). Plain
    # String like seal_condition. NULL from older app builds and replayed queue entries,
    # meaning "unknown", never guessed.
    seal_number_source: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
```
After the `linehaul_photo_artifact_id` column:
```python
    # The scanned linehaul sheet as a one-page PDF, built on the phone from the same scan
    # as linehaul_photo_artifact_id and anchored with it in loading payload v3. Optional:
    # a failed PDF build must never block loading.
    linehaul_pdf_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_linehaul_pdf"),
        nullable=True,
    )
```

- [ ] **Step 5: Run the test again**

Run: same as Step 2. Expected: 2 passed.

- [ ] **Step 6: Check for migration conflicts before writing the file**

Run: `git fetch origin && git log --oneline HEAD..origin/dev -- backend/migrations/versions && cd backend && .venv/bin/alembic heads`
Expected: no new migration commits on `origin/dev`, and the single head is `tim_precinct_geofence_polygon`. If either differs, stop and tell Tim; do not re-chain someone else's migration.

- [ ] **Step 7: Write the migration by hand.** Don't use autogenerate: on this repo it emits 28 unrelated destructive operations. Create `backend/migrations/versions/2026_10_15_tim_add_seal_source_and_linehaul_pdf.py`:

```python
"""add seal_number_source and linehaul_pdf_artifact_id to phase_events

seal_number_source records how a departure or arrival seal number was entered on the
phone: read by on-device OCR and confirmed, OCR corrected by the driver, or typed.
Recorded, never anchored. linehaul_pdf_artifact_id is the scanned linehaul sheet as a
PDF, anchored with the scan image in loading payload v3.

Both nullable: older app builds send neither, and a failed PDF build must not block
loading.

Revision ID: tim_seal_source_linehaul_pdf
Revises: tim_precinct_geofence_polygon
Create Date: 2026-10-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "tim_seal_source_linehaul_pdf"
down_revision = "tim_precinct_geofence_polygon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("phase_events", sa.Column("seal_number_source", sa.String(20), nullable=True))
    op.add_column(
        "phase_events",
        sa.Column(
            "linehaul_pdf_artifact_id",
            UUID(as_uuid=True),
            sa.ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_linehaul_pdf"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_constraint("fk_phase_linehaul_pdf", "phase_events", type_="foreignkey")
    op.drop_column("phase_events", "linehaul_pdf_artifact_id")
    op.drop_column("phase_events", "seal_number_source")
```

- [ ] **Step 8: Verify the migration**

Run: `cd backend && grep -nE "op\.[a-z_]+\(" migrations/versions/2026_10_15_tim_add_seal_source_and_linehaul_pdf.py && .venv/bin/alembic heads`
Expected: exactly 5 `op.` lines (2 `add_column`, 1 `drop_constraint`, 2 `drop_column`), and the single head is `tim_seal_source_linehaul_pdf`. **Do not run `alembic upgrade`.**

- [ ] **Step 9: Run the model and lockdown tests**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/unit/test_phase_model_schema.py tests/unit/test_data_api_lockdown_coverage.py`
Expected: all pass.

- [ ] **Step 10: Stage**

```bash
git add backend/app/db/models/enums.py backend/app/db/models/phases.py backend/migrations/versions/2026_10_15_tim_add_seal_source_and_linehaul_pdf.py backend/tests/unit/test_phase_model_schema.py
```
Suggested commit: `feat(db): add seal_number_source and linehaul_pdf_artifact_id to phase_events`

---

### Task B2: Backend accepts and stores `seal_number_source`

**Files:**
- Modify: `backend/app/schemas/phases.py`
- Modify: `backend/app/orchestration/phases/advance_departure.py`
- Modify: `backend/app/orchestration/phases/advance_arrival.py`
- Test: `backend/tests/integration/test_phases.py` (append at the end of the file)

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/integration/test_phases.py`; every helper used already exists in that file)

```python
async def _complete_departure_with(client: AsyncClient, db_session, trip, token: str, **fields: Any):
    """activation and loading, then departure carrying the given extra fields."""
    await _complete_activation(client, trip.id, token)
    assert (await _complete_loading(client, trip, token)).status_code == 200
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_id(client, trip.id, token, "departure")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
        json={
            "phase_type": "departure", "seal_number": "AB-1234",
            "seal_photo_artifact_id": seal_photo_id,
            "idempotency_key": str(uuid.uuid4()), **fields,
        },
        headers=auth_header(token),
    )
    return departure_id, resp


async def _complete_arrival_with(client: AsyncClient, db_session, trip, token: str, **fields: Any):
    """Walk to arrival, then complete it with the given fields."""
    await _walk_to_in_transit(client, db_session, trip, token)
    await _complete_in_transit(client, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    arrival_id = await _phase_id(client, trip.id, token, "arrival")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{arrival_id}/complete",
        json={
            "phase_type": "arrival", "seal_photo_artifact_id": seal_photo_id,
            "idempotency_key": str(uuid.uuid4()), **fields,
        },
        headers=auth_header(token),
    )
    return arrival_id, resp


async def test_departure_complete_records_how_the_seal_number_was_entered(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    departure_id, resp = await _complete_departure_with(
        client, db_session, trip, token, seal_number_source="ocr_corrected",
    )

    assert resp.status_code == 200, resp.text
    row = next(p for p in resp.json()["phases"] if p["phase_type"] == "departure")
    assert row["seal_number_source"] == "ocr_corrected"
    event = await db_session.get(PhaseEvent, uuid.UUID(departure_id))
    assert event.seal_number_source == "ocr_corrected"


async def test_departure_complete_without_seal_number_source_stores_null(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    departure_id, resp = await _complete_departure_with(client, db_session, trip, token)

    assert resp.status_code == 200, resp.text
    event = await db_session.get(PhaseEvent, uuid.UUID(departure_id))
    assert event.seal_number_source is None


async def test_departure_complete_rejects_an_unknown_seal_number_source(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    _departure_id, resp = await _complete_departure_with(
        client, db_session, trip, token, seal_number_source="scanned",
    )

    assert resp.status_code == 422


async def test_arrival_complete_records_how_the_seal_number_was_entered(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    arrival_id, resp = await _complete_arrival_with(
        client, db_session, trip, token, seal_condition="intact",
        seal_number_at_arrival="AB-1234", seal_number_source="ocr_confirmed",
    )

    assert resp.status_code == 200, resp.text
    event = await db_session.get(PhaseEvent, uuid.UUID(arrival_id))
    assert event.seal_number_source == "ocr_confirmed"


async def test_arrival_with_a_missing_seal_stores_no_seal_number_source(
    client: AsyncClient, db_session, seed_trip,
):
    """A missing seal has no number, so there is no way it was entered to record."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    arrival_id, resp = await _complete_arrival_with(
        client, db_session, trip, token, seal_condition="missing", seal_number_source="typed",
    )

    assert resp.status_code == 200, resp.text
    event = await db_session.get(PhaseEvent, uuid.UUID(arrival_id))
    assert event.seal_number_source is None
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/integration/test_phases.py -k "seal_number_source or how_the_seal_number"`
Expected: FAIL. The 200 cases fail on `KeyError: 'seal_number_source'`; the 422 case gets a 200, because Pydantic ignores the unknown field.

- [ ] **Step 3: Add the request and read fields** in `backend/app/schemas/phases.py`

Add `SealNumberSource` to the existing `from app.db.models.enums import (...)` import.

In `PhaseEventRead`, after `seal_condition: Optional[SealCondition] = None`:
```python
    seal_number_source: Optional[SealNumberSource] = None
```
In `DepartureCompleteRequest`, after `seal_number_confirmed`:
```python
    # How seal_number was entered on the phone. Optional: older builds and replayed queue
    # entries do not send it, and NULL then records "unknown" rather than a guess.
    seal_number_source: Optional[SealNumberSource] = None
```
In `ArrivalCompleteRequest`, after `seal_photo_artifact_id: UUID`:
```python
    # How seal_number_at_arrival was entered. Ignored for a missing seal (no number).
    seal_number_source: Optional[SealNumberSource] = None
```

- [ ] **Step 4: Store it on departure** in `backend/app/orchestration/phases/advance_departure.py`, directly after `event.seal_photo_artifact_id = payload.seal_photo_artifact_id`:

```python
    # Recorded, never anchored: how the number was entered says nothing about the seal,
    # and keeping it out of the payload leaves departure's anchor contract unchanged.
    event.seal_number_source = (
        payload.seal_number_source.value if payload.seal_number_source is not None else None
    )
```

- [ ] **Step 5: Store it on arrival** in `backend/app/orchestration/phases/advance_arrival.py`, directly after `event.seal_photo_artifact_id = payload.seal_photo_artifact_id`:

```python
    # Not anchored, as at departure. A missing seal has no number, so nothing to record.
    event.seal_number_source = (
        payload.seal_number_source.value
        if payload.seal_number_source is not None and seal_at_arrival is not None
        else None
    )
```

- [ ] **Step 6: Run the new tests again**

Run: same as Step 2. Expected: 5 passed.

- [ ] **Step 7: Confirm the anchor contracts are untouched**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/baseline/test_b3_canonical_hashes.py tests/unit/test_phase_anchor_payload.py tests/integration/test_every_phase_anchoring.py`
Expected: all pass.

- [ ] **Step 8: Regenerate the B1 API snapshot** (the schemas gained a field)

Run: `cd backend && UPDATE_SNAPSHOTS=1 .venv/bin/pytest -q tests/baseline/test_b1_api_contract.py && git diff --stat tests/baseline/snapshots`
Expected: only `openapi.json` changes. Review it with `git diff tests/baseline/snapshots/openapi.json | grep '^[+-]' | grep -v '^+++\|^---'`. Every change must be an addition of `seal_number_source` or the `SealNumberSource` enum schema. If anything else changed, stop and report it.

- [ ] **Step 9: Stage**

```bash
git add backend/app/schemas/phases.py backend/app/orchestration/phases/advance_departure.py backend/app/orchestration/phases/advance_arrival.py backend/tests/integration/test_phases.py backend/tests/baseline/snapshots/openapi.json
```
Suggested commit: `feat(orchestration): record how departure and arrival seal numbers were entered`

---

### Task B3: Seal text parser (driver app)

**Files:**
- Create: `frontend/driver-pwa/lib/ocr/parseSeal.ts`
- Test: `frontend/driver-pwa/lib/ocr/__tests__/parseSeal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/driver-pwa/lib/ocr/__tests__/parseSeal.test.ts
import { describe, expect, it } from 'vitest'
import { parseSealCandidates } from '../parseSeal'

describe('parseSealCandidates', () => {
  it.each([
    ['AB-1234', ['AB-1234']],
    ['seal no: ab 1234', ['AB-1234']],
    ['AB1234', ['AB-1234']],
  ])('reads %j as %j', (text, expected) => {
    expect(parseSealCandidates(text)).toEqual(expected)
  })

  it('maps look-alike digits on the letter side and look-alike letters on the number side', () => {
    expect(parseSealCandidates('8O-1O34')).toEqual(['BO-1034'])
    expect(parseSealCandidates('05 5B1L')).toEqual(['OS-5811'])
  })

  it('returns every distinct number it can see, so the caller can refuse to guess', () => {
    expect(parseSealCandidates('AB-1234\nCD-5678')).toEqual(['AB-1234', 'CD-5678'])
  })

  it('counts the same number read twice once', () => {
    expect(parseSealCandidates('AB-1234 AB 1234')).toEqual(['AB-1234'])
  })

  it.each(['FREIGHTPROOF', 'AB-12345', '', 'A-1234'])('finds nothing in %j', (text) => {
    expect(parseSealCandidates(text)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/ocr/__tests__/parseSeal.test.ts`
Expected: FAIL, "Failed to resolve import ../parseSeal".

- [ ] **Step 3: Implement**

```ts
// frontend/driver-pwa/lib/ocr/parseSeal.ts
//
// Turns the text OCR read off a seal photo into seal-number candidates.
//
// Seal print is small, embossed and often curved, so OCR routinely swaps letters and
// digits that look alike. The format is fixed (XX-####, lib/utils/seal-format.ts), which
// says which half each character belongs to, so a look-alike is mapped back by position
// rather than guessed.
import { isValidSealFormat } from '@/lib/utils/seal-format'

// Two characters, an optional space or dash, four characters, on word boundaries so a
// longer code ("AB-12345") is not read as a seal. Loose on purpose: the position maps
// below decide what each character really is.
const CANDIDATE = /\b([A-Z0-9]{2})[\s-]?([A-Z0-9]{4})\b/g

const AS_LETTER: Readonly<Record<string, string>> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B' }
const AS_DIGIT: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1', S: '5', B: '8' }

function mapChars(part: string, map: Readonly<Record<string, string>>): string {
  return part.split('').map((c) => map[c] ?? c).join('')
}

export function parseSealCandidates(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.toUpperCase().matchAll(CANDIDATE)) {
    const [, letters = '', digits = ''] = match
    const value = `${mapChars(letters, AS_LETTER)}-${mapChars(digits, AS_DIGIT)}`
    if (isValidSealFormat(value)) found.add(value)
  }
  return [...found]
}
```

- [ ] **Step 4: Run it again**

Run: same as Step 2. Expected: all pass.

- [ ] **Step 5: Stage**

```bash
git add frontend/driver-pwa/lib/ocr/parseSeal.ts frontend/driver-pwa/lib/ocr/__tests__/parseSeal.test.ts
```
Suggested commit: `feat(driver-pwa): parse seal numbers out of OCR text`

---

### Task B4: Capture tag and overwrite rule

**Files:**
- Create: `frontend/driver-pwa/lib/ocr/sealSource.ts`
- Test: `frontend/driver-pwa/lib/ocr/__tests__/sealSource.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/driver-pwa/lib/ocr/__tests__/sealSource.test.ts
import { describe, expect, it } from 'vitest'
import { canReplaceWithOcr, sealNumberSource } from '../sealSource'

describe('sealNumberSource', () => {
  it('is ocr_confirmed when the driver kept what OCR read', () => {
    expect(sealNumberSource('AB-1234', 'AB-1234')).toBe('ocr_confirmed')
  })

  it('is ocr_corrected when the driver changed what OCR read', () => {
    expect(sealNumberSource('AB-1284', 'AB-1234')).toBe('ocr_corrected')
  })

  it('is typed when OCR read nothing', () => {
    expect(sealNumberSource(null, 'AB-1234')).toBe('typed')
  })
})

describe('canReplaceWithOcr', () => {
  it.each([
    [null, null, true],
    ['', null, true],
    ['  ', 'AB-1234', true],
    ['AB-1234', 'AB-1234', true],
    ['AB-9999', 'AB-1234', false],
    ['AB-9999', null, false],
  ] as const)('field %j after previous read %j -> %j', (current, previousOcr, expected) => {
    expect(canReplaceWithOcr(current, previousOcr)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/ocr/__tests__/sealSource.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement**

```ts
// frontend/driver-pwa/lib/ocr/sealSource.ts
//
// How the seal number on a departure or arrival was entered. Sent as seal_number_source,
// stored server-side and never anchored (spec D6). Kept local to this app: the dispatcher
// reads it from the API, and shared/ is not changed for a value only this app produces.
export type SealNumberSource = 'ocr_confirmed' | 'ocr_corrected' | 'typed'

export function sealNumberSource(ocrValue: string | null, finalValue: string): SealNumberSource {
  if (ocrValue === null) return 'typed'
  return ocrValue === finalValue ? 'ocr_confirmed' : 'ocr_corrected'
}

// A new OCR result may replace the field only while the driver has not made it their own:
// empty, or still exactly what the previous read put there. Their typing is never lost.
export function canReplaceWithOcr(current: string | null, previousOcr: string | null): boolean {
  if (current === null || current.trim() === '') return true
  return previousOcr !== null && current === previousOcr
}
```

- [ ] **Step 4: Run it again.** Expected: all pass.

- [ ] **Step 5: Stage**

```bash
git add frontend/driver-pwa/lib/ocr/sealSource.ts frontend/driver-pwa/lib/ocr/__tests__/sealSource.test.ts
```
Suggested commit: `feat(driver-pwa): derive how a seal number was entered`

---

### Task B5: Native OCR wrapper

**Files:**
- Modify: `frontend/driver-pwa/package.json` (new dependency)
- Create: `frontend/driver-pwa/lib/ocr/readSeal.ts`
- Test: `frontend/driver-pwa/lib/ocr/__tests__/readSeal.test.ts`

- [ ] **Step 1: Install the plugin**

Run: `cd frontend/driver-pwa && npm install @capacitor-community/image-to-text@7.0.0`
Expected: added without peer errors; this needs Task A1 done.

- [ ] **Step 2: Write the failing test**

```ts
// frontend/driver-pwa/lib/ocr/__tests__/readSeal.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsNative, mockDetectText } = vi.hoisted(() => ({
  mockIsNative: vi.fn(),
  mockDetectText: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mockIsNative() } }))
vi.mock('@capacitor-community/image-to-text', () => ({
  Ocr: { detectText: (...args: unknown[]) => mockDetectText(...args) },
}))

import { readSealFromPhoto, SEAL_OCR_TIMEOUT_MS } from '../readSeal'

const PHOTO = 'data:image/jpeg;base64,AAAA'

function detections(...lines: string[]) {
  return { textDetections: lines.map((text) => ({ text })) }
}

describe('readSealFromPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsNative.mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is unavailable in the browser and never calls the plugin', async () => {
    mockIsNative.mockReturnValue(false)

    expect(await readSealFromPhoto(PHOTO)).toEqual({ kind: 'unavailable' })
    expect(mockDetectText).not.toHaveBeenCalled()
  })

  it('sends the base64 without the data-URL prefix and returns the one number it found', async () => {
    mockDetectText.mockResolvedValue(detections('TYDENBROOKS', 'AB-1234'))

    expect(await readSealFromPhoto(PHOTO)).toEqual({ kind: 'found', value: 'AB-1234' })
    expect(mockDetectText).toHaveBeenCalledWith({ base64: 'AAAA' })
  })

  it('reports none when nothing seal-shaped was read', async () => {
    mockDetectText.mockResolvedValue(detections('NO SEAL HERE'))

    expect(await readSealFromPhoto(PHOTO)).toEqual({ kind: 'none' })
  })

  it('reports none rather than guess between two different numbers', async () => {
    mockDetectText.mockResolvedValue(detections('AB-1234', 'CD-5678'))

    expect(await readSealFromPhoto(PHOTO)).toEqual({ kind: 'none' })
  })

  it('is unavailable when the plugin throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockDetectText.mockRejectedValue(new Error('ML Kit not ready'))

    expect(await readSealFromPhoto(PHOTO)).toEqual({ kind: 'unavailable' })
  })

  it('gives up after the timeout so the driver is never kept waiting', async () => {
    vi.useFakeTimers()
    mockDetectText.mockReturnValue(new Promise(() => {}))

    const pending = readSealFromPhoto(PHOTO)
    await vi.advanceTimersByTimeAsync(SEAL_OCR_TIMEOUT_MS)

    expect(await pending).toEqual({ kind: 'unavailable' })
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/ocr/__tests__/readSeal.test.ts`
Expected: FAIL, unresolved import `../readSeal`.

- [ ] **Step 4: Implement**

```ts
// frontend/driver-pwa/lib/ocr/readSeal.ts
//
// Reads the seal number off the seal photo with the phone's own text recognition (ML Kit
// on Android, Apple Vision on iOS). On-device: the photo is not sent anywhere for this,
// it works without signal, and it costs nothing per photo. The browser PWA has no
// equivalent, so it reports 'unavailable' and the driver types the number as before.
import { Capacitor } from '@capacitor/core'
import { Ocr } from '@capacitor-community/image-to-text'
import { parseSealCandidates } from './parseSeal'

export type SealReading =
  | { kind: 'found'; value: string }
  | { kind: 'none' }
  | { kind: 'unavailable' }

// Long enough for a mid-range phone, short enough that a driver who starts typing is
// never waiting on it. The field stays editable throughout either way.
export const SEAL_OCR_TIMEOUT_MS = 4000

const DATA_URL_PREFIX = /^data:[^,]*,/

const TIMED_OUT = Symbol('timed out')

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err: unknown) => { clearTimeout(timer); reject(err) },
    )
  })
}

export async function readSealFromPhoto(dataUrl: string): Promise<SealReading> {
  if (!Capacitor.isNativePlatform()) return { kind: 'unavailable' }
  try {
    const result = await withTimeout(
      Ocr.detectText({ base64: dataUrl.replace(DATA_URL_PREFIX, '') }),
      SEAL_OCR_TIMEOUT_MS,
    )
    if (result === TIMED_OUT) return { kind: 'unavailable' }
    const candidates = parseSealCandidates(result.textDetections.map((d) => d.text).join('\n'))
    // Exactly one, or nothing: with two different numbers in view there is no telling
    // which is the seal, and a wrong pre-fill is worse than an empty field.
    const [only] = candidates
    return candidates.length === 1 && only !== undefined ? { kind: 'found', value: only } : { kind: 'none' }
  } catch (err: unknown) {
    console.warn('Seal OCR failed — the driver types the number instead', err)
    return { kind: 'unavailable' }
  }
}
```

- [ ] **Step 5: Run it again.** Expected: 6 passed.

- [ ] **Step 6: Stage**

```bash
git add frontend/driver-pwa/package.json frontend/driver-pwa/package-lock.json frontend/driver-pwa/lib/ocr/readSeal.ts frontend/driver-pwa/lib/ocr/__tests__/readSeal.test.ts
```
Suggested commit: `feat(driver-pwa): read seal numbers with on-device OCR`

---

### Task B6: `useSealOcr` hook

**Files:**
- Create: `frontend/driver-pwa/lib/hooks/useSealOcr.ts`
- Test: `frontend/driver-pwa/lib/hooks/__tests__/useSealOcr.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/driver-pwa/lib/hooks/__tests__/useSealOcr.test.ts
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SealReading } from '@/lib/ocr/readSeal'

const { mockRead } = vi.hoisted(() => ({ mockRead: vi.fn() }))
vi.mock('@/lib/ocr/readSeal', () => ({ readSealFromPhoto: (...a: unknown[]) => mockRead(...a) }))

import { useSealOcr } from '../useSealOcr'

function deferred() {
  let resolve: (r: SealReading) => void = () => {}
  const promise = new Promise<SealReading>((r) => { resolve = r })
  return { promise, resolve }
}

describe('useSealOcr', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the number read and shows reading while it runs', async () => {
    const pending = deferred()
    mockRead.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useSealOcr())

    let outcome: Promise<unknown> = Promise.resolve()
    act(() => { outcome = result.current.readSeal('photo-1') })
    expect(result.current.reading).toBe(true)

    await act(async () => { pending.resolve({ kind: 'found', value: 'AB-1234' }) })

    expect(await outcome).toEqual({ stale: false, value: 'AB-1234' })
    expect(result.current.reading).toBe(false)
  })

  it('treats none and unavailable alike: no value', async () => {
    mockRead.mockResolvedValue({ kind: 'unavailable' })
    const { result } = renderHook(() => useSealOcr())

    let outcome: unknown
    await act(async () => { outcome = await result.current.readSeal('photo-1') })

    expect(outcome).toEqual({ stale: false, value: null })
  })

  it('marks an earlier read stale once a retake has started a newer one', async () => {
    const first = deferred()
    const second = deferred()
    mockRead.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useSealOcr())

    let firstOutcome: Promise<unknown> = Promise.resolve()
    let secondOutcome: Promise<unknown> = Promise.resolve()
    act(() => {
      firstOutcome = result.current.readSeal('photo-1')
      secondOutcome = result.current.readSeal('photo-2')
    })
    await act(async () => {
      second.resolve({ kind: 'found', value: 'CD-5678' })
      first.resolve({ kind: 'found', value: 'AB-1234' })
    })

    expect(await firstOutcome).toEqual({ stale: true })
    expect(await secondOutcome).toEqual({ stale: false, value: 'CD-5678' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/hooks/__tests__/useSealOcr.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement**

```ts
// frontend/driver-pwa/lib/hooks/useSealOcr.ts
'use client'

// Runs seal OCR for a step and says whether the answer still matters when it arrives.
// A retake starts a new read, and reads resolve in whatever order the phone finishes
// them, so only the latest read for this step may touch the draft. Same per-request
// counter idea as useArtifactUpload.

import { useCallback, useEffect, useRef, useState } from 'react'
import { readSealFromPhoto } from '@/lib/ocr/readSeal'

export type SealOcrResult = { stale: true } | { stale: false; value: string | null }

export interface SealOcrState {
  reading: boolean
  readSeal: (dataUrl: string) => Promise<SealOcrResult>
}

export function useSealOcr(): SealOcrState {
  const [reading, setReading] = useState(false)
  const latestRequest = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const readSeal = useCallback(async (dataUrl: string): Promise<SealOcrResult> => {
    latestRequest.current += 1
    const request = latestRequest.current
    setReading(true)
    const answer = await readSealFromPhoto(dataUrl)
    if (!mounted.current || request !== latestRequest.current) return { stale: true }
    setReading(false)
    return { stale: false, value: answer.kind === 'found' ? answer.value : null }
  }, [])

  return { reading, readSeal }
}
```

- [ ] **Step 4: Run it again.** Expected: 3 passed.

- [ ] **Step 5: Stage**

```bash
git add frontend/driver-pwa/lib/hooks/useSealOcr.ts frontend/driver-pwa/lib/hooks/__tests__/useSealOcr.test.ts
```
Suggested commit: `feat(driver-pwa): add useSealOcr hook`

---

### Task B7: Draft fields and the wire field

**Files:**
- Modify: `frontend/driver-pwa/lib/types/evidence-draft.ts`
- Modify: `frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx`
- Modify: `frontend/driver-pwa/lib/api/phases.ts`
- Test: `frontend/driver-pwa/lib/api/__tests__/phases.test.ts`

- [ ] **Step 1: Write the failing tests** (add inside `describe('submitPhase (real-backend branch)', ...)` in `lib/api/__tests__/phases.test.ts`; `mockPost`, `mockUploadArtifact`, `IDEMPOTENCY_KEY`, `POSITION` and `DRIVER_CAPTURED_AT` are already defined there)

```ts
  it('sends ocr_confirmed when the departure seal number is what OCR read', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact.mockResolvedValue({ id: 'seal-artifact' })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-3', 'departure', {
      sealNumber: 'AB-1234', sealNumberOcr: 'AB-1234',
      sealPhotoDataUrl: 'data:image/jpeg;base64,AAAA', sealPhotoArtifactId: 'seal-artifact',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).toMatchObject({ seal_number_source: 'ocr_confirmed' })
  })

  it('sends typed for a departure draft saved before OCR existed', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-3', 'departure', {
      sealNumber: 'AB-1234',
      sealPhotoDataUrl: 'data:image/jpeg;base64,AAAA', sealPhotoArtifactId: 'seal-artifact',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).toMatchObject({ seal_number_source: 'typed' })
  })

  it('sends no seal_number_source for a missing seal at arrival', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'arrival', {
      sealCondition: 'missing', sealNumberAtArrival: null, sealNumberAtArrivalOcr: null,
      sealPhotoDataUrl: 'data:image/jpeg;base64,AAAA', sealPhotoArtifactId: 'seal-artifact',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('seal_number_source')
  })

  it('sends ocr_corrected when the arrival number differs from what OCR read', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'arrival', {
      sealCondition: 'intact', sealNumberAtArrival: 'AB-1234', sealNumberAtArrivalOcr: 'AB-1284',
      sealPhotoDataUrl: 'data:image/jpeg;base64,AAAA', sealPhotoArtifactId: 'seal-artifact',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).toMatchObject({ seal_number_source: 'ocr_corrected' })
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/api/__tests__/phases.test.ts`
Expected: the 3 new departure and intact-arrival tests FAIL with `seal_number_source` missing. The missing-seal test may already pass.

- [ ] **Step 3: Add the draft fields** in `lib/types/evidence-draft.ts`

In `DepartureEvidence`, after `sealNumber`:
```ts
  // What on-device OCR read off the seal photo (lib/ocr/readSeal.ts), or null when it read
  // nothing or could not run. Kept so the submit can tell confirmed from corrected from
  // typed. Optional: drafts saved before OCR existed have no key at all.
  sealNumberOcr?: string | null
```
In `ArrivalEvidence`, after `sealNumberAtArrival`:
```ts
  // As DepartureEvidence.sealNumberOcr, for the seal as found at the gate.
  sealNumberAtArrivalOcr?: string | null
```

- [ ] **Step 4: Seed them** in `PhaseStepPageClient.tsx`

```ts
const DEPARTURE_INITIAL: DepartureEvidence = {
  sealNumber: null, sealNumberOcr: null, sealPhotoDataUrl: null, sealPhotoArtifactId: null, capturedAt: null,
}
```
```ts
const ARRIVAL_INITIAL: ArrivalEvidence = {
  sealCondition: null, sealNumberAtArrival: null, sealNumberAtArrivalOcr: null,
  sealPhotoDataUrl: null, sealPhotoArtifactId: null, capturedAt: null,
}
```

- [ ] **Step 5: Send the field** in `lib/api/phases.ts`

Add the import:
```ts
import { sealNumberSource, type SealNumberSource } from '@/lib/ocr/sealSource'
```
In `interface DepartureCompleteRequest`, after `seal_photo_artifact_id: string`:
```ts
  seal_number_source: SealNumberSource
```
In `interface ArrivalCompleteRequest`, after `seal_number_at_arrival?: string`:
```ts
  // Omitted with the number when the seal is missing.
  seal_number_source?: SealNumberSource
```
In the `'departure'` case, in the `completePhase(...)` body after `seal_photo_artifact_id: sealPhotoId,`:
```ts
        // `?? null`: a departure queued by an older build has no OCR key, and was typed.
        seal_number_source: sealNumberSource(e.sealNumberOcr ?? null, e.sealNumber),
```
In the `'arrival'` case, replace the existing conditional spread with:
```ts
        ...(e.sealCondition === 'missing' ? {} : {
          seal_number_at_arrival: e.sealNumberAtArrival ?? undefined,
          seal_number_source: sealNumberSource(e.sealNumberAtArrivalOcr ?? null, e.sealNumberAtArrival ?? ''),
        }),
```

- [ ] **Step 6: Update the existing exact-match expectations**

The departure test `'uploads only the seal photo and completes departure ...'` and any arrival test that asserts the whole body with `toHaveBeenCalledWith` now also receive `seal_number_source: 'typed'`. Add that key to their expected objects; their fixtures have no OCR value, so `'typed'` is correct.

- [ ] **Step 7: Run the file and type-check**

Run: `cd frontend/driver-pwa && npx vitest run lib/api/__tests__/phases.test.ts && npm run type-check`
Expected: all pass, no type errors.

- [ ] **Step 8: Stage**

```bash
git add frontend/driver-pwa/lib/types/evidence-draft.ts "frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx" frontend/driver-pwa/lib/api/phases.ts frontend/driver-pwa/lib/api/__tests__/phases.test.ts
```
Suggested commit: `feat(driver-pwa): send seal_number_source with departure and arrival`

---

### Task B8: Departure: photo first, OCR pre-fill

**Files:**
- Modify: `frontend/driver-pwa/components/phase/SealInput.tsx`
- Modify: `frontend/driver-pwa/components/phase/steps/departure/CaptureSeal.tsx`
- Test: `frontend/driver-pwa/components/phase/steps/departure/__tests__/CaptureSeal.test.tsx`

- [ ] **Step 1: Mock OCR in the existing suite, then write the failing tests**

At the top of `CaptureSeal.test.tsx`, after the existing `vi.mock` blocks:
```tsx
// Seal OCR is mocked file-wide: 'unavailable' (the browser answer) unless a test says
// otherwise, so the older tests keep exercising typing exactly as before.
const { mockReadSeal } = vi.hoisted(() => ({ mockReadSeal: vi.fn() }))
vi.mock('@/lib/ocr/readSeal', () => ({ readSealFromPhoto: (...a: unknown[]) => mockReadSeal(...a) }))
```
In the existing top-level `beforeEach` (or add one), set:
```tsx
  mockReadSeal.mockResolvedValue({ kind: 'unavailable' })
```
Append:
```tsx
describe('CaptureSeal — reading the seal number from the photo', () => {
  it('puts the photo before the number', () => {
    renderStep()

    const photo = screen.getByRole('button', { name: 'Seal photo' })
    const input = screen.getByLabelText('Seal number')
    expect(photo.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('fills the number OCR read and asks the driver to check it', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(await screen.findByDisplayValue('AB-1234')).toBeInTheDocument()
    expect(screen.getByText('Read from the photo — check it matches the seal.')).toBeInTheDocument()
    expect(onUpdate).toHaveBeenCalledWith({ sealNumberOcr: 'AB-1234', sealNumber: 'AB-1234' })
  })

  it('never overwrites a number the driver typed', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    typeSealNumber('CD-5678')
    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ sealNumberOcr: 'AB-1234' }))
    expect(screen.getByDisplayValue('CD-5678')).toBeInTheDocument()
  })

  it('replaces an untouched earlier read when the seal is photographed again', async () => {
    mockReadSeal
      .mockResolvedValueOnce({ kind: 'found', value: 'AB-1234' })
      .mockResolvedValueOnce({ kind: 'found', value: 'AB-1284' })
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))
    await screen.findByDisplayValue('AB-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(await screen.findByDisplayValue('AB-1284')).toBeInTheDocument()
  })

  it('leaves the field for the driver when OCR is unavailable', async () => {
    const onUpdate = vi.fn()
    renderStep({ onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ sealNumberOcr: null })))
    expect(screen.getByLabelText('Seal number')).toHaveValue('')
  })
})
```
Add `waitFor` to the existing `@testing-library/react` import. Add `sealNumberOcr: null,` to `makeDraft`'s defaults.

- [ ] **Step 2: Run to see them fail**

Run: `cd frontend/driver-pwa && npx vitest run components/phase/steps/departure/__tests__/CaptureSeal.test.tsx`
Expected: the new tests FAIL; the old ones still pass.

- [ ] **Step 3: Update `SealInput.tsx`**

Replace the props interface and component with:
```tsx
interface SealInputProps {
  sealNumber: string | null
  sealPhotoDataUrl: string | null
  /** When the seal photo was taken, for the captured tile's timestamp. */
  sealPhotoCapturedAt?: string | null
  /** Shown in place of the format hint, the moment the typed number can't be valid. */
  formatError?: string
  /** Replaces the default format hint, e.g. to say the number was read from the photo. */
  hint?: string
  /** True while OCR is reading the photo. The field stays editable throughout. */
  reading?: boolean
  onSealNumberChange: (value: string) => void
  onSealPhotoCapture: (dataUrl: string) => void
  requirePhoto?: boolean
}

const NOTE_ID = 'seal-number-note'
const DEFAULT_HINT = 'Two letters, a dash, four digits.'

export function SealInput({
  sealNumber,
  sealPhotoDataUrl,
  sealPhotoCapturedAt = null,
  formatError,
  hint,
  reading = false,
  onSealNumberChange,
  onSealPhotoCapture,
  requirePhoto = true,
}: SealInputProps) {
  const note = formatError ?? (reading ? 'Reading the seal…' : hint ?? DEFAULT_HINT)
  return (
    // Photo first: the number is read from it (lib/ocr/readSeal.ts), so taking it first is
    // what lets the field arrive already filled for the driver to check.
    <div className="flex flex-col gap-6">
      {requirePhoto && (
        <CameraCapture
          label="Seal photo"
          actionLabel="Photograph the seal"
          hint="Number readable, seal on the door"
          dataUrl={sealPhotoDataUrl}
          capturedAt={sealPhotoCapturedAt}
          onCapture={onSealPhotoCapture}
        />
      )}
      <div className="flex flex-col gap-2">
        <Input
          label="Seal number"
          placeholder="AB-1234"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={NOTE_ID}
          aria-invalid={formatError !== undefined || undefined}
          aria-busy={reading || undefined}
          value={sealNumber ?? ''}
          onChange={(e) => onSealNumberChange(normalizeSeal(e.target.value))}
          // The number is read off a physical seal and compared against one later, so it
          // is set like a plate: larger, tracked out, each character distinct.
          className={cn('text-title-3 tracking-wider', formatError !== undefined && 'ring-2 ring-error focus-visible:ring-error')}
        />
        {/* Not Input's own error: that waits for blur, and this one is a guaranteed
            backend 422 the driver should see while still typing. */}
        <p id={NOTE_ID} aria-live="polite" className={cn('text-footnote', formatError !== undefined ? 'font-medium text-error' : 'text-surface-on-variant')}>
          {note}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update `CaptureSeal.tsx`**

Change the imports:
```tsx
import { useEffect, useRef } from 'react'
import { useSealOcr } from '@/lib/hooks/useSealOcr'
import { canReplaceWithOcr } from '@/lib/ocr/sealSource'
```
Inside the component, before `handleSealPhoto`:
```tsx
  const { reading, readSeal } = useSealOcr()
  // The OCR answer is judged against the draft as it is when the answer ARRIVES: the
  // driver may have typed while it ran, and that typing must win.
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
```
Replace `handleSealPhoto` with:
```tsx
  function handleSealPhoto(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ sealPhotoDataUrl: dataUrl, sealPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt, 'seal_photo').then((artifactId) => {
      if (artifactId !== null) onUpdate({ sealPhotoArtifactId: artifactId })
    })
    void readSeal(dataUrl).then((result) => {
      if (result.stale) return
      const current = draftRef.current
      // Replacing with null is deliberate: an untouched number read off a photo the driver
      // has since replaced must not survive as if it came from the new one.
      onUpdate(canReplaceWithOcr(current.sealNumber, current.sealNumberOcr ?? null)
        ? { sealNumberOcr: result.value, sealNumber: result.value }
        : { sealNumberOcr: result.value })
    })
  }

  const readFromPhoto = sealNumber !== '' && sealNumber === (draft.sealNumberOcr ?? null)
```
Change the `intro`:
```tsx
      intro="Photograph the seal, then check the number. The number is locked into the journey record."
```
In the `requirements` array, put the photo first:
```tsx
      requirements={[
        { label: 'Seal photo', met: draft.sealPhotoDataUrl !== null },
        { label: 'Seal number', met: sealFormatValid },
      ]}
```
Pass the new props to `SealInput`:
```tsx
        hint={readFromPhoto ? 'Read from the photo — check it matches the seal.' : undefined}
        reading={reading}
```
Change the `SwipeToConfirm` `waitingLabel` to `"Add photo and number"`.

- [ ] **Step 5: Run the suite and type-check**

Run: `cd frontend/driver-pwa && npx vitest run components/phase/steps/departure/__tests__/CaptureSeal.test.tsx && npm run type-check`
Expected: all pass. If an older test asserted the exact intro text, the requirement order or `"Add number and photo"`, update its expectation to the new wording.

- [ ] **Step 6: Stage**

```bash
git add frontend/driver-pwa/components/phase/SealInput.tsx frontend/driver-pwa/components/phase/steps/departure/CaptureSeal.tsx frontend/driver-pwa/components/phase/steps/departure/__tests__/CaptureSeal.test.tsx
```
Suggested commit: `feat(driver-pwa): pre-fill the departure seal number from the photo`

---

### Task B9: Arrival: photo before number, OCR pre-fill, still blind

**Files:**
- Modify: `frontend/driver-pwa/components/phase/steps/arrival/SealVerify.tsx`
- Test: `frontend/driver-pwa/components/phase/steps/arrival/__tests__/SealVerify.test.tsx`

- [ ] **Step 1: Mock OCR and write the failing tests**

Add the same file-wide `mockReadSeal` mock and `beforeEach` default as in Task B8, Step 1. Add `sealNumberAtArrivalOcr: null` to this file's `makeDraft` defaults, and `waitFor` to its testing-library import.

This file's `renderStep` is **not** stateful: it passes a fixed `draft` and a mock `onUpdate`. So the tests below seed state through `draft` and assert on `onUpdate`, not on re-rendered draft values.

```tsx
describe('SealVerify — reading the seal number from the photo', () => {
  it('fills the number read from the photo of the seal as found', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStep({ draft: makeDraft({ sealCondition: 'intact' }), onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(await screen.findByDisplayValue('AB-1234')).toBeInTheDocument()
    expect(onUpdate).toHaveBeenCalledWith({ sealNumberAtArrivalOcr: 'AB-1234', sealNumberAtArrival: 'AB-1234' })
  })

  it('tells the driver to check a number that came from the photo', () => {
    renderStep({ draft: makeDraft({
      sealCondition: 'intact', sealNumberAtArrival: 'AB-1234', sealNumberAtArrivalOcr: 'AB-1234',
    }) })

    expect(screen.getByText('Read from the photo — check it matches the seal.')).toBeInTheDocument()
  })

  it('never overwrites a number the driver typed', async () => {
    mockReadSeal.mockResolvedValue({ kind: 'found', value: 'AB-1234' })
    const onUpdate = vi.fn()
    renderStep({ draft: makeDraft({ sealCondition: 'intact', sealNumberAtArrival: 'CD-5678' }), onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ sealNumberAtArrivalOcr: 'AB-1234' }))
    expect(screen.getByLabelText('Seal number you see')).toHaveValue('CD-5678')
  })

  it('does not read a photo of a missing seal', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'missing' }) })

    fireEvent.click(screen.getByRole('button', { name: 'Seal photo' }))

    expect(mockReadSeal).not.toHaveBeenCalled()
  })

  it('puts the photo before the number', () => {
    renderStep({ draft: makeDraft({ sealCondition: 'intact' }) })

    const photo = screen.getByRole('button', { name: 'Seal photo' })
    const input = screen.getByLabelText('Seal number you see')
    expect(photo.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd frontend/driver-pwa && npx vitest run components/phase/steps/arrival/__tests__/SealVerify.test.tsx`
Expected: the new tests FAIL.

- [ ] **Step 3: Update `SealVerify.tsx`**

Imports: change `import { useState } from 'react'` to `import { useEffect, useRef, useState } from 'react'`, and add:
```tsx
import { useSealOcr } from '@/lib/hooks/useSealOcr'
import { canReplaceWithOcr } from '@/lib/ocr/sealSource'
```
Inside the component, after the `input` state:
```tsx
  const { reading, readSeal } = useSealOcr()
  // Judged when the OCR answer arrives, not when the photo was taken (see CaptureSeal).
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
```
Replace `handleSealPhoto` with:
```tsx
  // Upload starts at capture, not submit. Artifact id is cleared alongside the new data
  // URL so a re-shot photo can never submit under the previous shot's id.
  //
  // OCR stays blind entry: it reads the physical seal in this photo, never paperwork and
  // never the departure value. A missing seal has nothing to read.
  function handleSealPhoto(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ sealPhotoDataUrl: dataUrl, sealPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt, 'seal_photo').then((artifactId) => {
      if (artifactId !== null) onUpdate({ sealPhotoArtifactId: artifactId })
    })
    if (draft.sealCondition === 'missing') return
    void readSeal(dataUrl).then((result) => {
      const current = draftRef.current
      if (result.stale || current.sealCondition === 'missing') return
      if (canReplaceWithOcr(current.sealNumberAtArrival, current.sealNumberAtArrivalOcr ?? null)) {
        setInput(result.value ?? '')
        onUpdate({ sealNumberAtArrivalOcr: result.value, sealNumberAtArrival: result.value })
      } else {
        onUpdate({ sealNumberAtArrivalOcr: result.value })
      }
    })
  }
```
In `handleConditionChange`, the `missing` branch becomes:
```tsx
      onUpdate({ sealCondition: condition, sealNumberAtArrival: null, sealNumberAtArrivalOcr: null })
```
Add, before `waitingLabel`:
```tsx
  const readFromPhoto = input !== '' && input === (draft.sealNumberAtArrivalOcr ?? null)
```
In the JSX, move the `<CameraCapture ... />` block so it sits directly after the condition `<section>` and before the `{isMissing ? (...) : (...)}` block. In the number note `<p>`, change its text expression to:
```tsx
            {showFormatHint
              ? 'Seal number must look like AB-1234 (two letters, four digits).'
              : reading
                ? 'Reading the seal…'
                : readFromPhoto
                  ? 'Read from the photo — check it matches the seal.'
                  : 'Type what is printed. Don’t copy it from paperwork.'}
```
Give that `<p>` `aria-live="polite"`. Reorder `requirements` so the photo comes before the number:
```tsx
      requirements={[
        { label: 'Seal condition', met: draft.sealCondition !== null },
        { label: 'Seal photo', met: hasPhoto },
        // A missing seal has no number to record, so it drops off the list entirely.
        ...(isMissing ? [] : [{ label: 'Seal number', met: numberSatisfied }]),
      ]}
```
Update `waitingLabel` to the new order:
```tsx
  const waitingLabel = draft.sealCondition === null
    ? 'Choose the seal condition'
    : !hasPhoto ? 'Add the photo first' : 'Add the seal number'
```

- [ ] **Step 4: Run the suite and type-check**

Run: `cd frontend/driver-pwa && npx vitest run components/phase/steps/arrival/__tests__/SealVerify.test.tsx && npm run type-check`
Expected: all pass. Update any older assertion that pinned the previous waiting-label order.

- [ ] **Step 5: Stage**

```bash
git add frontend/driver-pwa/components/phase/steps/arrival/SealVerify.tsx frontend/driver-pwa/components/phase/steps/arrival/__tests__/SealVerify.test.tsx
```
Suggested commit: `feat(driver-pwa): pre-fill the arrival seal number from the photo`

---

### Task B10: Stage B checkpoint

- [ ] **Step 1: Full driver-app gate**

Run: `cd frontend/driver-pwa && npm run type-check && npm run lint && npm test && npm run build`
Expected: all pass.

- [ ] **Step 2: Full backend suite**

Run: `cd backend && TEST_DATABASE_URL="postgresql+asyncpg://timgultig@localhost:5433/freightproof_test" .venv/bin/pytest -q`
Expected: the same pass and fail counts as `dev`, plus the new tests. Any new failure is a regression; report it and don't patch around it.

- [ ] **Step 3: Device smoke test (Tim)**

Run `npm run cap:sync` and `npm run cap:sync:ios`, install, and on both phones photograph a real seal at departure and at arrival. Check that:
- the number fills
- editing it is kept
- a retake re-reads it
- a `missing` arrival skips OCR

Then check the stored `seal_number_source` on the dispatcher API response.

---

# Stage C: Linehaul scan, PDF, loading anchor v3

### Task C1: Audit pack labels the anchored linehaul photo correctly (bug fix)

The audit-pack builder lists `linehaul_photo` with no anchored payload key. But loading payload v2 has committed `linehaul_photo_sha256` since 23 Sep 2026, so an anchored linehaul photo shows in the insurer pack as only "recorded".

**Files:**
- Modify: `backend/app/orchestration/audit_packs/builder.py`
- Test: `backend/tests/integration/test_audit_pack_builder.py`

- [ ] **Step 1: Write the failing test** (append; add these imports at the top if missing)

```python
from sqlalchemy import select

from app.db.models.enums import AnchorStatus, BlockchainReceiptType, PhaseType, SubjectType
from app.db.models.phases import PhaseEvent
from app.orchestration.phases.payloads import compute_loading_canonical_payload_v2
from tests.integration.audit_pack_seed import _artifact, _receipt


async def _loading(db: AsyncSession, seed: AuditTrip) -> PhaseEvent:
    return (await db.execute(
        select(PhaseEvent).where(PhaseEvent.trip_id == seed.trip.id, PhaseEvent.phase_type == PhaseType.LOADING)
    )).scalar_one()


async def test_build_audit_manifest_marks_an_anchored_linehaul_photo_anchored(db_session, audit_trip):
    # Arrange
    loading = await _loading(db_session, audit_trip)
    photo = _artifact(audit_trip.trip.id, "linehaul-scan", T0)
    db_session.add(photo)
    await db_session.flush()
    loading.linehaul_photo_artifact_id = photo.id
    payload = compute_loading_canonical_payload_v2(
        phase_event_id=loading.id, trip_id=audit_trip.trip.id,
        parcel_count_origin=loading.parcel_count_origin, linehaul_photo_sha256=photo.file_hash,
    )
    receipt = await _receipt(
        db_session, trip_id=audit_trip.trip.id, subject_type=SubjectType.PHASE_EVENT,
        subject_id=loading.id, receipt_type=BlockchainReceiptType.LOADING, payload=payload,
        sequence=10, at=T0 + timedelta(hours=1, minutes=30),
    )
    loading.blockchain_receipt_id = receipt.id
    loading.anchor_status = AnchorStatus.ANCHORED
    loading.event_hash = receipt.data_hash
    await db_session.flush()

    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    record = next(p for p in manifest.phases if p.phase_type == "loading")
    linehaul = next(e for e in record.evidence if e.role == "linehaul_photo")
    assert linehaul.tier == "anchored"
    assert {f.name: f.matches_anchor for f in record.anchored_fields}["linehaul_photo_sha256"] is True
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/integration/test_audit_pack_builder.py -k linehaul`
Expected: FAIL, `assert 'recorded' == 'anchored'`.

- [ ] **Step 3: Fix the map** in `builder.py`, in `_PHASE_EVIDENCE`:

```python
    "linehaul_photo": ("linehaul_photo_artifact_id", "linehaul_photo_sha256"),
```

- [ ] **Step 4: Run the whole builder file**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/integration/test_audit_pack_builder.py tests/integration/test_audit_pack_service.py tests/integration/test_audit_pack_public.py`
Expected: all pass.

- [ ] **Step 5: Stage**

```bash
git add backend/app/orchestration/audit_packs/builder.py backend/tests/integration/test_audit_pack_builder.py
```
Suggested commit: `fix(orchestration): show an anchored linehaul photo as anchored in audit packs`

---

### Task C2: The `linehaul_pdf` evidence role, end to end

**Files:**
- Modify: `backend/app/db/models/enums.py`, `backend/app/core/phase_meta.py`
- Modify: `frontend/shared/lib/types/evidence.ts`, `frontend/shared/lib/types/phase.ts`, `frontend/shared/lib/constants/phase-meta.ts`
- Modify: `frontend/dispatcher/lib/phase/act-wording.ts`, `frontend/dispatcher/lib/phase/act-wording.test.ts`
- Test: `backend/tests/unit/test_phase_meta_contract.py` (existing parity test)

- [ ] **Step 1: Write the failing dispatcher test row**

In `act-wording.test.ts`, add to the `evidenceTitle` `it.each` table:
```ts
    ['linehaul_pdf', 'loading', 'Linehaul sheet scanned (PDF)'],
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd frontend/dispatcher && npx vitest run lib/phase/act-wording.test.ts`
Expected: FAIL (it may fail at type level). Check `node -v` is 22 first.

- [ ] **Step 3: Backend role and allowlist**

In `enums.py`, in `EvidenceRole`, after `LINEHAUL_PHOTO`:
```python
    LINEHAUL_PDF   = "linehaul_pdf"
```
In `core/phase_meta.py`:
```python
    PhaseType.LOADING: frozenset({EvidenceRole.LINEHAUL_PHOTO, EvidenceRole.LINEHAUL_PDF}),
```

- [ ] **Step 4: Shared types and constants**

In `shared/lib/types/evidence.ts`, add to `EvidenceRole`:
```ts
  | 'linehaul_pdf'
```
In `shared/lib/types/phase.ts`, after `linehaul_photo_artifact_id?: string | null`:
```ts
  // The scanned linehaul sheet as a PDF, from the same scan as linehaul_photo_artifact_id
  // (loading payload v3). Optional for the same fixture reason as the field above.
  linehaul_pdf_artifact_id?: string | null
```
In `shared/lib/constants/phase-meta.ts`:
```ts
  loading: ['linehaul_photo', 'linehaul_pdf'],
```
Add `| 'linehaul_pdf_artifact_id'` to `EVIDENCE_ROLE_FIELD`'s value union, then add these entries:
```ts
  linehaul_pdf: 'linehaul_pdf_artifact_id',
```
```ts
  linehaul_pdf: 'linehaul sheet scan (PDF)',
```

- [ ] **Step 5: Dispatcher wording** in `act-wording.ts`, after the `linehaul_photo` case:

```ts
    case 'linehaul_pdf': return 'Linehaul sheet scanned (PDF)'
```

- [ ] **Step 6: Run every affected check**

Run:
```bash
cd backend && .venv/bin/pytest -q tests/unit/test_phase_meta_contract.py
cd ../frontend/dispatcher && npx vitest run lib/phase/act-wording.test.ts && npm run type-check
cd ../driver-pwa && npm run type-check
```
Expected: all pass. If the dispatcher type-check finds another exhaustive switch or `Record<EvidenceRole, …>`, add the `linehaul_pdf` case in the same style and list the file in the task report. It's a cross-owner edit.

- [ ] **Step 7: Stage**

```bash
git add backend/app/db/models/enums.py backend/app/core/phase_meta.py frontend/shared/lib/types/evidence.ts frontend/shared/lib/types/phase.ts frontend/shared/lib/constants/phase-meta.ts frontend/dispatcher/lib/phase/act-wording.ts frontend/dispatcher/lib/phase/act-wording.test.ts
```
Suggested commit: `feat(shared): add the linehaul_pdf evidence role`
**Flag to Ciaran:** shared constants and one dispatcher wording line.

---

### Task C3: Loading payload v3

**Files:**
- Modify: `backend/app/orchestration/phases/payloads.py`
- Test: `backend/tests/unit/test_phase_anchor_payload.py`, `backend/tests/baseline/test_b3_canonical_hashes.py`

- [ ] **Step 1: Write the failing tests**

In `test_phase_anchor_payload.py`, add `compute_loading_canonical_payload_v3` to the existing `from app.orchestration.phases.payloads import (...)`, and append after `test_loading_v2_payload_keeps_optional_keys_present_when_absent`:
```python
def test_loading_v3_payload_adds_the_pdf_hash_to_the_v2_keys():
    payload = compute_loading_canonical_payload_v3(
        phase_event_id=uuid.uuid4(), trip_id=uuid.uuid4(),
        parcel_count_origin=3, linehaul_photo_sha256="a" * 64, linehaul_pdf_sha256="b" * 64,
    )

    assert set(payload) == {
        "payload_version", "phase_event_id", "trip_id", "phase_type",
        "parcel_count_origin", "linehaul_photo_sha256", "linehaul_pdf_sha256",
    }
    assert payload["payload_version"] == 3
    assert payload["phase_type"] == "loading"


def test_loading_v3_payload_keeps_the_pdf_key_present_when_absent():
    payload = compute_loading_canonical_payload_v3(
        phase_event_id=uuid.uuid4(), trip_id=uuid.uuid4(),
        parcel_count_origin=None, linehaul_photo_sha256=None, linehaul_pdf_sha256=None,
    )

    assert payload["linehaul_pdf_sha256"] is None
```
In `tests/baseline/test_b3_canonical_hashes.py`, add `compute_loading_canonical_payload_v3` to the imports, and add this vector to `_PHASE_VECTORS` after `"loading_v2"`:
```python
    "loading_v3": (
        compute_loading_canonical_payload_v3(
            phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID,
            parcel_count_origin=42, linehaul_photo_sha256=DIGEST_A, linehaul_pdf_sha256=DIGEST_B,
        ),
        {
            **_BASE_V2, "payload_version": 3, "phase_type": "loading",
            "parcel_count_origin": 42, "linehaul_photo_sha256": DIGEST_A, "linehaul_pdf_sha256": DIGEST_B,
        },
        "4d528e99b4acbd3d08cbea7663e0bdeb84e8b2fa6fe2ce948dd2e3e7f5c4918e",
    ),
```
Change the vector-count test to 11:
```python
def test_there_is_one_golden_vector_for_each_of_the_eleven_payload_builders() -> None:
    assert len(_PHASE_VECTORS) == 11
```
(The golden hash was computed with `compute_payload_hash` over exactly that dict on 2026-10-15.)

- [ ] **Step 2: Run to see them fail**

Run: `cd backend && .venv/bin/pytest -q tests/unit/test_phase_anchor_payload.py -k v3 tests/baseline/test_b3_canonical_hashes.py`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Implement** in `payloads.py`

Under `PHASE_PAYLOAD_VERSION_V2 = 2`:
```python
# Loading only: v2 plus the scanned linehaul PDF's hash. Every other phase stays on v2.
PHASE_PAYLOAD_VERSION_V3 = 3
```
After `compute_loading_canonical_payload_v2`:
```python
def compute_loading_canonical_payload_v3(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, parcel_count_origin: int | None,
    linehaul_photo_sha256: str | None, linehaul_pdf_sha256: str | None,
) -> dict[str, str | int | None]:
    """v2 plus the scanned linehaul sheet's PDF. The scan image and the PDF made from it
    are both committed, so a PDF handed to an insurer can be checked against Hedera too.
    Every key is always present, None when absent (a failed PDF build, a paperless
    warehouse), so reconstruction has one deterministic shape."""
    return {
        **compute_loading_canonical_payload_v2(
            phase_event_id=phase_event_id, trip_id=trip_id,
            parcel_count_origin=parcel_count_origin, linehaul_photo_sha256=linehaul_photo_sha256,
        ),
        "payload_version": PHASE_PAYLOAD_VERSION_V3,
        "linehaul_pdf_sha256": linehaul_pdf_sha256,
    }
```

- [ ] **Step 4: Run again.** Expected: all pass, and all ten pre-existing B3 vectors unchanged.

- [ ] **Step 5: Stage**

```bash
git add backend/app/orchestration/phases/payloads.py backend/tests/unit/test_phase_anchor_payload.py backend/tests/baseline/test_b3_canonical_hashes.py
```
Suggested commit: `feat(orchestration): add loading anchor payload v3 with the linehaul PDF hash`

---

### Task C4: Loading cites the PDF and anchors v3

**Files:**
- Modify: `backend/app/schemas/phases.py`
- Modify: `backend/app/orchestration/phases/artifacts.py`
- Modify: `backend/app/orchestration/phases/advance_loading.py`
- Test: `backend/tests/integration/test_phases.py`, `backend/tests/unit/test_phase_anchor_payload.py`

- [ ] **Step 1: Write the failing integration tests** (append to `test_phases.py`)

```python
async def _make_linehaul_pdf(db_session, trip_id, phase_event_id, *, mime_type="application/pdf") -> str:
    """An attributed PDF artifact as the upload route would store it."""
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.DOCUMENT,
        s3_key=f"{trip_id}/{uuid.uuid4()}.pdf", s3_bucket="evidence-artifacts",
        file_hash=uuid.uuid4().hex * 2, mime_type=mime_type, captured_at=datetime.now(UTC),
        phase_event_id=uuid.UUID(str(phase_event_id)), evidence_role=EvidenceRole.LINEHAUL_PDF,
    )
    db_session.add(artifact)
    await db_session.flush()
    return str(artifact.id)


async def test_loading_complete_with_linehaul_pdf_persists_it(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    photo_id = await _make_attributed_artifact(db_session, trip.id, loading_id, EvidenceRole.LINEHAUL_PHOTO)
    pdf_id = await _make_linehaul_pdf(db_session, trip.id, loading_id)

    resp = await _complete_loading(
        client, trip, token, linehaul_photo_artifact_id=photo_id, linehaul_pdf_artifact_id=pdf_id,
    )

    assert resp.status_code == 200, resp.text
    row = next(p for p in resp.json()["phases"] if p["phase_type"] == "loading")
    assert row["linehaul_pdf_artifact_id"] == pdf_id
    event = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    assert str(event.linehaul_pdf_artifact_id) == pdf_id


async def test_loading_complete_rejects_an_image_cited_as_the_linehaul_pdf(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    not_a_pdf = await _make_linehaul_pdf(db_session, trip.id, loading_id, mime_type="image/jpeg")

    resp = await _complete_loading(client, trip, token, linehaul_pdf_artifact_id=not_a_pdf)

    assert resp.status_code == 422


async def test_loading_complete_rejects_the_same_artifact_as_photo_and_pdf(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    pdf_id = await _make_linehaul_pdf(db_session, trip.id, loading_id)

    resp = await _complete_loading(
        client, trip, token, linehaul_photo_artifact_id=pdf_id, linehaul_pdf_artifact_id=pdf_id,
    )

    assert resp.status_code == 422


async def test_loading_complete_rejects_another_trips_linehaul_pdf(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)

    resp = await _complete_loading(client, trip, token, linehaul_pdf_artifact_id=str(uuid.uuid4()))

    assert resp.status_code == 404
```
(`ArtifactType`, `EvidenceRole`, `EvidenceArtifact`, `datetime` and `UTC` are already imported in this file. Add whichever is missing to the existing imports.)

- [ ] **Step 2: Write the failing anchor test** (append to `test_phase_anchor_payload.py`, after the departure anchoring tests)

```python
@pytest.mark.asyncio
async def test_advance_loading_anchors_v3_with_both_linehaul_hashes(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    trip, driver, phases = trip_fixture
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(
            phase_type=PhaseType.ACTIVATION, driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
            idempotency_key=str(uuid.uuid4()),
        ),
    )
    photo_id = await _make_artifact(db_session, trip.id, file_hash="a" * 64)
    pdf_id = await _make_artifact(db_session, trip.id, file_hash="b" * 64)
    pdf = await db_session.get(EvidenceArtifact, pdf_id)
    pdf.artifact_type = ArtifactType.DOCUMENT
    pdf.mime_type = "application/pdf"
    await db_session.flush()

    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
            linehaul_photo_artifact_id=photo_id, linehaul_pdf_artifact_id=pdf_id,
        ),
    )

    loading_payloads = [p for _id, p, _type in captured_anchor_dispatches if p.get("phase_type") == "loading"]
    assert loading_payloads == [compute_loading_canonical_payload_v3(
        phase_event_id=phases["loading"].id, trip_id=trip.id,
        parcel_count_origin=phases["loading"].parcel_count_origin,
        linehaul_photo_sha256="a" * 64, linehaul_pdf_sha256="b" * 64,
    )]
```
Check that `ArtifactType` and `ActivationCompleteRequest` are in this file's imports, and add them if not.

- [ ] **Step 3: Run to see them fail**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/integration/test_phases.py -k linehaul_pdf tests/unit/test_phase_anchor_payload.py -k v3_with_both`
Expected: FAIL. Responses lack `linehaul_pdf_artifact_id`, and the request model ignores the field.

- [ ] **Step 4: Schema fields** in `backend/app/schemas/phases.py`

Add `model_validator` to the pydantic import if it's not there. In `PhaseEventRead`, after `linehaul_photo_artifact_id`:
```python
    linehaul_pdf_artifact_id: Optional[UUID] = None
```
In `LoadingCompleteRequest`, after `linehaul_photo_artifact_id`:
```python
    # The same sheet as a one-page PDF built on the phone from the scan. Optional: a failed
    # PDF build still completes loading with the scan image alone.
    linehaul_pdf_artifact_id: Optional[UUID] = None

    @model_validator(mode="after")
    def validate_distinct_linehaul_artifacts(self) -> "LoadingCompleteRequest":
        if (
            self.linehaul_pdf_artifact_id is not None
            and self.linehaul_pdf_artifact_id == self.linehaul_photo_artifact_id
        ):
            raise ValueError("the linehaul scan image and its PDF must be different artifacts")
        return self
```

- [ ] **Step 5: The PDF role must be a stored PDF** in `orchestration/phases/artifacts.py`

Add the import:
```python
from app.storage.mime_allowlist import PDF
```
Add `EvidenceArtifact.mime_type` to the `select(...)` column list, after `EvidenceArtifact.captured_by_driver_id`. Change `_assert_attribution_fits`'s `artifact` annotation to:
```python
    artifact: Row[tuple[uuid.UUID, str, uuid.UUID | None, EvidenceRole | None, uuid.UUID | None, str]],
```
At the end of `_assert_attribution_fits`, add:
```python
    # The upload allowlist sniffs the bytes, so mime_type is what the file really is. Checked
    # per role because attribution alone would let an unattributed photo stand in as the PDF.
    if role is EvidenceRole.LINEHAUL_PDF and artifact.mime_type != PDF:
        raise EvidenceAttributionError("The linehaul PDF must be a PDF file.")
```

- [ ] **Step 6: Anchor v3** in `advance_loading.py`

Change the payload import to:
```python
from app.orchestration.phases.payloads import compute_loading_canonical_payload_v3
```
Replace the whole "Optional evidence" block (from `linehaul_photo_sha256: str | None = None` through `linehaul_photo_sha256 = linehaul_hashes[...]`) with:
```python
    # Optional evidence: a warehouse that has already gone paperless has no linehaul
    # sheet to hand the driver, and this must never block completion (schema docstring).
    # The PDF is optional on its own too: a failed PDF build on the phone still sends the
    # scan image alone.
    linehaul_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id, phase_event_id=event.id,
        cited={
            EvidenceRole.LINEHAUL_PHOTO: payload.linehaul_photo_artifact_id,
            EvidenceRole.LINEHAUL_PDF: payload.linehaul_pdf_artifact_id,
        },
    )
    event.linehaul_photo_artifact_id = payload.linehaul_photo_artifact_id
    event.linehaul_pdf_artifact_id = payload.linehaul_pdf_artifact_id
    linehaul_photo_sha256 = (
        linehaul_hashes[payload.linehaul_photo_artifact_id]
        if payload.linehaul_photo_artifact_id is not None else None
    )
    linehaul_pdf_sha256 = (
        linehaul_hashes[payload.linehaul_pdf_artifact_id]
        if payload.linehaul_pdf_artifact_id is not None else None
    )
```
Replace the `_anchor_phase(...)` call with:
```python
    _anchor_phase(db, event=event, canonical_payload=compute_loading_canonical_payload_v3(
        phase_event_id=event.id, trip_id=trip_id,
        parcel_count_origin=event.parcel_count_origin,
        linehaul_photo_sha256=linehaul_photo_sha256,
        linehaul_pdf_sha256=linehaul_pdf_sha256,
    ))
```

- [ ] **Step 7: Run the new tests again**

Run: same as Step 3. Expected: all pass.

- [ ] **Step 8: Expect the verifier tests to fail until C5**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/integration/test_every_phase_anchoring.py`
Expected: FAIL on loading ("did not reconstruct"). The verifier doesn't know v3 yet; Task C5 fixes it. Do not stage until C5 is green, and do C5 next.

---

### Task C5: Verify loading v3

**Files:**
- Modify: `backend/app/orchestration/verification/phase_payloads.py`
- Test: `backend/tests/unit/test_phase_anchor_payload.py`

- [ ] **Step 1: Write the failing tests** (append to `test_phase_anchor_payload.py`)

```python
@pytest.mark.asyncio
async def test_verify_subject_after_loading_v3_reconstructs_matching_payload(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    trip, driver, phases = trip_fixture
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(
            phase_type=PhaseType.ACTIVATION, driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
            idempotency_key=str(uuid.uuid4()),
        ),
    )
    photo_id = await _make_artifact(db_session, trip.id, file_hash="a" * 64)
    pdf_id = await _make_artifact(db_session, trip.id, file_hash="b" * 64)
    pdf = await db_session.get(EvidenceArtifact, pdf_id)
    pdf.mime_type = "application/pdf"
    await db_session.flush()
    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
            linehaul_photo_artifact_id=photo_id, linehaul_pdf_artifact_id=pdf_id,
        ),
    )
    await _drain_anchors(db_session, captured_anchor_dispatches)
    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=phases["loading"].id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    assert outcome.evidence_verified is True


@pytest.mark.asyncio
async def test_verify_subject_rejects_a_v3_payload_on_a_phase_other_than_loading(
    db_session, trip_fixture,
):
    trip, _driver, phases = trip_fixture
    departure = phases["departure"]
    departure.seal_number = "AB-1234"
    payload = {
        "payload_version": 3, "phase_event_id": str(departure.id), "trip_id": str(trip.id),
        "phase_type": "departure", "seal_number": departure.seal_number,
    }
    db_session.add(BlockchainReceipt(
        id=uuid.uuid4(), trip_id=trip.id,
        subject_type=SubjectType.PHASE_EVENT, subject_id=departure.id,
        receipt_type=BlockchainReceiptType.PICKUP,
        payload_json=payload, data_hash=compute_payload_hash(payload),
        hedera_topic_id="0.0.12345", hedera_sequence_number=13,
    ))
    await db_session.flush()
    stub_service = MagicMock()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=departure.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.ERROR
    stub_service.verify_hash.assert_not_called()
```
This file's existing autouse storage stub already makes `evidence_verified` work for `_make_artifact` rows, as the departure verify test shows.

- [ ] **Step 2: Run to see them fail**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/unit/test_phase_anchor_payload.py -k "loading_v3 or other_than_loading"`
Expected: the loading test FAILS with status ERROR (unsupported version 3). The departure test may already pass.

- [ ] **Step 3: Implement** in `verification/phase_payloads.py`

Add `PHASE_PAYLOAD_VERSION_V3` and `compute_loading_canonical_payload_v3` to the `from app.orchestration.phases.payloads import (...)` list.

Replace `_phase_payload_version`'s check:
```python
    version = anchored_payload["payload_version"]
    if type(version) is not int or version not in (PHASE_PAYLOAD_VERSION_V2, PHASE_PAYLOAD_VERSION_V3):
        raise _UnsupportedPhasePayloadVersion(f"unsupported phase payload version: {version!r}")
    return version
```
In `_reconstruct_phase_event_payload`, directly after the `if event.phase_type in _V2_ONLY_PHASE_TYPES and version == _LEGACY_PHASE_PAYLOAD_VERSION:` block, add:
```python
    if version == PHASE_PAYLOAD_VERSION_V3 and event.phase_type != PhaseType.LOADING:
        # v3 exists only for loading (the linehaul PDF). A v3 receipt on any other phase is
        # not a shape this system ever produced.
        raise _UnsupportedPhasePayloadVersion("payload version 3 exists only for loading")
```
Replace the whole `if event.phase_type == PhaseType.LOADING:` block with:
```python
    if event.phase_type == PhaseType.LOADING:
        roles: list[tuple[str, uuid.UUID]] = []
        if event.linehaul_photo_artifact_id is not None:
            roles.append(("linehaul_photo_sha256", event.linehaul_photo_artifact_id))
        if version == PHASE_PAYLOAD_VERSION_V3 and event.linehaul_pdf_artifact_id is not None:
            roles.append(("linehaul_pdf_sha256", event.linehaul_pdf_artifact_id))
        loading_artifacts = (
            await _load_artifacts_for_roles(db, event=event, roles=tuple(roles)) if roles else ()
        )
        hashes = {item.payload_key: item.artifact.file_hash for item in loading_artifacts}
        if version == PHASE_PAYLOAD_VERSION_V3:
            return _PhasePayloadState(
                payload=compute_loading_canonical_payload_v3(
                    phase_event_id=event.id, trip_id=event.trip_id,
                    parcel_count_origin=event.parcel_count_origin,
                    linehaul_photo_sha256=hashes.get("linehaul_photo_sha256"),
                    linehaul_pdf_sha256=hashes.get("linehaul_pdf_sha256"),
                ),
                artifacts=loading_artifacts,
            )
        return _PhasePayloadState(
            payload=compute_loading_canonical_payload_v2(
                phase_event_id=event.id, trip_id=event.trip_id,
                parcel_count_origin=event.parcel_count_origin,
                linehaul_photo_sha256=hashes.get("linehaul_photo_sha256"),
            ),
            artifacts=loading_artifacts,
        )
```
In `reconstruct_pending_phase_payload`, recovery must also try v3. Replace its loop with:
```python
    for contract in (
        {}, {"payload_version": PHASE_PAYLOAD_VERSION_V2}, {"payload_version": PHASE_PAYLOAD_VERSION_V3},
    ):
        try:
            state = await _reconstruct_phase_event_payload(db, event.id, anchored_payload=contract)
        except (_PhaseEvidenceMissing, _UnsupportedPhasePayloadVersion):
            # A contract this phase type never produced (v3 off loading) is simply not a
            # match; move on to the next one rather than abandoning recovery.
            continue
        if _hash_payload(state.payload) == event.event_hash:
            return state.payload
    return None
```
Update that function's docstring: replace "Trying v1 also recovers phase anchors queued before the v2 deployment." with "Trying every contract also recovers anchors queued before v2, and loading anchors queued as v3."

- [ ] **Step 4: Run the verification and anchoring suites**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/unit/test_phase_anchor_payload.py tests/integration/test_every_phase_anchoring.py tests/integration/test_phase_anchoring.py tests/baseline`
Expected: all pass, except B1, which is updated in Task C7. The existing tests `test_verify_subject_preserves_*`, `test_recovery_*` and `test_verify_subject_rejects_explicit_or_unknown_phase_payload_version` must pass unchanged.

- [ ] **Step 5: Stage C4 and C5 together**

```bash
git add backend/app/schemas/phases.py backend/app/orchestration/phases/artifacts.py backend/app/orchestration/phases/advance_loading.py backend/app/orchestration/verification/phase_payloads.py backend/tests/integration/test_phases.py backend/tests/unit/test_phase_anchor_payload.py
```
Suggested commit: `feat(orchestration): anchor and verify the linehaul PDF in loading payload v3`

---

### Task C6: Audit pack includes the PDF, and the end-to-end guard asserts v3

**Files:**
- Modify: `backend/app/orchestration/audit_packs/builder.py`, `backend/app/schemas/audit_pack.py`
- Test: `backend/tests/integration/test_audit_pack_builder.py`, `backend/tests/integration/test_every_phase_anchoring.py`

- [ ] **Step 1: Write the failing audit-pack test** (append; extend the C1 imports with `compute_loading_canonical_payload_v3`)

```python
async def test_build_audit_manifest_includes_the_anchored_linehaul_pdf(db_session, audit_trip):
    # Arrange
    loading = await _loading(db_session, audit_trip)
    photo = _artifact(audit_trip.trip.id, "linehaul-scan", T0)
    pdf = _artifact(audit_trip.trip.id, "linehaul-pdf", T0)
    pdf.artifact_type = "document"
    pdf.mime_type = "application/pdf"
    db_session.add_all([photo, pdf])
    await db_session.flush()
    loading.linehaul_photo_artifact_id = photo.id
    loading.linehaul_pdf_artifact_id = pdf.id
    payload = compute_loading_canonical_payload_v3(
        phase_event_id=loading.id, trip_id=audit_trip.trip.id,
        parcel_count_origin=loading.parcel_count_origin,
        linehaul_photo_sha256=photo.file_hash, linehaul_pdf_sha256=pdf.file_hash,
    )
    receipt = await _receipt(
        db_session, trip_id=audit_trip.trip.id, subject_type=SubjectType.PHASE_EVENT,
        subject_id=loading.id, receipt_type=BlockchainReceiptType.LOADING, payload=payload,
        sequence=11, at=T0 + timedelta(hours=1, minutes=30),
    )
    loading.blockchain_receipt_id = receipt.id
    loading.anchor_status = AnchorStatus.ANCHORED
    loading.event_hash = receipt.data_hash
    await db_session.flush()

    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    record = next(p for p in manifest.phases if p.phase_type == "loading")
    linehaul_pdf = next(e for e in record.evidence if e.role == "linehaul_pdf")
    assert linehaul_pdf.tier == "anchored"
    assert linehaul_pdf.mime_type == "application/pdf"
```

- [ ] **Step 2: Write the failing end-to-end assertion** (append inside `test_every_phase_of_a_completed_trip_ends_anchored_with_matching_receipt_type`, after its existing loop)

```python
    # Loading anchors v3 (linehaul PDF), every other phase keeps its existing contract.
    loading_event = next(p for p in phases if PhaseType(p.phase_type) == PhaseType.LOADING)
    loading_payload = await reconstruct_pending_phase_payload(db_session, loading_event)
    assert loading_payload is not None
    assert loading_payload["payload_version"] == 3
    assert "linehaul_pdf_sha256" in loading_payload
    for event in non_creation:
        if PhaseType(event.phase_type) != PhaseType.LOADING:
            payload = await reconstruct_pending_phase_payload(db_session, event)
            assert payload is not None and payload.get("payload_version") != 3
```

- [ ] **Step 3: Run to see the audit test fail**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/integration/test_audit_pack_builder.py -k linehaul_pdf tests/integration/test_every_phase_anchoring.py`
Expected: the audit test FAILS with `StopIteration`, because no `linehaul_pdf` evidence is listed. The every-phase test should already pass after C5.

- [ ] **Step 4: Implement**

In `builder.py`, `_PHASE_EVIDENCE`, after `linehaul_photo`:
```python
    "linehaul_pdf": ("linehaul_pdf_artifact_id", "linehaul_pdf_sha256"),
```
In `schemas/audit_pack.py`, add `"linehaul_pdf"` to the `EvidenceRole` Literal after `"linehaul_photo"`.

- [ ] **Step 5: Run the audit and anchoring suites**

Run: `cd backend && TEST_DATABASE_URL=... .venv/bin/pytest -q tests/integration/test_audit_pack_builder.py tests/integration/test_audit_pack_service.py tests/integration/test_audit_pack_public.py tests/integration/test_audit_pack_endpoints.py tests/integration/test_every_phase_anchoring.py`
Expected: all pass.

- [ ] **Step 6: Stage**

```bash
git add backend/app/orchestration/audit_packs/builder.py backend/app/schemas/audit_pack.py backend/tests/integration/test_audit_pack_builder.py backend/tests/integration/test_every_phase_anchoring.py
```
Suggested commit: `feat(orchestration): include the anchored linehaul PDF in audit packs`

---

### Task C7: Backend Stage C checkpoint

- [ ] **Step 1: Regenerate the B1 snapshot**

Run: `cd backend && UPDATE_SNAPSHOTS=1 .venv/bin/pytest -q tests/baseline/test_b1_api_contract.py && git diff tests/baseline/snapshots/openapi.json | grep '^[+-]' | grep -v '^+++\|^---'`
Expected: additions only. These are `linehaul_pdf_artifact_id` on `LoadingCompleteRequest` and `PhaseEventRead`, `linehaul_pdf` in the evidence-role enums, and `"linehaul_pdf"` in the audit-pack role literal. Anything else: stop and report.

- [ ] **Step 2: Full backend suite**

Run: `cd backend && TEST_DATABASE_URL="postgresql+asyncpg://timgultig@localhost:5433/freightproof_test" .venv/bin/pytest -q`
Expected: no new failures compared with `dev`.

- [ ] **Step 3: Stage**

```bash
git add backend/tests/baseline/snapshots/openapi.json
```
Suggested commit: `test(api): refresh the API snapshot for the linehaul PDF fields`

---

### Task C8: Upload filename follows the file type

**Files:**
- Modify: `frontend/driver-pwa/lib/api/artifacts.ts`
- Test: `frontend/driver-pwa/lib/api/__tests__/artifacts.test.ts`

- [ ] **Step 1: Write the failing test** (append; `PARAMS` and `mockPostForm` already exist in this file)

```ts
describe('uploadArtifact filename', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPostForm.mockResolvedValue({ id: 'artifact-1', file_hash: 'f'.repeat(64) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubBlob(type: string) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob([new ArrayBuffer(16)], { type })),
    }))
  }

  it('names a PDF .pdf', async () => {
    stubBlob('application/pdf')

    await uploadArtifact({ ...PARAMS, artifactType: 'document' })

    const file = (mockPostForm.mock.calls[0][1] as FormData).get('file') as File
    expect(file.name).toBe('document.pdf')
  })

  it('keeps .jpg for photos', async () => {
    stubBlob('image/jpeg')

    await uploadArtifact(PARAMS)

    const file = (mockPostForm.mock.calls[0][1] as FormData).get('file') as File
    expect(file.name).toBe(`${PARAMS.artifactType}.jpg`)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/api/__tests__/artifacts.test.ts`
Expected: the PDF test FAILS (`document.jpg`).

- [ ] **Step 3: Implement** in `artifacts.ts`. Add above `uploadArtifact`:

```ts
// The backend decides the type from the bytes (mime_allowlist.py); the name only has to
// stop a stored PDF from carrying a .jpg extension into Storage and downloads.
function fileExtension(blob: Blob): string {
  return blob.type === 'application/pdf' ? 'pdf' : 'jpg'
}
```
Change the append line to:
```ts
  form.append('file', blob, `${params.artifactType}.${fileExtension(blob)}`)
```

- [ ] **Step 4: Run again.** Expected: all pass.

- [ ] **Step 5: Stage**

```bash
git add frontend/driver-pwa/lib/api/artifacts.ts frontend/driver-pwa/lib/api/__tests__/artifacts.test.ts
```
Suggested commit: `fix(driver-pwa): name uploaded PDFs .pdf`

---

### Task C9: Build the linehaul PDF

**Files:**
- Modify: `frontend/driver-pwa/package.json`
- Create: `frontend/driver-pwa/lib/scan/buildLinehaulPdf.ts`
- Test: `frontend/driver-pwa/lib/scan/__tests__/buildLinehaulPdf.test.ts`

- [ ] **Step 1: Install**

Run: `cd frontend/driver-pwa && npm install pdf-lib@1.17.1`

- [ ] **Step 2: Write the failing test**

```ts
// frontend/driver-pwa/lib/scan/__tests__/buildLinehaulPdf.test.ts
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { A4_PT, buildLinehaulPdf } from '../buildLinehaulPdf'

// A real 4x6 grey JPEG, so pdf-lib's embedJpg parses an actual image.
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAGAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2CiiigD//2Q=='

async function decode(dataUrl: string): Promise<PDFDocument> {
  return PDFDocument.load(dataUrl.replace(/^data:application\/pdf;base64,/, ''))
}

describe('buildLinehaulPdf', () => {
  it('returns a PDF data URL', async () => {
    const pdf = await buildLinehaulPdf(TINY_JPEG)

    expect(pdf.startsWith('data:application/pdf;base64,')).toBe(true)
    expect(atob(pdf.split(',')[1] ?? '').startsWith('%PDF-')).toBe(true)
  })

  it('is one A4 page titled as the linehaul sheet, with no creation date', async () => {
    const doc = await decode(await buildLinehaulPdf(TINY_JPEG))

    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(A4_PT[0])
    expect(height).toBeCloseTo(A4_PT[1])
    expect(doc.getTitle()).toBe('Linehaul sheet')
    expect(doc.getCreationDate()).toBeUndefined()
  })

  it('rejects input that is not a JPEG data URL', async () => {
    await expect(buildLinehaulPdf('data:image/png;base64,iVBORw0KGgo=')).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run to see it fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/scan/__tests__/buildLinehaulPdf.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 4: Implement**

```ts
// frontend/driver-pwa/lib/scan/buildLinehaulPdf.ts
//
// Wraps the scanned linehaul sheet in a one-page A4 PDF, on the phone, so dispatchers and
// insurers get a document they can print and file. The image inside is the very scan
// stored as linehaul_photo; the PDF adds nothing but the page, which is why both hashes
// can be anchored side by side (loading payload v3).
import { PDFDocument } from 'pdf-lib'

// A4 in PDF points (1/72 inch).
export const A4_PT: readonly [number, number] = [595.28, 841.89]
// About 12 mm: clear of a printer's unprintable edge.
const PAGE_MARGIN_PT = 34

const JPEG_DATA_URL = /^data:image\/jpe?g;base64,/

export async function buildLinehaulPdf(jpegDataUrl: string): Promise<string> {
  if (!JPEG_DATA_URL.test(jpegDataUrl)) {
    throw new Error('The linehaul scan must be a JPEG to build its PDF.')
  }
  // updateMetadata: false stops pdf-lib stamping creation and modification dates and its
  // own producer string; the file should describe the sheet, not when the phone built it.
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.setTitle('Linehaul sheet')

  const image = await doc.embedJpg(jpegDataUrl.replace(JPEG_DATA_URL, ''))
  const page = doc.addPage([A4_PT[0], A4_PT[1]])
  const scale = Math.min(
    (A4_PT[0] - 2 * PAGE_MARGIN_PT) / image.width,
    (A4_PT[1] - 2 * PAGE_MARGIN_PT) / image.height,
  )
  const width = image.width * scale
  const height = image.height * scale
  page.drawImage(image, {
    x: (A4_PT[0] - width) / 2,
    y: (A4_PT[1] - height) / 2,
    width,
    height,
  })

  return doc.saveAsBase64({ dataUri: true })
}
```

- [ ] **Step 5: Run again.** Expected: 3 passed.

- [ ] **Step 6: Stage**

```bash
git add frontend/driver-pwa/package.json frontend/driver-pwa/package-lock.json frontend/driver-pwa/lib/scan/buildLinehaulPdf.ts frontend/driver-pwa/lib/scan/__tests__/buildLinehaulPdf.test.ts
```
Suggested commit: `feat(driver-pwa): build an A4 PDF from the linehaul scan`

---

### Task C10: Native scanner wrapper and `CameraCapture` hook-in

**Files:**
- Modify: `frontend/driver-pwa/package.json`
- Create: `frontend/driver-pwa/lib/scan/scanLinehaulSheet.ts`
- Modify: `frontend/driver-pwa/components/phase/CameraCapture.tsx`
- Test: `frontend/driver-pwa/lib/scan/__tests__/scanLinehaulSheet.test.ts`, `frontend/driver-pwa/components/phase/__tests__/CameraCapture.test.tsx`

- [ ] **Step 1: Install**

Run: `cd frontend/driver-pwa && npm install @capgo/capacitor-document-scanner@7.2.5`

- [ ] **Step 2: Write the failing wrapper test**

```ts
// frontend/driver-pwa/lib/scan/__tests__/scanLinehaulSheet.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockScan, mockCompress } = vi.hoisted(() => ({ mockScan: vi.fn(), mockCompress: vi.fn() }))
vi.mock('@capgo/capacitor-document-scanner', () => ({
  DocumentScanner: { scanDocument: (...a: unknown[]) => mockScan(...a) },
  ResponseType: { Base64: 'base64' },
  ScannerMode: { BaseWithFilter: 'base_with_filter' },
}))
vi.mock('@/lib/utils/image', () => ({
  fileToCompressedJpegDataUrl: (...a: unknown[]) => mockCompress(...a),
}))

import { scanLinehaulSheet } from '../scanLinehaulSheet'

describe('scanLinehaulSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob([new ArrayBuffer(8)], { type: 'image/jpeg' })),
    }))
    mockCompress.mockResolvedValue('data:image/jpeg;base64,SMALL')
  })

  it('scans one page without ML clean-up or private iOS crop hooks', async () => {
    mockScan.mockResolvedValue({ status: 'success', scannedImages: ['BIGBASE64'] })

    await scanLinehaulSheet()

    expect(mockScan).toHaveBeenCalledWith({
      maxNumDocuments: 1,
      responseType: 'base64',
      scannerMode: 'base_with_filter',
      letUserAdjustCrop: false,
    })
  })

  it('returns the scan downscaled to the evidence-photo cap', async () => {
    mockScan.mockResolvedValue({ status: 'success', scannedImages: ['BIGBASE64'] })

    expect(await scanLinehaulSheet()).toBe('data:image/jpeg;base64,SMALL')
    expect(mockCompress).toHaveBeenCalledWith(expect.any(File), 1600, 70)
  })

  it('returns null when the driver cancels', async () => {
    mockScan.mockResolvedValue({ status: 'cancel' })

    expect(await scanLinehaulSheet()).toBeNull()
  })
})
```

- [ ] **Step 3: Run to see it fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/scan/__tests__/scanLinehaulSheet.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 4: Implement the wrapper**

```ts
// frontend/driver-pwa/lib/scan/scanLinehaulSheet.ts
//
// Opens the phone's own document scanner (VisionKit on iOS, ML Kit on Android): it finds
// the page edges and flattens the perspective, which a plain camera photo cannot. Native
// only; the browser keeps the plain camera input (CameraCapture's file picker).
import { DocumentScanner, ResponseType, ScannerMode } from '@capgo/capacitor-document-scanner'
import { fileToCompressedJpegDataUrl } from '@/lib/utils/image'

// Same cap and quality as every evidence photo (CameraCapture), so a scan fits the
// localStorage draft and the 10 MB upload cap the same way a photo does.
const MAX_SCAN_EDGE_PX = 1600
const JPEG_QUALITY_PERCENT = 70

// Resolves the scanned page as a JPEG data URL, or null when the driver backs out. Throws
// on a scanner failure so CameraCapture can fall back to its file picker.
export async function scanLinehaulSheet(): Promise<string | null> {
  const result = await DocumentScanner.scanDocument({
    maxNumDocuments: 1,
    responseType: ResponseType.Base64,
    // Crop, rotate and global filters only. 'full' mode's ML cleaning erases stains and
    // fingers, which edits the content of an evidence document.
    scannerMode: ScannerMode.BaseWithFilter,
    // On iOS this option drives VisionKit through private navigation hooks, which risks App
    // Store rejection. VisionKit's own review screen still lets the driver retake.
    letUserAdjustCrop: false,
  })
  const [page] = result.scannedImages ?? []
  if (result.status === 'cancel' || page === undefined) return null
  const blob = await (await fetch(`data:image/jpeg;base64,${page}`)).blob()
  return fileToCompressedJpegDataUrl(
    new File([blob], 'linehaul-scan.jpg', { type: 'image/jpeg' }),
    MAX_SCAN_EDGE_PX,
    JPEG_QUALITY_PERCENT,
  )
}
```
If type-check reports that `ScanDocumentResponse.status` or `scannedImages` is named differently in the installed 7.2.5 typings, use the installed names and report the difference.

- [ ] **Step 5: Write the failing `CameraCapture` test** (append inside `describe('CameraCapture native capture failures', ...)`)

```tsx
  it('uses a provided native source instead of the camera, and stays quiet on cancel', async () => {
    const onCapture = vi.fn()
    const nativeSource = vi.fn().mockResolvedValueOnce('data:image/jpeg;base64,SCAN').mockResolvedValueOnce(null)

    render(<CameraCapture label="Linehaul sheet" actionLabel="Scan the sheet" dataUrl={null} onCapture={onCapture} nativeSource={nativeSource} />)
    fireEvent.click(screen.getByText('Scan the sheet'))
    await waitFor(() => expect(onCapture).toHaveBeenCalledWith('data:image/jpeg;base64,SCAN'))
    fireEvent.click(screen.getByText('Scan the sheet'))
    await waitFor(() => expect(nativeSource).toHaveBeenCalledTimes(2))

    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(mockGetPhoto).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('falls back to the file picker when the native source fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const nativeSource = vi.fn().mockRejectedValue(new Error('Document scanner is not supported'))

    render(<CameraCapture label="Linehaul sheet" actionLabel="Scan the sheet" dataUrl={null} onCapture={vi.fn()} nativeSource={nativeSource} />)
    fireEvent.click(screen.getByText('Scan the sheet'))

    expect(await screen.findByText('Choose a Photo Instead')).toBeInTheDocument()
  })
```

- [ ] **Step 6: Run to see it fail**

Run: `cd frontend/driver-pwa && npx vitest run components/phase/__tests__/CameraCapture.test.tsx`
Expected: the 2 new tests FAIL.

- [ ] **Step 7: Implement the prop** in `CameraCapture.tsx`

Add to `CameraCaptureProps`:
```tsx
  /**
   * Native-only replacement for the camera, e.g. the document scanner for the linehaul
   * sheet. Resolves a JPEG data URL, or null when the driver backs out. Failures fall
   * back to the file picker exactly like a camera failure. The browser ignores it.
   */
  nativeSource?: () => Promise<string | null>
```
Add `nativeSource` to the destructured props. In `handleCapture`, replace the `const photo = await Camera.getPhoto({...}); if (photo.dataUrl) onCapture(photo.dataUrl)` lines with:
```tsx
      if (nativeSource !== undefined) {
        const dataUrl = await nativeSource()
        if (dataUrl !== null) onCapture(dataUrl)
        return
      }
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        quality: JPEG_QUALITY_PERCENT,
        // Native-side downscale, applied before the image crosses the bridge as
        // base64 — same cap as the browser path's canvas step.
        width: MAX_PHOTO_EDGE_PX,
      })
      if (photo.dataUrl) onCapture(photo.dataUrl)
```
Add `nativeSource` to `handleCapture`'s `useCallback` dependency array. The `return` inside `try` still runs the `finally`, so `isCapturing` resets.

- [ ] **Step 8: Run both suites again**

Run: `cd frontend/driver-pwa && npx vitest run lib/scan components/phase/__tests__/CameraCapture.test.tsx && npm run type-check`
Expected: all pass.

- [ ] **Step 9: Stage**

```bash
git add frontend/driver-pwa/package.json frontend/driver-pwa/package-lock.json frontend/driver-pwa/lib/scan/scanLinehaulSheet.ts frontend/driver-pwa/lib/scan/__tests__/scanLinehaulSheet.test.ts frontend/driver-pwa/components/phase/CameraCapture.tsx frontend/driver-pwa/components/phase/__tests__/CameraCapture.test.tsx
```
Suggested commit: `feat(driver-pwa): scan documents natively through CameraCapture`

---

### Task C11: Linehaul step scans, builds the PDF and submits both

**Files:**
- Modify: `frontend/driver-pwa/lib/types/evidence-draft.ts`
- Modify: `frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx`
- Modify: `frontend/driver-pwa/lib/api/phases.ts`
- Modify: `frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx`
- Test: `frontend/driver-pwa/lib/api/__tests__/phases.test.ts`, `frontend/driver-pwa/components/phase/steps/loading/__tests__/Linehaul.scan.test.tsx` (new), `frontend/driver-pwa/components/phase/steps/__tests__/linehaul.test.tsx`

- [ ] **Step 1: Write the failing submit tests** (in `phases.test.ts`, inside the real-backend `describe`)

```ts
  it('sends the linehaul PDF id next to the scan image', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', {
      linehaulPhotoDataUrl: 'data:image/jpeg;base64,AAAA', linehaulPhotoArtifactId: 'scan-artifact',
      linehaulPdfDataUrl: 'data:application/pdf;base64,JVBERi0=', linehaulPdfArtifactId: 'pdf-artifact',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).toMatchObject({
      linehaul_photo_artifact_id: 'scan-artifact', linehaul_pdf_artifact_id: 'pdf-artifact',
    })
  })

  it('uploads the PDF at submit as a document when the early upload never landed', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact.mockResolvedValue({ id: 'late-pdf' })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', {
      linehaulPhotoDataUrl: 'data:image/jpeg;base64,AAAA', linehaulPhotoArtifactId: 'scan-artifact',
      linehaulPdfDataUrl: 'data:application/pdf;base64,JVBERi0=', linehaulPdfArtifactId: null,
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactType: 'document', attribution: { phaseEventId: 'phase-event-2', role: 'linehaul_pdf' },
    }))
    expect(mockPost.mock.calls[0][1]).toMatchObject({ linehaul_pdf_artifact_id: 'late-pdf' })
  })
```
Also add `linehaul_pdf_artifact_id: null,` to the expected body of the existing `'completes loading with no linehaul photo ...'` test.

- [ ] **Step 2: Write the failing step tests in a new file**

The existing `linehaul.test.tsx` renders the real `CameraCapture`, so stubbing it there would change its tests. The scan behaviour gets its own suite instead:

```tsx
// frontend/driver-pwa/components/phase/steps/loading/__tests__/Linehaul.scan.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Linehaul } from '../Linehaul'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { LoadingEvidence } from '@/lib/types/evidence-draft'

const { mockScan, mockBuildPdf, mockUploadNow, mockIsNative } = vi.hoisted(() => ({
  mockScan: vi.fn(),
  mockBuildPdf: vi.fn(),
  mockUploadNow: vi.fn(),
  mockIsNative: vi.fn(),
}))

// StepLayout's header calls useRouter, as in every step suite.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mockIsNative() } }))
vi.mock('@/lib/scan/scanLinehaulSheet', () => ({ scanLinehaulSheet: () => mockScan() }))
vi.mock('@/lib/scan/buildLinehaulPdf', () => ({ buildLinehaulPdf: (...a: unknown[]) => mockBuildPdf(...a) }))
vi.mock('@/lib/hooks/useArtifactUpload', () => ({ useArtifactUpload: () => ({ uploadNow: mockUploadNow }) }))
// CameraCapture stubbed as in the seal suites, but it honours nativeSource so the
// scanner wiring is what the test exercises.
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture, nativeSource }: {
    label: string; onCapture: (d: string) => void; nativeSource?: () => Promise<string | null>
  }) => (
    <button onClick={() => {
      void (nativeSource ? nativeSource() : Promise.resolve(`data:image/jpeg;base64,${label}`))
        .then((d) => { if (d !== null) onCapture(d) })
    }}>{label}</button>
  ),
}))

const LINEHAUL = {
  trip_id: 'trip-1', vehicle_registration: 'ABC123GP', vehicle_type: 'horse',
  driver_full_name: 'Test Driver', consolidated_unit_count: 4,
  origin_scan_complete: true, pulled_at: '2026-08-05T10:00:00Z',
}

const EMPTY_DRAFT: LoadingEvidence = {
  linehaulPhotoDataUrl: null, linehaulPhotoArtifactId: null,
  linehaulPdfDataUrl: null, linehaulPdfArtifactId: null, capturedAt: null,
}

function renderUnblocked(onUpdate: (patch: Partial<LoadingEvidence>) => void) {
  render(
    <Linehaul
      tripId="trip-1"
      phase={makePhase('loading', { blocked_on: null })}
      stepIndex={0}
      linehaul={LINEHAUL}
      draft={EMPTY_DRAFT}
      onUpdate={onUpdate}
      onComplete={vi.fn()}
    />,
  )
}

describe('Linehaul — scan and PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsNative.mockReturnValue(true)
    mockScan.mockResolvedValue('data:image/jpeg;base64,SCAN')
    mockBuildPdf.mockResolvedValue('data:application/pdf;base64,PDF')
    mockUploadNow.mockImplementation((_d: string, _t: string, _at: string, role: string) =>
      Promise.resolve(role === 'linehaul_pdf' ? 'pdf-artifact' : 'scan-artifact'))
  })

  it('scans on a phone, then uploads the scan and its PDF under their own roles', async () => {
    const onUpdate = vi.fn()
    renderUnblocked(onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Linehaul sheet' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ linehaulPdfArtifactId: 'pdf-artifact' }))
    expect(mockBuildPdf).toHaveBeenCalledWith('data:image/jpeg;base64,SCAN')
    expect(mockUploadNow).toHaveBeenCalledWith('data:image/jpeg;base64,SCAN', 'photo', expect.any(String), 'linehaul_photo')
    expect(mockUploadNow).toHaveBeenCalledWith('data:application/pdf;base64,PDF', 'document', expect.any(String), 'linehaul_pdf')
  })

  it('keeps the scan when the PDF cannot be built', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockBuildPdf.mockRejectedValue(new Error('embed failed'))
    const onUpdate = vi.fn()
    renderUnblocked(onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Linehaul sheet' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ linehaulPhotoArtifactId: 'scan-artifact' }))
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ linehaulPdfArtifactId: 'pdf-artifact' }))
  })

  it('does not use the scanner in the browser', async () => {
    mockIsNative.mockReturnValue(false)
    renderUnblocked(vi.fn())

    fireEvent.click(screen.getByRole('button', { name: 'Linehaul sheet' }))

    await waitFor(() => expect(mockBuildPdf).toHaveBeenCalledWith('data:image/jpeg;base64,Linehaul sheet'))
    expect(mockScan).not.toHaveBeenCalled()
  })
})
```
In the existing `linehaul.test.tsx`, add `linehaulPdfDataUrl: null, linehaulPdfArtifactId: null` to `EMPTY_DRAFT`, and update any assertion pinning the old wording ("Sheet photo", "Add the sheet photo first", "Photograph the sheet") to the new wording from Step 6.

- [ ] **Step 3: Run to see them fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/api/__tests__/phases.test.ts components/phase/steps/__tests__/linehaul.test.tsx components/phase/steps/loading/__tests__/Linehaul.scan.test.tsx`
Expected: the new tests FAIL.

- [ ] **Step 4: Draft fields** in `evidence-draft.ts`, in `LoadingEvidence`:

```ts
  // The same sheet as a one-page PDF (lib/scan/buildLinehaulPdf.ts), uploaded as role
  // linehaul_pdf. Optional: drafts saved before the scanner existed have neither key, and
  // a failed PDF build leaves them null while the scan image still submits.
  linehaulPdfDataUrl?: string | null
  linehaulPdfArtifactId?: string | null
```
In `PhaseStepPageClient.tsx`:
```ts
const LOADING_INITIAL: LoadingEvidence = {
  linehaulPhotoDataUrl: null, linehaulPhotoArtifactId: null,
  linehaulPdfDataUrl: null, linehaulPdfArtifactId: null, capturedAt: null,
}
```

- [ ] **Step 5: Submit** in `lib/api/phases.ts`

In `interface LoadingCompleteRequest`, after `linehaul_photo_artifact_id`:
```ts
  // The scan as a PDF. Null when it could not be built, or on a paperless warehouse.
  linehaul_pdf_artifact_id: string | null
```
In the `'loading'` case, after `linehaulPhotoId` is computed:
```ts
      const linehaulPdfDataUrl = e.linehaulPdfDataUrl ?? null
      const linehaulPdfId = linehaulPdfDataUrl !== null
        ? await artifactIdFor({
            tripId, artifactType: 'document', readyId: e.linehaulPdfArtifactId ?? null,
            dataUrl: linehaulPdfDataUrl, capturedAt,
            attribution: { phaseEventId, role: 'linehaul_pdf' },
          })
        : null
```
And in the `completePhase` body, after `linehaul_photo_artifact_id: linehaulPhotoId,`:
```ts
        linehaul_pdf_artifact_id: linehaulPdfId,
```

- [ ] **Step 6: The step** in `Linehaul.tsx`

Imports:
```tsx
import { useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { buildLinehaulPdf } from '@/lib/scan/buildLinehaulPdf'
import { scanLinehaulSheet } from '@/lib/scan/scanLinehaulSheet'
```
Inside the component, after `const { uploadNow } = useArtifactUpload(...)`:
```tsx
  // A retake replaces the scan while the previous PDF may still be building; only the
  // newest capture's PDF may land in the draft.
  const latestCapture = useRef(0)
```
Replace `handleCapture` with:
```tsx
  // Upload starts the moment the scan exists, not when the driver swipes — the walk
  // between the two is dead time otherwise. Same pattern as departure/CaptureSeal.tsx.
  //
  // The PDF is built from the very scan stored as linehaul_photo, and both go up under
  // their own roles; loading anchors both hashes (payload v3). A PDF that fails to build
  // is logged and dropped: the scan image is the evidence, the PDF the readable copy.
  function handleCapture(dataUrl: string) {
    latestCapture.current += 1
    const capture = latestCapture.current
    const capturedAt = new Date().toISOString()
    onUpdate({
      linehaulPhotoDataUrl: dataUrl, linehaulPhotoArtifactId: null,
      linehaulPdfDataUrl: null, linehaulPdfArtifactId: null, capturedAt,
    })
    void uploadNow(dataUrl, 'photo', capturedAt, 'linehaul_photo').then((artifactId) => {
      if (artifactId !== null) onUpdate({ linehaulPhotoArtifactId: artifactId })
    })
    void buildLinehaulPdf(dataUrl)
      .then((pdf) => {
        if (capture !== latestCapture.current) return null
        onUpdate({ linehaulPdfDataUrl: pdf })
        return uploadNow(pdf, 'document', capturedAt, 'linehaul_pdf')
      })
      .then((artifactId) => {
        if (artifactId !== null && artifactId !== undefined && capture === latestCapture.current) {
          onUpdate({ linehaulPdfArtifactId: artifactId })
        }
      })
      .catch((err: unknown) => {
        console.warn('Linehaul PDF could not be built — submitting the scan alone', err)
      })
  }
```
Change the intro and requirement:
```tsx
      intro="Compare these with the sheet you were handed, then scan it."
      requirements={[{ label: 'Sheet scan', met: hasPhoto }]}
```
and the swipe `waitingLabel` to `"Scan the sheet first"`. Replace the `<CameraCapture ... />` with:
```tsx
      <CameraCapture
        label="Linehaul sheet"
        actionLabel="Scan the sheet"
        hint="Lay it flat, all four corners in view"
        dataUrl={draft.linehaulPhotoDataUrl}
        onCapture={handleCapture}
        // The phone's document scanner finds the edges and flattens the page; the browser
        // has none, so it keeps the plain camera and the PDF wraps the uncropped photo.
        nativeSource={Capacitor.isNativePlatform() ? scanLinehaulSheet : undefined}
      />
```
Update the comment above the old `handleCapture` that says "This is now the ONLY capture of the linehaul document" so it still reads true: keep it and add "(as a scan, plus its PDF)".

- [ ] **Step 7: Run both suites and type-check**

Run: `cd frontend/driver-pwa && npx vitest run lib/api/__tests__/phases.test.ts components/phase/steps/__tests__/linehaul.test.tsx components/phase/steps/loading/__tests__/Linehaul.scan.test.tsx && npm run type-check`
Expected: all pass. Older linehaul tests that pinned "Sheet photo" or "Add the sheet photo first" get the new wording.

- [ ] **Step 8: Stage**

```bash
git add frontend/driver-pwa/lib/types/evidence-draft.ts "frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx" frontend/driver-pwa/lib/api/phases.ts frontend/driver-pwa/lib/api/__tests__/phases.test.ts frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx frontend/driver-pwa/components/phase/steps/__tests__/linehaul.test.tsx frontend/driver-pwa/components/phase/steps/loading/__tests__/Linehaul.scan.test.tsx
```
Suggested commit: `feat(driver-pwa): scan the linehaul sheet and submit its PDF`

---

### Task C12: Final verification

- [ ] **Step 1: Driver app**

Run: `cd frontend/driver-pwa && npm run type-check && npm run lint && npm test && npm run build`
Expected: all pass.

- [ ] **Step 2: Dispatcher** (role and type changes reach it)

Run: `cd frontend/dispatcher && npm run type-check && npx vitest run`
Expected: all pass, Node 22.

- [ ] **Step 3: Backend**

Run: `cd backend && TEST_DATABASE_URL="postgresql+asyncpg://timgultig@localhost:5433/freightproof_test" .venv/bin/pytest -q`
Expected: no new failures compared with `dev`. Confirm by name that `test_anchored_phases_is_every_phase_type` and `test_every_phase_of_a_completed_trip_ends_anchored_with_matching_receipt_type` pass.

- [ ] **Step 4: Device smoke test (Tim)**

Run `npm run cap:sync` and `npm run cap:sync:ios`, then install on a physical Android phone (the ML Kit scanner does not run on emulators) and on the iPhone. Walk one trip end to end against a local backend:
- the linehaul scanner opens, edges are found, and the step completes
- the dispatcher API shows `linehaul_pdf_artifact_id`
- the seal OCR fills at departure and arrival
- every phase shows as anchored in `AnchorProgress`
- the audit pack for the trip lists the linehaul PDF as anchored

- [ ] **Step 5: Hand-off notes for the PR**

The PR description must:
- list the cross-owner files (Ground rules) and ask Ciaran to review the shared and dispatcher lines
- name the migration `tim_seal_source_linehaul_pdf` and say it is applied from `dev` after merge
- name the new packages: `@capacitor/*` 7, `@capacitor-community/image-to-text`, `@capgo/capacitor-document-scanner` and `pdf-lib`
- record the audit-pack linehaul tier bug fix (C1)
