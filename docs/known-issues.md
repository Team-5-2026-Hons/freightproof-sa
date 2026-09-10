# Known Issues & Tech Debt

A running list of environment and code issues to raise with the team. Each entry
records the symptom, root cause, impact, and proposed fix. Delete an entry once it
is resolved (and, if it changed shared behaviour, note it in the relevant spec).

Two parts. **Known issues** (1-7) are defects and tech debt. **Deferred work** (8 onward) is
scoped work that has been deliberately postponed — not broken, but decided and parked,
recorded so the reasoning does not have to be re-derived when it is picked up. Both live
here rather than in separate design notes so there is one place to look.

---

## 1. `??` fallback in `supabase.ts` fails on empty-string env vars

**Files:** `frontend/driver-pwa/lib/supabase.ts` (and the equivalent
`frontend/dispatcher/lib/supabase/client.ts` — verify before fixing).

**Symptom:** The driver PWA compiles and reaches "Ready", but every page returns
HTTP 500 with `Error: supabaseUrl is required.`

**Root cause:** The client reads config as
`process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'`.
`??` only substitutes the placeholder when the value is `null`/`undefined`. When a
developer's `.env.local` contains `NEXT_PUBLIC_SUPABASE_URL=` (present but empty),
the value is the empty string `""`, which is *not* nullish — so the placeholder is
skipped and `createClient("")` throws.

**Why it's inconsistent across the team:** `.env.local` is gitignored, so its shape
differs per machine. Omitting the line entirely → works. Leaving it empty → crash.
Notably, the committed `.env.example` demonstrates the empty-value form, so anyone
who copies it verbatim and runs in demo mode hits the crash.

**Impact:** Medium severity, high friction. No data or production-logic risk, but
the app looks completely broken (blank 500) for any teammate or CI job whose env
file follows the documented example. Masquerades as an unrelated failure.

**Proposed fix (team decision — touches a shared auth file):** Use `||` instead of
`??` so empty strings also fall back, or normalise the env read (trim and treat
empty as unset). Apply the same fix to the dispatcher client if it shares the
pattern.

---

## 2. Node version is not pinned anywhere

**Scope:** whole repo — no `.nvmrc`, no `"engines"` field in any `package.json`.

**Symptom:** On Node 23.x the driver PWA's dev server hangs indefinitely at startup
(the `@serwist/next` import inside `next.config.ts` stalls ~35s→never), so the app
never boots and appears dead with no error message.

**Root cause:** The project targets Node 22 LTS (stated in `README.md` and
`CLAUDE.md`) but nothing enforces it. A routine `brew upgrade` can move a developer
onto Node 23 — an odd-numbered, non-LTS "Current" release — without warning.

**Impact:** Medium severity, recurring/latent. Costs a confusing debugging session
each time someone drifts off the supported line, because the failure (a silent
hang) points nowhere near the real cause. Undermines cross-developer
reproducibility, which the `CLAUDE.md` standards section is meant to guarantee.

**Proposed fix (team decision — touches shared config):** Add `.nvmrc` containing
`22` and `"engines": { "node": ">=22 <23" }` to the frontend `package.json` files.
`.nvmrc` lets `nvm use` auto-select the right version; `engines` makes npm warn
(or error under `engine-strict`) on the wrong Node.

---

## 3. Xcode's "Update to recommended settings" breaks the iOS build

**Files:** `frontend/driver-pwa/ios/App/App.xcodeproj/project.pbxproj`.

**Symptom:** `npx cap run ios` / `xcodebuild` fails with
`error: Sandbox: bash(...) deny(1) file-read-data .../Pods-App-frameworks.sh` and
`Operation not permitted`, in the `[CP] Embed Pods Frameworks` phase.

**Root cause:** Accepting Xcode 26's "Update to recommended settings" banner sets
`ENABLE_USER_SCRIPT_SANDBOXING = YES` on the App project. CocoaPods' embed-frameworks
run script reads files outside its declared inputs, so the sandbox denies it. CocoaPods
knows this — it already sets the flag to `NO` on all 12 of its own Pods targets — but it
cannot set it for the App target, which is the one Xcode "upgraded".

**Impact:** Hard build failure, blocks all device testing. Reappears any time the banner
is accepted again.

