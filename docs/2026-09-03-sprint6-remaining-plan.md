# Sprint 6 — Ciaran's Remaining Work

> **Author:** Ciaran · **Date:** 2026-09-03 · **Sprint 6 ends Mon 7 Sep 06:00 UTC**
> **Board state read from Jira on 2026-09-03.** Code claims verified against `dev`
> (local `Ciaran` is level with `origin/dev`: `git rev-list --left-right --count` → `0 0`).
> **Related:** [design-notes/2026-09-02-step-event-ledger-implementation-plan.md](design-notes/2026-09-02-step-event-ledger-implementation-plan.md)

## Where the board actually stands

| Ticket | Board | Reality on `dev` |
|---|---|---|
| FP-138 | Done | ✅ unique index + `test_creation_concurrency.py` |
| FP-141 | Done | ✅ |
| FP-144 | Done | ✅ both sides normalised, covered at `test_phase_service.py:1289` |
| FP-259 | **In Review** | **Code is merged.** Board hygiene only — see §1 |
| FP-146 | To Do | Not started. 8 pts |
| FP-147 | To Do | Not started. 5 pts |
| FP-148 | To Do | Not started. 5 pts — **split, see §4** |

**Four days, 18 points of To Do.** That does not fit, and the fix is choosing now rather
than discovering it on Sunday. §5 makes the call.

---

## 1 · FP-259 — close it, no code required

Every acceptance criterion is on `dev` already:

| Subtask | Evidence |
|---|---|
| FP-261 service, org-scoped | `precinct_service.py:111` `create_precinct`, `:209` `update_precinct` |
| FP-262 POST/PATCH behind the admin gate | `endpoints/precincts.py:53` and `:80`, both `Depends(require_admin_dispatcher)` |
| FP-263 bounds as constants | `schemas/organisations.py:60-88` — `_LATITUDE_MIN/MAX`, `_LONGITUDE_MIN/MAX`, `_RADIUS_MIN/MAX_METRES`, applied through `LatitudeFloat` / `LongitudeFloat` / `RadiusMetresInt` |
| FP-264 integration tests | `tests/integration/test_precincts.py`, `tests/unit/test_precinct_service.py`, `tests/unit/test_precinct_event_model.py` |
| FP-265 dispatcher UI | `app/(app)/precincts/` — list, `new`, `[id]`, with the geofence map |

**One judgement call to make and then stop thinking about:** FP-263 says *"bounds as config
constants"* and they are module constants in `schemas/organisations.py`, not in
`core/constants.py`. Named constants sitting next to the validators that use them is
defensible and arguably better. Either accept it, or move them — but do not leave the
subtask open over it.

**Do:** run `cd backend && pytest -q` once, transition the five subtasks to Done, move
FP-259 to Done. **Ten minutes, and it is the cheapest burndown movement available.**

---

## 2 · FP-147 + FP-148 Half A — one branch, one PR

These are one piece of work. Both touch `core/realtime.py` and `RealtimeProvider.tsx`;
doing them separately means opening the same two files twice and reviewing the same
decision twice.

### The constraint that decides the shape

**`phase_service` cannot import `exception_service`.** `exception_service.py:16` already
imports `current_phase_event` from `phase_service` — routing the six sites through
`raise_exception()` (as FP-211 is worded) is a circular import, not a refactor.

It would not work anyway: `raise_exception()` takes a `driver_id`, raises `PermissionError`
unless that driver is the trip's assigned driver, and hard-codes
`source=ExceptionSource.DRIVER`. **Enqueue inline at each site.** Six lines, no new module,
no import graph change. Re-word FP-211 to match.

### Steps

1. **`core/realtime.py`** — add `TAMPER_DETECTED = "tamper_detected"` to `RealtimeKind`.
   Nothing else changes; the channel stays thin and severity rides in the kind, so the
   POPIA surface is untouched. **Shared file — flag it.**
2. **`orchestration/phase_service.py`** — `enqueue_event(...)` after the `db.add(TripException(...))`
   at `:916`, `:1031`, `:1165`, `:1201`, `:1310`. `TAMPER_DETECTED` for the CRITICAL seal
   sites, `EXCEPTION_RAISED` for the warnings. `trip.operator_organization_id` is already in
   scope at every one of them — the file already calls `enqueue_event` at `:491` and `:575`.
3. **`orchestration/scan_service.py:344`** — same, one call. Reachable only through
   `dev_triggers.py` today, which is fine for the demo and worth knowing.
