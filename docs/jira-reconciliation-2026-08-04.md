# Jira Board Reconciliation — Dry Run (v2)

**Date:** 2026-08-04
**Board:** FP — FreightProof (INF4027W) Team 05 (`inf4027team5.atlassian.net`)
**Status:** §4.1 APPLIED — see Execution Log. §4.2, §5 and §6 still outstanding.
**Prepared for:** Ciaran, Tim, Chiko, Tom

## Execution log

**FP Sprint 5 is active: 27 July 2026 → 10 August 2026.** The backdated start was accepted, so the
sprint covers the real delivery window and the calendar gap after Sprint 4 is closed.

| When | Action | Result |
|---|---|---|
| 2026-08-04 | Added the 14 items in §4.1 to Sprint 5 (id 135) | **Done.** Sprint 5 holds 17 issues — the 14 plus FP-113, FP-119, FP-121. |
| 2026-08-04 | Started Sprint 5, dated from 27 July | **Done** (manually — the MCP has no board/sprint API). |
| 2026-08-04 | Assigned all 14 from commit authorship | **Done.** Tim ×10, Ciaran ×4. |
| 2026-08-04 | Commented each with file-level evidence and commit SHAs | **Done.** |
| 2026-08-04 | Transitioned all 14 to Done | **Done.** Verified: `project = FP AND sprint = 135 AND status = Done` returns 14. |

Transitions were run *after* the sprint started, so each closure is recorded as work completed
within the sprint window rather than arriving pre-completed.

**Sprint 5 now carries 14 Done and 3 open** — FP-113 (In Progress), FP-119 and FP-121 (To Do).

### Assignment basis

Derived from git authorship of the evidence files, not from prior board assignment.
`P-printer <ciaranformby@gmail.com>` and `Ciaran Formby <frmcia001@myuct.ac.za>` are the same
person; `timgultig021` has two addresses likewise.

Two were split and resolved on the completing contribution:
- **FP-118** — scaffolding Tim (2026-06-29), completing work Ciaran (`7e93217`). Assigned Ciaran.
- **FP-124** — `transit.py` is mostly Ciaran's, but `exception_service.py` and `exceptions.py` are
  wholly Tim's. Assigned Tim.

Both are noted in the issue comments for the team to override if they read it differently.

### Still outstanding

1. §4.2 — split the four partial items (FP-83, FP-63, FP-90, FP-113); close only the delivered half.
2. §5 — create the ~8 missing stories under FP-8.
3. §6.1 — **FP-125 still has no parent epic.**
4. §6.2 — FP-5/6/7 still describe the superseded five-handshake model.
5. §6.3 — FP-74 / FP-91 both closed; the duplicate question is unresolved, so the sprint count is
   inflated by one if they are the same story.
6. §6.4 — FP-3 should move to Done; re-derive FP-2/4/8 from their children.
7. Releases for `Iteration 1` / `Iteration 2` grouping.
8. The retrospective (§9).

> **v2 supersedes v1.** The first pass queried the board with a 100-issue page limit and silently
> missed FP-105…FP-125. That omission mattered: it wrongly concluded the phase refactor and the
> multi-stop work had no board representation, when FP-112, FP-113, FP-114, FP-115 and FP-125
> already exist. All counts and the entire unplanned-work section have been rebuilt. Every commit
> hash below has been verified to resolve against the repository.

---

## 1. Why this document exists

The FP board holds 121 issues across 10 epics. The hierarchy is sound. The problem is that the
board **stopped tracking reality around late June**, while the repository took roughly 145 commits
between 1 June and today.

The board's own sprint history shows the same gap — see §2.

---

## 2. Sprint state — read this first

| Sprint | State | Start | End | Issues |
|---|---|---|---|---|
| FP Sprint 1 | closed | 19 Apr | 3 May | 4 |
| FP Sprint 2 | closed | 3 May | 17 May | 20 |
| FP Sprint 3 | closed | 22 Jun | 6 Jul | 9 |
| FP Sprint 4 | closed | 12 Jul | 26 Jul | 6 |
| FP Sprint 5 | **future — never started** | — | — | 4 |

Two things follow, and both matter for planning:

1. **There is no active sprint right now.** Sprint 4 completed on 27 July. Sprint 5 exists but was
   never started, so it has no dates. The work of 27 July → 4 August — which includes the entire
   phase-model delivery — currently sits in no sprint at all.