**Fix (applied):** `ENABLE_USER_SCRIPT_SANDBOXING = NO` in both Debug and Release. If the
banner returns, do not accept it for the App project — and never for Pods, which
`pod install` regenerates on every `cap sync` anyway.

---

## 4. The async engine has no pool or connect timeouts

**Files:** `backend/app/db/session.py` (lines 21–24, the `create_async_engine` call).

**Symptom:** Nothing visible yet — this is latent. It surfaces as a request that never
returns rather than one that fails: the client eventually gives up, the server-side
handler is still sitting there, and the logs show no error because nothing raised.

**Root cause:** The engine is built with `pool_pre_ping=True` and nothing else. Three
separate waits are therefore unbounded, each with its own trigger:

1. **Connecting.** asyncpg is given no `timeout`, so opening a new connection waits on
   the OS TCP timeout. If Supabase is reachable at the network level but not answering
   — the usual shape of a Supabase incident, as opposed to a clean outage — that wait is
   measured in minutes, not seconds.
2. **Waiting for a free connection.** `pool_timeout` defaults to 30s in SQLAlchemy, which
   *is* a bound, but a 30s queue wait under pool exhaustion is far longer than any
   request in this system should live. Every handler inherits it.
3. **Pre-ping.** `pool_pre_ping=True` issues a `SELECT 1` before handing a connection
   out. That is exactly the right behaviour for Supabase, which drops idle connections
   aggressively — but the ping is itself an unbounded round trip on a connection that
   has just been sitting idle, which is precisely the connection most likely to be
   half-open. The feature that protects us from stale connections is also the one that
   inherits their hang.

**Relationship to the `/health` fix (issue resolved on this branch):** `/health` was the
one place where this was *visible*, because it makes an explicit worst-case promise to
an orchestrator. That endpoint is now bounded from both ends: `asyncio.wait_for` around
the probe and its cleanup, and a non-committing session dependency so teardown does not
issue an unbounded `COMMIT`. But that is a bound applied *at one call site*. Every other
endpoint in the app still sits on the unbounded engine underneath. `/health` is now
honest about its own latency; it is not evidence that the database layer is bounded.

**Why it was not fixed in the same change:** it is a different failure mode with a much
wider blast radius. The `/health` fix touches one endpoint and cannot change behaviour
anywhere else. Adding `connect_args={"timeout": ...}` and a shorter `pool_timeout` to the
engine changes the failure behaviour of *every* query on *all four* branches at once,
including Celery tasks and Alembic — and the correct values depend on numbers nobody has
measured yet (real Supabase connect latency from `af-south-1`, and the pool's actual
high-water mark under the load the demo generates). Guessing them converts a rare hang
into a frequent spurious error, which is a worse trade.

**Impact:** Low probability, high severity when it fires, and effectively undiagnosable
from the logs — the signature of the bug is the *absence* of an error. Most likely to
appear during a live demo on conference wifi, which is the worst possible time.

**Proposed fix (team decision — `session.py` is imported by every endpoint):**
1. Measure first. Log connect latency and pool checkout wait for one full demo run;
   `pool_timeout` and the connect timeout should be set from observed p99, not invented.
2. Then set `connect_args={"timeout": N, "command_timeout": M}` for asyncpg and an
   explicit `pool_timeout`, with the values in `core/config.py` rather than as literals,
   so they can be tuned per environment without a code change.
3. Consider `pool_recycle` as well, sized under Supabase's idle-connection cutoff. That
   attacks the same problem from the other side — recycling a connection before it can go
   stale is cheaper than detecting staleness with a pre-ping that might hang.

**Owner:** unassigned. Raise at the next sprint boundary; do not fold into an unrelated PR.

---

## 5. `alembic --autogenerate` proposes dropping 17 indexes and the Supabase auth FKs

**Files:** `backend/migrations/versions/0001_initial_schema.py`, `backend/app/db/models/`,
`backend/tests/conftest.py:183-207`.

**Symptom:** Run `alembic revision --autogenerate` for any model change and the generated
file contains far more than you asked for. Confirmed 2026-09-03: a one-column addition
produced **25 operations**. The extra 24 were `DROP INDEX` on 17 indexes —
`ix_trips_status`, `ix_trips_driver_id`, `ix_trips_created_at_desc`,
`ix_trips_order_number`, `ix_parcels_barcode`, `ix_parcels_consignment_id`,
`ix_exceptions_severity`, `ix_exceptions_trip_resolved`, and the rest across
`blockchain_receipts`, `checkpoints`, `driver_events`, `precinct_events`, `vehicles` —
plus `DROP CONSTRAINT` on `fk_users_auth_id` and `fk_drivers_auth_id`, the foreign keys
into Supabase's `auth` schema, and three unrelated FK/unique additions.

