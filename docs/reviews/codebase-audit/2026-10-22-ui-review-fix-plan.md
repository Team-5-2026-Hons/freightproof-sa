# UI review fix plan — 22 Oct 2026

Source: the Codex/GPT UI review of 22 Oct, re-verified line by line against `9e636802` by Claude (Opus).
Every item below is a **confirmed** defect; file:line references are where the defect lives, not
suggestions of where the fix must go.

This plan carries decisions, interfaces and test cases — not code. The implementer writes the code,
following `CLAUDE.md` (no commits, no `git checkout/stash/reset`, TASK COMPLETE per batch).

## Ground rules for the implementer

- Work batch by batch in the order **A → B → C**. Stop after each batch with a TASK COMPLETE block
  and wait for Ciaran. Do not start D or E — they are reviewed separately.
- Each batch touches only its own tree: A = `backend/`, B = `frontend/driver-pwa/`,
  C = `frontend/dispatcher/`. If a fix seems to need a file outside the batch, stop and ask.
- Do not touch: `.claude/launch.json`, `.codex/`, `graphify-out/`, `.impeccable/`, or the untracked
  audit docs. No migrations are needed anywhere in this plan; if you think one is, stop and ask.
- Tests: write the failing test first, see it fail for the stated reason, then fix.
- Commands:
  - Backend: `cd backend && .venv/bin/pytest <paths>` — **foreground only** (a background run races
    the Stop hook and drops the test schema). Full suite once at the end of batch A.
  - Frontend: `npm test`, `npm run typecheck`, `npm run lint` inside the batch's app directory.
- Read `docs/design-notes/` only if a task says so. Before UI edits in batch C, read the impeccable
  craft floor and do **not** add coloured side-stripe bars for status or selection.

---

## Batch A — backend integrity (`backend/`)

### A1. Driver submission to an overridden phase is silently accepted (evidence lost)

**Defect.** `_gate_and_load` (`app/orchestration/phases/gate.py:33`) treats every resolved status,
including `OVERRIDDEN`, as an idempotent replay and returns 200 with trip detail. A driver whose
queued capture arrives after a dispatcher override is told "recorded"; the app clears it.

**Why OVERRIDDEN is never a replay.** `override_phase` only moves a row from PENDING/IN_PROGRESS
(`app/orchestration/phases/override.py:64`). So no driver completion of an OVERRIDDEN row ever
landed — any driver submission against it is new evidence, not a resend.

**Decision.**
- Add `PhaseOverriddenError` in `app/core/exceptions.py`, a subclass of `CustodyAccessError` so the
  existing `custody_http_exception` renders it as `409 {code, message}` with no new endpoint
  wiring (all four phase routes in `app/api/v1/endpoints/phases.py` already catch
  `CustodyAccessError`). Comment why it sits under that base (shared coded-409 rendering).
  - `code = "PHASE_OVERRIDDEN"`
  - `message = "The dispatcher closed this step while your capture was waiting. It is kept on this phone."`
- In `_gate_and_load`, before the generic `_is_resolved` replay branch: if
  `event.status == OVERRIDDEN` → raise `PhaseOverriddenError`. COMPLETED and EXCEPTION keep the
  idempotent-200 replay unchanged. Update the long comment there to say why OVERRIDDEN is split out.
- Out of scope (decision D-1 below): sending that evidence to the dispatcher.

**Tests** (integration, phases endpoint tests):
- `test_complete_phase_after_override_returns_409_phase_overridden` — create trip, override the
  activation phase as dispatcher, submit activation as driver → 409, `detail.code == "PHASE_OVERRIDDEN"`;
  assert the row is still OVERRIDDEN and no evidence/exception row was written.
