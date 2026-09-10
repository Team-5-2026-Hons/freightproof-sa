# FP-146 — Dispatcher exception list, resolve, and the act row

> **Author:** Ciaran · **Date:** 2026-09-03 · **Branch:** `Ciaran` → PR into `dev`
> **Supersedes** [../2026-09-03-sprint6-remaining-plan.md](../2026-09-03-sprint6-remaining-plan.md) §3,
> which is a correct ordering but wrong on one material point — see §1.
> Every claim below was verified against the working tree on 2026-09-03; each carries
> the command that re-checks it.

## 0 · What this ticket actually is

The story says "add resolve". It is really **make the exception surface real**:

- `frontend/dispatcher/lib/hooks/useExceptions.ts` returns `mockExceptions` and never
  calls the API. Both exception pages render off it.
- `backend/app/api/v1/endpoints/exceptions.py` has **one** route — the driver's POST.
  Its module docstring explicitly declares dispatcher list/resolve out of scope.
- `TripException` already carries `resolved`, `resolved_by_user_id`, `resolved_at`,
  `resolver_note`. Only the *method* was missing.

```bash
grep -n "mockExceptions" frontend/dispatcher/lib/hooks/useExceptions.ts
grep -n "@router\." backend/app/api/v1/endpoints/exceptions.py
grep -n "resolved\|resolver" backend/app/db/models/transit.py
```

## 1 · The correction: `main.py` **is** in scope

The sprint plan says *"No `main.py` change — both new routes extend the existing
exceptions router."* **That is wrong**, and it is the one thing in §3 that would have
stopped work mid-Saturday.

The existing router is trip-scoped:

```python
router = APIRouter(prefix="/trips/{trip_id}/exceptions", tags=["exceptions"])
```

But the dispatcher list page calls `useExceptions({ resolved: showResolved })` with **no
trip id** — it is an org-wide list across every trip. That cannot be served from a
`/trips/{trip_id}/...` prefix. FP-146 needs a **second router** at `/exceptions`,
registered in `main.py`, which is a four-reviewer shared file.

**Decision: a second `APIRouter` in the same module**, not a new file. The two routers
serve one resource from two scopes; splitting the module would separate code that shares
schemas and a service.

## 2 · Route shape

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/trips/{trip_id}/exceptions` | `get_current_driver` | **Unchanged.** Driver raises |
| `GET` | `/exceptions` | `get_current_dispatcher` | Org-scoped list, `resolved` filter |
| `PATCH` | `/exceptions/{exception_id}/resolve` | `get_current_dispatcher` | Record the resolution |

Resolve is **not** trip-nested. Both places it is invoked from — the detail page and the
trip timeline act row — hold an exception id; only one holds a trip id. Nesting it would
force the caller to supply a value the server can already derive, and derive it anyway to
authorise the request.

**Org scoping is the authorisation boundary**, not a filter: the query joins
`Trip.operator_organization_id` against the token's org. A dispatcher must not be able to
read or resolve another operator's exceptions by guessing a UUID. Wrong org is `404`, not
`403` — a `403` confirms the row exists.

## 3 · Order of work

Each step ends somewhere the branch is green.

| # | Step | Files | State |
|---|---|---|---|
| 1 | `tel:` link | `components/ui/InfoRow.tsx`, `trips/[id]/page.tsx` | ✅ done |
| 2 | Enum → column → migration | `enums.py`, `transit.py`, `migrations/` | ✅ done |
| 3 | `resolve_exception()` | `orchestration/exception_service.py` | ⬜ |
| 4 | Narrow resolve schema + `Read` field | `schemas/transit.py` | ⬜ |
| 5 | Two routes + router registration | `endpoints/exceptions.py`, `main.py` | ⬜ |
| 6 | Backend tests | `tests/integration/`, `tests/unit/` | ⬜ |
| 7 | Shared type + real `useExceptions` | `shared/lib/types/exception.ts`, `useExceptions.ts` | ⬜ |
| 8 | Resolve form, both mocks killed | `exceptions/[id]/page.tsx` | ⬜ |
| 9 | Act row on the timeline | `trips/[id]/page.tsx` | ⬜ |

### Step 1 — `tel:` (done)

`Driver.phone_number` → `DriverRead` → `TripDetailResponse.driver`. The value was already
on the wire and simply never rendered; a dispatcher reacting to an exception was reading
it off another system to dial it. Shipped as an **additive optional `href`** on `InfoRow`
so none of its 37 existing call sites change.

A `tel:` link, not a call feature. FreightProof records; the phone does the calling and
the resolve form records that it happened.

### Step 2 — the column (done)

`ExceptionResolutionMethod`: `phoned` / `whatsapp` / `in_person` / `no_contact_yet`.
`no_contact_yet` is not a gap — a dispatcher resolving from evidence alone must be able
to say so rather than pick the nearest wrong answer, which is how contact logs become
fiction.

**`String(20)`, not `SAEnum`.** No model in this codebase uses a native PG enum; the
three sibling columns on this table (`exception_type`, `source`, `severity`) are all
String. A PG type would also need hand-written `CREATE`/`DROP TYPE`.

Revision `ciaran_exc_resolution_method`, hand-written. **Do not regenerate it** — see
`known-issues.md` §5. Upgrade and downgrade both verified against the dev database;
19 indexes and both Supabase auth FKs confirmed intact after each.

### Step 3 — `resolve_exception()`

```python
async def resolve_exception(
    db, *, exception_id, user_id, organization_id,
    resolver_note: str, resolution_method: ExceptionResolutionMethod,
) -> TripExceptionRead
```

- **Server sets `resolved_by_user_id` from the token and `resolved_at` from the clock.**
  The client sets neither. An evidence record where the client names its own author is
  not evidence.
- Org-scope in the same query that loads the row; `ResourceNotFoundError` on a miss.
- Already-resolved is **not** an error — return the existing row unchanged. The offline
  queue and a double-click both produce a repeat, and the first resolution is the
  evidence. Same idempotency discipline as the phase engine.
- Log metadata only. `resolver_note` is free text a dispatcher typed about a person and
  must never reach the log.
- Enqueue a realtime event so other dispatchers' lists refresh —
  `kind=EXCEPTION_RAISED, severity=INFO`. A resolution is progress, not an alarm.

### Step 4 — schemas

**A new narrow body. Do not reuse `TripExceptionUpdate`** (`schemas/transit.py:154`) — it
exposes `resolved`, `resolved_by_user_id`, `resolved_at` and `merkle_batch_id` on the
wire, which is exactly what must not be settable by a caller.

```python
class TripExceptionResolveRequest(BaseModel):
    resolver_note: FreeText          # mandatory, min_length after strip
    resolution_method: ExceptionResolutionMethod