4. **`lib/realtime/types.ts`** — mirror the new kind.
5. **`lib/realtime/RealtimeProvider.tsx`** — this is FP-148 Half A. The `handleEvent`
   toast currently fires on `exception_raised` with the copy *"A driver flagged an
   exception"*, which would be false for all six system sites. Rank there:
   `TAMPER_DETECTED` → sticky critical with its own copy; `EXCEPTION_RAISED` → today's
   behaviour. **Ranking lives in the provider, not in the toast component** — one home, and
   the same home the ledger's debounce needs in iteration 4.
   Stickiness needs no work: `ToastContext.tsx:34` already makes `error` manual-dismiss.

### Verification

- `pytest backend/tests/unit/test_realtime_emit.py` extended — one case per site asserting
  the outbox carries the expected kind after commit.
- Full `pytest` green. The phase tests must not need editing; if one does, a contract moved.
- Manual: drive a destination seal mismatch through `dev_triggers`, watch the toast fire.
- **Known and accepted:** sites 1–5 fire in requests that also enqueue `PHASE_COMPLETED` at
  `_finish_phase` (`:575`), so one commit publishes two events and the client refetches
  twice. Let both ride; suppressing the completion hides a completion.

### Demo it from site 4

`phase_service.py:1201`, the destination mismatch. **Site 2 (`:1031`) cannot fire** — it
sits inside the `guard_verified_seal` branch the app has not sent since 2026-08-05.

**Shared files:** `core/realtime.py`. No migration.

---

## 3 · FP-146 — the biggest one, and bigger than the ticket said

The story is written as "add resolve". It is really "make the exception surface real":
`useExceptions.ts` returns `mockExceptions` and never calls the API, and
`endpoints/exceptions.py` has one route — the driver's POST. There is no dispatcher list
endpoint for the resolve action to live beside.

### Order — migration first, UI last

1. **`db/models/enums.py`** — `ExceptionResolutionMethod`: phoned / whatsapp / in_person /
   no_contact_yet. **Shared file — flag it.**
2. **`db/models/transit.py`** — one nullable column on `TripException`. The four resolution
   columns already exist at `:93-98`; only the *how* is missing.
3. **Migration.** `git fetch origin` and check `dev` for unmerged revisions **before**
   autogenerate — 28 on disk. `alembic heads` must show one head after.
   `2026_09_XX_ciaran_add_exception_resolution_method.py`. **Coordinate — Tim's FP-143 and
   FP-145 are live on the same sprint.**
4. **`orchestration/exception_service.py`** — `resolve_exception()`. Server sets
   `resolved_by_user_id` from the token and `resolved_at` from the clock; the client sets
   neither. Log metadata, never content.
5. **`schemas/transit.py`** — a **new narrow body**. `TripExceptionUpdate` already exists at
   `:156` but lets the caller set `resolved_by_user_id` and `resolved_at`, which is exactly
   what must not be on the wire. New model: `resolver_note` + `resolution_method` only.
   Add `resolution_method` to `TripExceptionRead`.
6. **`api/v1/endpoints/exceptions.py`** — dispatcher `GET` list (org-scoped, `resolved`
   filter) and `PATCH .../resolve`. Both behind `get_current_dispatcher`. Update the module
   docstring — it currently declares this out of scope.
7. **`lib/hooks/useExceptions.ts`** — real `api.get`, same `ExceptionsFilter` signature so
   the two pages need no rewrite. Wire `useLiveResource('trip', 'any', refetchSilent)` so
   FP-147's events refresh the list.
8. **UI** — resolve form on `exceptions/[id]/page.tsx` (its success toast at `:85` already
   exists and currently fires against nothing), mandatory note + method.
9. **`trips/[id]/page.tsx`** — the `tel:` link, and the act-row decision below.

### The design decision to take here

**Render the exception as an act row on the timeline, not as a child behind the phase
chevron.** Today it nests inside `isExpanded` (`:300-336`, props `:156-161`, attach loop
`:652-663`). This story touches that block anyway to show a resolution, and an exception
already has an actor (`source`), a timestamp, a position and an artifact FK — everything a
row needs. Do it now and the step-event ledger absorbs exceptions in iteration 4 instead of
rebuilding them. Keep the in-transit de-duplication rule at `:737-743`.

### The ten-minute win, do it first

`tel:` on the contact strip. `Driver.phone_number` (`people.py:59`) → `DriverRead`
(`schemas/people.py:53`) → `TripDetailResponse.driver`. **The value is already on the wire**;
the page just never renders it. Ship it in the first commit — it is the detail that makes
the demo feel built by someone who watched the job.

### Verification

- Integration: 201/200 resolve, 401 unauthenticated, 403 wrong org, 404 unknown id, 422
  missing note. Assert the four columns **and** the method after the mutation.