- Existing replay tests for COMPLETED and EXCEPTION still return 200 (run them; don't duplicate).

### A2. Receiver verification verdict can be rewritten

**Defect.** `resolve_verification` (`app/orchestration/handover/receiver_verification.py:500`) always
overwrites `identity_match`, `status`, `tier`. The receiver route is unauthenticated (token holder),
so repeat POSTs with different typed name/ID can turn FAILED into VERIFIED, and each failed attempt
files another exception via `resolve_receiver_verification` (`handover/service.py:381`). The webhook
path already refuses to overwrite terminal rows — this brings the receiver path in line.

**Decision (revised 22 Oct after review of the first implementation).**
"Terminal status → return unchanged" is WRONG: the webhook can terminalise a row (e.g. VERIFIED)
before the receiver returns, and the webhook never runs the typed-identity cross-check
(`identity_match` stays None) and never files an exception — both happen only in the receiver's
resolve (`frontend/receiver/app/h/[token]/HandoverPageClient.tsx:367-372` documents this). Vendor-
unavailable rows are also UNVERIFIED before resolve, and resolve is what files their exception.
The correct invariant is "the receiver's cross-check runs once", not "status is written once":
- Keep `lock=True` on the load.
- Return the row unchanged (no vendor call, no exception) only when **`identity_match is not None`**
  — a cross-check already happened. That alone blocks FAILED(mismatch) → VERIFIED.
- Otherwise run `resolve_verification` as before (this covers PENDING, webhook-terminalised rows,
  and vendor-unavailable rows).
- Make exception filing idempotent: `raise_verification_exception` skips when a TripException of
  the same `exception_type` already exists for the same `trip_id` + `phase_event_id` +
  `trip_stop_id`. This stops repeat resolves filing duplicates.

**Tests:**
- FAILED by mismatch + second resolve with matching name → still FAILED, vendor not called, no new
  exception. (Existing new test — keep.)
- VERIFIED by receiver resolve + second resolve with mismatching name → still VERIFIED. (Keep.)
- **Webhook-first race:** webhook sets VERIFIED (identity_match None) → receiver resolve with a
  mismatching typed name → FAILED, identity_match False, one RECEIVER_ID_MISMATCH exception.
- Same race with a matching name → VERIFIED, identity_match True, no exception.
- **Vendor unavailable:** start_verification fails (UNVERIFIED, no session) → resolve twice → exactly
  one RECEIVER_ID_UNVERIFIED exception.
- PENDING row still resolves as today (existing tests cover — run them).

### A3. Override ignores phase order

**Defect.** `override_phase` checks only the row's own status (`override.py:64`); the API lets a
dispatcher override phase N while an earlier phase is unresolved. The UI doesn't expose this, but the
invariant belongs in orchestration.

**Decision.** After the status check, apply the same lower-sequence rule the gate uses
(`gate.py`, the `lower_result` query + `_is_resolved`). If any earlier phase is unresolved → raise
`PhaseSequenceError(..., "Override")` with a reason naming the unresolved earlier phase, mirroring the
gate's message. Extract a small shared helper in `phases/` if it avoids duplicating the query;
otherwise duplicate — don't over-engineer.

**Tests:** integration — override phase 2 while phase 1 pending → 409 and row unchanged; override
phase 1 then phase 2 → both succeed.

### A4. Direct trip creation skips precinct visibility (SEC-PRECINCT-1)

**Defect.** `create_trip` (`app/orchestration/trips/creation.py:481`) copies `spec.precinct_id` into
stops without checking ownership. Manifest import enforces `_visible_to`
(`app/orchestration/consignments/manifest_import.py:63`): own org's precincts plus `is_shared`.

**Decision.** Before building stops, load the distinct precinct ids from `new_trip.stops` filtered by
the same predicate. Any id missing from the result → the same not-found/validation error the endpoint
already uses for an unknown precinct (check what an unknown precinct id does today and match it — do
not reveal whether a foreign precinct exists). Move `_visible_to` somewhere both modules can import
(e.g. a precinct helper in `orchestration/`), keeping the docstring.

**Tests:** integration — create trip using another org's non-shared precinct → rejected, no trip row;
another org's **shared** precinct → allowed; own precinct → allowed.

### A5. Rate-limit identity is shared by every user

**Defect (worse than the review stated).** `app/core/rate_limit.py:149` keys on the first 64 chars of
the bearer token. Supabase tokens here are ES256 with a `kid`, so the base64 header alone is ~96 chars
— the 64-char prefix is **identical for every user**. All authenticated callers share one bucket per
endpoint.

**Decision.** Key on `sha256(full token)` hex (still unverified, still never leaves Redis). Fix the
comment that claims the prefix is unique. No config change.

**Tests** (`tests/unit/test_rate_limit.py`): two tokens with an identical 96-char header but different
payloads → different identities / independent counters. Existing tests still pass.

### A6. ParcelPerfect sweep reads expired ORM attributes after rollback

**Defect.** `app/tasks/parcel_perfect.py:140` — after `await db.rollback()` the `except` block reads
`consignment.id` / `.parcel_perfect_reference`. Rollback expires every instance; the async lazy load
raises inside the handler and aborts the whole sweep (and later loop iterations hit expired objects).

**Decision.** Capture the id and reference as plain locals at the top of each iteration before any
work, and log those. Load the loop's consignments as plain `(id, reference)` tuples or re-fetch per
iteration so later iterations never touch an instance expired by an earlier rollback. Use
`logger.exception` (keeps the traceback) instead of `logger.error(... %r)`.

**Tests** (`tests/unit/test_pp_task.py` or nearest): two consignments, the first sync raises →
errors == 1, the second still syncs, no exception escapes.

### A7. Audit pack prints "at None"

**Defect.** `app/orchestration/audit_packs/analysis.py:511` interpolates nullable `exchange_location`.

**Decision.** Render `"location not recorded"` when null (constant, not inline literal). Check the same
file for other nullable interpolations of the same shape and fix only identical cases.

**Tests:** unit — substitution with `exchange_location=None` → text contains "location not recorded",
not "None".

**Batch A done when:** targeted tests green, then full backend suite green (foreground).

---

## Batch B — driver evidence retention (`frontend/driver-pwa/`)

Depends on A1's response shape: `409 {code: "PHASE_OVERRIDDEN", message}`.

### B1. Treat PHASE_OVERRIDDEN as retained, never "recorded"

**Today.** The 200 replay made `runSubmission` (`lib/submission/phase-submitter.ts:330`) return
`recorded`. After A1 the server answers a coded 409, which `classifyLiveWriteFailure`
(`lib/offline/live-write-conflict.ts:78`) already turns into `{kind: 'retain', attention}`. But
`runSubmission` only acts on `retain` when `isCustodyConflict(...)` — otherwise it falls into the
uncoded-409 refetch path, which reads the phase as resolved and reports `recorded` again. That must
not happen.

**Decision.**
- Add `isPhaseOverridden(attention)` beside `isCustodyConflict` (code `PHASE_OVERRIDDEN`). Do **not**
  add it to `isCustodyConflict` — it must not be offered to the late-evidence route (that route
  requires a former custody period and would refuse it).
- In `runSubmission`'s coded branch: `retain` + `isPhaseOverridden` → `enqueuePhase(... attention ...)`
  and return `{kind: 'retained', message: attention.reason, persisted, handedOver: false}`.
- Defensive second line: in the uncoded-409 refetch branch and the 200 branch, if the addressed
  phase's status is `'overridden'`, return `retained` (enqueue with a PHASE_OVERRIDDEN attention)
  instead of `recorded`. This covers an older backend.
- Offline queue flush (`flushQueue` in `lib/hooks/useOfflineQueue.ts`, ~line 392): a queued phase
  entry answered with PHASE_OVERRIDDEN is kept as `needs-attention` (via `classifyLiveWriteFailure` →
  retain) and **not** dropped. It must **not** add the trip to `stalledTripIds`: the server already
  treats an overridden row as resolved, so later phase entries for that trip should keep draining in
  the same pass. Every other retained phase failure still stalls as today.
- This change supersedes decision D26 in `docs/superpowers/plans/2026-10-12-live-evidence-rail.md`
  ("any completion for a resolved phase replays 200") for OVERRIDDEN only. A1 already made that
  change on the backend; B1 is the client half.
- The retained-evidence review screen (`lib/offline/retained-evidence.ts`,
  `components/offline/RetainedEvidenceList.tsx`) must show these items with the server's message and
  no "send as late evidence" action. Check how it titles a non-custody retained item; adjust copy only
  if it's wrong.

**Tests** (vitest):
- submitter: coded 409 PHASE_OVERRIDDEN → outcome `retained`, `enqueuePhase` called with the attention.
- submitter: 200 whose addressed phase is `overridden` → `retained`, not `recorded`.
- submitter: uncoded 409 + refetch shows `overridden` → `retained`.
- queue flush: PHASE_OVERRIDDEN entry stays in the queue as needs-attention.
- queue flush: [overridden activation, loading] for one trip → activation retained, loading still
  sent in the same pass. A different retained code still stalls loading (existing behaviour).
- Existing `recorded` tests for `completed` still pass.

### B2. Checkpoint says "stored on this device" when storage failed

**Defect.** `enqueueCheckpoint` (`lib/hooks/useOfflineQueue.ts:696-709`) ignores `saveQueue`'s boolean
(`lib/offline/queue-storage.ts:135`). `CheckpointPageClient.tsx:89` then shows "Evidence stored on this
device" and navigates away.

**Decision.**
- `enqueueCheckpoint` returns `boolean` (the `saveQueue` result). Make `enqueueLocation` return it too
  for consistency (callers may ignore it — check them).
- `CheckpointPageClient`: if `false` → stay on the page, keep the captured evidence in state, show an
  error ("Couldn't save on this phone — storage is full or unavailable. Try again."), do not navigate.
  Same for the custody-conflict branch at line 101.
- Check every other `saveQueue` caller in this hook for the same ignore; fix identical cases only.

**Tests:** hook — `saveQueue` returning false → `enqueueCheckpoint` returns false. Page — network
error + storage failure → no success toast, no navigation, error visible; storage success → existing
behaviour.

**Batch B done when:** `npm test`, `npm run typecheck`, `npm run lint` green in `frontend/driver-pwa`.
Note: one suite needs `@capacitor/app` installed locally (`npm install` in driver-pwa, no package.json
change). The swipe test is known flaky in the full run — report it, don't chase it.

---

## Batch C — dispatcher truthfulness and usability (`frontend/dispatcher/`)

### C1. Incident filters don't refetch (browser-confirmed)

**Root cause.** `useAsyncData` (`lib/hooks/useAsyncData.ts`) keeps the latest fetcher in a ref and only
refetches when `run` changes, which it never does for a new fetcher. `useIncidents`
(`lib/hooks/useIncidents.ts:18`) is the only list hook whose fetcher changes with filters.
`useAnalytics.ts:33` documents the same limitation.

**Decision.** Fix locally in `useIncidents`: a `useEffect` keyed on `[status, incident_type, assigned_to]`
that calls `state.refetch()` on change (skip the first run — the mount fetch already happens). Do not
change `useAsyncData`'s contract (other callers rely on it). Make sure a slow response for old filters
can't overwrite newer ones — `useAsyncData` serialises requests and the follow-up uses the latest ref,
so verify with a test rather than adding a generation counter.

**Tests:** hook test rendering with status `open` then rerendering with `closed` → `listIncidents`
called with `closed`, and data from the second call is shown. Page test: picking the Closed tab hides
an investigating incident.

### C2. Trip panel shows "No incidents" when the load failed

**Defect.** `components/trips/TripDetailPanel.tsx:221` passes `tripIncidents.data` / `isLoading` but not
`error`; `TripIncidentsSection` renders empty as "None / No incidents on this trip".

**Decision.** Pass `error` and `onRetry` (refetch) to `TripIncidentsSection`. On error with no data:
"Incidents couldn't be loaded" + Try again; the disclosure summary reads "Unavailable", not "None".
With cached data + error: keep the rows and show a small "Couldn't refresh" note.

**Tests:** `TripIncidentsSection.test.tsx` — error + empty → unavailable state with retry, never
"No incidents".

### C3. Dashboard panels hide refresh failures behind old rows

**Defect.** `DashboardIncidentsPanel.tsx:55` and `DashboardExceptionsPanel.tsx:83` only show errors when
empty.

**Decision.** When `error && rows.length > 0`: keep rows, show a quiet inline "Couldn't refresh ·
showing data from HH:MM" with Retry. Track last successful load time in the panel (or hook) — no new
global state. Same treatment both panels; extract one small shared component if both use identical
markup.

**Tests:** each panel — rows + error → rows still rendered and stale note visible.

### C4. Trip list filters reset after visiting a trip (browser-confirmed)

**Defect.** `app/(app)/trips/page.tsx:42-43` keeps `search` and `tab` in `useState`.

**Decision.** Store both in the URL query (`?tab=…&q=…`) via `useSearchParams` + `router.replace`
(no history spam; wrap in Suspense as App Router requires). Validate `tab` against the known tab ids,
falling back to `all`. Search updates the URL debounced or on change — match how other pages handle
it if one already does. Check whether the incidents page should get the same treatment; if so, do it
the same way (status/type/owner/search).

**Tests:** page test — initial URL `?tab=active&q=CPT` renders with those filters applied; changing the
tab calls `router.replace` with the new query.

### C5. "Live" badge says Live while data requests are failing

**Defect.** `components/layout/LiveBadge.tsx` reflects only the realtime stream. Reviewer saw a trip
request time out and "Trip updates unavailable" while the badge said Live.

**Decision.** Keep the badge about the stream, but rename the meaning precisely in its accessible
label/tooltip ("Live updates connected"). Don't couple it to every fetch. The data-freshness signal
lives where the data is (C2, C3). Small change — if the badge already has precise copy, record
"no change" and say why.

### C6. Incident history buries substantive updates

**Observed.** One incident had 48 individual "parcel added" timeline entries
(`components/incidents/IncidentTimeline.tsx`, `IncidentTimelineEvent.tsx`).

**Decision.** Collapse consecutive events of the same kind by the same actor into one row
("48 parcels added" + expandable list). Only collapse runs of ≥3 consecutive entries; never across a different event kind;
keep the earliest/latest timestamps visible. Pure grouping function with unit tests, then render.

**Tests:** grouping function — runs, run boundaries on kind/actor change, runs of 1–2 left alone.
Component — collapsed row expands to show every item.

### C7. Incident table: clipped timestamp / horizontal scroll

**Decision.** At the review width the "received" timestamp clips. Shorten the date format in that
column (relative time with absolute on hover/title, matching how other tables in `ui/Table` do it —
reuse the existing helper, don't invent one) and let the summary column absorb the width. Check at
1280px and 1440px.

### C8. Keyboard focus in clarification forms and transfer descriptions

**Decision.** When a clarification form opens, focus its first field; on close/cancel, return focus to
the button that opened it (look for an existing `rememberTrigger`-style helper — TripDetailPanel uses
one — and reuse it). Driver transfer rows: include outcome and any warning in the accessible name /
`aria-describedby`.

**Tests:** focus moves in on open, returns on close; transfer row's accessible description includes
the outcome.

**Batch C done when:** `npm test`, `npm run typecheck`, `npm run lint` green in `frontend/dispatcher`,
and C1/C4 checked in the browser via the preview (log in with the demo dispatcher account Ciaran
provides; don't put credentials in files).

---

## Batch D — savepoint/outbox ordering (later, separate session)

Use WI-21 and WI-22 in `2026-10-21-fix-plan.md` with these corrections:
- WI-21 first: anchor dispatch (`app/orchestration/phases/anchor_dispatch.py:86`) uses a bare
  `after_commit`, which fires on savepoint release. Dispatch must wait for the **outer** commit. Tests
  must include: outer rollback after a released savepoint → nothing published.
- WI-22: rollback expires the modified event — re-load before reading attributes. Its proposed
  pre-existing-row test doesn't hit the failure (the helper returns early on that row); design one
  that does.
- WI-07: status lives on `DriverSubstitution`, not `BlockchainReceipt`; handle legacy null-status links.
- WI-27: commit/rollback/read-only dependency tests already exist — extend them.
- Drop the empty-batch finding (schema already requires ≥1 item).

**Already done elsewhere — skip:** WI-01 (superseded by A2's corrected rule: cross-check once,
guarded on `identity_match`, exception dedupe — do NOT reintroduce WI-01's "terminal status stands"
rule) and WI-23 (done as A6).

**Order and stop points (added 22 Oct):**
- **D1 — WI-27 characterisation (tests only).** Add only what's missing: items 4 (own-replay of an
  EXCEPTION completion → 200), 5 (concurrent double completion → one completion), 6 (phase Celery task
  success/retry). Items 1–3: check whether they exist; extend, don't duplicate. Every test must pass
  on today's code. No production edits.
- **D2 — WI-21.** In `phases/anchor_dispatch.py`, replace the bare `listens_for(db.sync_session,
  "after_commit", once=True)` with `evidence_anchors.dispatch.run_after_outer_commit(db, start)`; keep
  `_send`'s scheduling body as the `start` callable. Tests (model:
  `test_evidence_anchor_recovery.py::test_nested_savepoint_release_does_not_publish_early`):
  (a) register a phase anchor, open + release a savepoint → not published; outer commit → published
  once. (b) register, release a savepoint, then roll back the outer transaction → never published.
  (c) anchor registered INSIDE a savepoint that rolls back → never published, while the outer commit
  still succeeds. Then run every `*anchor*` integration test.
  **STOP after D1 + D2 for review.**
- **D3 — WI-22.** Wrap each fail-open write in `async with db.begin_nested():` (pattern:
  `evidence/action_location.py:484`). First list each site in the WI-22 file list and say whether it
  is already wrapped (`exceptions/creation.py:287` already is) — only change unwrapped ones.
  `handover/receiver_verification.py::raise_verification_exception` now also has A2's dedupe query;
  put the query and the insert in the same savepoint. Rollback hazard: a savepoint rollback expires
  ORM objects modified inside it — never read attributes of such an object afterwards without
  `await db.refresh(obj)`; prefer capturing plain values before the savepoint. The WI-22 test design
  (pre-insert the unique row) does NOT exercise the failure: the helper detects the row and returns
  early. Instead force the failure inside the savepoint (monkeypatch the insert/flush to raise
  `IntegrityError`) and assert: phase COMPLETED, HTTP 200, error logged, no finding row, and the
  phase's own evidence/anchor still recorded. One such test per wrapped site.
  **STOP after D3 for review.**
- **D4 — WI-07.** Tier = `"anchored"` only when `DriverSubstitution.anchor_status == ANCHORED`.
  Legacy rows: read the migration that added `anchor_status`. If it backfilled, null means never
  anchored → `"recorded"`. If it did not, a null status with a `blockchain_receipt_id` keeps
  `"anchored"`. State which applies, with the migration file name. Unknown driver → the same "Unknown
  driver" fallback `_declarations` uses. Check no golden/pinned audit-pack test pins the tier.

## Batch E — performance (later, measure first)

1. Instrument: count queries and wall time per request for trip detail, dashboard, incident detail
   (SQLAlchemy event counter behind a debug flag, or a test harness). Record baseline numbers.
2. Only then batch the redundant trip/phase/substitution reads, keeping tenancy and evidence checks.
3. Re-measure; report before/after. Note: pool size is set in code (2 + overflow 1), so changing the
   pooler port alone won't raise concurrency; `pool_recycle` doesn't replace `pool_pre_ping`.

**Context (measured 21–22 Oct):** the DB is Supabase eu-north-1, about 185 ms per round trip from Cape
Town, so latency is roughly sequential queries × 185 ms. `GET /trips/{id}` (dispatcher) ran 42
sequential queries, 25 of them inside `with_dispatcher_custody`
(`app/orchestration/substitutions/reads.py:321`), many re-reading what `get_trip_detail` already
loaded. Lock contention and the SSE stream were ruled out. **Query count is the metric that matters,
and it doesn't depend on the environment**; wall time on the test DB is not representative.

**Stages:**
- **E1 — baseline (no production edits).**
  (a) New integration test file `tests/integration/test_query_budgets.py`: one test per hot read
  endpoint, capturing statements with the existing `before_cursor_execute` pattern
  (`tests/integration/test_exception_reads.py:831`) on a realistic seeded trip (multi-stop, ≥1 driver
  substitution, exceptions, incident, evidence). Endpoints: dispatcher trip detail, trip list,
  exceptions review queue, incidents list, incident detail, driver trip detail, dashboard calls.
  Each test asserts `count <= <today's count>` (a ceiling that later stages lower) and, on failure,
  prints the statements grouped by first FROM table.
  (b) A read-only profiler `scripts/profile_requests.py` that runs those GETs in-process against the
  configured database (ASGITransport, demo account looked up by email, no writes, never prints
  secrets) and prints count + wall time per endpoint. **Ciaran runs it**; the implementer does not run
  it against the shared dev DB.
  (c) Report: a table per endpoint with count, duplicate statements (same SQL text, ≥2 times) and the
  call sites they come from. Then STOP — targets are chosen from this data, not guessed.
- **E2 — reduce (only the targets Ciaran approves from E1).** Allowed techniques: pass
  already-loaded rows down instead of re-reading; replace per-row loops with one `IN (...)` query;
  `selectinload` / joined loads; combining independent reads into one statement. Not allowed: caching
  across requests, changing tenancy/org-scope filters, dropping an evidence or custody check, pool or
  pooler config, `pool_recycle`. Each reduction lowers that endpoint's ceiling in
  `test_query_budgets.py` and keeps every existing behaviour test green. One endpoint per change.
- **E3 — re-measure:** before/after table (counts from the tests; Ciaran re-runs the profiler for
  wall time). Pool size, region and caching go in a short recommendations note only — they are team
  decisions.

**E outcome (22 Oct):** trip detail 45 → 27, driver trip detail 25 → 20, incident detail 10 → 7,
trip list 11 → 10, incident evidence 34 → 33. Full suite 4806 passed. #3 (auth) and #5 (audit-manifest
loader) were deliberately left out.