2. **Only 33 of 121 issues belong to any sprint.** The other 88, including most Done work, were
   never added to one. There is also an unsprinted gap between 17 May and 22 Jun.

### Can completed work be put into the sprint it was done in?

- **Closed sprints (1–4): no.** Jira's Agile API rejects adding issues to a completed sprint, and
  this is a team-managed (next-gen) project, so there is no company-managed bulk-edit path around
  it. Even where it can be forced, a closed sprint's report is generated from the changelog
  snapshot taken at completion — retroactive additions surface as scope changes dated today, or
  not at all. The burndown will not redraw.
- **Sprint 5: yes, completely.** It is in `future` state, so it accepts any issue and can then be
  started. This is the clean vehicle for everything being closed now.

### The legitimate way to show *when* work happened

Sprints can't carry that, but **Releases (fix versions) can** — a version's `releaseDate` is a
field you set yourself, so historical dates are permitted and accurate. Recommend creating
`Iteration 1` and `Iteration 2` versions with true dates and tagging issues to them. That gives
time-grouped reporting for the documentation without misrepresenting anything.

Labels (`iteration-1`, `iteration-2`) are a lighter-weight fallback if Releases aren't enabled.

**One item to test before committing to a plan:** Jira permits editing a sprint's start/end dates.
If Sprint 5's start date can be set to 27 July (the day Sprint 4 closed), that is an *accurate*
record of when the work began, and it closes the calendar gap honestly. Try it on Sprint 5 first
and confirm it holds — I could not verify this without writing to the board.

---

## 3. Current board state (corrected)

| Issue type | Count |
|---|---|
| Epic | 10 |
| Story | 35 |
| Subtask | 56 |
| Task | 20 |
| **Total** | **121** |

| Status | Count |
|---|---|
| Done | 87 |
| To Do | 29 |
| In Progress | 4 |
| In Review | 1 |

**Epics:**

| Key | Status | Title | Owner |
|---|---|---|---|
| FP-1 | Done | Core Infrastructure & Developer Environment | Tim |
| FP-2 | In Progress | Blockchain Evidence Layer (Hedera HCS) | Chiko |
| FP-3 | In Review | Identity & Authentication | Tom |
| FP-4 | In Progress | Trip Management & Journey Lock | Ciaran |
| FP-5 | To Do | Pickup Verification Engine | Tom |
| FP-6 | To Do | Delivery Verification & Manifest Reconciliation | Chiko |
| FP-7 | To Do | In-Transit Evidence & Exceptions | Tim |
| FP-8 | In Progress | Dispatcher Dashboard, Evidence Portal & Hardening | Ciaran |
| FP-33 | Done | Documentation Iteration 1 | Tom |
| FP-123 | To Do | Documentation Iteration 2 | unassigned |

**One orphan:** FP-125 "Phase Refactor" (Task, To Do, Ciaran) has **no parent epic** — despite
being the single largest body of work delivered this iteration.

---

## 4. Open issues → codebase verdict

Verified against files in the working tree, not inferred from commit messages.

### 4.1 Complete — recommend transition to Done, add to Sprint 5