**Root cause:** Those objects are created by `0001_initial_schema.py` but were never
declared on the SQLAlchemy model classes. Autogenerate works by diffing the models
against the live database, so it reads "in the database, absent from the models" as
"deliberately deleted" and writes the drop. It is doing exactly what it is designed to
do; it cannot distinguish *removed* from *never written down*.

It compounds because the two databases have **different sources of truth**: the dev
database is built by migrations and therefore has the indexes, while
`tests/conftest.py` builds the test database from the models via
`Base.metadata.create_all` and therefore does not. The schemas have never matched.

**Impact:** High if it ships, and the danger is how quietly it fails. **Dropping an index
breaks no test** — every assertion still passes and the application stays correct, it
just degrades as data grows, and nobody connects that to a migration from weeks earlier.
The `auth` foreign keys are the more serious half: that is referential integrity into
Supabase, not a performance question. Nothing is currently damaged — the generated file
was deleted before it ran, and the dev database was verified afterwards (19 indexes
present, both auth FKs intact).

**Affects everyone.** This is not one branch. Any developer running autogenerate this
sprint hits it — relevant to FP-143/FP-145, which are live.

**Workaround, today:** hand-write the migration scoped to the actual change. Precedent:
`2026_09_03_ciaran_add_exception_resolution_method.py`, which documents the trap inline.
If you do run autogenerate, read the entire generated file and delete everything you did
not ask for. Never commit one unread.

**Proposed fix:** declare the missing indexes and constraints on the models
(`__table_args__`) so autogenerate stops seeing them as absent, which also makes the test
database match the real one. Roughly a day, touches many model files, and must not be
folded into a feature PR.

**Owner:** unassigned. Raise at the next sprint boundary.

---

## 6. The test database's clock runs days behind the host

**Files:** `infrastructure/docker/docker-compose.test.yml`, any test comparing a
database-generated timestamp against a Python-generated one.

**Symptom:** Observed 2026-09-03: `select now(), statement_timestamp(), clock_timestamp()`
against the test database all returned **2026-08-29** — five days behind the host. Any row
whose `created_at` / `updated_at` comes from the `func.now()` server default is therefore
stamped days earlier than a row the test process stamps with `datetime.now(UTC)`.

**Root cause:** container clock drift. A Docker VM's clock does not resynchronise after
the host sleeps, so a laptop closed over a weekend leaves the database days behind. It is
per-machine and invisible until something compares the two clocks.

**Impact:** Low severity, high confusion. It does not affect correctness in production —
only tests that mix the two time sources. It bit an ordering test in
`tests/unit/test_exception_service.py`: a row created with an explicit "three hours ago"
Python timestamp sorted *newer* than one the database had just stamped, making a correct
`ORDER BY created_at DESC` look broken. The failure points at the query, not the clock,
which is what makes it expensive to diagnose.

**Workaround:** in any test that asserts on ordering or elapsed time, stamp **every**
timestamp involved from one Python base rather than letting some take the server default.
Never assert that a database-stamped row is later than a Python-stamped one.

**Fix:** `docker compose -f infrastructure/docker/docker-compose.test.yml restart` resyncs
it. Worth adding to the test-environment setup notes so it is the first thing checked when
a time-dependent test fails inexplicably.

**Owner:** unassigned. Environment issue, not code.

---

## 7. No stamped destination count exists between unloading and confirmation

**Files:** `backend/app/orchestration/phase_service.py` (`advance_unloading`,
`advance_confirmation`), `backend/app/db/models/phases.py`,
`frontend/dispatcher/lib/phase/derive.ts` (`destinationScannedCount`),
`frontend/dispatcher/lib/phase/trip-detail.ts` (`cargoFact`).

**Symptom:** A trip that has arrived and finished unloading still reports its ORIGIN
count in the detail header, while the manifest panel beside it shows every parcel
scanned in at the destination. The two surfaces describe the same trip and disagree.