**E follow-ups (optional, not started):**
- **E4a — measure an anchored handover.** The budget seed's handover has no event hash, so
  `_chain_findings` skips its per-row loop (a request, receipt and payload rebuild per handover).
  Production trip detail is therefore above 27 and grows with handovers. Seed an anchored handover
  and add a budget first; reduce only after seeing the number. This is the custody-verification path,
  so be careful.
- **E4b — `load_investigations` is 3 queries per incident** (`orchestration/incidents/manifest.py`),
  shared by the evidence view and the audit pack. An `IN (...)` batch makes it constant. It's
  evidence-adjacent, so it needs an equivalence test like `test_trip_detail_custody_reuse.py`.

## Batch F — incident page candidates (noted 22 Oct after Batch C; not started, needs a brief)

Raised while checking INC1 in the browser after Batch C. Neither is a correctness defect, so neither
was folded into C. Do not start without a brief.

### F1. Incident Evidence panel is too busy to follow

**Observed.** `components/incidents/IncidentEvidencePanel.tsx` stacks six sections with different
layouts in one panel: a 5-column scans table, seal and count lists, a last-known-position line with
tracking gaps, an exceptions list with per-row actions, and "Needs attention" last. The one section
that says what to do is at the bottom, and the panel overlaps with Affected cargo (parcel state) and
the Hijacking response guide (what is done).