```

Add `resolution_method` to `TripExceptionRead`.

### Step 5 — endpoints

Both behind `get_current_dispatcher`. Thin: validate, call the service, return. Update
the module docstring, which currently declares this work out of scope.

### Step 6 — tests

Integration (`tests/integration/test_exceptions_dispatcher.py`):
200 resolve · 401 unauthenticated · 404 wrong org · 404 unknown id · 422 missing note ·
list is org-scoped · `resolved` filter both ways · repeat resolve is idempotent.
**Assert the four existing columns *and* the method after the mutation.**

Unit: `resolve_exception` takes the resolver from the token, not the body — the test that
would have caught the whole class of bug.

`pytest -q -ra`. Baseline before step 3: **928 passed, 4 skipped**; the 4 are deliberate
parametrised cases in `test_seed_fixtures.py`, not DB skips. Any other skip means
`TEST_DATABASE_URL` is unset and the integration half silently did not run.

The test database is built from the **models** (`conftest.py:183` `create_all`), not from
migrations, so it picks up `resolution_method` with no migration step.

### Step 7 — the hook

Real `api.get`, **same `ExceptionsFilter` signature** so neither page needs rewriting.
Wire `useLiveResource('trip', 'any', refetchSilent)` so FP-147's events refresh the list.

`shared/lib/types/exception.ts` gains `resolution_method` — **shared with `driver-pwa`**
via `@shared/*`. Additive and optional-nullable; the driver app reads no new field.

### Step 8 — the detail page

Resolve form: mandatory note + method. Its success toast at `:85` already exists and
currently fires against nothing.

**Both mocks go.** The page reads the exception from the API *and* the trip from
`mockTrips` (`:76`); wiring only the first leaves it half-real. Needs loading and error
states, which the page currently has none of.

### Step 9 — the act row

**An exception renders as its own row on the timeline rail, not as a child behind the
phase chevron.** Today it nests inside `isExpanded` (`:300-336`, props `:157-161`, attach
loop `:652-663`).

Before: a `1 exception` badge on the phase row, content only on expand.
After: `⚠ Seal mismatch · system · 14:33` as a row in chronological position.

Why now: an exception already has everything a row needs — `source` is the actor,
`created_at` the timestamp, `phase_event_id`/`trip_stop_id` the position,
`supporting_artifact_id` the artifact. When the step-event ledger lands in iteration 4,
exceptions **join** the rail instead of being rebuilt; the `exceptions` prop group and the
`:300-336` block are already gone. This is the only part of FP-146 that buys anything
structural (ledger note §4: *"Take it."*).

**Keep the in-transit de-duplication rule** at `:737-743` — an in-transit leg renders its
own exceptions inside its Journey mini-timeline, and without the rule they appear twice.

## 4 · Shared files — flag every one

| File | Change | Risk |
|---|---|---|
| `backend/app/main.py` | one `include_router` | Low, additive |
| `backend/app/db/models/enums.py` | one new enum | Low, additive |
| `backend/migrations/versions/` | one revision | **Coordinate — Tim is live on FP-143/145** |
| `frontend/shared/lib/types/exception.ts` | one optional field | Low; `driver-pwa` reads it not |
| `frontend/dispatcher/components/ui/InfoRow.tsx` | optional `href` | Low; 37 call sites unchanged |

No new dependency. `requirements.txt` and both `package.json` untouched.

## 5 · Out of scope

- **FP-148 Half B** (All / My / Watching) — needs a trip↔dispatcher assignment model that
  does not exist. `approving_dispatcher_user_id` is on `DriverSubstitution`, not `Trip`;
  `created_by_user_id` reaches no dispatcher response at all.
- **Step-event ledger Stage 1+** — iteration 4.
- **The autogenerate drift** (`known-issues.md` §5) — affects the whole team, is its own
  task, and must not be folded into this PR.
- **`driver-pwa`** — shares the type, reads no new field.

## 6 · Working agreement

Claude writes migration files and **never runs them**. Ciaran runs all Alembic and
database commands, so he knows exactly when the schema changes. Claude stages files and
never commits or pushes.