Observed on `FP-20260812-02275C10` (9 September 2026, `status: active`,
`current_phase: confirmation`):

| Source | Value |
| --- | --- |
| Header — Recorded arrival | 12 Aug 2026, 11:52 |
| Header — Cargo | `14 booked · 14 recorded at origin` |
| loading phase (`completed`) | `parcel_count_origin` = 14 |
| **unloading phase (`completed`)** | `parcel_count_destination` = **NULL** |
| confirmation phase (`pending`) | `parcel_count_destination` = NULL |
| consignment | expected 14, scanned out 14, **scanned in 14** |
| manifest parcels | 14 scanned out, **14 scanned in** |

**Root cause:** `parcel_count_destination` is written in exactly one place —
`advance_confirmation` — onto the CONFIRMATION event. Unloading closes without stamping
anything, so between unloading completing and confirmation completing there is no
stamped destination figure in existence for the header to show. It falls back to the
origin count, which is the newest stamped fact available and is genuinely stale as a
statement about where the cargo is. `UnloadingDetail` already documents the gap from the
other side: "There is no stamped equivalent on this phase to fall back to once unloading
closes."

**This is not an artifact of the Parcel Perfect simulation.** The live destination
figure exists in the parcel scan rows and is what the manifest reads; the stamped one
does not exist yet by design. Replacing the seeded feed with the real integration would
reproduce the gap exactly. The simulation only flatters the display in a second way —
expected, scanned-out and scanned-in all agree in the demo data, so the header looks
tidier than real data would make it.

**Impact:** Medium severity on an evidence page. Nothing recorded is wrong and nothing is
lost: the count is in the scan rows and is anchored at confirmation. But the trip detail
header — the one surface a dispatcher reads first — states an origin figure for a trip
that has demonstrably arrived and been unloaded, without saying the destination figure is
not due yet. On a platform whose claim is "this is what happened", a stale summary that
does not announce itself as stale is the wrong default.

**Proposed fix (team decision — changes what the ledger records):** stamp a destination
count on the UNLOADING event at close, as `advance_loading` already does for
`parcel_count_origin`, and have `destinationScannedCount` prefer the final unloading and
fall back to confirmation. This makes the stamped record follow the goods rather than
waiting for the paperwork.

Open questions for the team, none of them settled here:

- Does the unloading stamp get anchored, or is it evidence held off-chain until
  confirmation anchors the authoritative figure? Anchoring it means a second
  `PHASE_EVENT` payload shape and a `verification_service` branch to rebuild it.
- On a cross-dock, every intermediate unloading would stamp a count. That is arguably
  correct — each is a real handover — but it changes what "destination count" means for
  a trip with three stops.
- `parcel_count_destination` already exists as a column on every phase row, so no
  migration is needed to hold the value. A migration WOULD be needed if the team wants
  the two stamps distinguished by name rather than by which phase carries them.

**Rejected for now (recorded so they are not re-proposed as fixes):**

- *Copy-only* — say "14 recorded at origin · destination count due at confirmation".
  Honest and cheap, and a reasonable stopgap, but it explains the gap rather than
  closing it.
- *Show the live scan in the header* — puts a figure recomputed per request next to
  stamped, anchored evidence in the same block. The header's whole discipline is that
  its numbers are stamped; the manifest is where live counts belong.

**Owner:** unassigned. Backend `orchestration/` work with a frontend follow-up; raised
from the dispatcher trip detail review, 9 September 2026.

---

## Common theme

Issue 7 stands apart from the rest: it is not a setup or drift problem but a modelling
decision whose consequence only shows up on screen, where the newest stamped fact and the
current state of the goods are not the same thing.

Issues 1, 2, 5 and 6 stem from the project depending on something being "correct" without
defining or enforcing what correct is — a developer's local setup in 1 and 2, and the
agreement between the models and the database in 5. Node version and
`.env.local` contents are invisible and per-machine, so the app works for whoever
set things up right and mysteriously breaks for everyone else. Pinning the Node
version and hardening the env-var fallback convert "silently depends on local
setup" into "explicitly defined and self-correcting".

Issue 5 is the same shape one layer down: the models and the migrations have drifted
because nothing checks that they agree, so the tool built to reconcile them now
proposes destroying the difference. A CI step asserting that autogenerate produces an
empty diff would convert it into an error at the moment it is introduced.

---

# Deferred work

