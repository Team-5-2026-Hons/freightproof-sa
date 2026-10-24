# Iteration 4 Document vs Codebase: Claim Verification Review

**Document reviewed:** `docs/iteration4/INF4027W_Team05_Iteration4_Document2026.docx` (work in progress)
**Code reviewed:** `origin/dev` at `ba9ecaa` (local `dev` at `7dc61bf` differs only by `backend/railway.json`), plus every remote branch where a feature was missing on `dev`
**Date:** 20 October 2026 (three days before the 23 October submission)
**Method:** Every factual claim about the system was checked against source, migrations, tests, CI config and git history. All checks were read-only. Nothing was run against the shared Supabase database. Jira figures (story points, velocity, sprint dates) cannot be verified from the repository and are listed separately in §9.

---

## 1. Headline findings

| Severity | Count | Meaning |
|---|---|---|
| 🔴 **Not built** | 12 | Written up as delivered, but the code does not exist on `dev` (most items are missing from every branch) |
| 🟠 **Contradicted** | 11 | The code does something different from what the document says |
| 🟡 **Partial or overstated** | 17 | Partly built, or the wording claims more than the code does |
| 🔵 **Wrong or stale numbers** | 9 | Figures that are out of date or incorrect |
| ⚪ **Process claims not supported** | 3 | CI, review and Jira-key claims |

**The most serious items for the marker** (each is claimed as "Done" or "Delivered"):

1. **FP-295 AI insights brief.** Not built anywhere. No LLM provider is called in the codebase; the brief exists only as a reference in a design note.
2. **FP-299 load test.** No load-test script (locust, k6 or similar) exists on any branch, and there are no results. §9.5 says "Done"; §9.3 still has placeholders.
3. **FP-293 opt-in identity check per consignment.** There is no per-consignment flag. Every receiver is sent to the identity consent screen.
4. **FP-297 breakdown naming several vehicles.** There is no `exception_vehicles` table on any branch; an exception links to a single `vehicle_id`.
5. **FP-316 "selfie stored before a selfie-only result".** The code does the opposite: FP-316 *removed* the receiver selfie, and `SELFIE_ONLY` is no longer assigned.
6. **FP-278 real seal formats.** Not built. Backend and driver app still accept only `XX-####` (`backend/app/schemas/phases.py:22`, `frontend/driver-pwa/lib/utils/seal-format.ts:3`).
7. **FP-275 database timeouts.** Not on `dev`. The code is on the unmerged branch `origin/Chiko` (commit `4f3dcf0`).
8. **R-05 "automatic dispatcher alert" for undeliverable offline items.** Not built on any branch, yet Appendix B gives it as the answer to feedback A20.
9. **FP-289 live trip list.** The two key columns, "time since last update" and "latest location check", do not exist, and the API does not supply them.
10. **CI on `dev` has been red on every push since 14 October.** Ruff fails first (`app/orchestration/phases/phase_payloads.py:129`, PLR0915), so pytest and the migration checks never run. The document presents CI as a green gate.
11. **"Drawn signature".** The receiver swipes to confirm. The "signature" is an image the app generates from name, ID, time and position, not something the receiver draws.
12. **FP-273 "the driver cannot close a delivery without the receiver's confirmation".** The server does not check that a receiver confirmation exists for the stop. It only refuses a driver-made signature upload.

---

## 2. 🔴 Claimed as done, but not built