**Open design questions (decide before building).**
- What does a dispatcher need first? Probably "Needs attention", then exceptions to group, then the
  raw scan/seal/count facts.
- Tabs, collapsed sections (reuse `ui/Disclosure`), or a shorter summary with detail behind it?
- Should scans and counts be one table keyed by consignment instead of separate lists?
- Run `impeccable critique` on the incident detail page first; do not add side-stripe bars.

### F2. Hijacking response steps are self-reported (product question, not a task)

**How they are recorded (verified in code).** "Tracking company alerted", "Driver welfare check",
"Client notified", "Insurer notified" and "Reported to SAPS" are `external_action` ledger updates a
dispatcher records from the response guide (`AddUpdateDialog`, optional "when it happened" + note;
`orchestration/incidents/updates.py`). The guide derives each step from those entries and
declarations (`orchestration/incidents/response_guide.py`), never from a stored checkbox. Nothing is
seeded or mocked: the INC1 entries were recorded by the demo dispatcher on 21 Oct. Only the trip stop
is witnessed by the system; SAPS case number and claim reference come from the declaration form.

**Gap.** A step reads "Done" on a dispatcher's say-so, with no corroboration attached. That is in
line with "evidence, not operations" (FreightProof records, it does not contact anyone), but an
examiner or insurer may ask how strong the evidence is. Options to put to Tim/Ciaran: leave as is and
say so in the write-up; add an optional reference or attached document per step (call log, email);
or label the guide "Recorded by dispatcher" so the claim is explicit. No migration is implied until
one is chosen.