Recorded deliberately, not started. These are not defects. Each entry states what was
decided, what it touches, and what is still open, so it can be picked up cold.

## 8. Trip detail load time — remaining plan (D)

**Status:** items A-C shipped on branch `Ciaran` (9 September 2026); D not started.

**Symptom:** the dispatcher trip detail page took roughly ten seconds to become useful.

**Measurements.** Clean cold load of `/trips/{id}`, dispatcher app in dev, backend on
Supabase `af-south-1`:

| Time | Event |
| --- | --- |
| 0-636ms | page shell loads |
| 666-2251ms | `GET /auth/me` (1585ms) — no data request is in flight during this |
| 2270ms | trip/artifacts/precincts requests finally start |
| ~10081ms | last response lands |

Per-call backend latency ranged 1.9-6.3s. `/trips/{id}` was requested five times and
`/precincts` twice in that single load; two of the five are React StrictMode
double-invoking effects in dev and will not occur in production.

Caveat on the numbers: browser resource timings are cross-origin
(`localhost:3000` → `127.0.0.1:8000`) without `Timing-Allow-Origin`, so `requestStart`
and `responseStart` are zeroed. Only total `duration` is trustworthy from the client.
Any finer attribution must be measured server-side.

**Root cause of the backend latency:**
`backend/app/orchestration/resource_service.py::get_trip_detail` issues **ten sequential
`await db.execute(...)` round-trips** — trip, driver, horse, trip_trailers, trailers,
phases, exceptions, blockchain_receipts, stops, consignments — each awaited before the
next begins. There is no `selectinload` anywhere in the trip read path. At ~200-400ms
round-trip latency to `af-south-1`, ten serial queries account for 2-4s, which matches
the observed range. **The cost is round-trip count, not query cost.**

**Already shipped (A-C):**

- Shared stale-while-revalidate cache in `useTripResource`, covering trip, artifacts and
  manifest. Re-entering a trip renders in ~24ms. Every mount still revalidates, and
  SSE-driven refreshes are forced so they never join a request issued before the event.
- Loading shell: the real layout with skeletons, replacing a bare centred spinner.
- Header seed: both list pages write their rows to `lib/trips/tripSeed.ts`; the detail
  header renders from that row immediately. Measured header at 750ms against a timeline
  at 6754ms on the same navigation.
- Timeline shows when the record was last read; jump-to-current moved into the timeline
  pane.

**Remaining plan (D).** Do these in order and stop when it is fast enough.
**Measure again after each.**

*D1 — batch the trip detail queries (highest value).* Replace the ten sequential executes
in `get_trip_detail` with `selectinload` eager loading, collapsing them to roughly two or
three round-trips. Expected: 2-6s → plausibly under 1s.

Constraint: these cannot be parallelised with `asyncio.gather` on a single
`AsyncSession` — SQLAlchemy async sessions are not concurrency-safe. Eager loading is the
route, not concurrency.

Risk: eager loading must not change the response shape. Run the trip integration tests
before and after and diff a real `TripDetailResponse` payload.

Ownership: backend work in `orchestration/`. Check sprint ownership before starting — it
is not obviously the dispatcher UI owner's file.

*D2 — unblock the auth gate.* ~1.6s of every cold load passes with zero data requests in
flight, waiting on `/auth/me` in `AuthProvider`. The trip fetch depends on the access
token, not on the dispatcher profile, so the two can run in parallel. Reclaims most of
that window.

*D3 — split the endpoint into staged loads.* Only if D1 and D2 leave it slow.
`GET /trips/{id}` returns the summary; a new `GET /trips/{id}/phases` returns the ledger;
fire both in parallel so header and panel paint on the first and the timeline on the
second. Deliberately last: splitting a slow endpoint in two does not reduce ten
round-trips, it just spreads them. D1 must come first or this mostly moves the problem.

**The rule that constrained the header seed, and constrains D3.** A fact that has not
loaded yet must render as loading — never as an em-dash or a zero. On this page those are
evidentiary claims: `originScannedCount` returning null already means "no origin count was
recorded", which is a statement about the trip, and a not-yet-fetched value is not
entitled to make it. Any staged load must keep unfetched facts visibly pending, which is
why `tripHeaderFacts` returns `null` for cargo when only a list row is known, and why the
history seed leaves arrival unread rather than substituting `closed_at` — closing a trip
is not arriving.