- Unit: `resolve_exception` sets the resolver from the token, not the body.
- Frontend: the two exceptions pages render from the API, not the mock.
- `alembic upgrade head` **and** `downgrade` against a scratch database.

**Shared files:** `db/models/enums.py`, `migrations/versions/`.

---

## 4 · FP-148 — split, and say so on the board

**Half A (severity)** rides with FP-147 above. **Half B (All / My / Watching) cannot be
built**, and not for effort reasons:

- `approving_dispatcher_user_id` is **not on `Trip`** — it is on `DriverSubstitution`
  (`models/trips.py:282`), the dispatcher who approved a driver swap.
- `created_by_user_id` **is** on `Trip` but reaches the dispatcher in no response at all:
  it lives on `TripBase` → `TripRead` (`schemas/trips.py:142`), and `TripRead` is used by
  **zero** endpoints. Neither `TripListItemResponse` nor `TripDetailResponse` carries it.
- `seed_demo.py` creates **one** dispatcher, so even with the field plumbed through,
  "My trips" returns "All trips" on the only dataset we demo.

FP-215 and FP-216 move to iteration 4 with the assignment model. This is the same ground
the iteration 3 plan already used to defer per-dispatcher routing in decision 11 —
**routing asks which dispatcher, severity asks which events are loud.** Only the second is
buildable now, and it is the one carrying the value.

**Record the split as a scope change with a date**, the way the 26 August changes were —
the board's own §7 lesson is that silent drift is the problem, not change.

---

## 5 · The four days

| Day | Work |
|---|---|
| **Thu 3** | FP-259 close-out (10 min) · FP-148 split recorded on the board · FP-147 + 148A backend: the kind and six enqueues · `test_realtime_emit` cases |
| **Fri 4** | FP-147 + 148A frontend: types, provider ranking, copy · manual seal-mismatch run · **PR** · FP-146 starts: enum, column, migration, `tel:` link |
| **Sat 5** | FP-146 backend: service, schemas, both endpoints, integration tests |
| **Sun 6** | FP-146 frontend: real `useExceptions`, resolve form, act row on the timeline |
| **Mon 7** | Buffer and merge. **Do not start anything new.** |

**If it slips, sacrifice in this order:** the act-row refactor (keep the nested rendering,
lose the ledger head-start) → the dispatcher list endpoint (keep the mock list, resolve from
the trip timeline only). **FP-147 does not give** — it is five days of work at most a few
hours long and it answers the panel's own sentence.

**Do not start any step-event ledger work this sprint.** Its Stage 0 items are Sprint 7,
and its Stage 1+ is iteration 4.

---

## Shared files this sprint

| File | Ticket | Note |
|---|---|---|
| `backend/app/core/realtime.py` | FP-147 / 148A | One new `RealtimeKind` |
| `backend/app/db/models/enums.py` | FP-146 | One new enum |
| `backend/migrations/versions/` | FP-146 | `git fetch` first — Tim is live on FP-143/145 |
| `frontend/dispatcher/lib/realtime/types.ts` | FP-147 / 148A | Mirrors the backend kind |

No `main.py` change — both new routes extend the existing exceptions router. No new
dependency, so `requirements.txt` and both `package.json` files stay untouched.

---

## 6 · Starting a fresh session on FP-147 + 148A

Everything a session needs that is not already in `CLAUDE.md` or the ticket.

### Read first, in order

1. **FP-147 in Jira** — the six-site inventory lives there, verified 2026-09-03.
2. `backend/tests/unit/test_realtime_emit.py` — **the template.** It already asserts
   against `session.info["realtime_outbox"]` after calling a service, DB-backed via
   `db_session`, no Redis and no Hedera. Its docstring says *"the three orchestration
   write paths"* and will need updating to nine.
3. `backend/app/core/realtime.py` — the outbox/after-commit contract (D9).
4. `graphify-out/GRAPH_REPORT.md` if any cross-file question comes up.

### Environment

```bash
source backend/.venv/bin/activate
cd backend && pytest -q -ra          # -ra so SKIPPED reasons are printed
```

**The trap that will otherwise produce a false green:** `tests/conftest.py:190-191` skips
every DB-backed test unless `TEST_DATABASE_URL` is set in `backend/.env`. A bare
`pytest -q` then reports all-pass while the integration half never ran. `-ra` makes the
skips visible; `infrastructure/docker/docker-compose.test.yml` is what stands the database
up. **"Full pytest green" is only true if the skip count is zero.**

`pytest.ini` already sets `asyncio_mode = auto` — async tests need no decorator.

### Branch and merge