**Related, unverified.** The Evidence panel's tracker positions and scan counts come from mock feeds
in dev (`PULSE_USE_MOCK`, `SCAN_FEED_USE_MOCK` default `True` in `core/config.py`); driver-phone fixes,
seal readings and counts come from real driver submissions. Confirm which flags the demo environment
sets before showing this evidence to anyone.

### F3. Error toasts survive sign-out and stack duplicates (correctness — do first)

**Observed.** After the session ended, the login page showed three identical sticky "Failed to load
trips — request timed out" toasts.

**Cause (verified).**
- `ToastProvider` is mounted in the root `app/layout.tsx`, above the auth gate in
  `app/(app)/layout.tsx`. Error toasts never auto-dismiss (`ToastContext.tsx`, `notify`). So anything
  raised while signed in stays on screen after the gate drops to `/login`.
- `notify` has no de-duplication. `useTrips` refetches every 60 s (`RECONCILE_INTERVAL_MS`), and each
  failed refetch sets `error` again. Pages toast on every `error` change (`useActiveTrips.ts:36` and
  about 17 similar `useEffect(() => { if (error) notify(...) })` sites), so one outage stacks one toast
  per minute, up to `MAX_TOASTS`.

**Decision (two small changes in `lib/context/ToastContext.tsx` + one call site, no per-page edits).**
1. Add `clear(): void` to `ToastState`. It clears all toasts and their timers. Call it in
   `app/(app)/layout.tsx`'s existing `!isLoading && !user` effect, before `router.replace(login)`.
   The login page raises no toasts, so nothing it needs is lost.
2. In `notify`, if a toast with the same `kind` + `title` + `body` is already on screen, don't add
   another. Optionally restart an existing non-error toast's timer.

**Tests:** ToastContext — `clear()` empties the list and cancels pending timers. Two identical
`notify` calls → one toast, while a different body → two. App layout — signed-in with an error toast,
then user becomes null → toast gone and redirect called.

---

## Open decisions (for Ciaran)

- **D-1 Overridden-phase evidence reaching the dispatcher.** After A1/B1 it is kept safely on the
  phone and shown to the driver, but the dispatcher never sees it. Delivering it needs the late-evidence
  route to accept "current driver, overridden phase" (today it requires a former custody period) and
  probably a reason column → a migration. Recommend: separate task after this plan lands.
- **Ownership.** Receiver verification (A2) and the PP sweep (A6) may belong to another dev's area —
  check the sprint ownership issue before batch A.
