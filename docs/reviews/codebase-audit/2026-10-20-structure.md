# FreightProof SA — Structure review (Pass 4): one-purpose-per-file, layering, frontend size and rules

| | |
|---|---|
| Date | 2026-10-20 |
| Reviewed tree | `origin/Ciaran` at commit **f4b7360** (`git archive` export, read-only; not checked out) |
| Working checkout at review time | branch `dev`, commit `b8c44ea` (`origin/Ciaran` is an ancestor of this HEAD via PR #95; `CLAUDE.md` is byte-identical on both) |
| Mode | Static review only. No file edited, no git write command, no `pytest`, `npm test`, build, `lint-imports` or Alembic command run. `.env` not read. |
| Prior passes | `docs/audits/` did not exist on either tree. The Pass 1 to Pass 3 reports (bugs, security) are **absent**; this pass does not cover their scope. |
| Related prior work | `docs/design-notes/2026-10-06-backend-structure-tech-debt-audit.md` (backend structure audit, phases 0 to 7 done by 2026-10-12), `backend/.importlinter` (17 enforced layering contracts), `backend/scripts/check_structure.py` + `structure-baseline.json` (CI ratchet: no new function over 100 lines; 19 functions and 4 files baselined). That audit records a **structural freeze from Mon 19 Oct**: no moves, renames or refactors until after the 22 Oct demo. Every proposal below is therefore for *after* the freeze and must be sequenced against the four branches. |

This pass proposes; it changes nothing. Each finding carries a risk line (shared file touched, tests that cover it, branches likely to conflict).

## Headline numbers

| Measure | Value |
|---|---|
| Backend `backend/app/` files over 300 lines | **59** of 291 `.py` files (longest `orchestration/audit_packs/builder.py`, 886) |
| Frontend files over 300 lines (non-test `.ts`/`.tsx`/`.css`) | dispatcher **26** of 364, driver-pwa **15** of 240, shared **4** of 53 (dispatcher count includes one test fixture, `components/domain/__fixtures__/phase-acts.ts`, 896 lines, excluded from findings) |
| Layering: violations of the enforced `.importlinter` contracts found by grep | **0** (the 7 known exceptions are listed as `ignore_imports` in the contract file and ratcheted: `core -> db` ×2, `schemas -> analytics` ×4, `orchestration.phases.anchor_dispatch -> tasks.blockchain` ×1) |
| Layering: violations of the stricter `CLAUDE.md` wording ("endpoints thin", "endpoints -> orchestration -> ... -> db") | **1** production endpoint running its own SQL (`endpoints/phases.py:52`), **2** dev endpoints (13 `select` calls), **4** endpoint-layer files importing ORM model classes directly, **2** `blockchain/` files that query and write the database (permitted by the contract, contrary to the directory's stated purpose) |
| Backend duplicate clusters confirmed | 30 (21 same job, 9 similar); the five largest are hashing (7 + 9 copies), 404 mapping (48 `except` blocks), org-scoped Trip load (11), operations timezone (8 constructions), keyset pagination (3) |
| Frontend duplicate clusters confirmed | 22 (8 identical, 5 near-identical, 9 similar) |
| Frontend rule checks | raw `fetch()` in components/pages: **0**; `any`: **0** (8 hits, all in comments); Pages Router / `getServerSideProps`: **0**; non-`NEXT_PUBLIC_` env reads in client code: **0**; cross-app relative imports: **0**; dispatcher pages that are Client Components: **21 of 22** |
| Findings | **64** backend (ST-01 to ST-64) and **60** frontend (FE-01 to FE-60), each with a proposal and a risk line; umbrella findings ST-20, FE-06, FE-10 and FE-17 point to their itemised entries |
| Documentation drift items against `CLAUDE.md` | 9 (ST-14, ST-25, ST-26, ST-27, ST-61, ST-62, FE-01, FE-03, FE-19) |

## Method and coverage

- Read in full by the reviewer: root `CLAUDE.md`; `graphify-out/GRAPH_REPORT.md` (summary, hubs, god nodes, cycles, hyperedges; the graph is built from `5d906bc5`, older than the reviewed commit, and reports no import cycles); `backend/.importlinter`; the 2026-10-06 audit (§0, §4, §5.7, §7, §8).
- Read in part by the reviewer (the lines cited in findings): `api/v1/endpoints/handover.py`, `endpoints/phases.py`, `api/v1/custody_errors.py`, `api/v1/handover_responses.py`, `blockchain/anchor_service.py`, `blockchain/subject_visibility.py`, `db/session.py`, `crypto/hashing.py`, `orchestration/substitutions/canonical.py`, `orchestration/handover/capability.py`, `orchestration/audit_packs/lifecycle.py`, `orchestration/evidence_anchors/canonical.py`, `orchestration/fleet/canonical.py`, `core/realtime.py`, `core/demo_waypoints.py`, every `core/*.py` header, `main.py` (router block), `db/models/__init__.py`, `schemas/trips.py` (tail), `schemas/driver_substitutions.py` (L155-161, L709-723), `scripts/check_structure.py`, `structure-baseline.json`, `.github/workflows/ci.yml` (L100-125), `backend/requirements.txt` (grep); frontend: `driver-pwa/app/layout.tsx`, `driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/page.tsx`, `driver-pwa/app/(app)/trips/[id]/page.tsx`, the heads of `dispatcher/app/(app)/{exceptions,trips/new,fleet/vehicles}/page.tsx`, `dispatcher/components/blockchain/{BlockchainBadge,ChainReceiptTag}.tsx`, `shared/components/blockchain/BlockchainBadge.tsx` (grep), both `tsconfig.json` path blocks, both `tailwind.config.ts` (grep), `driver-pwa/app/globals.css` (section headers), `dispatcher/components/ui/{Skeleton,TopBar,RecordLink}.tsx` (grep). About 50 files in total.
- Delegated to five Sonnet subagents with fixed briefs: responsibility summaries of the 59 backend and 44 frontend long files (AST/grep-based definition lists plus hand-written responsibility groupings), the backend duplication search, the frontend cross-app duplication search, and the dispatcher `'use client'` necessity check. Their claims that drive a High or Medium finding were spot-checked by the reviewer (the hashing copies, the 404 and Hedera-triple counts, the org-scoped Trip query count, the orphaned shared blockchain components, the directive-free pages, three "unnecessary directive" files). Lower-priority items are reported as the subagents found them, with file:line so they can be re-checked.
- **Not covered**: the ~230 backend files under 300 lines (grepped, not read); frontend files under 300 lines (grepped, not read); `frontend/client-portal/` and `frontend/receiver/` (out of the stated scope; noted in FE-19); test files beyond their location; migrations and generated files; `graph.json`; bugs, security, accessibility and visual design (other passes); whether `lint-imports`, `pytest` or the frontend test suites pass on this commit.

---

## Part A — Backend

### A.1 Size inventory: every `backend/app/` file over 300 lines

Responsibilities are named, not counted. "Seam" is where a split would fall; "single" means the file has one job and the size is incidental. Files marked ★ have a finding below.

| Lines | File | Responsibilities seen | Verdict |
|---|---|---|---|
| 886 | `orchestration/audit_packs/builder.py` ★ | (1) batch-load the trip evidence graph, 13 `_load_*` SELECT helpers L296-569; (2) consignment scope and redaction L576-616; (3) ORM row to manifest-record mapping, 16 helpers L105-809; (4) anchor-consistency recompute via `compute_payload_hash` L133-146; (5) location timeline L708-751; (6) `build_audit_manifest` composer L812 | split (ST-07) |
| 738 | `schemas/audit_pack.py` ★ | manifest wire contract (30 classes L29-511); issue/read DTOs L514-617; public share/seal/live-verify DTOs L618-675; incident-declaration request L676-715; emailed-code DTOs L716-738 | split (ST-13) |
| 723 | `schemas/driver_substitutions.py` ★ | 13 enums + `SUBSTITUTION_ERROR_STATUS` HTTP table L61-165; 27 read DTOs L183-531; 12 request bodies L532-693; error envelope; import-cycle patch `_resolve_trip_read_references` L711-723 | split (ST-13) |
| 709 | `orchestration/substitutions/service.py` ★ | idempotency bookkeeping L94-150; locks/guards L152-207; arrange/cancel/replace L210-360; confirm/complete L366-650; correction + anchor dispatch L651-709; a private `utcnow` L86 and `body_digest` sha256 L94 | split (ST-08) |
| 677 | `orchestration/handover/receiver_verification.py` ★ | identity matching (pure) L56-124; quota metering L125-166; verdict policy + exception raising L167-290; POPIA consent L293-377; IDVS session lifecycle L379-531; webhook HMAC/timestamp/ingest L532-635; reads and sweeper L636-677 | split (ST-09) |
| 676 | `orchestration/evidence/action_location.py` ★ | assessment builders L114-358 (incl. live Pulsit preview L218); two finding recorders with DB writes and realtime L361-676 | split (ST-10) |
| 613 | `orchestration/trips/creation.py` ★ | crew lock/clash L83-166; manifest race L168-258; phase plan L260; journey-lock payload L330; `persist_trip` L359-613 (255 lines, baselined) does crew claim, row inserts, consignment sync, phase plan, hash, Hedera anchor, H0 completion, realtime, `TripDetailResponse` | split (ST-06) |
| 573 | `orchestration/audit_packs/analysis.py` | pure trail analysis L58-183 and observation rules L189-573; no DB, no HTTP | single (two pure halves; low value to split) |
| 524 | `schemas/transit.py` | checkpoint schemas L30-143; exception create L163-297; review requests L298-353; exception reads L354-524; duplicated validators (ST-19) | split by domain, Low |
| 516 | `orchestration/evidence/corroboration.py` | context loaders; pure skew helpers; phase corroboration; checkpoint corroboration | single (two entry points) |
| 514 | `integrations/pulsit.py` ★ | port + types L46-134; mock fixtures + `MockPulsitClient` L135-299; `LivePulsitClient` + parsers L300-505; factory L506 | split (ST-23) |
| 509 | `dev/endpoints/triggers.py` ★ | gating helper; panel read model with 6 SELECTs L87-243; scan/PP/exception triggers with 3 `db.commit()`; mock flush | split (ST-05) |
| 509 | `core/exceptions.py` | 49 exception classes across ~10 domains; no logic, no handlers | single (package by domain is optional) |
| 497 | `dev/schemas.py` | dev panel, scan, PP, exception, move-truck, rig/road-check DTOs | single (dev-only; per-tool split optional) |
| 494 | `schemas/phases.py` | `PhaseEventRead.from_event` derivation L130-157; shared completion base + 7 per-phase requests; business rules in validators L304-315, L409-415 | mostly single; validators duplicated (ST-19) |
| 487 | `schemas/fleet_analytics.py` | nine per-tab response families, `@computed_field` ratios via `analytics.stats` | single |
| 461 | `api/v1/endpoints/handover.py` ★ | driver router (2 routes); public receiver router (5 routes); vendor webhook; 8 `db.commit()`, 3 rollback/500 blocks; cookie policy L227-241; signature gate L438-447 | split (ST-03) |
| 444 | `orchestration/exceptions/creation.py` | driver-report assessment; breakdown vehicle pick; idempotent insert; `raise_exception` L311-444 (134 lines, baselined) | single flow; `raise_exception` is the oversized unit |
| 441 | `orchestration/handover/capability.py` | token hashing/issue/redeem/rotate L37-380; `HandoverConfirmation` persistence L382-432 | mostly single |
| 434 | `orchestration/consignments/manifest_import.py` | manifest fetch + context + preview L63-283; create-from-manifest L286-434 | two halves, Low |
| 431 | `orchestration/verification/phase_payloads.py` | version detection; artifact re-hash; per-phase reconstructors v1-v4; `_reconstruct_phase_event_payload` 112 lines (baselined) | single |
| 430 | `db/models/enums.py` | 33 `str` enums for the whole schema + `enum_text` | single (central registry) |
| 424 | `orchestration/substitutions/reads.py` | dispatcher reads; driver-scoped reads; custody overlay; completed-substitution reads | two audiences, Low |
| 421 | `orchestration/exceptions/queries.py` | label loading; list shaping; queue + cursor history; detail | single (reads) |
| 420 | `db/models/driver_substitutions.py` ★ | 9 tables (requests, confirmations, artifacts, uploads, notices, late evidence ×2, corrections, operations) | see ST-14 |
| 419 | `schemas/trips.py` ★ | schedule rules L31-70; list/history reads; `TripCreateRequest.validate_request` L236-291 (trip-type vs consignments, schedule derivation); manifest reads; `TripDetailResponse`; cycle patch L419 | split (ST-13) |
| 418 | `api/v1/endpoints/trips.py` | `_trip_http_error` mapper (13 branches) L91-144; 2 creates; 5 dispatcher reads; 4 driver reads; admin redaction in route L416 | single router; see ST-15, ST-20 |
| 415 | `db/models/trips.py` ★ | 7 tables: trip_templates, consignments, parcels, trips, trip_stops, trip_trailers, driver_substitutions; docstring names five | see ST-14 |
| 411 | `orchestration/verification/service.py` | receipt lookup + live checks; reconstructor registry; `verify_subject` verdict; visibility wrapper | single (verify) |
| 407 | `orchestration/fleet/precincts.py` | reads L105-119, L335-407 vs create/update with event log and anchor L122-332 | single aggregate |
| 394 | `orchestration/handover/service.py` | driver-side target/rotation; public scan page; redemption; receiver confirmation; verification steps | thin composition; single |
| 394 | `orchestration/consignments/scans.py` | tallies L88-180; ingest/reconcile/stamp/raise L183-394 | single |
| 393 | `orchestration/evidence/artifacts.py` | driver upload; receiver upload; trip-scoped reads + signed URLs; sha256 of bytes L73, L153 | single; see ST-01 |
| 387 | `orchestration/exceptions/review.py` | review; claim/release; batch review | single (dispatcher actions) |
| 387 | `orchestration/consignments/sync.py` | waybill serialise; fetch + upsert (`sync_consignment_from_waybill` 163 lines, baselined); cancelled-trip release; lookups | single |
| 369 | `orchestration/audit_packs/access.py` ★ | link access + email-code gate L84-206; public reads/downloads L209-293; live Hedera re-verification L296-369; PDF re-hash duplicated with `lifecycle.py` | split (ST-11) |
| 369 | `integrations/idvs.py` ★ | port + types; `MockIdvsClient`; parsers; `DiditIdvsClient`; factory | split (ST-23) |
| 367 | `orchestration/substitutions/anchors.py` | freeze/dispatch/execute/recover L47-253; chain verification L259-367 | two halves, Low |
| 365 | `analytics/fleet/periods.py` | tz constant + date helpers; period/grain model; occurrence counting; four banding enums | single (pure); owns the date helpers duplicated elsewhere (ST-17) |
| 359 | `dev/endpoints/pulsit.py` | gating; waypoint list; trip-context loader with 3 SELECTs; `move_truck` 164-line route body (baselined) | dev-only; see ST-05 |
| 358 | `api/v1/endpoints/driver_substitutions.py` | `_domain_errors` context manager; multipart upload helpers L88-130; three routers (dispatcher, late-evidence, driver) | three audiences; Low |
| 356 | `integrations/parcel_perfect/unassigned_fixtures.py` | one fixture table | single (data) |
| 348 | `orchestration/audit_packs/lifecycle.py` ★ | pure helpers; preview render; issue (snapshot, PDF, Storage, Hedera seal, token); revoke/list/read; download with hash check | two halves; see ST-11 |
| 340 | `dev/services/truck.py` | one SELECT L128-153; pure geodesy; scenario builder; docstring calls itself "an orchestration module" | single; see ST-24 |
| 339 | `orchestration/trips/listing.py` | `list_trips` L82-182 (101 lines, baselined); `list_trip_history` L185-338 (154, baselined); keyset pagination inline (ST-18) | single |
| 338 | `orchestration/phases/findings.py` ★ | four independent finding raisers (GPS mismatch, trailer decoupling, scan shortfall, seal) | split (ST-12) |
| 334 | `orchestration/trips/availability.py` | pure window rules L96-146; row locking; occupancy queries | single aggregate |
| 331 | `db/models/transit.py` | 2 tables: checkpoints, exceptions (~230 lines) | see ST-14 |
| 329 | `auth/dependencies.py` | demo stub identities L48-81; JWKS fetch/cache (sync `urllib` L89); JWT decode; three FastAPI dependencies each running a SELECT | mostly single; demo stubs misplaced, Low |
| 327 | `orchestration/evidence/road_check.py` | pure evaluator L53-183; DB/Pulsit/recording shell L191-327 | single |
| 325 | `analytics/fleet/cost.py` | SQL loaders L102-180; money aggregation L182-325 | two halves, Low |
| 319 | `api/v1/endpoints/audit_packs.py` | four routers; `_not_found` ×10, SQLAlchemyError→500 ×3; response assembly in routes L182-186, L246-252, L305 | see ST-15 |
| 317 | `orchestration/substitutions/access.py` | custody derivation (pure); reads; trip locking; driver write authorisation | single aggregate |
| 317 | `api/v1/endpoints/audit_packs_public.py` | one public router, 8 routes each repeating the same three-clause `try/except` | see ST-15 |
| 307 | `integrations/parcel_perfect/waybill_fixtures.py` | fixture data + small builders; private names imported by two sibling fixture files | single (data) |
| 303 | `integrations/parcel_perfect/manifest_fixtures.py` | fixture data + `_build_header` renderer L274-303 | single (data + one renderer) |
| 303 | `integrations/parcel_perfect/client.py` | live PP client: token cache, `_make_call`, MD5 auth (PP spec), `_parse_waybill_response` 75 lines, retry-by-message-text | single |
| 302 | `orchestration/substitutions/canonical.py` | own `sha256_text`/`canonical_hash` L49-54; commitment types; two payload builders/validators | single (pure); see ST-01 |

### A.2 Mixed-purpose findings

**ST-01 · duplication / placement · High — SHA-256 and canonical-JSON hashing is defined in seven modules outside `crypto/`, and `crypto/` is imported by only four callers.**
`CLAUDE.md` Architecture: `crypto/ Ed25519 (PyNaCl), SHA-256, Merkle`; layering puts `crypto` in the bottom layer alongside `core`.
Evidence (reviewer-read): `crypto/hashing.py:48-54` `canonical_json` + `_canonical_sha256`; `blockchain/anchor_service.py:32-39` `canonicalize_payload` + `compute_payload_hash` (identical bodies: `json.dumps(payload, sort_keys=True, separators=(",", ":"))` then `hashlib.sha256(...).hexdigest()`); `orchestration/substitutions/canonical.py:49-54` `sha256_text` + `canonical_hash`; `orchestration/handover/capability.py:40-41` `_hash_token`; `orchestration/audit_packs/lifecycle.py:108-109` `hash_token` (byte-identical to `_hash_token`); `orchestration/evidence_anchors/canonical.py:88-89` `compute_text_hash`; `orchestration/fleet/canonical.py:33-34` `_sha256_hex`. Subagent additions: `substitutions/late_evidence.py:76`, `substitutions/service.py:94-98`, `verification/phase_payloads.py:70-73`, `phases/payloads.py:236-239`, three inline copies in `fleet/drivers.py:105,155,168`. Import counts: `from app.blockchain.anchor_service import compute_payload_hash` in 20 orchestration modules; `from app.crypto` in 4. `grep -rl hashlib backend/app` returns 18 files.
Proposal: `crypto/hashing.py` exports `canonical_sha256(payload)` and `sha256_hex(text)`; `blockchain/anchor_service.py` imports them (blockchain → crypto is permitted by contract 1); the orchestration copies become imports. No behaviour change: every copy already uses the same serialisation, so hashes are unchanged, but prove it with the existing golden tests first (`tests/baseline/test_b3_canonical_hashes.py`, `tests/integration/test_fleet_anchor_payload_pins.py`, `tests/unit/test_driver_substitution_payloads.py`).
Risk: shared file N. Tests: the three above plus every `*anchor*` integration test. Branches: any branch touching `orchestration/` (all four). Do after the freeze; one commit per package.

**ST-02 · mixed-purpose / placement · High — `blockchain/anchor_service.py` and `blockchain/subject_visibility.py` query and write the database and hold organisation-visibility policy.**
`CLAUDE.md`: `blockchain/ Hedera HCS REST, hash verify`. The review brief flags any crypto or blockchain file touching the DB. The `.importlinter` layers contract *permits* `blockchain -> db`, so this is not a contract violation; it is a purpose mismatch.
Evidence: `anchor_service.py:1-3` docstring: *"Orchestration-layer wrapper around HederaService + BlockchainReceipt persistence"*; imports `sqlalchemy select`, `AsyncSession`, `BlockchainReceipt` (L15-27); three functions take `db: AsyncSession` (L62, L125, L152). `subject_visibility.py:11-25` imports `AsyncSession` and 12 ORM models; `assert_subject_visible(db, ...)` L207. Importers: 20 orchestration modules (listed under ST-01) plus `orchestration/verification/{service,receipts}.py`.
Proposal: keep `blockchain/hedera.py` (transport) where it is; move `BlockchainReceipt` persistence and `anchor_subject` into `orchestration/anchoring/` (or into the existing `orchestration/verification/receipts.py`, which already wraps `lookup_receipts`), and `subject_visibility` into `orchestration/verification/visibility.py`. Hashing goes to `crypto/` (ST-01).
Risk: shared file N (but `.importlinter` contract 2 and the tier contracts would need entries; that file is not on the shared list but is team-owned). Tests: `unit/test_subject_policy_registries.py`, `unit/test_verification_service.py`, `integration/test_blockchain*.py`, `integration/test_fleet_anchor_roundtrip.py`, ~20 anchor tests. Branches: all four. Largest proposal in this report; the 2026-10-06 audit (§5.7 last paragraph) explicitly chose *not* to collapse these layers, so this needs a team decision rather than a quiet move.

**ST-03 · mixed-purpose · Medium — `api/v1/endpoints/handover.py` owns transaction control, cookie policy and the vendor-webhook gate, and holds three audiences in one module.**
`CLAUDE.md`: *"Endpoints thin — validate, call service, return."* `db/session.py:49-57` `get_db()` commits on success and rolls back on exception, so endpoints do not normally commit; `handover.py` is the **only** file under `api/` with `db.commit()` (8 calls: L158, 224, 282, 305, 343, 376, 415, 460) and has three `except SQLAlchemyError: rollback; log; 500` blocks (L159-165, L306-312, L344-350).
Evidence: module docstring L3-5 (*"Two routers, one module"*); cookie policy built in the route L227-241; `verify_webhook_signature` / `webhook_timestamp_is_fresh` called from the route L438-447; `_not_found()` helper L99 distinct from `audit_packs.py`'s `_not_found(exc)` L59.
Context: the 2026-10-06 audit stage 3a moved the SQL out and *deliberately* left every commit at its original point so the attempt row is saved before the generic 404. That decision stands; what remains is the file shape.
Proposal: split into `endpoints/handover_driver.py` (router), `endpoints/handover_public.py` (public_router + cookie constants) and `endpoints/handover_webhook.py`; move the cookie-policy builder into `orchestration/handover/service.py` as a dataclass the route only sets. Keep the explicit commits unless the service grows a `commit_attempt()` helper that preserves the save-before-404 rule.
Risk: shared file **Y** (`main.py` L116-119 imports `handover_router` and `handover_public_router`; a split changes those two import lines). Tests: `integration/test_handover_endpoints.py`, `test_receiver_verification_endpoints.py`, `test_receiver_verification_webhook.py`, `test_handover_token_*.py`, `baseline/test_b1_api_contract.py` snapshot (routes unchanged, so the snapshot should not move). Branches: whoever owns receiver handover (Iteration 4 receiver work).

**ST-04 · layering · Medium — `api/v1/endpoints/phases.py` runs its own SQL.**
Evidence (reviewer-read): L32 `from app.db.models.trips import TripStop`; L50-55 `_stop_sequence_map` executes `select(TripStop.id, TripStop.sequence).where(TripStop.trip_id == trip_id)`; called from `list_phases_endpoint` L67. This is the one production endpoint that skips orchestration for a query (grep `select(` over `api/`: `phases.py:53` only).
Proposal: move `_stop_sequence_map` to `orchestration/phases/queries.py` (already imported at L38) and have `list_phases` return the sequence map, or let `PhaseEventRead.from_event` take the stop rows that `list_phases` already loads.
Risk: shared file N. Tests: `integration/test_phases.py`. Branches: phases is a shared hot spot; one-function move, low conflict.

**ST-05 · mixed-purpose · Low — `dev/endpoints/triggers.py` and `dev/endpoints/pulsit.py` hold queries and commits in routes, and `triggers.py`'s docstring says the opposite.**
Evidence (subagent, spot-checked via grep): `triggers.py` 10 `select(` in route bodies and helpers (L95, 111, 117, 124, 139, 189, 193, 321, 391, 472), `db.commit()` L290, L423, L491; docstring L4-5 *"no endpoint here writes to the database directly"*. `pulsit.py` 3 selects in `_load_trip_context` L150-173, a 164-line `move_truck` body (baselined). Both routers are mounted only when `DEV_PANEL_ENABLED` (`main.py:145-154`); the modules are imported unconditionally (`main.py:28-32`).
Proposal: move `list_dev_trips`' read model into `dev/services/panel.py` and the `move_truck` response assembly into `dev/services/truck.py`; fix the docstring. Dev-only, so Low.
Risk: shared file N (unless the router names change; keep them). Tests: `integration/test_dev_triggers.py`, `test_dev_pulsit.py`, `unit/test_dev_pulsit_writes_nothing.py`. Branches: demo tooling owner.

**ST-06 · mixed-purpose · Medium — `orchestration/trips/creation.py::persist_trip` (L359-613, 255 lines) does nine jobs.**
Evidence (subagent, body read in full by it): crew claim L121-166 → row inserts L405-434 → consignment sync L458-461 (local import of Parcel Perfect) → stamp stops → write phase plan L507 → journey-lock hash L521 → `anchor_subject` L525 (synchronous, fail-closed) → H0 completion L540-544 → `recompute_position` L552 → `enqueue_event` L565 → `TripDetailResponse` assembly L569-613. It is the longest baselined function (`structure-baseline.json`: 255). The 2026-10-06 audit §5.3 chose to keep it whole; the ratchet forbids it growing.
Proposal (for the team to weigh against §5.3): three private steps in the same module, `_persist_rows`, `_anchor_journey_lock` (hash + Hedera + H0), `_detail_response`, each under 100 lines, with `persist_trip` as the ordered pipeline; then remove the baseline entry.
Risk: shared file N. Tests: `integration/test_creation_concurrency.py`, `test_persist_trip_manifest.py`, `test_consignment_move.py`, `unit/test_trip_service.py`; the fail-closed H0 ordering is the behaviour to protect. Branches: trip creation is Ciaran's area per the hyperedge "Manifest-first trip creation"; low cross-branch risk, high regression sensitivity.

**ST-07 · size / mixed-purpose · Medium — `orchestration/audit_packs/builder.py` (886) is graph loading plus record mapping.**
Evidence: §A.1 row; seam at L569/L576. Read-only, no HTTP, no writes.
Proposal: `audit_packs/graph.py` (`_TripGraph` and the 13 loaders, L296-569) below `builder.py` (scope, record mappers, composer). Contract 21 gains a tier: `access > lifecycle > builder > graph | analysis | incident_declarations`.
Risk: shared file N. Tests: `integration/test_audit_pack_builder.py`, `test_audit_pack_evidence_anchors.py`, `test_driver_substitution_audit.py`, `test_fp290_incident_chain.py`, `test_incident_declarations.py`. Branches: Tim (audit packs moved from `Feat-ValueAddedDocumentation`).

**ST-08 · size · Medium — `orchestration/substitutions/service.py` (709) has three seams.**
Proposal: `substitutions/idempotency.py` (L67-150: `body_digest`, `OperationKey`, `find_replay`, `record_operation`), `substitutions/lifecycle.py` (L210-360: arrange/cancel/replace), `substitutions/completion.py` (L366-709: confirm/complete/correct); `service.py` keeps the guards or becomes the facade. Also delete the private `utcnow` (L86) in favour of a shared clock (ST-17).
Risk: shared file N. Tests: 11 `integration/test_driver_substitution_*.py` and `test_driver_transfer_v2*.py`. Branches: FP-83 owner.

**ST-09 · size · Medium — `orchestration/handover/receiver_verification.py` (677) mixes pure identity matching, metering, consent, vendor session and webhook intake.**
Proposal: `handover/identity_match.py` (L56-226, pure, unit-tested by `unit/test_receiver_identity_match.py` already), `handover/consent.py` (L293-377), `handover/webhook.py` (L532-633); `receiver_verification.py` keeps quota + session lifecycle. Contract 16 tiers: `service > receiver_verification > webhook | consent | identity_match > capability`.
Risk: shared file N. Tests: 8 files listed in §A.1. Branches: Iteration 4 receiver work.

**ST-10 · size · Medium — `orchestration/evidence/action_location.py` (676): assessment builders vs finding recorders.**
Proposal: keep builders and the Pulsit preview in `action_location.py`; move `record_separation_finding` and `record_driver_location_finding` (L361-676, DB writes + realtime) to `evidence/location_findings.py` on the same tier as `corroboration | action_location | road_check` in contract 12, importing `action_location` from the tier below (so `action_location` drops to the geofence/proximity tier or `location_findings` sits above).
Risk: shared file N. Tests: `unit/test_action_location_service.py`, `integration/test_gps_mismatch.py`, `test_exceptions.py`, `test_driver_substitution_seal_findings.py`, `test_exception_creation_site_anchors.py`, `unit/test_realtime_emit.py`. Branches: evidence/GPS owner.

**ST-11 · size / duplication · Low — `orchestration/audit_packs/access.py` (369) and `lifecycle.py` (348) each hold three jobs and share a copied PDF-rehash block.**
Evidence: `access.py:250-258` and `lifecycle.py:338-346` are identical (`hashlib.sha256(pdf).hexdigest() != pack.pdf_sha256` → log → `StoredFileMismatchError`).
Proposal: `lifecycle.download_issued_pdf` becomes the one implementation; `access.shared_pdf` calls it. Optionally `audit_packs/public_access.py` (link + email code) vs `audit_packs/live_verify.py` (L296-369).
Risk: shared file N. Tests: `integration/test_audit_pack_public.py`, `test_audit_pack_email_codes.py`, `test_fp290_incident_chain.py`. Branches: Tim.

**ST-12 · size · Low — `orchestration/phases/findings.py` (338) is four unrelated finding raisers.**
Proposal: only if `phases/` is touched again: one module per finding type under a `phases/findings/` package on the same tier. Otherwise leave.
Risk: shared file N; contract `phases-tier-order` lists modules by name, so a package rename edits `.importlinter`. Tests: `integration/test_gps_mismatch.py`, `test_trailer_location_mismatch.py`, `unit/test_phase_service.py`.

**ST-13 · size / mixed-purpose · Medium — `schemas/audit_pack.py` (738) serves five audiences; `schemas/driver_substitutions.py` (723) and `schemas/trips.py` (419) form an import cycle patched at import time; HTTP status codes live in a schema.**
Evidence (reviewer-read): `schemas/trips.py:417-419` `import app.schemas.driver_substitutions  # noqa: E402,F401` with a comment that the cycle is deliberate; `schemas/driver_substitutions.py:711-723` `_resolve_trip_read_references()` calls `model_rebuild` on two `trips` classes at module import. `schemas/driver_substitutions.py:158-161` `SUBSTITUTION_ERROR_STATUS` maps error codes to 409/403/503 (consumed by `api/v1/custody_errors.py:28`). `schemas/trips.py:236-291` `TripCreateRequest.validate_request` carries business rules (trip-type vs consignments, schedule derivation) that `CLAUDE.md` places in orchestration.
Proposal: (a) `schemas/audit_pack_manifest.py` (L29-511) + `schemas/audit_pack.py` (DTOs); (b) `schemas/driver_substitutions/` → `enums.py`, `reads.py`, `requests.py`, and break the cycle by moving `CustodyIntegrityRead`, `DriverAccess`, `DriverParticipation`, `SubstitutionRequestRead`, `CompletedSubstitutionSummary` into a leaf `schemas/custody.py` that both import; (c) move `SUBSTITUTION_ERROR_STATUS` next to its consumer in `api/v1/custody_errors.py`; (d) leave `validate_request` for a team decision (schema-level cross-field validation is defensible; the schedule *derivation* L262-275 is the part that reads as orchestration).
Risk: shared file N, but `schemas/__init__.py` re-exports (not on the shared list, widely imported) and `baseline/test_b1_api_contract.py` OpenAPI snapshot (model names unchanged, so it should hold). Tests: `unit/test_driver_substitution_schemas.py` (also parses the shared TS types), `unit/test_trip_schemas.py`, 12 substitution integration files. Branches: FP-83 owner, Tim.

**ST-14 · naming / doc-drift · Medium — `db/models/` is one file per *aggregate*, not "one file per table"; the substitution aggregate is split across two files.**
`CLAUDE.md` Architecture L104: `db/models/ one file per table`. Code: 13 of 16 model files define more than one `__tablename__`: `trips.py` 7, `driver_substitutions.py` 9, `audit_packs.py` 4, `blockchain.py` 3, `events.py` 3, `handover.py` 3, and 2 each in `evidence_anchors`, `organisations`, `people`, `phases`, `receiver_verification`, `sessions`, `transit`. `trips.py:274-288` holds `DriverSubstitution` while its nine sibling tables sit in `driver_substitutions.py` (whose docstring L1-3 says it *"stays DriverSubstitution in trips.py"*); `trips.py`'s docstring names five of its seven tables.
Proposal: amend `CLAUDE.md` to "one file per aggregate; list every table in the module docstring" (the code is consistent and the audit-pack and substitution packages depend on it). Separately, after the freeze, move `DriverSubstitution` to `driver_substitutions.py` (import-only move, no migration) and fix the `trips.py` docstring.
Risk: shared file **Y** for both parts (`CLAUDE.md` needs the four-reviewer PR; `db/models/__init__.py` would change one import if the class moves; Alembic `env.py` imports via that `__init__`). Tests: `unit/test_model_schema_v6.py`, `integration/test_driver_substitution_models.py`, 97 files import `app.db.models.trips`. Branches: all.

### A.3 Layering

Rule under test (`CLAUDE.md`): `endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db`; `integrations/` never imports `api/` or `orchestration/`; `db/` never imports elsewhere in `app/`; endpoints never call `hedera.py` directly. Enforced rule (`backend/.importlinter`, run in CI): layers `api|tasks|dev > orchestration > integrations|blockchain|storage|auth|analytics > schemas > db > core|crypto`, plus `api` may not import `integrations|blockchain|storage|crypto` even indirectly.

Grep results on the reviewed tree (commands as in the brief):

| Check | Result |
|---|---|
| `integrations`, `crypto`, `blockchain` importing `app.*` outside their own package | `integrations/supabase_admin.py:15` → `db.models.enums`; `blockchain/anchor_service.py:26-27` → `db.models.blockchain`, `db.models.enums`; `blockchain/subject_visibility.py:15-25` → 12 model modules. All downward; permitted by contract (see ST-02 for the purpose mismatch). |
| `integrations` or `db` importing `app.api` / `app.orchestration` | none |
| `hedera` in `api/` | only field names: `endpoints/blockchain.py:38` `hedera_tx_id=`, `endpoints/exceptions.py:170` `include_hedera_refs=`. No call into `hedera.py`. |
| `db/` importing `app.*` | `db/session.py:12` → `core.config` only (contract allows `db -> core`; `CLAUDE.md`'s "never" is one word too strong). |
| FastAPI/Starlette imported outside `api`, `dev`, `core`, `auth` | none in `orchestration`, `storage`, `analytics`, `blockchain`, `crypto`, `integrations`. No orchestration module raises `HTTPException` (29 long files checked by the subagent: status codes appear only in docstrings). |
| Endpoints importing ORM model classes | `audit_packs_public.py:32` `AuditPack`; `handover.py:46` `HandoverCapabilityToken`; `phases.py:32` `TripStop`; `handover_responses.py:8` `ReceiverIdentityVerification`. Enum imports in 11 endpoint files are vocabulary, not a skip. Only `phases.py` uses its model to query (ST-04). |
| Endpoints importing `analytics` / `reporting` directly | `fleet_analytics.py:29` (`Grain`, `Period` types), `audit_packs.py:46` and `audit_packs_public.py:50` (`NoIncidentError`). Allowed by the contract; `app.reporting` is **not listed in any contract layer**, so nothing constrains it today (its own docstring says "called from orchestration only"). |
| Known, ratcheted exceptions (`.importlinter` `ignore_imports`) | `core/phase_meta.py:5` and `core/realtime.py:42` → `db.models.enums`; `schemas/fleet_analytics.py:15-17` and `schemas/analytics.py:22` → `app.analytics`; `orchestration/phases/anchor_dispatch` → `tasks.blockchain` (function-level). 7 edges. |
| Import cycles | graph report: none. The one schema-level cycle (`schemas/trips` ↔ `schemas/driver_substitutions`) is intra-layer and patched at import (ST-13). |

**ST-25 · doc-drift · Medium — `CLAUDE.md`'s architecture diagram and layering line omit five packages and place `auth` differently from the enforced contract.**
Evidence: `CLAUDE.md` L97-110 lists `api, auth, blockchain, core, crypto, db, integrations, orchestration, storage, tasks`. The tree also has `analytics/` (10 modules), `dev/` (endpoints, services, schemas), `reporting/` (PDF/SVG), `schemas/` (26 modules). `CLAUDE.md` L113 puts `auth` beside `orchestration`; `.importlinter` contract 1 puts `auth` and `analytics` beside `integrations` (below orchestration) and adds `schemas` as its own layer. `core/` is described as "config, constants, exceptions" but holds `realtime.py` (261 lines, Redis pub/sub event bus), `rate_limit.py` (190, Redis middleware), `polygon.py`/`geo.py` (geometry), `demo_waypoints.py` (demo data), `pagination.py`, `display.py`, `client_ip.py`, `security_headers.py`, `config_validation.py`.
Proposal: update the diagram and the layering line to match contract 1 verbatim (it is the thing CI enforces), add `reporting` to the contract, and either describe `core/` honestly or move `demo_waypoints.py` to `dev/` and `realtime.py` to its own package.
Risk: shared file **Y** (`CLAUDE.md`, four-reviewer PR; `.importlinter` team-owned). No tests. Branches: none for the doc change.

**ST-26 · doc-drift · Low — three `CLAUDE.md` statements no longer describe the code (already listed as open in the 2026-10-06 audit §8 item 8).**
`crypto/ Ed25519 (PyNaCl), SHA-256, Merkle` (L103): `crypto/` contains only `hashing.py` (165 lines, SHA-256); `requirements.txt:22` comments *"pynacl returns when crypto/ Ed25519 signing lands"*. `integrations/ pulse.py, parcel_perfect.py, idvs.py, twilio.py, sendgrid.py` (L106): actual files are `pulsit.py`, `parcel_perfect/` (10-module package), `idvs.py`, `sendgrid.py`, `supabase_admin.py`, `scan_feed.py`, `mock_state.py`, `routing.py`; no Twilio. `Receiver = one-time OTP` (L132): the receiver path is a capability token in the URL plus an HttpOnly session cookie plus optional IDVS (`endpoints/handover.py:3-14`).
Risk: shared file **Y** (`CLAUDE.md`).

**ST-27 · doc-drift · Low — three module docstrings name the wrong layer or a retired path.** `blockchain/anchor_service.py:1` ("Orchestration-layer wrapper"); `dev/services/truck.py:8` ("this is an orchestration module"); `dev/endpoints/pulsit.py:213` references `orchestration/dev_truck_service.py` (retired in stage 7b). Pure comment fixes; Risk: none.

### A.4 Duplication

Thirty clusters were confirmed (subagent report, spot-checked where it drives priority). Grouped here; both locations are given for each.

**ST-15 · duplication · High — domain-error → HTTP mapping is hand-written per endpoint; `main.py` registers only a catch-all `Exception` handler.**
Evidence (reviewer grep): `except ResourceNotFoundError` appears **48** times across 16 endpoint files (`audit_packs.py` 10, `audit_packs_public.py` 8, `exceptions.py` 6, `phases.py` 4, `trips.py` 3, six files with 2, five with 1); the subagent classified 30 of them as the plain `→ 404 detail=str(exc)` shape (18 with `from exc`, 6 without, 10 via `audit_packs.py:59 _not_found`). The `DuplicateResourceError→409 / HederaTimeoutError→504 / HederaServiceError→502` triple is copied verbatim six times (`precincts.py:73-78, 107-112`; `drivers.py:69-76, 97-100`; `vehicles.py:51-56, 77-83`) with `HTTP_504_GATEWAY_TIMEOUT` in four files. `main.py:167` is the only `@app.exception_handler`. `core/exceptions.py` has 49 classes and no handler. `api/v1/custody_errors.py` already centralises the custody and substitution families (used by 9 endpoint files), and `endpoints/driver_substitutions.py:72-85` uses a `_domain_errors` context manager at 17 call sites, so the pattern exists twice over.
Proposal: `api/v1/http_errors.py` registering handlers for `ResourceNotFoundError`, `DuplicateResourceError`, `HederaTimeoutError`, `HederaServiceError`, `TripStateError`, `StoredFileMismatchError`, `FileStorageUnavailableError` via `app.add_exception_handler` in `main.py`; keep the deliberate generic-detail cases (`audit_packs_public.py` `_LINK_NOT_FOUND`, `handover.py` `_GENERIC_NOT_FOUND`) and the two routers that *return* rather than raise so the denied-access log row survives (`audit_packs_public.py:5-8`).
Risk: shared file **Y** (`main.py`). Tests: every endpoint integration test asserting a 404/409/502/504 body; `baseline/test_b1_api_contract.py` and `test_b2_authorization.py` snapshots (detail strings must stay byte-identical). Branches: all four touch endpoints.

**ST-16 · duplication · Medium — "load `Trip` by id scoped to the dispatcher's organisation, else `ResourceNotFoundError("Trip")`" is written 11 times.**
Locations (subagent; reviewer grep finds 27 occurrences of `Trip.operator_organization_id ==` across `orchestration/` and `dev/`): `phases/loaders.py:61`, `substitutions/service.py:152`, `substitutions/reads.py:71`, `substitutions/anchors.py:346`, `evidence/artifacts.py:325`, `consignments/manifest_reads.py:62`, `audit_packs/incident_declarations.py:23`, `audit_packs/builder.py:336`, `trips/administration.py:52` (with `FOR UPDATE`), `trips/detail.py:107`, `dev/endpoints/tracker.py:42` (raises `HTTPException` instead).
Proposal: `orchestration/trips/scope.py::get_org_trip(db, trip_id, organization_id, *, lock=False)` on the lowest `trips/` tier (contract 22 `detail | availability | scope`).
Risk: shared file N. Tests: broad (any 404-on-foreign-trip test). Branches: all.

**ST-17 · duplication · Medium — the operations timezone is constructed eight ways, mixing `ZoneInfo("Africa/Johannesburg")` with a fixed offset from settings; three `sast_date` copies; a copied date-bounds block.**
Locations: `substitutions/eligibility.py:34` and `core/display.py:10` (ZoneInfo); `analytics/fleet/periods.py:24`, `integrations/parcel_perfect/timestamps.py:15`, `phases/scheduling.py:37`, `trips/availability.py:132`, `trips/listing.py:225`, `exceptions/queries.py:278` (fixed offset); `analytics/fleet/constants.py:15` (SQL-side name). `sast_date`: `eligibility.py:37`, `periods.py:76`, `scheduling.py:28 operating_day`. Inclusive `from_date/to_date` → half-open bounds, comment included: `trips/listing.py:225-234` and `exceptions/queries.py:278-286`, while `periods.py:80-87` already has `instant_range`/`start_of_day`. Two private "now" helpers in one package (`substitutions/reads.py:56`, `service.py:86`) against 70 inline `datetime.now(UTC)` calls.
Proposal: `core/time.py` with `OPERATIONS_TZ`, `sast_date`, `start_of_day`, `instant_range`, `utcnow`; the two representations can disagree if `OPERATIONS_UTC_OFFSET_HOURS` ever changes, so pick one.
Risk: shared file N (`config.py` untouched if the setting stays). Tests: `unit/test_fleet_periods.py`, `unit/test_trip_availability.py`, `integration/test_trip_history.py`, `test_exception_reads.py`. Branches: analytics and substitutions owners.

**ST-18 · duplication · Low — keyset pagination written three times; page-size literals repeated.**
`trips/listing.py:252-259, 328-334`; `exceptions/queries.py:304-316, 331-334`; `parcel_trace/queries.py:76-80` + `parcel_trace/service.py:41-45`. `limit: int = Query(default=25, ge=1, le=100)` in `endpoints/trips.py:224` and `endpoints/exceptions.py:132`. `core/pagination.py` holds only cursor encode/decode.
Proposal: `core/pagination.py::apply_keyset(stmt, order_cols, position, limit)` + `next_cursor_for(rows, limit, key)` + `DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE`.
Risk: shared file N. Tests: `integration/test_trip_history.py`, `test_exception_reads.py`, parcel-trace tests.

**ST-19 · duplication · Low — Pydantic validators copied across schema files.** Timezone-aware check in 7 places over 4 files (`action_location.py:91, 192`; `phases.py:231, 251`; `transit.py:104, 264`; `driver_substitutions.py:168 _require_timezone`, the parametrised form); finite `driver_accuracy_metres` in 5 places; SA-ID validator twice in `people.py:66, 89` (one with the magic number 13). Proposal: `schemas/validators.py`. Risk: shared file N; tests `unit/test_schema_validators.py`, `unit/test_input_limits.py`.

**ST-20 · duplication — smaller clusters.** Itemised one per finding in §A.7 as ST-28 to ST-41 (Celery plumbing, asyncio retain tail, `enum_text` copies, admin redaction block, precinct-name lookup, Didit id, "critical" literal, metres-per-degree, UTC-ISO serialisers, 422 wrappers, current-driver twin, width constants, parallel analytics models, `_normalized_seal`).

### A.5 Naming and placement

**ST-21 · naming · Medium — underscore-prefixed functions are imported across module boundaries about 45 times, mostly inside `orchestration/phases/`.**
Evidence (reviewer grep `^from app\.[a-z_.]+ import .*\b_[a-z]`): 36 lines in `orchestration/phases/*` (`_finish_phase`, `_gate_and_load`, `_anchor_phase`, `_dispatch_anchor`, `_load_phase_event`, `_is_resolved`, `_record_driver_position`, `_assert_artifacts_belong_to_trip`, `_normalized_seal`, ...), plus `schemas/driver_substitutions.py:24-25` (`_validate_seal_format`, `_require_content`), `orchestration/verification/service.py:52` (`_reconstruct_trip_payload`), `orchestration/trips/listing.py:30` (`_client_names`, `_pp_manifest`), `api/v1/endpoints/manifest.py:11` (`_bearer` from `auth.dependencies`), `api/v1/endpoints/handover.py:30` (`_verification_state`), `integrations/parcel_perfect/mock.py:11` (`_build_header`). A leading underscore means module-private; these are package-shared.
Proposal: rename to public names (pure rename; ruff/mypy catch stragglers) when each package is next touched. The `phases/` ones are a product of the stage-4 split and were left as-is on purpose to keep the AST identical; renaming now is safe.
Risk: shared file N. Tests: `tests/baseline/test_b8_*` patch-target scanner and any `monkeypatch.setattr("app.orchestration.phases.x._name")` sites must be retargeted together (the migration guide documents how). Branches: `phases/` is touched by everyone; do it in one short-lived PR.

**ST-22 · placement · Low — `core/` hosts an event bus, demo data and geometry** (detail in ST-25). `core/demo_waypoints.py` (155 lines, FP-116 demo coordinates) belongs with `dev/`; `core/realtime.py` (Redis pub/sub, `after_commit` hooks, imports `db.models.enums` via an ignore) is infrastructure, not a constant. Risk: `demo_waypoints` is imported by `dev/services/truck.py` and `tests/unit/test_demo_waypoints.py` only (low); `realtime` is imported widely (Medium if moved).

**ST-23 · naming · Low — `integrations/pulsit.py` and `integrations/idvs.py` each bundle port, mock client (with fixture data) and live client; `parcel_perfect/` already shows the intended shape** (`port.py`, `mock.py`, `client.py`, fixtures, `factory.py`, contract 10). Proposal: `integrations/pulsit/{port,mock,client,factory}.py` and the same for `idvs`, keeping `get_pulsit_client` / `get_idvs_client` import paths via the package `__init__`. Risk: shared file N; 12 test files reference `pulsit`, 4 reference `idvs`; `dev/endpoints/pulsit.py` and `dev/endpoints/tracker.py` import the mock class directly.

**ST-24 · naming · Low — no `utils.py`/`helpers.py` exists in the backend (good).** `core/display.py` (14 lines) and `core/constants.py` (40) are correctly named. `orchestration/integrity.py` is the one flat module left in `orchestration/` and is intentionally small.

### A.6 Shared-file check

| Proposal | `main.py` | `core/config.py` | `db/models/__init__.py` | `requirements.txt` | `CLAUDE.md` | Other team-owned |
|---|---|---|---|---|---|---|
| ST-03 split `endpoints/handover.py` | **Y** (2 import lines) | N | N | N | N | — |
| ST-14 `DriverSubstitution` move / rule wording | N | N | **Y** (1 import) | N | **Y** | Alembic `env.py` via `__init__` |
| ST-15 central HTTP error handlers | **Y** (`add_exception_handler`) | N | N | N | N | B1/B2 snapshots |
| ST-25, ST-26 architecture/layering text | N | N | N | N | **Y** | `.importlinter` (add `reporting`) |
| ST-02, ST-07, ST-09, ST-10, ST-12, ST-23 package splits | N | N | N | N | N | `.importlinter` tier contracts |
| FE-01, FE-03, FE-19 frontend rules | N | N | N | N | **Y** | — |
| Everything else | N | N | N | N | N | — |

No proposal needs `requirements.txt`, `frontend/*/package.json` or `docker-compose.dev.yml`. FE-05 (shared API transport) and FE-06 (Supabase adapter base) would add a `@supabase/supabase-js` *type* import to `frontend/shared/`, which `shared/lib/auth/port.ts`'s header says it avoids; that is a design choice, not a package change, because both apps already depend on it.

### A.7 Itemised backend findings (unbundled from ST-20 and the inventory)

**ST-28 · duplication · Low — Celery task plumbing copied three times, with eight ad-hoc engines.**
Evidence: `_anchor` in `tasks/blockchain.py:35`, `tasks/driver_substitutions.py:30`, `tasks/evidence_anchors.py:34`; `_recover_*` loops at `blockchain.py:99`, `driver_substitutions.py:66`, `evidence_anchors.py:73` with identical `async with session_factory() as db, db.begin(): ... if result is None: break` bodies; `create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)` at `verification.py:29`, `parcel_perfect.py:59`, `blockchain.py:46,103`, `driver_substitutions.py:34,68`, `evidence_anchors.py:41,77`; identical task decorators (`bind=True, acks_late=True, reject_on_worker_lost=True, max_retries=3, default_retry_delay=30`); `evidence_anchors.py:30-32` re-exports another sweep's constants "so the sweeps cannot drift apart".
Proposal: `tasks/_session.py` with `worker_session_factory()` and `drain_recovery(recover_fn, *, delay_seconds)`; one decorator factory for the anchor tasks.
Risk: shared file N (`tasks/__init__.py` holds the Celery app; not on the shared list). Tests: `unit/test_pp_task.py`, `baseline/test_b6_*` (Celery task inventory). Branches: low.

**ST-29 · duplication / correctness-adjacent · Low — the asyncio "retain and observe a background task" tail is copied three times, and one copy uses the commit hook the shared helper warns against.**
Evidence: `evidence_anchors/dispatch.py:131 _retain`, `substitutions/anchors.py:116 _retain`, `phases/anchor_dispatch.py:110 _retain_anchor_task`, each with its own module-level set and the same `except asyncio.CancelledError: logger.warning(...)` / `except Exception:  # noqa: BLE001` pair. `evidence_anchors/dispatch.py:62 run_after_outer_commit` is savepoint-safe and documents (L55-57) that a `once=True` `after_commit` listener fires on `begin_nested()` release; `phases/anchor_dispatch.py:86` uses exactly that `listens_for(db.sync_session, "after_commit", once=True)` form.
Proposal: `core/background_tasks.py::retain(task, label)`; have `phases/anchor_dispatch.py` call `run_after_outer_commit` (a `phases -> evidence_anchors` import is new, so prefer moving the helper to `core/`). The commit-hook difference is behaviour, not structure; hand it to the bug pass.
Risk: shared file N. Tests: `integration/test_evidence_anchor_concurrency.py`, `test_driver_substitution_anchors.py`, `unit/test_phase_service.py`. Branches: phases shared.

**ST-30 · duplication · Low — `enum_text` re-implemented twice.** `db/models/enums.py:426 enum_text` (canonical, ~20 callers) vs `orchestration/evidence_anchors/recording.py:28 _text` and `orchestration/audit_packs/anchor_tiers.py:41 _text`, both `value.value if isinstance(value, Enum) else str(value)`, with the same docstring rationale. Proposal: delete both `_text`, import `enum_text`. Risk: none beyond `unit/test_enum_text.py` and the anchor tests; the `str()` on non-enum input is a no-op for the string columns involved, verify once.

**ST-31 · duplication · Low — the admin-only receipt redaction block is identical in four routes.** `endpoints/drivers.py:117`, `precincts.py:140`, `vehicles.py:100`, `trips.py:416`: `if current_user.role != DispatcherRole.ADMIN_DISPATCHER: detail = detail.model_copy(update={"receipts": []})` (trips: `blockchain_receipts`). Related inline role tests: `blockchain.py:77`, `exceptions.py:170`, `substitutions/service.py:207, 622`. `require_admin_dispatcher` (`auth/dependencies.py:252`) exists as a guard, not a predicate. Proposal: `auth/dependencies.py::is_admin_dispatcher(user)` and an `include_receipts: bool` parameter on `trips/detail.get_trip_detail` and the three fleet detail builders, so the redaction is applied where the receipts are loaded. Risk: shared file N; tests `integration/test_detail_receipts_gating.py`, `test_fleet_mutations_gating.py`; the gating test is the contract to keep green.

**ST-32 · duplication · Low — precinct id → name lookup in both analytics coordinators.** `orchestration/analytics/metrics.py:182` and `orchestration/analytics/fleet.py:137` are the same `select(Precinct.id, Precinct.name).where(Precinct.id.in_(...))` with the same docstring. Contract 25 keeps `metrics` and `fleet` independent, so the helper must go *down*: `orchestration/fleet/precincts.py::precinct_names(db, ids)` or a new `orchestration/analytics/_shared.py`. Risk: none; tests `integration/test_analytics_endpoints.py`, `test_fleet_*`.

**ST-33 · duplication / layering · Low — the Didit provider id is declared in both layers.** `orchestration/handover/receiver_verification.py:48 PROVIDER_DIDIT = "didit"` and `integrations/idvs.py:45 _PROVIDER_DIDIT = "didit"`. Orchestration may import integrations, not the reverse, so `integrations/idvs.py` should export it. Risk: none.

**ST-34 · duplication · Low — `"critical"` as a string literal where the enum exists.** `reporting/pdf_renderer.py:41 _CRITICAL = "critical"` and `orchestration/audit_packs/analysis.py:54 _CRITICAL = "critical"` compare `e.severity == _CRITICAL`; `ExceptionSeverity.CRITICAL` is at `db/models/enums.py:177` and a second, unrelated `CRITICAL = "critical"` member sits in `core/realtime.py:90`. `reporting/` deliberately avoids `db` imports ("renders a manifest it is given"), so pass the enum's value in via the manifest schema or `schemas/`. Risk: none; `unit/test_audit_pack_pdf.py`, `unit/test_audit_pack_analysis.py`.

**ST-35 · duplication · Low — two metres-per-degree constants with different values, and two distance formatters.** `core/polygon.py:25 _METRES_PER_DEGREE = math.pi * EARTH_RADIUS_METRES / 180` (≈111 195 m) vs `reporting/route_svg.py:20 METRES_PER_DEGREE = 111_320.0`; `core/geo.py:82 format_distance` (rounds, `.1f` km) vs `route_svg.py:68 _distance_label` (`:g`). The 0.1 % constant difference is invisible on an SVG but is still two sources of truth. Proposal: `route_svg` imports from `core/geo.py` (`reporting -> core` is allowed). Risk: `unit/test_route_svg.py` may pin label text; update in the same change.

**ST-36 · duplication · decision, not a move — four UTC-ISO serialisers feed anchored hashes and differ.** `crypto/hashing.py:62 _utc_iso` (naive read as UTC, default precision), `orchestration/evidence_anchors/canonical.py:96 _utc_iso` (naive raises, `timespec="microseconds"`), `orchestration/substitutions/canonical.py:57 _iso` (same, `None` passes), `orchestration/consignments/manifest_snapshot.py:19 _iso` (naive uses server-local zone). Their output is hashed and anchored on Hedera, so unifying them changes verification of existing receipts. Proposal: keep all four; document them as generations in `crypto/hashing.py` (as the trip payload v1/v2 already are) and add a golden test per variant so nobody "cleans them up". Risk: none if left alone; High if merged.

**ST-37 · duplication · Low — the "ValueError from one pure check → 422" wrapper is written three times in endpoints.** `endpoints/trips.py:240-247` (cursor decode), `endpoints/analytics.py:48-61 _require_valid_month_range`, `endpoints/fleet_analytics.py:63-79 _require_valid_period`, with the same multi-line docstring rationale in the last two. Proposal: `api/v1/http_errors.py::value_error_as_422()` context manager beside `custody_errors.py`, or the central handlers of ST-15 (note: a blanket `ValueError` handler is too broad; keep it a context manager). Risk: none; `integration/test_trip_history.py`, `test_analytics_endpoints.py`, `test_fleet_*`.

**ST-38 · duplication · Low — "current driver of each trip" exists as a SQL expression and as a Python fold.** `orchestration/substitutions/access.py:181 current_driver_ids` (SQL, "the SQL twin of derive_custody") and `orchestration/substitutions/availability.py:42` (Python over loaded rows; its docstring names the twin). Proposal: `availability.py` calls `access.current_driver_ids(trip_ids=[t.id for t in trips])` and falls back to `trip.driver_id`; one rule, one place. Risk: `unit/test_driver_substitution_custody.py`, `integration/test_driver_substitution_availability.py`.

**ST-39 · duplication · Low — column-width constants repeated, one with a conflicting value.** `schemas/text.py:14 NAME_MAX_LENGTH = 255`, `:21 ADDRESS_MAX_LENGTH = 1000`; `schemas/organisations.py:67 _NAME_MAX_LENGTH = 255`, `:71 _ADDRESS_MAX_LENGTH = 500` (documented as a deliberate tighter bound for `PrecinctEvent.changed_fields`). Proposal: import `NAME_MAX_LENGTH` from `schemas/text.py`; keep the 500 with its comment, renamed `_CHANGED_FIELDS_ADDRESS_MAX_LENGTH` so it stops reading as a duplicate. Risk: none; `unit/test_input_limits.py`.

**ST-40 · duplication · Low — two parallel analytics response families carry the same ratios under different field names.** `schemas/analytics.py:63 on_time_departure_rate`, `:69 override_rate` vs `schemas/fleet_analytics.py:191`, `:388`, both via `analytics/stats.safe_ratio` but over `on_time_departures_count / departures_with_plan_count` vs `on_time_departures / departures_with_plan`. The maths is shared; the naming is not, and `frontend/shared/lib/types/{analytics,fleet-analytics}.ts` mirror both spellings. Proposal: no move; pick one field vocabulary when either contract is next versioned. Risk: a rename is an API change (B1 snapshot, both frontends).

**ST-41 · duplication · Low — `_normalized_seal` twice with a documented reason.** `orchestration/phases/seals.py:13` (not `Optional` on purpose, comment L14-20) vs `orchestration/audit_packs/analysis.py:193` (`(value or "").strip().upper()`). Proposal: `analysis.py` resolves `None` then calls the `seals` function; or leave, it is two lines. Risk: none.

**ST-42 · duplication (cross-stack) · Medium — the "phase is already decided" status set is written five times across backend and frontend.**
Evidence: `orchestration/phases/state.py:21 _is_resolved` (the source); `dev/schemas.py:26 CLOSED_PHASE_STATUSES` with comment L21-25 *"stated again here (not imported) because that predicate is private to phases.state"*; `frontend/dispatcher/lib/types/dev.ts:24 CLOSED_PHASE_STATUSES`; `frontend/dispatcher/lib/phase/derive.ts:28 RESOLVED`; `frontend/driver-pwa/lib/phase/derive.ts:14 RESOLVED_STATUSES`; all `['completed', 'exception', 'overridden']`. The driver copy's comment claims the dispatcher excludes `'exception'`, which is false.
Proposal: backend: make the predicate public (`phases/state.py::is_resolved`, `RESOLVED_STATUSES`) and import it in `dev/schemas.py` (`dev -> orchestration` is allowed); frontend: one `shared/lib/phase/status.ts` exporting `RESOLVED_STATUSES` and `isResolved`, imported by both apps' `derive.ts` and `lib/types/dev.ts`; add it to the existing `tests/unit/test_phase_meta_contract.py`-style mirror test so the backend and the shared TS constant cannot drift.
Risk: shared file N. Tests: `unit/test_phase_service.py`, both `derive.test.ts`, `unit/test_dev_truck_service.py`. Branches: phases + both frontends; small diff.

**ST-43 · duplication (cross-stack, by design) · note — `core/phase_meta.py` must mirror `frontend/shared/lib/constants/phase-meta.ts`.** Docstring L1-2 says so and `tests/unit/test_phase_meta_contract.py` enforces it. This is the pattern ST-42 should copy; no action.

**ST-44 · mixed-purpose · Low — `auth/dependencies.py` (329) mixes demo identities, a synchronous JWKS fetch, JWT verification and three DB-backed dependencies.**
Evidence (reviewer-read L86-90): `_fetch_jwks` uses `urllib.request.urlopen(url, timeout=10)` (blocking) from an async dependency path, cached for `_JWKS_TTL_SECONDS` so it blocks the event loop once per TTL. `_DEMO_USER`/`_DEMO_DRIVER` fixed identities at L48-81 (DEMO_MODE only; import-time guard L323-329). The sub-claim parse + 401 and the "not found / inactive" 401 blocks are near-identical in `get_current_dispatcher` (L214-243) and `get_current_driver` (L283-312).
Proposal: `auth/jwks.py` (fetch with `httpx.AsyncClient`, cache), `auth/demo.py` (stub identities), one `_load_principal(db, model, user_id)` helper for the two dependencies. The blocking call is for the bug pass; the split is structure.
Risk: shared file N. Tests: `unit/test_auth_dependencies.py`, `unit/test_auth_jwks_cache.py`, `integration/test_auth_router.py`. Branches: auth is shared ground; one PR.

**ST-45 · mixed-purpose · Low — `endpoints/trips.py` does small pieces of orchestration in routes.** `get_crew_availability_endpoint` L293-308 builds `TimeWindow`, `CrewFilter()` and `datetime.now(UTC)` and calls `busy_crew_in_window` directly (a lower-tier `trips/availability` function) instead of a `trips/queries` entry point; cursor decode + 422 in the route L240-246 (ST-37); admin redaction L416 (ST-31); three identical five-line `except Exception` wrappers around `_trip_http_error` (L168-172, L192-196, L280-284). Proposal: `trips/queries.py::crew_availability(db, org, window, now)`; a `@handles_trip_errors` decorator or context manager for the three wrappers. Risk: none beyond `integration/test_trip_availability_endpoint.py`, `test_trips.py`.

**ST-46 · mixed-purpose · Low — `endpoints/audit_packs.py` assembles responses and re-queries in routes.** L182-186 builds `AuditPackIssued(... share_url(...), verify_url(...))`; L246-252 maps access events with `enum_text` in a comprehension; L305 `return next(d for d in declared if d.declaration_id == row.id)` re-lists every declaration to find the one just written. `_pdf_response` L63-67 formats `Content-Disposition` by hand (also done in `audit_packs_public.py`). Proposal: `record_declaration` returns the read model; `lifecycle.issue_audit_pack` returns `AuditPackIssued`; one `pdf_response(bytes, filename)` helper in `api/v1/`. Risk: `integration/test_audit_pack_endpoints.py`, `test_incident_declarations.py`; Tim's area.

**ST-47 · mixed-purpose / naming · Low — `integrations/parcel_perfect/client.py` classifies errors by message text and keeps a module-global token.**
Evidence: L272-296 `err_str = str(exc).lower()` then `any(kw in err_str for kw in ("token", "auth", "session", "invalid credentials"))` / `elif "not found" in err_str`; `_cached_token` global L50 with a comment (L44-49) accepting duplicate handshakes; `_parse_waybill_response` L181-254 (75 lines) sits beside transport. Proposal: `parcel_perfect/parsers.py` for the response mapper (tier `errors | timestamps | models`), typed error codes from `_make_call` instead of string sniffing, token cache as an attribute of the client instance. Risk: contract 10 tier list gains `parsers`; tests `unit/test_parcel_perfect_client.py`, `test_parcel_perfect_package.py`.

**ST-48 · naming · Low — the three Parcel Perfect fixture files import each other's underscore names, and one holds a renderer.** `unassigned_fixtures.py:4-11` and `manifest_fixtures.py:9-22` import `_BFN, _CPT, _JHB, _routed_waybill, _Depot, _DEMO_*` from `waybill_fixtures.py`; `mock.py:11` imports `_build_header` from `manifest_fixtures.py:278` (a renderer that formats and re-parses PP dates, L274-303). Proposal: `parcel_perfect/fixture_common.py` with public names; `_build_header` → `mock.py` or `timestamps.py`. Risk: contract 10 lists modules by name (add `fixture_common` to the fixtures tier); `unit/test_pp_*.py`, `unit/test_seed_fixtures.py`.

**ST-49 · naming / placement · Low — two tiny `api/v1/` helper modules expose private names.** `api/v1/handover_responses.py` (26 lines) exports only `_verification_state`, imported by `endpoints/handover.py:30`; `api/v1/custody_errors.py` (30 lines) is the right pattern (public names, one job). Proposal: rename to `verification_state` and fold into `endpoints/handover_public.py` when ST-03 lands, or move the conversion into `orchestration/handover/service.py` returning the schema. Risk: none.

**ST-50 · size · Low — `analytics/fleet/cost.py` (325) mixes four SQL loaders with the money arithmetic.** `trip_routes` L102-121, `_load` L135-180 vs `_Totals` L200-272, `_figures` L273, `build_cost` L310. Covered only by `integration/test_fleet_cost.py`; the pure half has no unit test. Proposal: `analytics/fleet/cost_queries.py` + pure `cost.py` with a unit test on `_Totals`. Risk: none; analytics owner.

**ST-51 · size · Low — `analytics/fleet/periods.py` (365) holds the date model and four banding enums with classifiers.** Pure, well-tested (`unit/test_fleet_periods.py`). Proposal: only if touched, `analytics/fleet/bands.py` for L247-365 next to `constants.py`; it is also the natural home for the shared time helpers of ST-17 if `core/time.py` is not wanted. Risk: imported by every fleet tab, `schemas/fleet_analytics.py` (ignore list) and `endpoints/fleet_analytics.py`.

**ST-52 · size · Low — `orchestration/substitutions/reads.py` (424) serves dispatcher and driver audiences.** Dispatcher reads L83-122, L321-424; driver-scoped reads L128-318. Proposal: `substitutions/reads_dispatcher.py` and `reads_driver.py` on one tier. Risk: `integration/test_driver_substitution_reads.py`, `test_driver_transfer_v2.py`, `unit/test_driver_transfer_phase_context.py`.

**ST-53 · size · Low — `orchestration/consignments/manifest_import.py` (434): read-only preview vs create-from-manifest.** Preview L63-283 (fetch, context, snapshot sha256, `PPManifestPreviewResponse`); create L286-434 (blocking checks, precinct resolution, `NewTrip`, `persist_trip`). Proposal: `consignments/manifest_preview.py` below `manifest_import.py` (contract 18 tiers). Risk: `integration/test_pp_manifest_preview.py`, `test_creation_concurrency.py`; Ciaran's manifest-first work.

**ST-54 · size · Low — `orchestration/substitutions/anchors.py` (367): freeze/dispatch/execute/recover vs custody-chain verification.** L47-253 vs L259-367. Proposal: `substitutions/custody_chain.py` for `verify_custody_chain` and its three finding helpers. Risk: `integration/test_driver_substitution_anchors.py`, `conftest.py` imports the module.

**ST-55 · size · Low — `orchestration/evidence/corroboration.py` (516): phase vs checkpoint entry points over shared helpers.** Single purpose; the two 100+-line entry points (`record_phase_corroboration` 157 lines, baselined; `record_checkpoint_corroboration` L435) share loaders. Proposal: no file split; extract the per-trailer loop (L338-430) into a helper so the baselined function shrinks. Risk: `unit/test_corroboration_service.py`, `integration/test_phase_corroboration.py`.

**ST-56 · size · Low — `orchestration/audit_packs/analysis.py` (573) is two pure halves.** Trail geometry L58-183 vs observation sentences L189-573. Proposal: `audit_packs/observations.py` for the rules; both stay leaves in contract 21. Risk: `unit/test_audit_pack_analysis.py`; Tim.

**ST-57 · size · Low — `dev/schemas.py` (497) groups DTOs per dev tool out of order.** Triggers L19-237, move-truck L239-420, rig/road-check L422-480, PP manifest L481-497 (appended last). `CLOSED_PHASE_STATUSES` duplication is ST-42. Proposal: `dev/schemas/{triggers,truck,rig,pp}.py` package (contract 19 lists `schemas` as a layer name, which a package satisfies). Risk: `integration/test_dev_*.py`.

**ST-58 · size · Low — `dev/services/truck.py` (340): one DB read among pure geodesy.** `resolve_target_stop` L128-153 vs `scenario_distance_metres`, `destination_point`, `build_scenario_target` L156-340. Proposal: move the read into `dev/endpoints/pulsit.py`'s `_load_trip_context` (already DB-aware) or a `dev/services/lookups.py`, leaving `truck.py` pure and fully unit-testable. Risk: `unit/test_dev_truck_service.py`, `integration/test_dev_pulsit.py`.

**ST-59 · size · Low — `schemas/transit.py` (524) holds checkpoint and exception schemas.** Checkpoints L30-143; exception create/review/read L163-524; validators duplicated (ST-19). Proposal: `schemas/checkpoints.py` + `schemas/exceptions.py` (name clash with `core/exceptions.py` is only cosmetic; `schemas/exception_reads.py` if preferred). Risk: `schemas/__init__.py` re-exports; `unit/test_schema_validators.py`, `unit/test_input_limits.py`.

**ST-60 · mixed-purpose · Low — `schemas/phases.py::PhaseEventRead.from_event` (L130-157) derives `stop_sequence`, `step_recipe` and `blocked_on` from an ORM row inside a schema.** Its docstring says it takes `Any` to avoid importing `db` models, which is the symptom. Proposal: build the read model in `orchestration/phases/queries.py` (where the row and the gate map are loaded) and keep the schema declarative; `endpoints/phases.py:67-72` becomes a pass-through (pairs with ST-04). Risk: `unit/test_phase_schemas.py`, `integration/test_phases.py`.

**ST-61 · doc-drift · Low — `backend/tests/baseline/` is not in the `CLAUDE.md` test layout.** `CLAUDE.md` Testing lists `unit/` and `integration/`; the tree also has `baseline/` (B1 API contract, B2 authorisation, B3 canonical hashes, B8 retired-module guard, with snapshots) and `fixtures/`. These are the behaviour-preservation gates every move in this report relies on. Proposal: add two lines to the Testing section. Risk: shared file **Y** (`CLAUDE.md`).

**ST-62 · placement · note — `schemas/__init__.py` is a barrel re-exporting every schema.** Not on the shared-file list but imported as `from app.schemas import ...` widely; any schema split (ST-13, ST-59) edits it. Suggest treating it like `db/models/__init__.py` in the shared-file list. Risk: shared file list is in `CLAUDE.md`.

**ST-63 · size · note — `core/exceptions.py` (509, 49 classes) and `db/models/enums.py` (430, 33 enums) are single-purpose registries.** Optional `core/exceptions/` package by domain with a re-exporting `__init__` (42 test files import the flat path, so keep the names). No action recommended before the handlers of ST-15, which would import from it.

**ST-64 · shared-file · note — `backend/app/main.py` is 298 lines with 32 `include_router` calls, environment gating and the one exception handler.** Two lines under the size threshold and on the shared list. ST-03 and ST-15 both touch it; sequence them as one PR so the four-reviewer coordination happens once.

---

## Part B — Frontend

### B.1 Size inventory: every non-test `.ts`/`.tsx`/`.css` over 300 lines

| Lines | File | Directive | Responsibilities seen | Verdict |
|---|---|---|---|---|
| 930 | `dispatcher/components/dev/AllControls.tsx` | client | one component, ~16 state slices, six panels in a ~395-line return (L535-930): scan target, move truck ×2, scan feed, PP lifecycle, exceptions, confirm modal | split (FE-17); dev-only |
| 668 | `dispatcher/components/map/LocationComparisonMap.tsx` | client | pure fit geometry L61-250; marker HTML; Leaflet init/tile-fallback/retry; layer rebuild effect L431-544; controls | split (FE-17) |
| 506 | `dispatcher/app/(app)/trips/new/page.tsx` | client | wizard state; validation; manifest lookup; submission + timeout recovery L205-330 calling `createTrip`/`createTripFromPPManifest`/`findLiveTripForManifest`; two presentational helpers; composed JSX | hook extraction (FE-17) |
| 503 | `dispatcher/components/precincts/PrecinctForm.tsx` | client | form state; coordinate paste; Overpass outline lookup with abort; address select; submit via `api.post/patch` L300-304; ~185-line JSX | hook extraction (FE-17) |
| 491 | `dispatcher/components/analytics/fleet/copy.ts` | none | one `as const` copy object with pluralisation lambdas | single |
| 456 | `dispatcher/app/(app)/fleet/vehicles/page.tsx` | client | filter/sort state + `sortVehicles`; add-vehicle form + `api.post`; ~250 lines inline JSX incl. a ~125-line modal form | split (FE-17) |
| 451 | `dispatcher/components/analytics/fleet/tabs/RoutesTab.tsx` | client | tab shell + four card components (sites, lane times, lane risk, incidents map/table) | per-card files, Low |
| 423 | `.../fleet/tabs/CostTab.tsx` | client | tab shell + five cards | single, Low |
| 422 | `dispatcher/components/map/LocationComparisonSchematic.tsx` | none | projection + extent fit + label placement inline (~70 lines of maths) + SVG | layout fn extraction, Low |
| 420 | `dispatcher/components/map/GeofenceMap.tsx` | client | 23 hook calls; Leaflet editing; echo suppression; tile failure tracking exported from a component file and imported by `LocationComparisonMap` | lib extraction (FE-17) |
| 415 | `dispatcher/lib/phase/acts.ts` | none | pure phase-act model (types + builders + ordering) | single |
| 412 | `.../fleet/tabs/ProblemsTab.tsx` | client | tab shell + five cards; `pivotByType` | single, Low |
| 409 | `dispatcher/app/(app)/exceptions/page.tsx` | client | URL↔view-state sync; data selection and owner partition; presets; debounce; ~170 lines of logic L106-278 before composed JSX | hook extraction (FE-17) |
| 386 | `dispatcher/app/(app)/exceptions/[id]/page.tsx` | client | detail load; review draft + `beforeunload`; claim/release/review via `lib/api/client`; ResizeObserver layout | hook extraction (FE-17) |
| 366 | `dispatcher/components/layout/Sidebar.tsx` | client | nav config data L30-80 inline with four components | data to `lib/constants/nav.ts`, Low |
| 365 | `dispatcher/components/trips/TripExceptionsPanel.tsx` | client | filter/sort/group; batch selection; expand/collapse with focus mgmt and `document.querySelector` L112; four `render*` closures | split, Medium (FE-17) |
| 365 | `dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx` | client | load; edit form + `api.patch`; resizable split pane; ~175 lines inline JSX; near-duplicate of the driver detail page | split (FE-17) |
| 348 | `dispatcher/lib/api/client.ts` | none | transport (~215 lines) + domain wrappers for trips/exceptions/PP (~130) | split (FE-05, FE-17) |
| 345 | `dispatcher/lib/types/dev.ts` | none | wire types + runtime constants + UI labels + one predicate | types vs constants, Low |
| 345 | `dispatcher/components/parcels/trace-display.ts` | none | label maps (copy) + derivation logic + a `createElement` component in a `.ts` file | split, Low |
| 334 | `dispatcher/app/(app)/fleet/drivers/[id]/page.tsx` | client | as vehicles/[id]; ~160 lines inline | split (FE-17) |
| 333 | `dispatcher/lib/phase/location-evidence.ts` | none | evidence model + copy + builders + map-framing geometry L268-333 | move framing helpers, Low |
| 325 | `dispatcher/components/blockchain/VerifyButton.tsx` | client | state machine + version guard + `api.post` + timers + focus mgmt + 3-state render + modal; 15 hooks | hook/view split, Low |
| 314 | `dispatcher/lib/phase/checks.ts` | none | check model + 75-line wording table + evaluators | single |
| 313 | `.../fleet/tabs/OnTimeTab.tsx` | client | tab shell + three cards | single |
| 766 | `driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx` | client (L10) | trip gate + hand-off latch; URL-vs-ledger guard; step router; **355-line `usePhaseStepController`** L305-660; six step wrappers; initial-evidence shapes; linehaul fetch; logic overlaps `InTransitPageClient` | split (FE-11) |
| 751 | `driver-pwa/lib/hooks/useOfflineQueue.ts` | client | ~90% module-scope offline engine (store, flush, migrations L138-490) + a 255-line hook with a 90-line `submitExceptionReport` | split (FE-12) |
| 608 | `driver-pwa/components/phase/SwipeToConfirm.tsx` | client | 36 hook calls; drag/flick/keyboard/tap modes; spring physics; haptics; presentation | split (FE-14) |
| 588 | `driver-pwa/lib/context/TripContext.tsx` | client | 24-member context; fetch/select/adopt; optimistic phase resolution; polling; handover; 105-line `logException`; 7 demo-mode branches on `mockTrips` | split (FE-13) |
| 578 | `driver-pwa/app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx` | client | form + photos; 110-line submit pipeline; ~215 lines inline JSX | split (FE-15) |
| 551 | `driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx` | client | fix refresh; ETA; arrival swipe + location check + submission (overlaps FE-11); ~145 lines inline JSX | split (FE-15) |
| 531 | `driver-pwa/lib/hooks/useSubstitutionCapture.ts` | client | ~340 lines non-React (validation, body builders, send engine) + hook | split (FE-16) |
| 493 | `driver-pwa/lib/api/phases.ts` | none | request types; 2 HTTP calls; artifact id resolution; 190-line `buildPhaseCompleteRequest` switch; demo-mode branch L472 | split (FE-16) |
| 472 | `driver-pwa/lib/submission/phase-submitter.ts` | client (L17) | GPS budget; types; module store + hook; runner; dedupe | cohesive; four concerns, Low |
| 439 | `driver-pwa/components/trip/DriverSubstitutionFlow.tsx` | client | flow orchestration + three sub-components | move sub-components, Low |
| 424 | `driver-pwa/components/map/DriverMap.tsx` | client | Maps loader/theme; marker/route sync; dark-mode observer; two fallback cards | fallback extraction, Low |
| 410 | `driver-pwa/app/globals.css` | — | two parallel token palettes (`--fp-*` RGB and shadcn HSL, light + dark + contrast); utilities; base; one screen class | tokens vs utilities, Low |
| 363 | `driver-pwa/tailwind.config.ts` | — | colour map mirroring the CSS variables (~170 lines), keyframes, plugins | single |
| 305 | `driver-pwa/lib/offline/exception-store.ts` | none | IndexedDB store + CRUD | single |
| 302 | `driver-pwa/lib/offline/late-evidence-sync.ts` | none | source abstraction; report building; send | single-ish |
| 689 | `shared/lib/mocks/driver-substitutions.ts` | none | fixtures + three type declarations + an endpoint-outcome matrix (contract documentation as data) | split by topic, Low (FE-18) |
| 603 | `shared/lib/mocks/trips.ts` | none | id constants; plan helpers; exception fixtures; seven trips; **runtime dependency of the PWA in demo mode** | split, Low (FE-18) |
| 600 | `shared/lib/types/driver-substitution.ts` | none | contract enums/constants; read models; late-evidence and live-write payload mirrors; request bodies; **parsed line-by-line by a backend test** | split constrained (FE-18) |
| 368 | `shared/lib/types/fleet-analytics.ts` | none | pure wire types per tab | single |

### B.2 Rule checks

| Rule (`CLAUDE.md` L68, L118) | Result | Evidence |
|---|---|---|
| Typed fetch wrapper; never raw `fetch()` in components | **Pass.** 9 `fetch(` calls, all inside `lib/` wrappers or data-URL conversions: `dispatcher/lib/api/client.ts:124`, `lib/supabase/client.ts:19`, `lib/realtime/RealtimeProvider.tsx:142` (SSE), `lib/geocode/{overpass.ts:128, photon.ts:120}`; `driver-pwa/lib/api/client.ts:205`, `lib/api/geocode.ts:24`, `lib/api/artifacts.ts:51` (data URL → blob), `lib/scan/scanLinehaulSheet.ts:36` (data URL). None in `components/` or `app/`. | grep `\bfetch\(` |
| No `any` | **Pass.** 8 hits, all in comments (`// any trip changing`, `/** ... any ISO instant */`, etc.). | grep `: any\|as any\|<any>` |
| App Router only | **Pass.** No `pages/` directory, no `getServerSideProps`/`getStaticProps`/`getInitialProps`, no `next/router`. | grep |
| Client env vars `NEXT_PUBLIC_*` | **Pass.** Only `NEXT_PUBLIC_*` and `NODE_ENV` (6 uses) read. Hardcoded fallbacks exist: `https://hashscan.io/testnet` ×4 (FE-07) and `http://localhost:8000` ×2 (`dispatcher/lib/api/client.ts:14`, `driver-pwa/lib/api/client.ts:9`). No keys. | grep `process\.env\.` |
| driver-pwa: every page `'use client'` | 19 of 21 `page.tsx` files carry it; 2 do not, by necessity (FE-03). | reviewer-read |
| dispatcher: `'use client'` only at lowest level | **Not met as a pattern.** 21 of 22 `page.tsx` files plus `app/(app)/layout.tsx` are Client Components; 224 dispatcher files carry the directive; 24 components carry it without needing it (FE-01, FE-02). | reviewer grep + subagent check |
| Shared via `@shared/*` alias | **Pass.** 337 dispatcher files and 148 driver-pwa files import `@shared/`; `frontend/shared/tsconfig.json` and both app tsconfigs define the alias; no `../dispatcher/` or `../driver-pwa/` reach; the one relative `../shared/` import is `driver-pwa/next.config.ts:8` (build config, cannot use the alias; legitimate). `client-portal/` imports `@shared` 0 times and `receiver/` once (FE-19). | grep |

**FE-04 · rule · Pass — raw `fetch()`, `any`, Pages Router, client env vars and cross-app imports.** All five checks in the table above pass on the reviewed tree; the only residue is the two hardcoded fallback URLs (HashScan testnet ×4, FE-07; `http://localhost:8000` ×2, FE-05), which are defaults rather than secrets. No proposal; recorded so the ID sequence is complete and the next pass can diff against it.

**FE-01 · rule / doc-drift · Medium — the dispatcher is a client-rendered app: 21 of 22 pages and the authenticated layout are Client Components that fetch their own data through hooks.**
`CLAUDE.md` L68: *"async Server Components where possible ... `"use client"` only at lowest level needed"*; L55: *"React 19+ (Server Components ...)"*.
Evidence (reviewer): `grep -lE "^['\"]use client['\"]"` over `dispatcher/app/**/page.tsx` → 21 of 22 (the exception is `app/dev/design/page.tsx`); `app/(app)/layout.tsx` too. Page heads read: `exceptions/page.tsx` (`'use client'`, `useCallback, useEffect, useMemo, useRef, useState`, `useSearchParams`), `trips/new/page.tsx`, `fleet/vehicles/page.tsx` (`React, useEffect, useMemo, useState`). Subagent: 18 of 21 client pages call hooks themselves (2 to 23 calls each); three (`dev/triggers`, `precincts/new`, `settings`) have no client signal of their own and only render client components.
Assessment: with a Supabase-session token resolved in the browser (`lib/api/client.ts:76 resolveToken`) and no server-side data layer, the pages genuinely need the directive *as written*; nothing here is a per-page mistake. The rule and the code disagree at the architecture level.
Proposal: decide once. Either (a) record in `CLAUDE.md` that the dispatcher is a client-rendered dashboard behind auth and that pages may be Client Components, keeping the "lowest level" rule for components (then FE-02 is the actionable residue), or (b) adopt the driver-pwa shape (`page.tsx` as a Server Component that renders a `*PageClient.tsx`), which changes nothing at runtime today but keeps the door open for server data loading and `generateMetadata`. Start with the three signal-free pages if (b).
Risk: shared file **Y** (`CLAUDE.md`) for (a); for (b) every page file plus its `page.test.tsx` (22 tests). Branches: all four touch dispatcher pages; do not start (b) during the freeze.

**FE-02 · rule · Low — 24 dispatcher components carry `'use client'` without hooks, handlers, browser APIs or client-only imports (26 more are borderline: they only pass an `onX` prop through).**
Evidence (subagent, three spot-checked by the reviewer with hooks = handlers = browser = 0): `components/ui/{Skeleton,TopBar,RecordLink,DetailSkeleton}.tsx`, `components/blockchain/EventTimeline.tsx`, `components/domain/{ActivationDetail,ExceptionEvidence,InTransitTimeline,ManifestSnapshot,PhaseAudit,PhaseChecks,PhaseLocationDetails,TripCreatedDetail,UnloadingDetail}.tsx`, `components/drivers/driverColumns.tsx`, `components/trips/tripColumns.tsx`, `components/exceptions/{ExceptionDetailEvidence,ExceptionDetailSkeleton,ExceptionHederaLinks}.tsx`, `components/map/GeofenceSchematic.tsx`, `components/precincts/{PrecinctCardSkeleton,PrecinctDetailSkeleton}.tsx`, `components/trips/new/ManifestSummary.tsx`, `components/vehicles/VehicleCardSkeleton.tsx`.
Proposal: delete the directive from these 24 (one-line change each, no behaviour change while every importer is already a client module). Leave the 26 borderline files (`Button`, `IconButton`, ...) alone; a prop-forwarding primitive is conventionally client.
Risk: shared file N. Tests: colocated `*.test.tsx` unaffected. Branches: trivial, but 24 files across everyone's areas; batch it after the freeze.

**FE-03 · doc-drift · Low — two driver-pwa pages are Server Components, correctly, and `CLAUDE.md` says "every page".**
Evidence (reviewer-read): `driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/page.tsx` (17 lines) and `driver-pwa/app/(app)/trips/[id]/page.tsx` (13 lines) export `generateStaticParams()` (server-only) and render `PhaseStepPageClient` / `TripDetailPageClient`; each has a comment explaining why. `app/layout.tsx` is also a Server Component so `viewport`/`metadata` export statically (comment L9-10).
Proposal: amend `CLAUDE.md` L68 and L118: *"every page that renders UI; a `page.tsx` that only exports `generateStaticParams` and returns a `*PageClient` is the one exception, and the root layout stays a Server Component for metadata."* Risk: shared file **Y** (`CLAUDE.md`).

### B.3 Duplication across apps

**FE-05 · duplication · High — the typed API transport exists four times, with byte-identical helpers between the two main apps.**
Evidence: `dispatcher/lib/api/client.ts` (348), `driver-pwa/lib/api/client.ts` (287), `client-portal/lib/api.ts` (137), `receiver/lib/api.ts` (158). `withTimeout<T>` (dispatcher L59-70 / driver L132-143) and `resolveToken()` (L76-85 / L152-161) diff to 0 lines; `SESSION_TIMEOUT_MS = 8_000` declared twice; `BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'` twice; two `class ApiError` with different constructor signatures and diverged pipelines (dispatcher: `detail: unknown`, blob mode, 20 s; driver: coded `ApiErrorDetail`, 401 token retry, custody-generation check, 12 s). The 2026-10-06 audit §7 deferred this consolidation until Tim's branch merged; it has (PR #93) and the duplication now includes `client-portal`.
Proposal: `frontend/shared/lib/api/` with `base-url.ts`, `with-timeout.ts`, `api-error.ts` (base class) and `resolve-token.ts` (taking the Supabase client as a parameter); each app keeps its own `request` pipeline on top. Also split `dispatcher/lib/api/client.ts` into transport vs `lib/api/{trips,exceptions}.ts` domain wrappers (L239-346).
Risk: shared file N. Tests: `dispatcher/lib/api/client.test.ts`, `driver-pwa/lib/api/__tests__/*.ts`, `receiver/lib/api.test.ts`. Branches: all four (every feature touches an API call); land it as its own PR right after the freeze.

**FE-06 · duplication · Medium — identical hooks, adapters and helpers copied between the two apps.** (Each item is also its own finding in §B.6: FE-41, FE-54 to FE-60.)
`useIdleTimeout.ts` (dispatcher 89 / driver 107; diff 0 after stripping comments; both built on `@shared/lib/session/idle`) → `shared/lib/session/useIdleTimeout.ts`. Supabase auth adapters `SupabasePasswordAuth.ts:14-45` and `SupabaseOtpAuth.ts:8-40`: `toSession`, `toEvent`, `getSession`, `onChange`, `signOut` bodies diff 0 → a shared base class over `shared/lib/auth/port.ts`. Supabase token-cache module (`dispatcher/lib/supabase/client.ts:34-53`, `driver-pwa/lib/supabase.ts:13-36`) → `shared/lib/supabase/token-cache.ts`. `isRecord` ×3 (`dispatcher/lib/api/json.ts:2`, `driver-pwa/lib/offline/queue-storage.ts:158`, `retained-drafts.ts:48`). `SUPPRESS_RETURN_SAVE_KEY` in both `AuthContext.tsx` (L25 / L30) → `shared/lib/session/return-path.ts` (already has `RETURN_PATH_KEY`). `initialsOf` (`dispatcher/lib/format/dispatcher-identity.ts:13`, `driver-pwa/components/profile/DriverAvatar.tsx:4`). `truncateHash` (`dispatcher/components/blockchain/BlockchainBadge.tsx:23`, `driver-pwa/components/blockchain/AnchorProgress.tsx:30`). `haversineMetres` with **different earth radii** (`dispatcher/lib/phase/geo.ts:13` 6 371 008.8, also `lib/map/polygon.ts:13`; `driver-pwa/lib/route/eta.ts:19` 6 371 000). Phase "resolved / current" derivation duplicated (`dispatcher/lib/phase/derive.ts:28-41`, `driver-pwa/lib/phase/derive.ts:14-30`) with a stale comment in the driver copy claiming the dispatcher excludes `'exception'` (it does not).
Risk: shared file N. Tests: `useIdleTimeout` tests in both apps, auth adapter tests, `derive.test.ts` in both. Branches: auth files are shared ground; the rest is low conflict.

**FE-07 · duplication / dead code · High — `frontend/shared/components/blockchain/{BlockchainBadge,EventTimeline}.tsx` have no importer in any of the four apps, while the dispatcher ships diverged forks of both.**
Evidence (reviewer): `grep -rn "@shared/components" frontend --include=*.ts --include=*.tsx` (excluding tests) → nothing; `shared/components/` contains only these two files. `dispatcher/components/blockchain/BlockchainBadge.tsx` (96 lines) vs shared (65): diff 107 lines; `EventTimeline` 104 vs 67: diff 121. The shared badge links to `${HASHSCAN_BASE}/topic/${topic}/${sequence}` (L25-26); the dispatcher badge omits the sequence, so the same receipt links to different HashScan pages. `HASHSCAN_BASE = process.env.NEXT_PUBLIC_HEDERA_HASHSCAN_BASE ?? 'https://hashscan.io/testnet'` is declared four times (`dispatcher/components/blockchain/BlockchainBadge.tsx:20`, `ChainReceiptTag.tsx:6`, `dispatcher/lib/format/hashscan.ts:2-5` as `hashscanTopicUrl`, `shared/components/blockchain/BlockchainBadge.tsx:18`).
Proposal: delete the two shared components (or replace them with the dispatcher versions if the receiver or client-portal will render receipts); move `hashscanTopicUrl` to `shared/lib/utils/hashscan.ts` and make the other three use it, deciding whether the sequence number belongs in the link.
Risk: shared file N. Tests: dispatcher `BlockchainBadge`/`EventTimeline` tests exist; nothing tests the shared copies. Branches: none import them, so no conflict.

**FE-08 · duplication · Low — types re-declared outside `shared/` that `shared/` already exports.** `ArtifactType` (`driver-pwa/lib/api/artifacts.ts:13` = `shared/lib/types/evidence.ts:7`); `SealNumberSource` (`driver-pwa/lib/ocr/sealSource.ts:6` = `shared/lib/types/driver-substitution.ts:292`; the local comment saying shared is unchanged is stale); `DriverUser = Driver` in both apps' `lib/types/user.ts`, and the dispatcher copy appears unused. Proposal: import from shared, delete the copies. Risk: none.

**FE-09 · duplication · Low — UI primitives.** `EmptyState`, `Spinner`, `Skeleton` differ only in the `cn` import path and token names (diff 14 / 8 / 16 lines); the other ten same-named primitives (`Button`, `Card`, `Chip`, `Drawer`, `IconButton`, `Input`, `Modal`, `Switch`, `TextArea`, `Toast`) are intentionally diverged (driver uses cva/Radix/forwardRef per its overhaul notes). Proposal: nothing until the two token vocabularies (`surface-*` vs shadcn `muted/accent/foreground`, see `globals.css` and both `tailwind.config.ts`) are reconciled; then the three near-identical ones can move to `shared/components/ui/`. Risk: design decision, not a move.

**FE-10 · duplication · Low — behaviourally different twins.** (Itemised in §B.6 as FE-38 to FE-40.) `cn()`: `shared/lib/utils/cn.ts:3` joins truthy classes; `driver-pwa/lib/utils.ts:20` is `twMerge(clsx(...))` with a custom font-size group, so the same class string can resolve differently per app. Three private `when(iso)` formatters inside the dispatcher (`components/trips/{AuditPacksPanel.tsx:43, DriverSubstitutionPanel.tsx:43, LateDriverEvidencePanel.tsx:16}`) use the viewer's timezone while `shared/lib/utils/datetime.ts` pins SAST; `driver-pwa/lib/utils/format-time.ts` also does not pin SAST. `ToastKind`/`ToastData`/`MAX_TOASTS = 3` declared in both apps. Proposal: `when` → `fmtDateTime` from shared; decide one `cn`; types to `shared/lib/types/toast.ts`.

### B.4 Shared alias use

Covered in B.2 (Pass). Additional notes: `shared/` imports itself via `@shared/` (19 imports) and relies on each app's alias config; it imports no app code and no vendor packages in the files searched. `status-meta.ts` exists in both apps as a one-line `export * from '@shared/lib/constants/status-meta'` shim, which is correct re-export use, not duplication.

### B.5 Frontend size findings (proposals)

**FE-11 · size / mixed-purpose · High — `driver-pwa/.../PhaseStepPageClient.tsx` (766) carries a 355-line controller hook, six step wrappers and the step router in a page-client file, and its arrival/location-check/submission logic is re-implemented in `InTransitPageClient.tsx` (551).**
Proposal: `lib/hooks/usePhaseStepController.ts` (L305-660), `components/phase/steps/{Activation,Loading,Departure,Arrival,Unloading,Confirmation}Step.tsx` + `PhaseStepRouter.tsx` (L274-297, L663-766), and one `useLocationCheckedSubmit` hook used by both page clients; the page client keeps the trip gate and the URL-vs-ledger guard (L98-253).
Risk: shared file N. Tests: four `PhaseStepPageClient*.test.tsx`, `InTransitPageClient.test.tsx`. Branches: driver-pwa phase flow is Ciaran's current area (`c7412e9`); coordinate with whoever holds in-transit.

**FE-12 · size / naming · High — `driver-pwa/lib/hooks/useOfflineQueue.ts` (751) is an offline engine named as a hook.**
Evidence: module-scope external store, rate-limit scheduling, send path, two flush engines and migrations occupy L83-490; the hook itself is L498-751 with a 90-line `submitExceptionReport` (L605). The graph's "offline replay evidence-loss cluster" hyperedge ties earlier review and security findings to this file, so it is also the most regression-sensitive file in the PWA.
Proposal: `lib/offline/queue-engine.ts` (store + flush + migrations), `lib/offline/exception-submit.ts`, and a thin `useOfflineQueue` over `useSyncExternalStore`. Pure move, with the two existing test files (`useOfflineQueue.test.ts`, `useOfflineQueue-actor-lock.test.ts`) run unchanged first.
Risk: shared file N. Branches: offline queue has had security fixes from more than one branch; single-owner PR.

**FE-13 · size / mixed-purpose · Medium — `driver-pwa/lib/context/TripContext.tsx` (588) mixes trip state, polling, handover, exception logging and seven demo-mode branches on `mockTrips`.**
Evidence: `import { mockTrips } from '@shared/lib/mocks/trips'` L9 with branches at L185, 250, 267, 303, 332, 427, 503; `logException` L460-564. Mock imports in production code (prior audit §7) persist in 7 driver-pwa files: `TripContext.tsx`, `trips/[id]/page.tsx:3`, `TripDetailPageClient.tsx:4`, `lib/hooks/useMyTrips.ts:8`, `lib/auth/DemoDriverProfileSource.ts:1`, `lib/utils/precinct-name.ts:1`, `lib/utils/directions.ts:2`.
Proposal: `lib/exceptions/build-report.ts` for `logException`'s payload normalisation; a `TripSource` port (like `DriverProfileSource`) with API and demo adapters so `TripContext` stops branching on `IS_DEMO_MODE`; polling stays in `useTripAutoRefresh`.
Risk: shared file N. Tests: four `TripContext*.test.tsx`. Branches: driver-pwa owner.

**FE-14 · size · Medium — `SwipeToConfirm.tsx` (608, 36 hook calls, four interaction modes).** Proposal: `useSwipeGesture` (pointer handlers, velocity sampling, spring) + `TapToConfirm.tsx`; the component renders the track. Risk: `SwipeToConfirm.test.tsx`; gesture maths is easy to regress, keep the test first.

**FE-15 · size · Medium — `LogExceptionPageClient.tsx` (578) and `InTransitPageClient.tsx` (551) implement UI inline and own their submission pipelines.** Proposal: `useExceptionReportDraft` + `ExceptionTypePicker`/`ExceptionReportForm`; `ArrivalPanel` + the shared hook from FE-11. Risk: colocated tests; same owner as FE-11.

**FE-16 · size / naming · Medium — three driver-pwa `lib/` files hold mostly non-React logic under hook or API names.** `useSubstitutionCapture.ts` (531; ~340 lines validation/body-building/send engine) → `lib/substitution/{capture,send}.ts` + thin hook. `lib/api/phases.ts` (493) → keep types and the two HTTP calls; move `buildPhaseCompleteRequest` (190-line switch) and artifact-id resolution to `lib/submission/build-phase-request.ts`; remove the demo-mode branch from the API layer (L472). `phase-submitter.ts` (472) is cohesive; optional split into position budget / store / runner. Risk: tests colocated for all three.

**FE-17 · size · Medium — dispatcher pages and components implementing UI inline or mixing pure logic with framework code.** Itemised one file per finding in §B.6 as FE-20 to FE-35.

**FE-18 · size · Low — `frontend/shared/`.** `lib/mocks/driver-substitutions.ts` (689) declares three types (`TripCustodyFields`, `SubstitutionMatrixAction`, `SubstitutionEndpointOutcome`) and an endpoint-outcome matrix inside a mock file; move the types to `lib/types/` and split fixtures by topic. `lib/mocks/trips.ts` (603) is a runtime dependency of the PWA demo path (FE-13); split exception fixtures from trip objects. `lib/types/driver-substitution.ts` (600) is parsed line-by-line by `backend/tests/unit/test_driver_substitution_schemas.py`, so any split (`types/late-evidence.ts` for L292-455, L512-528) must update that test in the same PR. `lib/types/fleet-analytics.ts` (368) is pure types; leave.

**FE-19 · doc-drift · Low — two frontend apps are not in `CLAUDE.md`.** `frontend/client-portal/` (39 `.ts/.tsx` files) and `frontend/receiver/` (16) exist beside `dispatcher/` and `driver-pwa/`; `CLAUDE.md` L118 names only the latter two. `client-portal` imports `@shared` 0 times and has its own `lib/api.ts`; `receiver` imports it once. Out of this pass's scope; flag for the `CLAUDE.md` PR and for FE-05.

### B.6 Itemised frontend findings (unbundled from FE-06, FE-10 and FE-17, plus items not previously listed)

Dispatcher files (one per finding; all have a colocated test unless stated; shared file N for all):

**FE-20 · size · Low (dev-only) — `dispatcher/components/dev/AllControls.tsx` (930).** One component, ~16 `useState` slices, a ~395-line return (L535-930) with six sections (scan target L544, move truck L569, move relative to stop L626, scan feed L683, PP lifecycle L786, exceptions L834) plus a confirm modal; render-phase prop-change resets (`resetForTripId` L268, `resetForKey` L325). Proposal: `ScanTargetPanel`, `MoveTruckPanel`, `ScanFeedPanel`, `PpLifecyclePanel`, `ExceptionPanel` under `components/dev/`; barcode-tick state and `buildScanOptions`/`buildWaybillBreakdown` into `lib/dev/`. Test: `components/dev/__tests__/AllControls.test.tsx`. Branch: demo owner.

**FE-21 · mixed-purpose · Medium — `components/map/LocationComparisonMap.tsx` (668) and `GeofenceMap.tsx` (420) mix pure geometry with Leaflet effect code, and share infrastructure through a component file.** `comparisonBounds` L156, `boundaryBox` L124, `padIfDegenerate` L110, `initialCenter` L210, `markerIconHtml` L250 are pure; `attachTileFailureTracking` is exported from `GeofenceMap.tsx:77` and imported by `LocationComparisonMap.tsx:24`; `GeofenceMap` has 23 hook calls (9 refs, 5 states, 9 effects). Proposal: `lib/map/{fit,marker-html,tile-fallback}.ts` and a `useLeafletBase` hook (init, tile source switch, failure fallback, retry) used by both. Tests: `components/map/__tests__/{LocationComparisonMap,GeofenceMap}.test.tsx`. Branch: precinct/geofence owner.

**FE-22 · mixed-purpose · Medium — `app/(app)/trips/new/page.tsx` (506) owns submission and timeout recovery.** `attemptCreate` L191, `submitManifest` L205, `submitEmptyLeg` L253 call `createTrip`, `createTripFromPPManifest`, `findLiveTripForManifest` from `lib/api/client` and classify failures (~125 lines L205-330); `NoticeBanner` L468 and `StepSection` L492 are presentational. The JSX already composes `components/trips/new/*`. Proposal: `lib/hooks/useTripSubmission.ts`; move the two helpers to `components/trips/new/`. Test: `page.test.tsx`. Branch: Ciaran (manifest-first creation).

**FE-23 · size · Medium — `app/(app)/fleet/vehicles/page.tsx` (456) implements ~250 lines of UI inline, including a ~125-line add-vehicle modal form, and holds sort logic.** `sortVehicles` L37 (five-way switch), five filter/sort states L101-105, `api.post` L183, modal L330-456. Proposal: `components/vehicles/{VehicleFilters,AddVehicleModal}.tsx` (modal owns its form state and submit); `sortVehicles` to `lib/vehicles/sort.ts`. Test: `page.test.tsx`.

**FE-24 · duplication / size · Medium — `app/(app)/fleet/vehicles/[id]/page.tsx` (365) and `fleet/drivers/[id]/page.tsx` (334) are structural near-duplicates.** Both: load via `use*Detail`, edit-mode form + validation + `api.patch` (L179 / L162), `useResizablePanel`, history/analytics `Tabs`, receipt block with `ForensicOnly` + `BlockchainBadge`, ~160-175 lines inline. Proposal: one `DetailSplitLayout` and a `useEntityEdit<T>` hook; `VehicleEditForm`, `DriverEditForm`, `VehicleInfoPanel`, `DriverInfoPanel` components. Tests: both `page.test.tsx`. Branch: fleet owner (Tim merged fleet analytics; check).

**FE-25 · mixed-purpose · Medium — `app/(app)/exceptions/page.tsx` (409) holds ~170 lines of view-state logic before composed JSX.** URL↔state sync L108-143, queue/history selection and owner partition L133-174, presets L193-203, search debounce L139-143, restoration/columns/groups L227-242. Proposal: `lib/hooks/useExceptionListView.ts`; `ExceptionsLoadError` to `components/exceptions/`. Test: `page.test.tsx`. Branch: exceptions inbox owner (FP-280).

**FE-26 · mixed-purpose · Medium — `app/(app)/exceptions/[id]/page.tsx` (386) owns the review draft, claim/release/review calls and a ResizeObserver layout decision.** `runClaimAction` L227, `handleReview` L247 (`reviewException` L256), draft `beforeunload` guard L134-138, `assessmentFits` L123-131. Proposal: `useExceptionReview` hook; `ExceptionContextGrid` component for the eight `ContextItem`s. Test: `page.test.tsx`.

**FE-27 · mixed-purpose · Medium — `components/precincts/PrecinctForm.tsx` (503) mixes form state, geocode side effects, map wiring and submission.** Overpass lookup with `AbortController` L195-237, address select L257, `handleSubmit` L267 with `api.patch` L300 / `api.post` L304, ~185-line JSX L317-503. Proposal: `usePrecinctForm` (state, validation, submit) + `useOutlineCandidates` (Overpass, abort, status). Test: `components/precincts/__tests__/PrecinctForm.test.tsx`.

**FE-28 · size · Medium — `components/trips/TripExceptionsPanel.tsx` (365) is four unnamed sub-components plus DOM-querying focus code.** `renderException` L233, `renderCompact` L317, `renderRow` L335, `renderRecords` L339 as closures; `document.querySelector` L112; exported filter/sort types and constants alongside the component. Proposal: `ExceptionRecordsControls`, `ExceptionCard` (with the collapse handlers), `ExceptionCompactRow`; a ref instead of the DOM query; types to `components/trips/exception-records.types.ts`. Test: `TripExceptionsPanel.test.tsx`.

**FE-29 · mixed-purpose · Low — `components/blockchain/VerifyButton.tsx` (325) combines the API call, a request-version guard, timers, focus management and three render states.** `verify` L130 with `api.post` L140, `requestVersion` L103, `resetTimer` L104, three focus refs L105-110, `MismatchReport` L38-97. Proposal: `useVerifyIntegrity` hook + `VerifyButtonView`; `MismatchReport.tsx`. Test: `VerifyButton.test.tsx`.

**FE-30 · naming / mixed-purpose · Low — `components/parcels/trace-display.ts` (345) is a `.ts` file exporting a component.** `Heading` L19 via `createElement`; label maps L23-57 (copy); derivation L62-341. Proposal: `lib/parcels/{labels,steps,status}.ts` and `components/parcels/Heading.tsx`. Test: `trace-display.test.ts`.

**FE-31 · naming · Low — `lib/types/dev.ts` (345) holds runtime constants, UI labels and a predicate in a types file.** `CLOSED_PHASE_STATUSES` L24 (ST-42), `isClosedPhaseStatus` L30, `DEMO_EXCEPTION_TYPES` L168, `SCENARIO_LABELS` L227. Proposal: `lib/constants/dev.ts` for the runtime values; `types/dev.ts` keeps types only. Tests: imported by four test files.

**FE-32 · placement · Low — `components/layout/Sidebar.tsx` (366) keeps navigation data inline with four components.** `NAV_GROUPS` L36, `CREATE_TRIP_ITEM` L30, `SETTINGS_ITEM` L76, `isActive` L82. Proposal: `lib/constants/nav.ts`. Test: `components/layout/__tests__/Sidebar.test.tsx`.

**FE-33 · mixed-purpose · Low — `lib/phase/location-evidence.ts` (333) ends with map-framing geometry.** `validFixCoords` L273, `validBoundary` L286, `boundaryDistanceMetres` L303, `boundaryIsNearby` L316, `boundaryInDefaultFrame` L328, `BOUNDARY_NEARBY_METRES` L268 are presentation-side; L17-260 is evidence derivation. Proposal: move L268-333 to `lib/map/framing.ts` (pairs with FE-21). Test: `location-evidence.test.ts`.

**FE-34 · mixed-purpose · Low — `components/map/LocationComparisonSchematic.tsx` (422) computes projection, extent fit and label placement inline (~70 lines of maths).** `project` L85, `labelPlacement` L97, `buildAriaLabel` L122, extent fit L150-215. Proposal: a pure `layoutComparison(evidence, size)` returning positions, tested without the DOM; the component draws it. Test: `__tests__/LocationComparisonSchematic.test.tsx`.

**FE-35 · size · note — fleet analytics tab files and copy are single-purpose.** `RoutesTab.tsx` 451 (four cards; `IncidentsCard` L303 is the only stateful one), `CostTab.tsx` 423, `ProblemsTab.tsx` 412 (`pivotByType` L201), `OnTimeTab.tsx` 313, `copy.ts` 491 (one `as const` object with pluralisation lambdas). Proposal: per-card files only if they grow; `pivotByType` to `lib/analytics/format.ts`. No action needed.

Dispatcher rule residue:

**FE-36 · rule · Low — 26 dispatcher components are "borderline" `'use client'`: no hook, handler, browser API or client import of their own, only an `onX` prop forwarded.** `components/ui/{Button,IconButton,LinkButton,BackButton,ListToolbar}.tsx`, `components/domain/{ArrivalDetail,ConfirmationDetail,DepartureDetail,LoadingDetail,ExceptionRowList,ManifestPanel,PhaseActRow}.tsx`, `components/exceptions/ExceptionGroupHeader.tsx`, `components/trips/{DriverModal,LateEvidenceDetail,PhaseEvidence,PrecinctModal,TimelinePhase,TripDetailSkeleton,VehicleModal}.tsx`, `components/trips/new/{CreateTripSummary,ManifestWarnings}.tsx`, `components/analytics/SummaryParts.tsx`, `components/analytics/fleet/FleetTiles.tsx`, `components/analytics/fleet/controls/{EventSwitch,GrainToggle}.tsx`. `Button` and `IconButton` only spread `{...props}` onto `<button>`. Proposal: leave them; a primitive that forwards handlers is conventionally client, and the directive costs nothing while every importer is client (FE-01). Revisit only if option (b) of FE-01 is taken.

**FE-37 · duplication · Low — `useAuth.ts` and `useToast.ts` are byte-identical across the apps (diff 0) and follow the same "required context" pattern.** `dispatcher/lib/hooks/{useAuth,useToast}.ts`, `driver-pwa/lib/hooks/{useAuth,useToast}.ts`. They import app-local contexts, so they cannot move as-is. Proposal: `shared/lib/utils/createRequiredContextHook.ts` and two-line hooks per app. Risk: none.

**FE-38 · duplication / consistency · Low — ad-hoc date formatting bypasses `shared/lib/utils/datetime.ts` and drops the SAST pin.** Three private `when(iso)` copies in the dispatcher (`components/trips/AuditPacksPanel.tsx:43-45`, `DriverSubstitutionPanel.tsx:43-45`, `LateDriverEvidencePanel.tsx:16-18`: `new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })`, viewer timezone); local SAST formatters in `dispatcher/lib/trips/manifest-form.ts` (8 matching lines) and `lib/format/sast.ts` (6); `driver-pwa/lib/utils/format-time.ts` (`formatTime`/`formatDateTime`/`formatDate`) uses device-local `en-ZA` while shared `fmtTime`/`fmtDateTime` pin `Africa/Johannesburg` and append "SAST". Proposal: `when` → `fmtDateTime`; decide whether the driver app intentionally shows device-local time (a driver is in SA, so it is usually the same, but not on a roaming device) and document it in `format-time.ts`. Risk: snapshot tests that pin formatted strings.

**FE-39 · duplication / consistency · Low — `cn()` has two behaviours.** `shared/lib/utils/cn.ts:3` joins truthy classes; `driver-pwa/lib/utils.ts:20` is `twMerge(clsx(...))` with a custom `font-size` class group from `TYPE_ROLES`, so `cn('p-2', 'p-4')` yields both classes in the dispatcher and only `p-4` in the driver app. The dispatcher imports the shared one in every `components/ui` file. Proposal: either add `tailwind-merge` to the shared `cn` (the driver's type-role registration would need injection) or rename the driver helper `twcn` so the difference is visible at call sites. Risk: a behaviour change for the dispatcher if merged; design decision.

**FE-40 · duplication · Low — toast types and provider constants.** `ToastKind`, `ToastData`, `MAX_TOASTS = 3` in `dispatcher/components/ui/Toast.tsx:7,13` + `lib/context/ToastContext.tsx:16` and `driver-pwa/components/ui/Toast.tsx:7,9` + `lib/context/ToastContext.tsx:17`; providers differ (dispatcher: timers and priority eviction; driver: last three). Proposal: `shared/lib/types/toast.ts` (types + constant only). Risk: none.

**FE-41 · duplication · Low — phase "resolved / current phase" derivation duplicated with a stale comment.** `dispatcher/lib/phase/derive.ts:28-41` (`RESOLVED`, `isResolved`, `sortedPlan`, `activePhase`) and `driver-pwa/lib/phase/derive.ts:14-30` (`RESOLVED_STATUSES`, `isResolved`, `bySequence`, `currentPhase`): same list, same sort, same `.find(!isResolved) ?? null`; the driver comment claims the dispatcher excludes `'exception'`. Proposal: `shared/lib/phase/derive.ts` (pairs with ST-42). Tests: both `derive.test.ts`.

**FE-42 · duplication (by design, documented) · note — `shared/lib/types/driver-substitution.ts:292-405` mirrors the driver app's phase/checkpoint/location/exception request bodies as `*Payload` types because shared cannot import from the app.** `driver-pwa/lib/api/phases.ts:21-125` declares `LoadingCompleteRequest` etc.; shared declares `LoadingCompletePayload` etc. with the same fields, and both mirror `backend/app/schemas/phases.py`. Proposal: move the request types *down* into `shared/lib/types/phase-requests.ts` and have `driver-pwa/lib/api/phases.ts` import them, so there is one TS mirror of the backend contract; keep the backend drift test pointed at the shared file. Risk: `backend/tests/unit/test_driver_substitution_schemas.py` parses the shared file; update it in the same PR.

**FE-43 · placement · Medium — mock data is imported by seven production driver-pwa modules and by a static-export route.** `lib/context/TripContext.tsx:9`, `app/(app)/trips/[id]/page.tsx:3` (`generateStaticParams` from `mockTrips`, so the exported route list is mock-defined; `next.config.ts:59` comment acknowledges it), `app/(app)/trips/[id]/TripDetailPageClient.tsx:4`, `lib/hooks/useMyTrips.ts:8`, `lib/auth/DemoDriverProfileSource.ts:1` (the one correct place: a demo adapter), `lib/utils/precinct-name.ts:1`, `lib/utils/directions.ts:2`. The 2026-10-06 audit §7 flagged this; still open. Proposal: a `TripSource` port with `ApiTripSource` and `DemoTripSource` (like `DriverProfileSource`), so only `lib/auth/Demo*.ts` and `lib/demo/*` import `@shared/lib/mocks`; `precinct-name`/`directions` take precincts as parameters. Risk: four `TripContext*.test.tsx`, `trips/[id]` tests; driver-pwa owner.

**FE-44 · placement · Low — a demo-mode branch in the API layer.** `driver-pwa/lib/api/phases.ts:472` (`submitPhase`) short-circuits on `IS_DEMO_MODE`. Proposal: the demo adapter of FE-43 handles it; the API module stays pure. Risk: `lib/api/__tests__/phases.test.ts`.

**FE-45 · size · Low — `driver-pwa/components/trip/DriverSubstitutionFlow.tsx` (439) carries three sub-components (~235 lines).** `DeclarationSummary` L62, `SealCheckFields` L102, `CaptureForm` L182. Proposal: `components/trip/substitution/`. Test: `__tests__/DriverSubstitutionFlow.test.tsx`.

**FE-46 · size · Low — `driver-pwa/components/map/DriverMap.tsx` (424) bundles two fallback cards with the Maps loader and theme helpers.** `CoordinatesCard` L120, `NoFixPanel` L186, `applyMapsOptions` L69, `themedMapStyles` L90. Proposal: `DriverMapFallback.tsx`; loader/theme helpers to `lib/map/`. Test: `__tests__/DriverMap.test.tsx`.

**FE-47 · size · Low — `driver-pwa/lib/submission/phase-submitter.ts` (472) holds four concerns that are cohesive around background submission.** GPS budget L58-103, outcome/request types L104-192, module store + hook L194-292, runner L310-431, dedupe L432-472. Proposal: optional `position-budget.ts` and `submission-store.ts`; the three existing tests already split along these lines. Low value; leave unless touched.

**FE-48 · naming · Low — `driver-pwa/lib/offline/late-evidence-sync.ts` (302) is a network sync driver under `offline/` and builds requests by importing the phase builder.** `buildReport` L96-182 imports `buildPhaseCompleteRequest` from `lib/api/phases.ts`; `sendLateEvidence` L219-302. Proposal: `lib/submission/late-evidence.ts` next to `phase-submitter.ts`, with the builder moved per FE-16. Test: `late-evidence-sync.test.ts`.

**FE-49 · size / consistency · Low — the driver app keeps two parallel colour-token vocabularies, mirrored in its Tailwind config, and shares no hex value with the dispatcher.** `driver-pwa/app/globals.css` (410): `--fp-*` RGB channels L26-198 and shadcn HSL tokens L219-290, light/dark/contrast each; `tailwind.config.ts` (363) maps both (~170 lines L32-199); `dispatcher/tailwind.config.ts` (160) + `globals.css` (53) use `surface-*` names; `shared/lib/tokens.ts` (47) holds only chart/map colours. The subagent found zero shared hex values between the two configs. This is the root reason FE-09's primitives cannot be lifted. Proposal: a design decision (one token vocabulary in `shared/lib/tokens.ts` driving both configs), not a file move. Risk: visual regression across both apps; outside this pass to judge.

**FE-50 · placement · Low — test and design fixtures live under `components/` and `app/`.** `dispatcher/components/domain/__fixtures__/phase-acts.ts` (896 lines, the largest non-test file in the tree by line count, with its own `phase-acts.test.tsx`); `dispatcher/app/dev/design/_timeline-scenarios/{ScenarioView,TimelineScenarios,frame}.tsx` (design preview under an `app/` route). Both are excluded from the build by Next's `_`/`__` conventions, but they count toward `components/` and `app/` size and show up in greps. Proposal: `dispatcher/test/fixtures/phase-acts.ts` and keep the design route (it is a deliberate dev page). Risk: fixture import paths in tests.

**FE-51 · duplication (by design) · note — exception-type label maps differ in wording on purpose.** `dispatcher/lib/format/exception.ts:14 EXCEPTION_TYPE_LABELS` (title-casing plus six overrides) vs `driver-pwa/app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx:30 EXCEPTION_LABELS` (five driver-friendly labels, e.g. `mechanical` → "Vehicle breakdown" vs "Mechanical"). Not a duplicate; recorded so nobody "unifies" it without product input.

**FE-52 · duplication (by design) · note — `driver-pwa/lib/types/location.ts DriverPosition` overlaps `shared/lib/types/position.ts PositionFix`.** Shared's comment says the overlap is deliberate. No action.

**FE-53 · naming · Low — `attachTileFailureTracking` is infrastructure exported from a component file.** `dispatcher/components/map/GeofenceMap.tsx:77`, imported by `LocationComparisonMap.tsx:24`. Covered by FE-21's `lib/map/tile-fallback.ts`.

**FE-54 · duplication · Medium — the Supabase auth adapters share five identical method bodies.** `dispatcher/lib/auth/SupabasePasswordAuth.ts:14-45` and `driver-pwa/lib/auth/SupabaseOtpAuth.ts:8-40`: `toSession`, `toEvent`, `getSession`, `onChange`, `signOut` diff to 0 lines; both declare `type SupabaseAuthClient = Pick<SupabaseClient, 'auth'>`. Proposal: `shared/lib/auth/supabase-base.ts` implementing `AuthPort` from `shared/lib/auth/port.ts`; each app adds `signInWithPassword` or `requestOtp`/`verifyOtp`. Risk: `shared/` would import `@supabase/supabase-js` *types*, which `port.ts`'s header avoids; both apps already depend on the package, so this is a documented exception rather than a new dependency. Tests: both adapter tests.

**FE-55 · duplication · Low — the Supabase client module with a synchronous access-token cache is written twice.** `dispatcher/lib/supabase/client.ts:34-53` and `driver-pwa/lib/supabase.ts:13-36`: `let cachedAccessToken`, `onAuthStateChange` listener, `cachedAccessToken ??= session?.access_token ?? null`, with the same comment about the `getSession` auth lock. Proposal: `shared/lib/supabase/token-cache.ts`; apps keep their `createClient` options (`fetchWithTimeout`, placeholder env fallbacks). Risk: none.

**FE-56 · duplication · Low — `isRecord` type guard ×3.** `dispatcher/lib/api/json.ts:2`, `driver-pwa/lib/offline/queue-storage.ts:158`, `driver-pwa/lib/offline/retained-drafts.ts:48`, all `typeof value === 'object' && value !== null && !Array.isArray(value)`. Proposal: `shared/lib/utils/is-record.ts`. Risk: none.

**FE-57 · duplication · Low — `SUPPRESS_RETURN_SAVE_KEY = 'fp:suppress-return-save'` in both `AuthContext.tsx` files (dispatcher L25, driver L30) with the same comment; `AUTH_ROUTE_PREFIXES` pattern likewise (L17 / L22).** Proposal: `shared/lib/session/return-path.ts` already owns `RETURN_PATH_KEY`; add this key beside it. Risk: none.

**FE-58 · duplication · Low — `initialsOf(fullName)`.** `dispatcher/lib/format/dispatcher-identity.ts:13` (accepts `undefined`, returns `FALLBACK_INITIALS`) and `driver-pwa/components/profile/DriverAvatar.tsx:4` (returns `''`). Proposal: `shared/lib/utils/initials.ts` with a `fallback` parameter. Risk: none.

**FE-59 · duplication · Low — `truncateHash`.** `dispatcher/components/blockchain/BlockchainBadge.tsx:23` (cut-off 20) and `driver-pwa/components/blockchain/AnchorProgress.tsx:30` (cut-off 16); same `${slice(0,8)}…${slice(-8)}` output. Proposal: `shared/lib/utils/hash.ts`, one cut-off. Risk: snapshot text in badge tests if the cut-off changes.

**FE-60 · duplication / consistency · Low — two `haversineMetres` with different earth radii.** `dispatcher/lib/phase/geo.ts:13,20` (6 371 008.8; also `lib/map/polygon.ts:13`) and `driver-pwa/lib/route/eta.ts:19,49` (6 371 000; clamps `Math.min(1, …)`); coordinate shapes differ (`{lat,lng}` vs `[lat,lng]`). The backend uses one `EARTH_RADIUS_METRES` in `core/geo.py:15`. Proposal: `shared/lib/utils/geo.ts` with the backend's radius so distance comparisons agree across the three codebases. Risk: `geo.test.ts`, `eta.test.ts` tolerances.

---

## Part C — Priority table (every finding, highest first)

Shared: Y = one of the `CLAUDE.md` shared files is touched (`main.py`, `config.py`, `db/models/__init__.py`, `requirements.txt`, `package.json`, `docker-compose.dev.yml`, `CLAUDE.md`). "contract" = `backend/.importlinter` needs an edit (team-owned, not on the shared list).

| ID | Pri | Category | Where | Proposal (one line) | Shared | Tests | Branch conflict |
|---|---|---|---|---|---|---|---|
| ST-01 | High | duplication | 7 + 9 hashing copies outside `crypto/` | `crypto/hashing.py` owns `canonical_sha256`/`sha256_hex`; all others import | N | B3 golden hashes, anchor tests | all |
| ST-02 | High | mixed-purpose | `blockchain/anchor_service.py`, `subject_visibility.py` | receipt persistence + visibility → `orchestration/`; `blockchain/` keeps transport | contract | ~25 anchor/verify tests | all; team decision |
| ST-15 | High | duplication | 16 endpoint files, 48 `except ResourceNotFoundError` | central handlers in `api/v1/http_errors.py` | **Y** `main.py` | all endpoint tests, B1/B2 | all |
| FE-05 | High | duplication | 4 API clients | `shared/lib/api/` transport pieces | N | 4 client tests | all |
| FE-07 | High | dead code | `shared/components/blockchain/*` | delete or promote; one `hashscanTopicUrl` | N | dispatcher badge tests | none |
| FE-11 | High | size | `PhaseStepPageClient.tsx` | controller hook + step components + shared submit hook | N | 5 tests | driver-pwa |
| FE-12 | High | size/naming | `useOfflineQueue.ts` | `lib/offline/queue-engine.ts` + thin hook | N | 2 tests | security-sensitive |
| ST-03 | Med | mixed-purpose | `endpoints/handover.py` | three router modules; cookie policy to service | **Y** `main.py` | handover/receiver tests | receiver owner |
| ST-04 | Med | layering | `endpoints/phases.py:52` | `_stop_sequence_map` → `phases/queries.py` | N | `test_phases.py` | low |
| ST-06 | Med | mixed-purpose | `trips/creation.py::persist_trip` | three private steps | N | creation tests | Ciaran |
| ST-07 | Med | size | `audit_packs/builder.py` | `graph.py` loader tier | contract | 5 audit tests | Tim |
| ST-08 | Med | size | `substitutions/service.py` | idempotency / lifecycle / completion | N | 11 tests | FP-83 |
| ST-09 | Med | size | `handover/receiver_verification.py` | identity / consent / webhook modules | contract | 8 tests | receiver |
| ST-10 | Med | size | `evidence/action_location.py` | `location_findings.py` | contract | 6 tests | evidence |
| ST-13 | Med | size/mixed | `schemas/{audit_pack,driver_substitutions,trips}.py` | split; `schemas/custody.py` breaks the cycle; status table → `custody_errors.py` | N (`schemas/__init__`) | schema unit tests, B1 | FP-83, Tim |
| ST-14 | Med | naming/doc | `db/models/*` | rule → "per aggregate"; move `DriverSubstitution` | **Y** `CLAUDE.md`, `db/models/__init__.py` | model tests | all |
| ST-16 | Med | duplication | 11 org-scoped Trip loads | `trips/scope.py::get_org_trip` | contract (tier) | broad | all |
| ST-17 | Med | duplication | 8 timezone constructions, 3 `sast_date` | `core/time.py` | N | periods/availability/history | analytics, substitutions |
| ST-21 | Med | naming | ~45 underscore cross-imports | rename to public | N | B8 patch scanner | phases shared |
| ST-25 | Med | doc-drift | `CLAUDE.md` architecture + layering | match contract 1; add `reporting` to the contract | **Y** + contract | — | none |
| ST-42 | Med | duplication (cross-stack) | resolved-status set ×5 | public `phases/state.is_resolved`; `shared/lib/phase/status.ts`; mirror test | N | phase + derive tests | phases, both apps |
| FE-01 | Med | rule/doc | 21 dispatcher pages + layout | decide: (a) amend rule or (b) page/PageClient split | **Y** (a) | 22 page tests (b) | all (b) |
| FE-06 | Med | duplication | see FE-41, FE-54 to FE-60 | lift to `shared/lib/` | N | hook/adapter tests | auth shared |
| FE-13 | Med | size/placement | `TripContext.tsx` | exception builder + `TripSource` port | N | 4 tests | driver-pwa |
| FE-14 | Med | size | `SwipeToConfirm.tsx` | `useSwipeGesture` + `TapToConfirm` | N | 1 test | driver-pwa |
| FE-15 | Med | size | `LogExceptionPageClient`, `InTransitPageClient` | draft hook + form components; `ArrivalPanel` | N | 2 tests | driver-pwa |
| FE-16 | Med | size/naming | `useSubstitutionCapture.ts`, `lib/api/phases.ts`, `phase-submitter.ts` | non-React logic to `lib/substitution/`, `lib/submission/` | N | 3 tests | driver-pwa |
| FE-21 | Med | mixed-purpose | `LocationComparisonMap.tsx`, `GeofenceMap.tsx` | `lib/map/*` + `useLeafletBase` | N | 2 tests | precincts |
| FE-22 | Med | mixed-purpose | `trips/new/page.tsx` | `useTripSubmission` | N | 1 test | Ciaran |
| FE-23 | Med | size | `fleet/vehicles/page.tsx` | `VehicleFilters` + `AddVehicleModal` | N | 1 test | fleet |
| FE-24 | Med | duplication/size | `fleet/{vehicles,drivers}/[id]/page.tsx` | `DetailSplitLayout` + `useEntityEdit` | N | 2 tests | fleet |
| FE-25 | Med | mixed-purpose | `exceptions/page.tsx` | `useExceptionListView` | N | 1 test | FP-280 |
| FE-26 | Med | mixed-purpose | `exceptions/[id]/page.tsx` | `useExceptionReview` + `ExceptionContextGrid` | N | 1 test | FP-280 |
| FE-27 | Med | mixed-purpose | `PrecinctForm.tsx` | `usePrecinctForm` + `useOutlineCandidates` | N | 1 test | precincts |
| FE-28 | Med | size | `TripExceptionsPanel.tsx` | three components; ref instead of DOM query | N | 1 test | trips |
| FE-43 | Med | placement | 7 driver-pwa modules importing mocks | `TripSource` port with demo adapter | N | TripContext tests | driver-pwa |
| FE-54 | Med | duplication | Supabase auth adapters | `shared/lib/auth/supabase-base.ts` | N (documented type import) | 2 adapter tests | auth shared |
| ST-05 | Low | mixed-purpose | `dev/endpoints/{triggers,pulsit}.py` | read model → `dev/services`; fix docstring | N | dev tests | demo |
| ST-11 | Low | size/dup | `audit_packs/{access,lifecycle}.py` | one PDF-rehash; `public_access` / `live_verify` | contract | 3 tests | Tim |
| ST-12 | Low | size | `phases/findings.py` | per-finding modules | contract | 3 tests | phases |
| ST-18 | Low | duplication | keyset pagination ×3 | `core/pagination.py` helpers + size constants | N | 3 tests | low |
| ST-19 | Low | duplication | schema validators ×14 | `schemas/validators.py` | N | validator tests | low |
| ST-22 | Low | placement | `core/{demo_waypoints,realtime}.py` | `dev/`; own package | N | low | low |
| ST-23 | Low | naming | `integrations/{pulsit,idvs}.py` | packages mirroring `parcel_perfect/` | contract (new tiers) | 16 tests | low |
| ST-24 | Low | naming | (none to fix) | — | — | — | — |
| ST-26 | Low | doc-drift | `CLAUDE.md` L103, L106, L132 | correct crypto, integrations, receiver text | **Y** | — | none |
| ST-27 | Low | doc-drift | 3 docstrings | text fixes | N | — | none |
| ST-28 | Low | duplication | `tasks/*` plumbing | `tasks/_session.py` | N | B6, `test_pp_task` | low |
| ST-29 | Low | duplication | asyncio retain ×3 | `core/background_tasks.py`; use `run_after_outer_commit` | N | 3 tests | phases |
| ST-30 | Low | duplication | `_text` ×2 | import `enum_text` | N | anchor tests | low |
| ST-31 | Low | duplication | admin redaction ×4 | `is_admin_dispatcher` + `include_receipts` flag | N | gating tests | low |
| ST-32 | Low | duplication | precinct-name lookup ×2 | helper below contract 25 | N | analytics tests | low |
| ST-33 | Low | duplication/layering | `PROVIDER_DIDIT` ×2 | `integrations/idvs.py` owns it | N | — | none |
| ST-34 | Low | duplication | `"critical"` literal ×2 | enum value via schema | N | 2 unit tests | Tim |
| ST-35 | Low | duplication | metres-per-degree, distance labels | import from `core/geo.py` | N | `test_route_svg` | Tim |
| ST-36 | Low | decision | 4 UTC-ISO serialisers | keep; document as generations; golden tests | N | — | none |
| ST-37 | Low | duplication | 422 wrappers ×3 | `value_error_as_422()` | N | 3 tests | low |
| ST-38 | Low | duplication | current-driver twin | call `access.current_driver_ids` | N | 2 tests | FP-83 |
| ST-39 | Low | duplication | width constants | import from `schemas/text.py`; rename the 500 | N | `test_input_limits` | low |
| ST-40 | Low | duplication | parallel analytics ratios | one vocabulary when versioned | N | B1 | analytics |
| ST-41 | Low | duplication | `_normalized_seal` twin | call `seals` after `None` check | N | — | none |
| ST-43 | note | cross-stack mirror | `core/phase_meta.py` | none (pattern to copy) | — | — | — |
| ST-44 | Low | mixed-purpose | `auth/dependencies.py` | `auth/jwks.py`, `auth/demo.py`, one loader | N | 3 tests | auth shared |
| ST-45 | Low | mixed-purpose | `endpoints/trips.py` | `trips/queries.crew_availability`; error wrapper | N | 2 tests | low |
| ST-46 | Low | mixed-purpose | `endpoints/audit_packs.py` | services return read models; `pdf_response` helper | N | 2 tests | Tim |
| ST-47 | Low | mixed/naming | `parcel_perfect/client.py` | `parsers.py`; typed errors; instance token | contract (tier) | 2 tests | low |
| ST-48 | Low | naming | PP fixture files | `fixture_common.py`; move `_build_header` | contract (tier) | PP unit tests | low |
| ST-49 | Low | naming | `api/v1/handover_responses.py` | public name; fold into handover public module | N | — | receiver |
| ST-50 | Low | size | `analytics/fleet/cost.py` | `cost_queries.py` + pure `cost.py` | N | `test_fleet_cost` | analytics |
| ST-51 | Low | size | `analytics/fleet/periods.py` | optional `bands.py` | N | 2 tests | analytics |
| ST-52 | Low | size | `substitutions/reads.py` | dispatcher vs driver read modules | N | 3 tests | FP-83 |
| ST-53 | Low | size | `consignments/manifest_import.py` | `manifest_preview.py` | contract (tier) | 2 tests | Ciaran |
| ST-54 | Low | size | `substitutions/anchors.py` | `custody_chain.py` | N | 1 test + conftest | FP-83 |
| ST-55 | Low | size | `evidence/corroboration.py` | extract per-trailer loop | N | 2 tests | evidence |
| ST-56 | Low | size | `audit_packs/analysis.py` | `observations.py` | contract | 1 test | Tim |
| ST-57 | Low | size | `dev/schemas.py` | per-tool package | N | dev tests | demo |
| ST-58 | Low | size | `dev/services/truck.py` | move the one DB read out | N | 2 tests | demo |
| ST-59 | Low | size | `schemas/transit.py` | `checkpoints.py` + exception schemas | N (`schemas/__init__`) | 2 tests | low |
| ST-60 | Low | mixed-purpose | `schemas/phases.py::from_event` | build read model in `phases/queries.py` | N | 2 tests | phases |
| ST-61 | Low | doc-drift | `CLAUDE.md` Testing | add `baseline/`, `fixtures/` | **Y** | — | none |
| ST-62 | note | placement | `schemas/__init__.py` | treat as shared | **Y** (list) | — | — |
| ST-63 | note | size | `core/exceptions.py`, `db/models/enums.py` | optional package | N | — | — |
| ST-64 | note | shared-file | `main.py` | land ST-03 + ST-15 as one PR | **Y** | — | all |
| FE-02 | Low | rule | 24 components | drop unnecessary `'use client'` | N | colocated | low |
| FE-03 | Low | doc-drift | `CLAUDE.md` L68, L118 | state the `generateStaticParams` exception | **Y** | — | none |
| FE-04 | pass | rule | fetch / any / router / env / alias checks | none | — | — | — |
| FE-08 | Low | duplication | `ArtifactType`, `SealNumberSource`, `DriverUser` | import from shared; delete copies | N | — | none |
| FE-09 | Low | duplication | `EmptyState`, `Spinner`, `Skeleton` (+10 diverged) | after FE-49 only | N | — | design |
| FE-10 | Low | duplication | see FE-38 to FE-40 | — | — | — | — |
| FE-17 | Med | size | see FE-20 to FE-35 | — | — | — | — |
| FE-18 | Low | size | `shared/lib/{mocks,types}/*` | split by topic; types out of mocks; update backend drift test | N | backend drift test | FP-83 |
| FE-19 | Low | doc-drift | `client-portal/`, `receiver/` | add to `CLAUDE.md`; include in FE-05 | **Y** | — | none |
| FE-20 | Low | size (dev) | `AllControls.tsx` | five panels + `lib/dev/` | N | 1 test | demo |
| FE-29 | Low | mixed-purpose | `VerifyButton.tsx` | `useVerifyIntegrity` + view | N | 1 test | low |
| FE-30 | Low | naming | `trace-display.ts` | `lib/parcels/*` + `Heading.tsx` | N | 1 test | parcels |
| FE-31 | Low | naming | `lib/types/dev.ts` | `lib/constants/dev.ts` | N | 4 tests | demo |
| FE-32 | Low | placement | `Sidebar.tsx` | `lib/constants/nav.ts` | N | 1 test | low |
| FE-33 | Low | mixed-purpose | `location-evidence.ts` | framing helpers to `lib/map/` | N | 1 test | low |
| FE-34 | Low | mixed-purpose | `LocationComparisonSchematic.tsx` | pure layout function | N | 1 test | low |
| FE-35 | note | size | fleet tabs, `copy.ts` | none | — | — | — |
| FE-36 | Low | rule | 26 borderline components | leave | N | — | — |
| FE-37 | Low | duplication | `useAuth`/`useToast` | `createRequiredContextHook` | N | — | none |
| FE-38 | Low | duplication/consistency | `when()` ×3, local SAST formatters, driver `format-time.ts` | use `shared/lib/utils/datetime.ts`; document driver policy | N | snapshot tests | low |
| FE-39 | Low | consistency | two `cn()` behaviours | one `cn` or a distinct name | N | — | design |
| FE-40 | Low | duplication | toast types | `shared/lib/types/toast.ts` | N | — | none |
| FE-41 | Low | duplication | `derive.ts` ×2, stale comment | `shared/lib/phase/derive.ts` | N | 2 tests | both apps |
| FE-42 | note | by design | shared `*Payload` mirrors | move request types down into shared | N | backend drift test | driver-pwa |
| FE-44 | Low | placement | demo branch in `lib/api/phases.ts` | demo adapter | N | 1 test | driver-pwa |
| FE-45 | Low | size | `DriverSubstitutionFlow.tsx` | `components/trip/substitution/` | N | 1 test | FP-83 |
| FE-46 | Low | size | `DriverMap.tsx` | `DriverMapFallback.tsx`; `lib/map/` | N | 1 test | driver-pwa |
| FE-47 | Low | size | `phase-submitter.ts` | optional split | N | 3 tests | driver-pwa |
| FE-48 | Low | naming | `late-evidence-sync.ts` | `lib/submission/` | N | 1 test | driver-pwa |
| FE-49 | Low | consistency | two token palettes; 0 shared hex | design decision | N | visual | design |
| FE-50 | Low | placement | `__fixtures__` under `components/`; design route | `test/fixtures/` | N | fixture imports | low |
| FE-51 | note | by design | exception label maps | none | — | — | — |
| FE-52 | note | by design | `DriverPosition` vs `PositionFix` | none | — | — | — |
| FE-53 | Low | naming | `attachTileFailureTracking` | in FE-21 | N | — | — |
| FE-55 | Low | duplication | Supabase token cache ×2 | `shared/lib/supabase/token-cache.ts` | N | — | none |
| FE-56 | Low | duplication | `isRecord` ×3 | `shared/lib/utils/is-record.ts` | N | — | none |
| FE-57 | Low | duplication | `SUPPRESS_RETURN_SAVE_KEY` ×2 | `shared/lib/session/return-path.ts` | N | — | none |
| FE-58 | Low | duplication | `initialsOf` ×2 | `shared/lib/utils/initials.ts` | N | — | none |
| FE-59 | Low | duplication | `truncateHash` ×2 | `shared/lib/utils/hash.ts` | N | badge tests | none |
| FE-60 | Low | duplication/consistency | `haversineMetres` ×2, two radii | `shared/lib/utils/geo.ts` with the backend radius | N | 2 tests | low |

## Sequencing note

The freeze (19 Oct to the 22 Oct demo) rules everything above out until after submission. When work resumes: (1) doc-only items first (ST-25, ST-26, ST-27, FE-03, FE-19, and the FE-01 decision) in the one `CLAUDE.md` PR; (2) the zero-conflict deletions and one-liners (FE-07, FE-02, FE-08); (3) the hashing consolidation (ST-01) with golden tests, which unblocks ST-02; (4) the central handlers (ST-15) as a single `main.py` change with B1/B2 snapshots re-run; (5) package splits one at a time, each with its `.importlinter` tier update and `check_structure --update`, following the migration guide's move checklist (no wrappers; retired paths into B8). Every move in (5) should be preceded by a characterisation run of the listed tests on the unchanged code, as the 2026-10-06 audit did.