---

## 9. Dispatcher call logging and driver substitution

**Status:** neither started. Recorded because neither is safe to bolt on. The read-only
driver modal (`frontend/dispatcher/components/trips/DriverModal.tsx`) is the surface both
would eventually attach to.

### 9a. Dispatcher call logging

**Intent.** A dispatcher opens the driver modal on a live trip, calls the driver, and
records that the call happened. The record appears in the trip timeline. Most likely
during `in_transit`, but it must be possible in any phase.

**Why this is recording, not operating.** It passes the scope test in CLAUDE.md: it
captures *that contact occurred*, which is evidence. It must not become a task list, a
dispatch queue, or anything that tells a dispatcher what to do next.

**What already exists — do not duplicate it.** Contact is already modelled, but only
inside exception review:

- `ExceptionContactMethod` in `backend/app/db/models/enums.py`: `phone`, `whatsapp`,
  `in_person`.
- `contact_method` on the exception review columns in `backend/app/db/models/transit.py`.
- The enum's docstring is worth reading: `NO_CONTACT_YET` was deliberately removed,
  because the ABSENCE of contact belongs on the review outcome, not on a field named for
  the method OF contact. Any trip-level design should honour that same distinction.

A free-floating trip call log would create a second, parallel record of dispatcher
contact. Reuse the vocabulary; do not invent a competing one.

**Open questions to settle before building:**

1. **Is a contact event anchored to Hedera?** Phase events and exceptions are. A contact
   log is dispatcher-authored evidence, so the honest answer is probably yes — but that
   makes it a chain write, with the cost and failure modes that implies, and it means a
   mistyped log entry is permanent. Decide explicitly.
2. **Is it attached to a phase, or only to the trip?** The trip timeline is plan-driven
   and derives position from the phase ledger. A contact event has no phase of its own.
   Simplest coherent answer: trip-scoped with a timestamp, rendered in chronological
   position — the same treatment trip-level exceptions already get in `TripTimeline`'s
   "Trip record" section.
3. **What is actually recorded?** At minimum: who logged it, when, method, and free text.
   Whether the call *reached* the driver is a separate fact from whether it was attempted,
   and conflating them would repeat the `NO_CONTACT_YET` mistake.
4. **POPIA.** Call notes are free text about a named person and will end up holding
   personal detail. They stay in Postgres in `af-south-1`; only a hash may be anchored.

**Rough shape of the work.** New model + hand-written Alembic migration (autogenerate
drifts on this project — see issue 5), registration in `db/models/__init__.py`, Pydantic
v2 schemas, a thin endpoint delegating to orchestration, timeline rendering as a third
event kind alongside phases and exceptions, and unit plus integration tests. This is a
sprint item, not an afternoon.

### 9b. Driver substitution

**The constraint that decides the design.** `compute_journey_lock_hash` in
`backend/app/crypto/hashing.py` takes `driver_id`, `horse_id` and `trailer_ids` among its
inputs. **The driver is inside the journey lock.**

So mutating `trip.driver_id` on an existing trip makes the stored record stop hashing to
its anchored value, and the Record Integrity check reports tampering — correctly. That is
the mechanism working, not a bug to route around. CLAUDE.md is explicit: trip parameters
are never modified after creation without an explicit exception event.

**Chosen direction: option 1 — amendment on the ledger.** Agreed 9 September 2026.

The original journey lock stays valid over the original parameters, because those remain
true: this trip *was* created with driver X. The substitution is recorded as its own
anchored amendment naming the outgoing driver, the incoming driver, who authorised it and
when. Verification then checks the original lock plus the ordered chain of amendments.

This preserves exactly what the platform exists to prove — that the original driver was
on the trip — while letting the record reflect what actually happened afterwards.

The rejected alternative was closing the trip and re-creating it under the new driver with
a fresh lock. It keeps verification trivially simple but fragments one physical journey
across two trip records, which damages the evidence more than it simplifies the code.

**What this touches:**

- A new anchored amendment record, and a decision on whether it is a variant of the
  existing exception event or its own type.
- `verification_service._reconstruct_trip_payload` — verification stops being "rebuild the
  payload and compare one hash" and becomes "rebuild the original, then apply the ordered
  amendments". This is the substantive change and it deserves its own tests, including a
  trip with two successive substitutions.
