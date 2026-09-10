# Step-Event Ledger — Correction Decision Record

> **Status:** incorporated and superseded · **Author:** Ciaran · **Date:** 2026-09-05
> · **Incorporated:** 2026-09-06
> **Authority:**
> [2026-09-02-step-event-ledger-implementation-plan.md](2026-09-02-step-event-ledger-implementation-plan.md)
> **Handoff:**
> [2026-09-05-live-phase-timeline-handoff.md](2026-09-05-live-phase-timeline-handoff.md)

This file preserves the audit trail for the review that corrected the implementation plan.
It is **not** a second implementation plan. All accepted corrections now live in the
authoritative 2026-09-02 plan; if wording here conflicts with it, that plan wins.

## Decisions incorporated

- **Iteration boundary:** Iteration 3 ships the attributed capture-event rail. The complete
  `phase_steps` child ledger remains Iteration 4. The Iteration 3 slice covers the five
  current evidence-producing acts, not every driver screen step.
- **Anchor sequencing:** departure and confirmation dispatch their anchor before
  `_finish_phase`. Stage 3 cannot include child hashes while materialising children only in
  that funnel; D-12 now gates the stage.
- **Event catalogue:** `STEP_SLUGS` remains a mutable screen recipe. A separate typed domain
  catalogue starts with the five Iteration 3 evidence producers and expands in ledger Stage 1.
- **Live attribution:** `evidence_artifacts` gains nullable `phase_event_id` and `step_slug`
  as an all-or-neither pair, enforced by a database check. Upload validates trip, active
  eligible unresolved phase (`PENDING` or `IN_PROGRESS`) and allowed slug; current code does
  not set `IN_PROGRESS`, so that value alone is not the gate.
- **Completion integrity:** an attributed artifact used to complete a phase must match both
  that phase and the expected step slug. Same-trip ownership alone is insufficient. Legacy
  unattributed artifacts remain accepted during the compatibility window.
- **Timestamp honesty:** the rail uses client `captured_at` as the event time and shows
  server `created_at` when it differs, exposing delayed/offline receipt rather than hiding it.
- **Realtime consumer:** the INFO artifact-upload event must trigger a kind-filtered refetch
  of the separate artifacts endpoint. An emitter without that consumer leaves the rail stale.
- **Offline queue:** a bare 409 cannot mean both replay success and unmet prerequisite.
  Stage 5 must safely dispose of duplicates while retaining and retrying out-of-order events.
- **Legacy waybill:** there is no current live waybill-photo producer, but an older queued
  departure may still upload and attach one. Its compatibility path remains intact.
- **Backlog protection:** FP-149 parcel traceability is not displaced. Whether its
  `ParcelScanEvent` log later converges with `phase_steps` is an Iteration 4 decision.
- **Open decision:** D-8 remains open and must be taken before derived ledger rows ship.

## Review provenance

The original review compared the design notes with the phase completion funnel, anchor call
order, artifact upload/read paths, dispatcher realtime hooks, driver offline queue, phase
screen metadata, Iteration 3 plan, and the 2026-09-01 meeting minutes. A final pass added the
completion-time attribution guard and the client/server timestamp distinction before this
record was incorporated.