| # | Doc location | Claim | Finding | Evidence | Other branches |
|---|---|---|---|---|---|
| N1 | §3.3 SO-7, §5.3, §8.5, §10.3 (FP-295 "Done"), §10.6, App. C | AI insights brief summarising de-identified analytics | **Not built.** No Anthropic, OpenAI, Gemini or OpenRouter calls in `backend/app` or `frontend/dispatcher`. | Mentioned only in `docs/design-notes/2026-10-15-fp294-cost-analytics-spec.md:7` | None |
| N2 | §3.2, §5.2, §7.6, §9.1, §9.3, §9.5 ("Done"), §10.3 (FP-299 "Done") | Load test against a separate environment | **Not built.** No script and no results. No commit mentions FP-299. | Planned only, in `docs/iteration4_plan.md:353` | None |
| N3 | §3.3 SO-4, §4 R-12, §5.2, §5.3, BR-7, CC 1.10, §8.6, §10.3 (FP-293 "Done") | Identity check requested only for consignments flagged high-value or dangerous | **Not built.** No flag on `Consignment` or `Trip`. Every handover with no verification yet goes to the consent screen. | `frontend/receiver/app/h/[token]/HandoverPageClient.tsx:119-120` | None |
| N4 | §5.3, §6.2, §6.7 (`exception_vehicles`), CC 1.6, §10.2 (FP-297 "Done") | One breakdown can name the horse and its trailers | **Not built.** A single `exceptions.vehicle_id`; no link table. | `backend/app/db/models/transit.py:258-270`; `backend/app/schemas/transit.py:243-252` | Design spec only (`docs/superpowers/specs/2026-09-23-exception-workflow-design.md`) |
| N5 | §5.3, §10.2 (FP-278 "Done") | Real seal formats accepted | **Not built.** Regex `^[A-Z]{2}-\d{4}$` on both sides. | `backend/app/schemas/phases.py:22`; `frontend/driver-pwa/lib/utils/seal-format.ts:3` | None |
| N6 | §5.2, §7.6, Table 28, §10.2 (FP-275 "Done") | DB connection and pool-wait timeouts | **Not on `dev`.** `session.py` sets only `pool_pre_ping`, `pool_size` and `max_overflow`. | `backend/app/db/session.py:21-26` | `origin/Chiko` `4f3dcf0` (unmerged, 20 Oct) |
| N7 | §4 R-05, Table 28, App. B (A20) | Automatic dispatcher alert on undeliverable offline-queue items | **Not built.** The blocked status is shown only on the driver's phone. | `frontend/driver-pwa/lib/hooks/useOfflineQueue.ts:183,428` | None |
| N8 | §8.2, Table 25, TLM 1.3, §4 (R-17 closure) | Live list shows "time since last update" and "latest location check" | **Not built.** `TripSummary` has neither field and there are no such columns. R-17 was *closed* on the strength of this feature. | `frontend/dispatcher/components/trips/tripColumns.tsx:119-184`; `frontend/shared/lib/types/trip.ts` | None |
| N9 | BR-10, §6.4 | An exchange outside the planned exchange point raises a location warning | **Not built.** Exchange-point coordinates are stored but never compared with the drivers' actual positions. | `backend/app/orchestration/substitutions/capture_assessment.py:3-6`; `service.py:239` | `origin/Ciaran` makes them optional |
| N10 | §7.3 Table 23 | "Anchoring receipt target 60 s" is a configured value | **No such setting or constant exists.** SO-1's "receipt targeted within 60 s" has no measurement behind it (see N2). | Searched `backend/app/core/config.py` and every branch | None |
| N11 | TLM 1.2 step 2 (FP-142) | Availability strip for the week | **Not built.** Each dropdown option shows "On TRIP-x, free after…" for the chosen time window only. The clash check at confirm (FP-139) *does* work. | `frontend/dispatcher/lib/trips/crew-availability.ts:76-79`; `CrewFields.tsx:71` | None |
| N12 | §8.7 (FP-309) | "A click on the map shows the address of that point" | **Not built.** A map click sets coordinates only; there is no reverse geocoding. Forward address search works. | `frontend/dispatcher/.../PrecinctForm.tsx:225-234`; `lib/geocode/photon.ts` | None |

---

## 3. 🟠 Contradicted: the code does something different