Work on `Ciaran`; PR into `dev` (the precedent is PR #42). `main` and `dev` are both
branch-protected. Claude does not commit or push — it stages and hands back.

### Locate the sites by content, not by line

Every line number in this plan and in FP-147 is anchored to `dev` as of 2026-09-03. If
anything merges first, they move:

```bash
grep -n "db.add(TripException(" backend/app/orchestration/phase_service.py \
                                backend/app/orchestration/scan_service.py \
                                backend/app/orchestration/trip_service.py
```

Nine hits. Six are this story. `phase_service.py:560` and `trip_service.py:565` are the
dispatcher-note sites and stay silent.

### The kind is derived from severity, not from a list

Site 3 (`SEAL_UNVERIFIED`) computes its severity at runtime, so it belongs to neither the
"critical" nor the "warning" group when you are reading the code. **Rule:**

> `TAMPER_DETECTED` when the severity being written is `CRITICAL`, `EXCEPTION_RAISED`
> otherwise — read from the same value passed to the `TripException`, never hard-coded
> per site.

One small helper beats six judgement calls, and it cannot drift when a severity changes.

### Site 2 emits but gets no test

`phase_service.py:1031` sits inside the `guard_verified_seal is False` branch, which no
client can reach — the driver app stopped sending the field on 2026-08-05
(`driver-pwa/lib/api/phases.ts:50`). FP-214 asks for a test per site; **this is the one
exception.** Emit there for consistency and leave a one-line comment saying the branch is
unreachable from any current client and why the emit is there anyway. Do not contort a test
to drive a dead path.

See §7 on why the field still exists at all.

### The toast copy

`RealtimeProvider.tsx` currently reads *"A driver flagged an exception"* for every
`exception_raised`. Keep it for that kind, and add for `tamper_detected`:

> **Title:** `Critical: tamper signal`
> **Body:** `A seal check failed on a live trip — open the trip to review.`

`kind: 'error'` gives manual dismiss for free (`ToastContext.tsx:34`). **The toast must
name no driver, no seal number and no trip reference** — the channel carries ids and a
kind, and the dispatcher opens the trip, which has already refetched.

### Done means

- [ ] `TAMPER_DETECTED` on `RealtimeKind` and mirrored in `lib/realtime/types.ts`
- [ ] Six emits, kind derived from severity
- [ ] `test_realtime_emit.py` extended — five new cases, site 2 documented as excluded
- [ ] `pytest -q -ra` green **with zero skips**
- [ ] Provider ranks the two kinds; new copy in place
- [ ] Manual: destination seal mismatch through `dev_triggers` raises the sticky toast
- [ ] No phase test needed editing — if one did, a contract moved

---

## 7 · Note: `guard_verified_seal` is deprecated, not forgotten

Raised 2026-09-03: the guard verifies nothing in the process, so is this old code?

**The guard is not a party in the process.** `frontend/guard/` contains a README and no
code — a scaffold for a plain-HTML gate page promised in "Sprint 2" and never built.
`scope-boundaries.md:70` says guards have no accounts, and Bruce's 1 September description
names three parties who legitimately know the seal number, **none of them a gate guard**.

**But the two fields are a deliberate deprecation-in-place, and the comments say why.**
`schemas/phases.py:237-254` and `phase_service.py:1005-1013` both record it: older app
builds and replayed offline-queue entries still send `guard_verified_seal`, and the offline
queue treats a 4xx as terminal and discards the entry — so making the field required, or
deleting it, would permanently strand queued departures that are otherwise valid evidence.
Same reasoning that keeps `waybill_photo_artifact_id`.

**The tri-state is load-bearing.** `None` means "not collected" and is the ordinary case;
only an explicit `False` is an anomaly. A falsy check here would stamp a CRITICAL
`seal_mismatch` on every trip the current app submits. Four tests hold that line
(`test_phase_service.py:705-790`).

**Do not delete it this sprint.** Nothing can prove no client holds a queued departure, and
the removal touches `schemas/phases.py` plus roughly fifteen test sites in the last four
days of a sprint. It is already scheduled: the ledger note's §6 lists it as *"remove once
no client can still send it"*.

**What replaces it is the expected seal, not a guard page** (seal-chain note §3.3). The
mechanism was right — an independent confirmation of the seal — and the actor was wrong.
The waybill supplies a value the driver does not control; a guard re-typing on the driver's
own phone never did.

**One thing to act on now:** `frontend/guard/README.md` documents a plan the project has
since rejected, in a directory that ships. Either delete the directory or rewrite the README
to record that guards were designed out. It is the same class of artefact as the dead
`/sla` page.