| Key | Item | Evidence | Commit |
|---|---|---|---|
| FP-125 | Phase Refactor *(orphan task)* | `orchestration/phase_plan.py`, `phase_service.py`, `db/models/phases.py`, migration `2026_07_28_ciaran_phase_model.py`; five handshake routes retired | `fe35e5d`, `676d03e`, `f8acfbf`, `b26ebbb` |
| FP-124 | DB-persisted ExceptionEvent behind exceptions pages | `TripException` model (`db/models/transit.py:45`), `exception_service.raise_exception()`, `api/v1/endpoints/exceptions.py`, migration `2026_07_02_ciaran_add_exception_scoping.py` | `ee4cf32` |
| FP-118 | Document upload on trip evidence trail | `orchestration/artifact_service.py` (`create_artifact`, `list_artifacts_for_trip`), `storage/supabase_storage.py`, `api/v1/endpoints/artifacts.py`, signed URLs | `7e93217` |
| FP-70 | Offline checkpoint queue + sync | `lib/hooks/useOfflineQueue.ts` + tests | `d3e0a78` |
| FP-88 | Soft panic button with GPS | `app/(app)/trip/panic/` (4 files + tests) | `5470315`, `10e3f9a`, `e4727ba` |
| FP-73 | Photograph signed vehicle waybill at loading | `components/handshake/steps/H2Waybill.tsx` | `35a15ec` |
| FP-85 | Capture seal number + photograph sealed door | `H2Seal.tsx`, `SealInput.tsx` | `35a15ec` |
| FP-86 | Origin gate exit photo + guard seal verify | `H3ExitSeal.tsx`, `H3Departure.tsx`, `H3ApproachExit.tsx` | `c1a8c2b`, `1c2a545` |
| FP-89 | Destination gate-in, seal verified vs origin | `H4SealVerify.tsx`, `H4ApproachDest.tsx`, `SealReferencePersistence.test.tsx` | `b3e9324`, `75aad6b` |
| FP-74 | Photograph signed master POD at delivery | `H5PodPhoto.tsx`, `H5HandWaybill.tsx`; migration `2026_06_29_tim_add_pod_signature_artifact.py` | — |
| FP-91 | POD photo after unloading reconciled | Same components as FP-74 — probable duplicate, see §5.3 | — |
| FP-72 | View full parcel manifest on PWA | `H2Review.tsx`, `H2Linehaul.tsx`; `manifest_service.get_linehaul_for_driver()` | `ee4cf32` |
| FP-84 | Poll Parcel Perfect for scan-out + manifest | `integrations/parcel_perfect.py`, `orchestration/pp_lookup_service.py`, `tasks/parcel_perfect.py`, `tests/unit/test_parcel_perfect_client.py` | `9955993` |
| FP-92 | Anchor SHA-256 of delivery event to Hedera | `phase_service.advance_confirmation` (P6) via `anchor_subject()`; `anchor_status` state machine | `676d03e`, `fe35e5d` |

**14 items to close.**

### 4.2 Partially complete — split, close the delivered half

| Key | Item | What exists | What's missing |
|---|---|---|---|
| FP-83 | Driver substitution logging | `DriverSubstitution` model (`db/models/trips.py:215`), schemas, enums, migration `0002_driver_substitutions.py` | **No service, no endpoint.** Nothing in `api/` or `orchestration/` references it. |
| FP-63 | Merkle batching of in-transit checkpoints | `merkle_batches` + `merkle_batch_leaves` tables, `merkle_root` / `merkle_batch_id` columns and schemas | **No root-computation logic.** `crypto/` contains only `hashing.py`. |
| FP-90 | Reconcile destination scan-in vs origin manifest | `H5Reconciliation.tsx`, reconciliation phase, `pp_lookup_service.get_manifest_summaries()` | Automatic discrepancy **flagging** — needs team confirmation, see §6. |
| FP-113 | Journey-lock-hash payload includes stops/legs | Versioned lock hash shipped in trip-creation redesign | Confirm it covers `TripStop`; currently In Progress across Sprints 3/4/5. |

### 4.3 Not started — carry to next sprint

| Key | Item | Verdict |
|---|---|---|
| FP-87 | Poll Pulsit API for deviations / geofence breaches | No `pulse.py` / `pulsit.py` in `integrations/`. |
| FP-68 | Cross-reference GPS vs precinct geofence | Columns exist, but `phase_service.py:413-414` states it is "out of scope until the Pulsit integration lands". Blocked on FP-87. A branch was attempted and reverted (`d95d772`). |
| FP-116 | UI simulation harness `/dev/simulate/[tripId]` | No such route exists. |
| FP-117 | Trip cancellation event | `CANCELLED` enum exists (`enums.py:36`); no cancellation service or endpoint. |
| FP-119–122 | Documentation Iteration 2 tasks | Writing work, not yet done. |

**Six-plus genuinely open items. A sprint carrying real carry-over is credible; one carrying zero is not.**

---

## 5. Work still absent from the board

Corrected — much less than v1 claimed. Multi-stop (FP-112/113/114), forensic view and
admin-dispatcher role (FP-115), and the phase refactor (FP-125) are all already represented.

What remains genuinely unrepresented, recommended as new stories under **FP-8** rather than new
epics:

| Proposed story | Evidence |
|---|---|
| Pre-iteration-2 security hardening (SEC-1–5, CQ-1–9) | `b2348ff` |
| Strip blockchain receipts from detail endpoints for non-admin dispatchers | `8cc00ef` |
| Restrict fleet mutations to `admin_dispatcher` role | `08b2c36` |
| Harden dispatcher auth — 401 refresh-retry, idle deadlock, dev-token prod gate | `4704c00` |
| Green backend CI baseline — 12 ruff + 29 mypy errors resolved | `7560157`, `4695a3c`, `52ddb3b` |
| DB-backed pytest against throwaway Postgres; driver-pwa CI job | `c132f45`, `88c58c5` |
| Vitest scaffolds — dispatcher and driver-pwa | `7016630`, `7fa0f54` |
| Fleet UI parity — driver pages, vehicle validation, trip tables | `94e7129`, `9e61e70`, `c918e99`, `811df47` |

Roughly **8 stories**, not six epics.

---

## 6. Board corrections

**6.1 FP-125 has no parent.** Attach the phase refactor to FP-4 (Trip Management) or create an
epic for it. An orphan task carrying the iteration's biggest delivery is the single most visible
board defect.

**6.2 FP-5, FP-6, FP-7 describe a superseded model.** These epics use the five-handshake vocabulary
that `f8acfbf` retired. Recommend rewriting their descriptions in phase-model terms and keeping
their child stories — the work items remain valid, only the framing changed.

**6.3 FP-74 / FP-91 look like duplicates** — same artifact, same components. Close one as a
duplicate of the other.

**6.4 Stale epic statuses.** FP-3 sits "In Review" with all four subtasks Done and auth hardened
twice since (`8cc00ef`, `4704c00`) — should be Done. Re-derive FP-2, FP-4, FP-8 from their children
after §4.1 is applied.

**6.5 Unassigned issues.** Most of the To Do stories are unassigned. Assign from commit author
before closing.

**6.6 Migration naming** — `0001_initial_schema.py`, `0002_driver_substitutions.py`,
`0002_tom_supabase_auth_schema.py`, `0003_tom_rls_policies.py` break the `CLAUDE.md` convention,
and `0002` is duplicated. Housekeeping ticket; out of scope here.

---

## 7. Open questions

1. **FP-90** — does reconciliation automatically *flag* discrepancies, or only display counts?
2. **FP-113** — does the versioned lock hash already cover `TripStop`, or is that outstanding?
3. **Sprint 5 dates** — can the start date be set to 27 July? (Test before planning around it.)
4. **Releases** — enable Releases for `Iteration 1` / `Iteration 2` grouping, or use labels?
5. **Sprint 5 scope** — all 14 closures in Sprint 5, or only the ones done after 27 July, with the
   rest left sprintless but tagged to a Release?

---

## 8. Recommended execution order

1. Team reviews this document and answers §7.
2. Test whether Sprint 5's start date can be set to 27 July. Start Sprint 5.
3. Assign and transition the 14 complete items (§4.1), each with a comment citing its commit SHA,
   and add them to Sprint 5.
4. Split the four partial items (§4.2); close only the delivered subtask.
5. Create the ~8 missing stories under FP-8 (§5), linked to commits.
6. Apply board corrections (§6) — FP-125's parent first.
7. Leave §4.3 open; they become Sprint 6.
8. Create `Iteration 1` / `Iteration 2` Releases with true dates and tag issues.
9. Complete Sprint 5 at week's end. Write the retrospective (§9).

---

## 9. The retrospective is the real deliverable

The board will show its own reconstruction — issue creation dates cannot be altered. What makes
this defensible is a retro that states plainly:

- Jira was used well through Iterations 1–2 (121 issues, 10 epics, proper hierarchy, 87 closed).
- Sprint discipline lapsed after Sprint 4 closed on 27 July; Sprint 5 was never started, so
  eight days of delivery went untracked.
- Requirements changed materially mid-project — the phase refactor replaced the five-handshake
  model outright, invalidating parts of the original plan rather than merely delaying them.
- The board was reconciled against git on 2026-08-04; every closure is evidenced by commit SHA.
- Process change for the next iteration: *[team to specify — e.g. issue key in every commit
  message, board review at each stand-up, sprint started before work begins].*

Requirements churn invalidating a plan is textbook agile, not a failure. Evidenced and reflected
on, it reads as a team that adapted. Presented as a board that always looked perfect, it invites
the question of why the dates disagree.

---

*Nothing in this document has been applied to Jira. Awaiting team review.*