| # | Doc location | Claim | What the code actually does | Evidence |
|---|---|---|---|---|
| C1 | SO-4, §6.5 CC 1.10, §6.7, §10.3 (FP-316) | Selfie stored before a "selfie only" result | FP-316 **removed** the receiver selfie. No document gives `TYPED_ONLY`. `selfie_artifact_id` is unused. | `backend/app/db/models/enums.py:312-320`; `orchestration/handover/receiver_verification.py:360-368` |
| C2 | §1.3, SO-4, BR-7, §7.4, §8.6 | Receiver gives a typed name and a **drawn signature** | The receiver **swipes** to confirm. The "signature" is a generated attestation image. **§7.4's ECTA analysis rests on a drawn signature and needs rewriting.** | `frontend/receiver/components/Swipe.tsx:1-5`; `frontend/shared/lib/utils/render-attestation.ts:1-5` |
| C3 | CC 1.10 step 4 | "A scanned document number is not typed again" | The receiver types their ID number, and the server compares it with the number read from the document. | `HandoverPageClient.tsx:331-345`; `receiver_verification.py:88-112` |
| C4 | §1.1 Table 2, §7.5 | Didit is "off by default" | `IDVS_USE_MOCK` chooses between the mock and live provider; it is not an on/off switch. The check is offered on every handover. | `backend/app/core/config.py` |
| C5 | BR-5 | A parcel shortfall is handled as critical | Parcel-count discrepancies are always **WARNING**. | `orchestration/consignments/scans.py:44`; `orchestration/phases/findings.py:301-302` |
| C6 | R-02, §7.1 | "5-minute recovery sweep" | The sweeps run **every 60 s** and pick up debts older than 300 s. The only true 5-minute job is the IDVS abandoned-verification sweep. | `backend/app/tasks/blockchain.py:30-31`; `tasks/__init__.py:28-80` |
| C7 | §7.6, R-14 (FP-274) | Rate limits "keyed on the verified user" | Keyed on the first 64 characters of the **unverified** bearer token; the code comment says it is not verified. Supabase JWTs share a header and issuer, so the 64-character prefix is likely identical for all users, putting **everyone in one bucket**. This is a probable bug, not just a wording issue. | `backend/app/core/rate_limit.py:139-153` |
| C8 | §6.7 (FP-281) | trips: "order number removed" | `order_number` is still there: made nullable, still indexed. It also causes a likely bug (see §8, B1). | `backend/app/db/models/trips.py:169,179` |
| C9 | §6.4 BR-1 | System raises only the listed types as critical; "other exceptions start as warnings" | Extra types are also critical: moved before departure, an unexplained missing seal record, and substitution seal findings. Nothing (DB or API) actually prevents lowering a severity; it holds only because no code does it. | `orchestration/exceptions/creation.py:39,332-335`; `phases/findings.py:240,338` |
| C10 | §8.4, TLM 1.9 | Inbox tabs *Unreviewed* / *All recorded* | Inbox tabs are **Unreviewed / Claimed by me / History**; the per-trip panel has Unreviewed / Reviewed / All. | `frontend/dispatcher/app/(app)/exceptions/page.tsx:211-220`; `TripExceptionsPanel.tsx:179-181` |
| C11 | §8.5, Table 25 | Analytics split into **Today** and **Trends** views | No such split. There are seven tabs (Activity, On time, Problems, Review desk, Evidence, Routes & sites, Cost). "Today" is a map window inside Routes & sites. | `frontend/dispatcher/app/(app)/analytics/page.tsx:39-47,114` |

---

## 4. 🟡 Partial or overstated