- The frontend integrity summary, which currently reports a single match/mismatch verdict
  and would need to express "matches, with N recorded amendments".
- Whatever authorisation rule governs who may substitute a driver.

**Note for the write-up.** Both the chosen and rejected options are defensible, and the
reasoning above — evidential continuity over implementation simplicity — is the kind of
trade-off worth being able to defend at examination. Keep this section.

---

## 10. Deferred — dedicated arrival custody-check phase (iteration 4 candidate)

**Recorded:** 9 September 2026. **Status:** preferred product direction; deferred for
iteration 4 planning alongside the full phase child ledger. Not implemented, assigned,
or approved for immediate execution. This entry is the canonical record of the proposal.

**Reason:** Departure records the outbound seal and location. A corresponding Arrival
phase should record the seal as found at the destination BEFORE opening, with its own
location evidence and completion state. Unloading should then describe unloading alone.
The existing in-transit “Arrived” milestone records the end of driving; it does not replace
this destination custody check. Reaching the gate and completing inspection can be hours
apart, so their timestamps must remain distinct.

**Proposed sequence for new single-leg trips:** trip creation → activation → loading →
departure → in transit → arrival → unloading → confirmation.

**Proposed responsibilities:**

- In transit ends on the driver's existing arrival attestation; retain that actual-arrival
  timestamp and mini-timeline milestone.
- Arrival belongs to the destination stop. Move destination seal number/intact photo,
  departure-to-arrival seal comparison and associated seal exceptions from unloading into
  it. Capture phone position and timely tracker corroboration against that destination.
- Arrival inspection must be recordable before warehouse scan completion. Keep the
  unloading scan gate on unloading, not on arrival.
- Unloading retains warehouse scan completion and the applicable independent driver
  observations. Confirmation retains POD and final reconciliation.
- If recording the subsequent seal-opening act is required, model it as an explicitly
  attributed child event. Do not infer that opening happened at arrival or substitute a
  broken-seal photo for the intact inspection photo. Actor and evidence requirements for
  seal opening still need a team/domain decision.

**Relationship to the child ledger:** This adds a distinct custody stage to the parent
plan; the child ledger records acts within that stage (inspection, captures and potentially
opening). It is not a proposal to promote every capture step into a phase. The existing
ledger spec says “Do not make the phase plan finer”; adopting this proposal requires a
deliberate, narrow revision of that assumption before implementation, not silently doing
both designs at once.

**Implementation coordination:** Use
[the authoritative step-event implementation plan](design-notes/2026-09-02-step-event-ledger-implementation-plan.md)
as the execution home when iteration 4 is planned. Reconcile its §6 scope and seal-chain
design first, assign an owner, and add a bounded arrival work item with acceptance tests.
The two features can be delivered in coordinated stages; an Arrival phase does not
technically require the entire child ledger to ship first.

**Work required:** backend phase type/plan generation, destination lookup, transitions,
request contracts and seal exception ownership; shared types/recipes; driver routes,
drafts and offline retries; dispatcher timeline/location views; anchor-payload decisions
and compatibility tests. Reuse existing seal capture and comparison components/logic.

**Compatibility fence:** Existing trips retain their committed plans, historical seal
attribution and hashes. Agree how old and new plans coexist before creating migrations
or changing shared phase recipes. An in-flight/queued old-client unloading submission
must not become invalid merely because a new client supports Arrival. Preserve existing
empty-leg behaviour; define the new Arrival behaviour for trips with no cargo/seal.
Multi-leg expansion remains outside this request and must not regress.

**Acceptance criteria for the future work:**

1. End-of-driving time and arrival-inspection completion time are separately visible.
2. A destination seal mismatch can be recorded before unloading scans finish, with the
   exception attached to Arrival and no automatic loss of later delivery evidence.
3. Geofence checks use the destination, with missing/untimely fixes remaining unknown.
4. Retries/offline replay do not duplicate inspection events or exceptions.
5. Legacy trips and queued submissions still work; cancellation/overrides remain honest.
6. Applicable seal evidence remains covered by the agreed integrity model; moving fields
   does not silently drop them from verification or rewrite existing receipts.

**Next planning action:** review this entry when opening the iteration 4 child-ledger
work, settle compatibility and seal-opening attribution, then revise the authoritative
implementation plan. No application changes are authorised by this backlog entry.