| # | Doc location | Claim | Gap |
|---|---|---|---|
| P1 | SO-4, CC 1.8 (FP-273) | Server completes confirmation only if a receiver confirmation exists; signature taken from it | A driver-made upload is refused (`phases/artifacts.py:39-40,88-93`), but the driver still submits `pod_signature_artifact_id`, and `advance_confirmation.py:29-52` never checks that a receiver confirmation exists for the stop. R-11 was **closed** on this basis. |
| P2 | §1.1, §5.4, §7.5, R-22 | Pulsit "integration code complete"; each feed switched live by one setting | Switches exist (`PULSE_USE_MOCK`, `PP_USE_MOCK`, `SCAN_FEED_USE_MOCK`). But Pulsit's API shape is marked "ASSUMED, NOT FROM PULSIT DOCUMENTATION" (`integrations/pulsit.py:3-7`), and the live scan feed raises `NotImplementedError` (`integrations/scan_feed.py:198-206`), so its switch cannot go live. |
| P3 | SO-2 (FP-272) | On-road tracker check during in-transit | `evidence/road_check.py:15-16`: "Called by the dev tracker endpoint today". There is no scheduler, so it never runs on a real trip. |
| P4 | BR-10, TLM 1.14 (FP-83) | Driver substitution delivered | Built and merged (PR #90), but behind `DRIVER_SUBSTITUTIONS_ENABLED=False` by default (`config.py:113`). The location warning is missing (N9). `origin/Ciaran` has unmerged rework. |
| P5 | SO-1 | Fleet and precinct changes anchored | Fail-closed anchoring exists for material changes, but cosmetic-field edits are logged and not anchored. Say "material changes". |
| P6 | SO-1, BR-9 | Audit pack anchored at issue | Fail-open: if anchoring fails the pack is issued as `FAILED` and nothing retries it (`audit_packs/lifecycle.py:169-182`). Audit packs are in `UNVERIFIABLE_SUBJECT_TYPES` (`verification/service.py:268-270`). |
| P7 | §7.2, SO-1 | Exceptions anchored | Only **critical** raises are anchored on raise. A non-critical raise reaches Hedera only through its later review event (`evidence_anchors/recording.py:187-193`). The doc mostly says this correctly; check §1.3 and §6.5 wording. |
| P8 | BR-2 | "Every exception starts unreviewed" | Override and cancellation notes are created already reviewed (`exceptions/review_policy.py:41`). |
| P9 | §6.7, §10.1 | Every new table has RLS enabled **and direct access revoked** | RLS is on everywhere. An explicit `REVOKE` exists only in the evidence-anchor and substitution migrations. `audit_packs`, `audit_pack_access_events`, `audit_pack_email_codes`, `incident_declarations` and `cost_profiles` rely on `ALTER DEFAULT PRIVILEGES` without `FOR ROLE` (`2026_09_23_ciaran_lock_down_data_api.py:83-84`). |
| P10 | BR-3, §6.2 | Incident declarations record principal, insurer and SAPS notifications with reference numbers | Fields are client, tracking company, insurer and SAPS; there is no "principal" field. Reference numbers exist only for SAPS (CAS) and the insurer claim. |
| P11 | §1.3 | A principal's depot is shared with "the operators that deliver to it" | `precincts.is_shared` is a single boolean, so sharing is global to every operator. There is no per-operator sharing table (`db/models/organisations.py:73`). |
| P12 | §8.8 | New *Audit packs* **tab** on the trip page | It is a section inside the Info tab (`TripDetailPanel.tsx:135`). "Missing evidence listed" covers only GPS gaps and "not recorded" text. |
| P13 | §7.1 Table 22, FP-292 "Done" | Client portal deployed at portal.freightproof.co.za | No `vercel.json` or `.env.example` for the client portal, and it is not in the runbook's deployed table. The portal is only "new project" instructions (runbook §4a). |
| P14 | §7.1 Table 22 | Custom domains (www, receiver, portal, api `.freightproof.co.za`) | Appear only in comments and test fixtures. `README.md:238-243` lists `freightproof-sa.vercel.app` and `freightproof-sa.up.railway.app`. |
| P15 | §7.1, §7.5 | Background worker, Redis and Celery beat on Railway | `backend/railway.json` arrived on 20 Oct and runs uvicorn only. There is no worker or beat deployment config, and the runbook never mentions Celery. Worker and beat exist only in `docker-compose.dev.yml` and `docker-compose.anchors.yml`. **Without beat, the recovery sweeps and manifest refresh do not run in production.** |
| P16 | §7.3 "All are configuration settings, not constants" | — | Mostly true (20 s rotation, 10 min link, 50 m tolerance, 100 m, 60 s/30 s freshness, 500 m, 60 s manifest refresh, 10 min idle are `Settings` fields). But the **200 m default geofence is a code constant plus a DB default** (`orchestration/evidence/geofence.py:28`), the **60 s anchor target does not exist** (N10), and the front end hardcodes copies of the idle time-out (`frontend/shared/lib/session/idle.ts:12`) and rotation (`useRotatingHandover.ts:27`). |
| P17 | §9.1, §10.1 UI standards | Shared design system and types used by all four front ends; checked at 1,440/1,280/1,024/768 px | The client portal does not use `@shared` (its types are local, `client-portal/lib/types.ts:2`). Each app has its own Tailwind config. Viewport checks exist only for the timeline design harness (`frame.test.ts`); there are no visual or E2E tests. Also: **client-portal has no CI job** (Table 27 omits it, but §9.1 says Vitest covers "all four front ends"). |

Also worth noting: the driver app runs OCR (FP-300) **on the phone** via `@capacitor-community/image-to-text`, so it works only in the native app. The browser PWA falls back to typing. That is fine, but §8.6 should say so.

---

## 5. 🔵 Wrong or stale numbers

| # | Doc location | Document says | Code shows today |
|---|---|---|---|
| S1 | §9.2 | 227 backend test files (109 unit + 112 integration) | **247** (113 unit, 128 integration, 6 baseline). Note that 109 + 112 = 221, not 227. |
| S2 | §9.2 | 362 frontend test files | **372** (dispatcher 205, driver 153, receiver 4, client-portal 10) |
| S3 | §9.2 | 3,411 backend tests passed | `pytest --collect-only`: 4,025 total, **3,737 not slow** (not run) |
| S4 | §9.2 | 1,448 driver / 2,900 dispatcher tests | Rough grep counts: driver ≈1,425, dispatcher ≈2,594. Re-run before submission. |
| S5 | §9.2 | 267 deselected slow tests | **288**. These are all import-cycle checks, which run in a separate CI step. |
| S6 | §6.1 | "The former 1,962-line phase service" | 1,962 was its size on 17 Sep (`f0a985e`). Just before the split it was **2,289** lines (peak 2,305). |
| S7 | R-02, §7.1 | 5-minute recovery sweep | 60 s sweep interval (see C6) |
| S8 | Appendix A TC-10 | `test_handover_endpoints.py: test_full_walk_receiver_without_an_id_still_confirms` | The function is in **`test_receiver_verification_endpoints.py:610`** |
| S9 | Figure 24 / §9.2 | All suites passed on 19 October with no failures | CI on `dev` has failed on every push since 14 Oct (ruff, then driver Vitest). Check which commit Figure 24 was taken from. |

All other Appendix A test files and functions exist as named (TC-01 to TC-09 and TC-11 to TC-15), and none is marked slow.

---

## 6. ⚪ Process claims not supported by the repository

| # | Doc location | Claim | Finding |
|---|---|---|---|
| X1 | §9.2, §10.1, R-16, R-23 | CI runs and must pass before merge; "CI caught migration and layering problems" | The pipeline is configured as described: ruff, structure ratchet, import-linter, mypy, pytest with PG 17 and Redis, import check, single migration head, and the full chain on an empty DB (`.github/workflows/ci.yml`). **But it has been red on `dev` since 14 Oct**, ruff currently fails locally, and the structure ratchet (`scripts/check_structure.py`) also fails locally. If CI "must pass before merge", branch protection is not enforcing it. |
| X2 | §10.1 | "Every change arrives through a pull request that a second member reviews" | According to the GitHub API, **all 22 merged PRs (#65 to #90) have zero recorded reviews**, and 21 were merged by their own author. 6 commits went straight to `dev` since 25 Sep (e.g. `96cf9b9` "Geofence fix", 5 files). Confirm in GitHub before rewording. |
| X3 | §10.1 | "Commits reference their Jira key" | Only **23 of 149** non-merge commits on `dev` since 25 Sep (~15%) carry an FP key. FP-271, 274, 275, 292, 299 and 308 appear in no commit on any branch. |
| X4 | §10.6 | Repository instructions require a plan and forbid AI from committing or merging | ✅ Verified (`CLAUDE.md`, `AGENTS.md`). Note that `CLAUDE.md` still says "CI never runs Alembic", which is now out of date (CI does apply the chain). |

---

## 7. Placeholders and TEAM TO DO items still open

These are already marked in the draft, but they must not ship. Several depend on work that is **not done** (marked ❗).

- Cover page: four `[ADD STUDENT NUMBER]` placeholders.
- SO-1 status: `[ADD: share of receipts within 60 s from the load test]` ❗ no load test exists (N2).
- §6.1 package diagram, §6.2 class diagram, §6.3 both use-case diagrams, §6.6 state machine, §6.7 ERD, §7.1 deployment diagram: all are still Iteration 3 stand-ins.
- §8: eleven `INSERT SCREENSHOT HERE` boxes (Figures 8, 11, 12, 13, 17, 21, 22, 23, 26, 27, 28) plus the retakes in §8.5. ❗ Figure 8 cannot show "time since last update" or "location check" (N8). ❗ Figure 12 ("Today view") does not exist as a view (C11). ❗ Figure 23 needs a deployed portal (P13).
- §9.3 load-test results ❗ (N2). §9.5 device and connectivity scenarios `[TO CONFIRM]`: no evidence in the repo that these manual tests were run.
- §10.2 Sprint 8 and §10.3 Sprint 9 retrospectives: "drafted from Jira data", to be confirmed by the team.
- Appendix C: contribution scores and sign-off table.

---

## 8. Defects found during the review (not doc claims, but they affect the demo)

| # | Defect | Evidence | Impact |
|---|---|---|---|
| B1 | **Building an audit pack for a manifest-created trip will likely fail.** `TripSummary.order_number: str` is required, but manifest trips leave `order_number` as `NULL`. Test fixtures always set it, so the tests don't catch this. *Inferred from the code; not run.* | `backend/app/schemas/audit_pack.py:412`; `orchestration/audit_packs/builder.py:801`; `db/models/trips.py:179` | The audit-pack demo could return 500 on exactly the trips the document promotes |
| B2 | Rate limit identity is a raw token prefix that is likely shared by all users | `backend/app/core/rate_limit.py:148-151` | One busy user could throttle everyone (C7) |
| B3 | CI red on `dev` (ruff PLR0915 at `phase_payloads.py:129`; driver Vitest failing; structure ratchet failing locally) | `.github/workflows/ci.yml` | Tests and migration checks have not been gating merges since 14 Oct |
| B4 | No Celery beat or worker in the production deployment config | `backend/railway.json`, `backend/Dockerfile` | Pending anchors would never be retried and manifests never refreshed in the hosted demo |
| B5 | `REVOKE` missing on five Iteration 4 tables | see P9 | Lockdown depends on which role ran the migrations |

---

## 9. Claims that could not be verified from the repository

These are not code claims, so they are not marked wrong. The team should check them against Jira and their own records:
- Story points, velocity, per-member points and burndown (§10.2 to §10.4, Tables 31 to 35). Note that several tickets marked "Done" in Tables 31 and 33 are not built (FP-275, 278, 295, 297, 299) or are only partly built (FP-273, 289, 292, 293, 316). **The points and completion percentages will change once these are corrected.** For example, Sprint 9's "118 of 118 completed" and the 10.7 points-per-day figure cannot both stand.
- Seven research interviews, LFG relationship, sprint dates, presentation dates.
- SAPS statistic (1,589 hijackings), the ECTA s.13 reading and the TAPA TSR citation.
- iOS TestFlight distribution. The native `ios/` and `android/` projects exist, but the runbook notes "Android is untested against the hosted API", while `CLAUDE.md` describes an Android APK.

---

## 10. Verified claims (accurate as written)

- **Phase model:** Arrival phase type; per-stop order Arrival → Unloading → Loading → decision; refused-activation guards (`orchestration/phases/plan.py`, `scheduling.py`). Note: "too early" means an earlier operating day.
- **Every phase anchored** (`ANCHORED_PHASES = frozenset(PhaseType)`, `phases/plan.py:17`); trip creation fail-closed; phases anchor later during an outage.
- **Critical raises, every review and every cancellation** each get their own `evidence_anchor_events` row and receipt; free text committed as a hash only; no positions; payload tests in CI.
- **Override** anchored with its own receipt type, mandatory reason, shown as overridden.
- **Verification** results group into matches, does not match and could not check, and cover exception, review and cancellation events.
- **Exception workflow:** claim, release, 409 on a colleague's claim, first review final, batch review of warnings with criticals refused, contact methods phone/WhatsApp/in person, live SSE fan-out to dispatchers.
- **Location corroboration** across phone, horse and every trailer; "could not check" for missing or stale data; 100 m, 60 s/30 s and 500 m (critical) as settings.
- **Receiver handover:** single-use link, browser-binding cookie, 20 s rotation that stops once opened, 10 min lifetime with one extension, concurrent redemptions give one success, a second browser is refused without burning the token, identity check never blocks delivery, consent recorded.
- **Arrival seal inspection** with on-device OCR (FP-300), confirm/correct, intact/damaged/missing, critical on mismatch.
- **Manifest-first trip creation** (FP-281): manifest key with a partial unique index excluding cancelled trips, P0 manifest snapshot in the journey-lock hash, mixed-client and duplicate refusal naming the existing trip, manual precinct pick.
- **Clash check at confirm** (FP-139) returns 409 naming the clashing trip.
- **Parcel trace** (FP-149) with a dispatcher page, identical "not found" for foreign and unknown barcodes, and gaps shown.
- **Audit packs** (FP-279/291): hashed tokens, e-mailed OTP via SendGrid, 410 on revoked links, access log, PDF, incident declarations in the pack, and client-portal verification done **in the browser** with `crypto.subtle` against the Hedera mirror node.
- **Cost analytics** (FP-294) with admin-only editable rates; source lines; a small-sample flag at under 5 trips; live analytics views.
- **Trip timeline** (FP-287/288): verdict lines, pulse on the current phase, "Not started", "Jump to current phase", amber exception counts, call link, photos refresh on upload.
- **Single driver session:** a new sign-in ends the old one; dispatcher can deactivate the driver; OTP sign-in; 10 min idle time-out.
- **DB lockdown migration** (FP-271) and its test; upload limits and artefact ownership (FP-308); production refuses unsafe settings; the unauthenticated routes are as described (plus `GET /public/audit-packs/seal/{pack_id}`, and `/docs` outside production).
- **Orchestration split** into the 12 named packages (plus `substitutions`); import-linter contracts in CI (17 kept, 0 broken).
- **One Alembic head**; all I4 tables have `created_at` and `updated_at`. Six older tables do not, so "every table" in CLAUDE.md does not hold, though the document itself doesn't claim it.
- OpenRouteService routing with fallback; demo panel (FP-272); driver-to-driver substitution storage written by the workflow.

---

## 11. Recommended actions before 23 October

For each 🔴 item the team must choose **build it** (only if it is small and can be merged and green before the freeze) or **reword it** (move it to §5.4 Known Limitations and change the ticket outcome to "Carried" or "Not done").

**Quick code fixes, worth doing because they protect the demo:**
1. Fix the ruff failure and the driver Vitest failure so CI is green again (B3).
2. Make `TripSummary.order_number` optional, or drop it from the audit-pack summary, and add a test with a manifest trip (B1).
3. Merge FP-275 from `origin/Chiko` if it is ready, or mark it "Carried" (N6).
4. Add Celery worker and beat to the Railway deployment, or state in §7.1 that anchoring retries run only locally (B4).

**Rewording that is unavoidable:**
- Remove or mark as not delivered: FP-295 AI brief, FP-299 load test (and every reference to its results: SO-1, §5.2, §7.6, §9.3, §9.5, R-15/R-16), FP-278, FP-297 and `exception_vehicles`, and the R-05 automatic alert (also fix Appendix B row A20).
- FP-293 and BR-7: describe what is built. The identity check is offered to every receiver, who may decline or proceed without a document, and it never blocks delivery.
- FP-316: describe the **removal** of the receiver selfie (a "typed only" result when there is no document).
- "Drawn signature": replace with swipe-to-confirm plus a generated attestation, and **revise §7.4's ECTA argument accordingly**.
- FP-273: state the actual guarantee (driver-made signature uploads refused), or add the missing receiver-confirmation check. Reconsider closing R-11.
- FP-289: remove "time since last update" and "location check", or build them. Reconsider closing R-17.
- BR-5: shortfall is a warning in the system and escalated by procedure.
- Analytics: describe the seven tabs and the Today map window instead of Today/Trends views.
- Correct C6, C7, C8, C10, P2 to P17 and every number in §5.
- §10.1: soften or correct the PR-review and Jira-key statements (X2, X3) and the CI-must-pass statement (X1).
- Recalculate the Sprint 8 and 9 outcomes, points and velocity once the ticket statuses are corrected (§9).

---

*Prepared from a read-only review of `origin/dev`. File and line references are as of commit `ba9ecaa`. Re-check any line numbers if `dev` moves before submission.*
