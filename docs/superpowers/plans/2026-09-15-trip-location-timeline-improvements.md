# Trip Location and Timeline Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only if the user requests that execution mode. Steps use checkbox (`- [ ]`) syntax for tracking. This document authorizes no implementation by itself.

**Goal:** Make trip-specific truck simulation accurate, record driver/vehicle separation independently of precinct membership, and make the dispatcher timeline compact, readable and dependable.

**Architecture:** Keep the phase-event ledger authoritative and evaluate location on the backend using independent phone and tracker readings. Separate the persistent journey summary from expandable evidence, and share exception records between timeline summaries and the existing detail panel. Fix modal behavior in the common modal component and remove nested cancellation dialogs.

**Tech Stack:** Existing FastAPI, Pydantic v2, SQLAlchemy 2 async, Alembic, PostgreSQL, Pulsit mock/adapter, Redis mock state, Next.js 15 App Router, React 19, TypeScript, Tailwind 3.4, Leaflet, pytest and Vitest/Testing Library. Node 22. No new dependency is planned.

**Spec:** The embedded [scope and behavior specification](#scope-and-behavior-specification), transcribed from the user's nine testing observations and the read-only assessment on 14–15 September 2026. Read `CLAUDE.md` in full before execution. The assessment is evidence, not approval of the proposed policies.

## Status and authority

- **Requested and authorized now:** write this detailed plan document only.
- **Not authorized yet:** application edits, migrations, mock changes, deployments or Git writes.
- The user requested that all findings be captured so they survive a new session. This file is the master handoff; do not require access to the original chat.
- Modal defects were reproduced in the browser. Location and timeline findings were checked against source after querying the existing Graphify graph.
- Assessment branch: `ciaran`. Assessment HEAD: `6332f9c`. Graph report dated 2026-09-13 names `101c6d38`; treat graph locations as navigation leads, not proof that current source is identical.
- Do not rebuild Graphify or save query results as part of this work. Only the designated graph maintainer may rebuild it.
- Checked boxes mean an executor has supplied evidence, not that this planning session implemented anything.

## Global constraints

- **Do exactly what you were asked. Nothing more.**
- **Evidence, not operations.** Preserve records of what happened; do not reroute, dispatch a response or replace Pulsit/Parcel Perfect.
- The ledger is truth. Derive phase and stop position; never implement a seven-row assumption or determine phase authority from coarse trip status.
- IN_TRANSIT is linked to the stop it departs from. Do not check arrival against that origin boundary. This plan retains the existing no-geofence-verdict behavior for transit legs.
- All location comparisons use independent sources. Never trust driver-submitted truck coordinates.
- Missing, stale or inaccurate measurements are not proof of separation. Null is not false and is not zero distance.
- Existing recorded evidence is not re-evaluated using today's policy or precinct geometry. Do not backfill historical verdicts.
- GPS, identities, notes, photos and parcel details remain in the approved database/storage region. No new personal data goes to Hedera. Do not change canonical anchor payloads.
- Preserve tenant isolation, assigned-driver authorization, offline queue compatibility and replay protection.
- Endpoints remain thin; orchestration owns decisions; integrations do not import orchestration.
- Python signatures and TypeScript interfaces must be typed. Do not introduce TypeScript `any`.
- Driver PWA pages remain client components and compatible with static export/Capacitor.
- Never read or print `.env` or secrets. Read settings declarations, not deployed values.
- Coordinate changes to `backend/app/core/config.py`, `backend/app/db/models/__init__.py`, `backend/app/main.py`, dependency manifests and migration ownership. Avoid those changes where not required.
- Do not commit, push, merge, rebase, switch branches, stage files, rewrite history or discard working-tree changes. Repository/user restrictions override the skill's example commit steps.
- Before running database tests, establish that their configured target is the isolated test database without printing credentials. Do not run mutation tests against the user's existing demo trip.

## Scope and behavior specification

### Requirement mapping

| User item | Required outcome | Tasks |
|---|---|---|
| 1 and 6 | Simulate the selected trip's assigned origin, destination and intermediate precincts | 3 |
| 2 | Distinguish precinct membership from proximity; make activation policy explicit | 4–7 |
| 3 | Keep the in-transit mini-timeline visible, including when evidence is collapsed | 9–10 |
| 4 | Explicit loading-location policy without accidentally replacing scan gates | 4–7 |
| 5 | Dragging beyond a map modal must not close it; useful zoom controls | 1 |
| 7 | Record separation at relevant driver actions, including distance and evidence quality | 4–8 |
| 8 | Center cancellation consistently, including inside the narrow-layout flow | 2 |
| 9 | Collapse phase exceptions; clickable counts; detail panel becomes primary review surface | 10 |
| Additional review | Clear labels, completion/review distinction, compact header, readable text, truthful freshness | 11 |

### Confirmed observations and causes

1. `backend/app/core/demo_waypoints.py` anchors all simulation presets at fixed Cape Town coordinates. `dev_pulsit.py` chooses the selected trip's horse and current precinct, but the requested waypoint coordinates remain static. Thus moving and evaluating can refer to different places.
2. `_raise_position_disagreement_if_unrecorded` in `phase_service.py` returns unless `event.pulsit_geofence_confirmed is False`. It is a truck-outside-precinct detector, despite its broader name. It does not independently test driver-to-truck distance.
3. The inspected completed trip showed green “Within accepted tolerance” and “7.9 km apart” together on activation/loading/departure. Those are different facts and must be labeled separately.
4. `corroboration_service.py` compares timestamps and permits continuation on corroboration failure. `PULSIT_CORROBORATION_MAX_SKEW_SECONDS` defaults to 300 in source, and `GPS_TOLERANCE_METRES` to 50. These are defaults, not verified deployment settings.
5. `TripTimeline.tsx` forces the active transit phase open; completed legs hide `PhaseEvidence` when collapsed. `PhaseEvidence.tsx` passes `exceptions={[]}` to `InTransitTimeline`, while the parent displays full exception cards below the phase.
6. `Modal.tsx` dismisses on a click whose target is the dialog element. Dragging from the map to outside the dialog reproduced dismissal. `LocationComparisonMap.tsx` sets `scrollWheelZoom: false`.
7. `DetailPanel.tsx` docks at 1280px and otherwise renders a modal. Cancellation is rendered inside `TripInformation`, creating a nested dialog. Opening cancellation at the inspected width reproduced its top-of-screen placement. `TripDetailPanel` already lifts precinct dialogs outside the parent.
8. Warning exceptions start as `recorded`; critical exceptions start as `needs_review`. The default exceptions filter is `needs_review`, so GPS warnings are not shown there until “All recorded” is selected.
9. Checkpoints capture independent truck positions but currently have no separation-exception evaluation in `checkpoint_service.py`. Driver exception reports need their own measurement context; a nearby phase's stored coordinates are not the report's coordinates.

### Policy decisions awaiting user approval

These are concrete proposals, not secretly selected requirements. Record approval in this table before executing dependent tasks. UI-only tasks do not depend on numerical thresholds.

| ID | Proposed policy | Why / alternative | Dependent tasks |
|---|---|---|---|
| P1 | Warn, offer retry, then allow activation/loading completion with an explicit reason when a reliable discrepancy exists | Matches evidence-first behavior. Alternative: block reliable failed checks until an audited dispatcher override; requires a separate approved operational-gate design | 4–8 |
| P2 | Initial **100 m** maximum phone-to-horse separation; treat exactly 100 m as within limit | A proposed testable pilot value, not an industry standard or field-validated distance. User must approve or replace it after yard tests | 4–8 |
| P3 | For a proximity verdict require each fix no older than **60 s** at capture/evaluation and source skew at most **30 s**; known phone accuracy must be at most **50 m** | Proposed pilot values. Do not silently reuse or lower the existing 300 s geofence setting. Absence of required timing/accuracy means unverified | 4–8 |
| P4 | At activation/loading/departure/unloading/confirmation evaluate both sources against the expected precinct plus the independent separation check | “Both in a large precinct” does not prove proximity; “together at wrong depot” does not prove location. Transit/checkpoints/reports compare proximity without an invented road geofence | 4–8 |
| P5 | New reliable driver-separation findings are WARNING severity but explicitly NEEDS_REVIEW | Severity and review obligation are different. Do not globally promote every warning to needs-review or rewrite existing GPS warnings | 5–8 |
| P6 | Unknown location never blocks or creates a separation accusation. Record an unavailable reason. Panic/emergency reporting never waits for a retry/acknowledgment flow | Prevents loss of evidence and prevents false accusations during outages | 4–8 |

If P1's blocking alternative is chosen, stop tasks 6–7 and revise this document with attempt persistence, override permissions, offline behavior and race/replay rules before implementing. Do not repurpose the existing “unable to complete phase” override to mean “location approved.”

### Intended interaction details

**Truck controls:** show the trip reference, horse registration, ordered stops, and explicit “At origin — Name”/“At destination — Name” controls. Repeated precinct visits use stop sequence/ID, not name as identity. Include selected-stop inside/outside-tolerance, 3 km away, 50 km away and no-signal scenarios. A response names both the simulation target and current phase's expected stop. Simulating destination during origin loading must still show that loading expects origin. Changing trip or stop clears stale selection/results. No action advances a phase or directly inserts an exception.

**Driver checks:** location belongs to an action, not every navigation click or app opening. Coverage is phase submissions, arrival, explicit checkpoints and driver exception reports. No new continuous-tracking alert loop is included. Ordinary submissions may use a non-writing preview for warning UX, but final submission independently evaluates and persists the capture evidence. An old preview must never authorize or suppress a later backend finding.

**Timeline:** every transit row retains a compact departure/arrival summary outside evidence disclosure. A not-started leg reads “Awaiting departure”; do not invent timestamps. Active legs show “En route to …”; complete legs show actual recorded arrival. Full coordinates and artifacts stay expandable. In-transit exception markers show timestamp, label and severity, with a link to the panel, rather than duplicate full cards. No third permanent pane is planned.

**Exception disclosure:** each phase has an independent `N exceptions · R need review` button. It expands all linked exceptions and collapses without changing review state. Critical/unreviewed counts remain visible when collapsed. The panel is the primary review surface. Opening it from a phase always selects that phase and all recorded exceptions; it must not silently hide warnings. Trip-level records remain in a separate group. Counts derive from unique record IDs.

**Map:** keep pan, +/−, keyboard interaction and map reset/fit controls. Enable wheel zoom while the pointer is over the expanded map and contain that wheel interaction there; scrolling over surrounding text scrolls the dialog. Keep touch pinch/pan supported. Do not change embedded non-modal map scroll behavior globally.

## Delivery sequence and file ownership

Execute sequentially by default. A master plan is used because the user requested one document; each task is a separately reviewable slice.

1 → 2 → 3 can ship independently after implementation approval.

4 → 5 → 6 → 7 → 8 are the location-policy workstream and require P1–P6 approval plus shared-file/migration coordination.

9 → 10 → 11 are the dispatcher presentation workstream. Task 11's evaluated proximity display also depends on task 5; its clear geofence wording does not.

12 verifies the integrated outcome. Do not claim the whole plan is complete if a policy-dependent workstream is deferred.

Paths below are repository-relative. Existing paths were inspected or identified through the existing graph/source inventory. New paths are explicit proposals. Line numbers are deliberately not execution anchors because source may change before approval.

### Task 1: Make modal dismissal safe for map gestures

**Files**
- Modify: `frontend/dispatcher/components/ui/Modal.tsx`
- Modify: `frontend/dispatcher/components/map/LocationComparisonMap.tsx`
- Test: `frontend/dispatcher/components/ui/Modal.test.tsx`
- Test: `frontend/dispatcher/components/map/__tests__/LocationComparisonMap.test.tsx`

**Interfaces:** retain `ModalProps`; no callers should need to change. Map interaction change applies to `LocationComparisonMap` only.

- [x] Add a regression to `Modal.test.tsx` using existing dialog test setup:

```tsx
it('does not dismiss a gesture beginning inside the dialog', () => {
  const close = vi.fn()
  render(<Modal open title="Map" onClose={close}><div data-testid="map">Map</div></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Map' })
  fireEvent.pointerDown(screen.getByTestId('map'), { pointerId: 1, clientX: 100, clientY: 100 })
  fireEvent.pointerUp(dialog, { pointerId: 1, clientX: 0, clientY: 0 })
  fireEvent.click(dialog)
  expect(close).not.toHaveBeenCalled()
})
```

- [x] Run from `frontend/dispatcher`: `npm test -- components/ui/Modal.test.tsx`; establish the failing dismissal assertion before editing production code.
- [x] Track pointer origin and completion; allow backdrop dismissal only when both are outside the dialog bounding rectangle, refer to the same pointer, and represent an intentional click. Reset state on pointer cancellation/close. Honor `closeDisabled`. Do not treat dialog padding as backdrop merely because the event target is the dialog.

```ts
function outsideDialog(rect: DOMRect, x: number, y: number): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
}
// Capture the down result; require downOutside && upOutside on the same pointer.
// A click alone must not turn an inside-origin drag into backdrop dismissal.
```

- [x] Add positive tests for a genuine backdrop click, close button and Escape, plus protected submission and pointer-cancel cases. Stub bounding rectangles explicitly in unit tests.
- [ ] Enable wheel zoom for the map instance (`scrollWheelZoom: true`), test its configured interaction and retain accessible zoom controls. Verify wheel events over map do not scroll the outer dialog; add narrowly scoped wheel propagation handling only if the browser reproduction requires it. **[S1: code + unit assertion done (`COMPARISON_MAP_INTERACTION.scrollWheelZoom === true`); browser wheel/dialog-scroll verification NOT performed — deferred by user]**
- [ ] Run both affected suites. Browser-check drags leaving left/right/top/bottom, drag returning inside, ordinary outside click, touch/pointer cancellation, wheel zoom, Escape and focus return. DOM tests alone cannot prove native dialog/Leaflet pointer behavior. **[S1: suites pass (Modal 10/10, LocationComparisonMap 19/19); browser checks NOT performed — deferred by user]**

**Deliverable:** panning never closes the map; deliberate dismissal still works.

### Task 2: Lift cancellation out of the information dialog

**Files**
- Modify: `frontend/dispatcher/components/domain/CancelTripAction.tsx`
- Modify: `frontend/dispatcher/components/trips/TripInformation.tsx`
- Modify: `frontend/dispatcher/components/trips/TripDetailPanel.tsx`
- Test: `frontend/dispatcher/components/domain/CancelTripAction.test.tsx`
- Test: `frontend/dispatcher/components/trips/TripDetailPanel.test.tsx`
- Test: `frontend/dispatcher/components/trips/TripInformation.test.tsx`

**Interfaces:** lift open state to `TripDetailPanel`; change `TripInformation` to consume `onCancelTrip: () => void`. Export controlled `CancelTripDialog` from the existing cancellation file with `{ tripId: string; status: Trip['status']; open: boolean; onClose: () => void; onCancelled: () => void }`. Keep submission/error handling there; the information view owns only its trigger.

- [x] Write a regression asserting no cancellation `dialog` is a DOM descendant of the information `dialog`, using the narrow-layout mock already present in panel tests.
- [x] Run the three affected tests and confirm the structural regression fails.
- [x] Render the cancellation dialog as a sibling of `DetailPanel`, following `PrecinctModal` ownership. Preserve terminal-state hiding, required reason, double-submit prevention, server errors and “Keep trip active.”

```tsx
<TripInformation {...informationProps} onCancelTrip={() => setCancelOpen(true)} />
// In TripDetailPanel's outer fragment, after DetailPanel:
<CancelTripDialog tripId={trip.id} status={trip.status} open={cancelOpen}
  onClose={() => setCancelOpen(false)} onCancelled={onChanged} />
```

- [x] Test successful cancellation only with mocked APIs; verify closing resets reason, returns focus to trigger, and never calls the API. Handle trip becoming terminal while the dialog is open.
- [ ] Verify viewport centering at 390, 1024, 1279, 1280 and 1440px. On an existing trip only open/dismiss; never submit cancellation during read-only browser verification. **[S1: NOT performed — deferred by user; no cancellation was submitted]**

### Task 3: Use actual trip stops for truck simulation

**Files**
- Modify: `backend/app/api/v1/endpoints/dev_pulsit.py`
- Modify: `backend/app/schemas/dev.py`
- Create: `backend/app/orchestration/dev_truck_service.py`
- Modify: `frontend/dispatcher/lib/types/dev.ts`
- Modify: `frontend/dispatcher/lib/hooks/useDevTriggers.ts`
- Modify: `frontend/dispatcher/components/dev/DevTriggerPanel.tsx`
- Test: `backend/tests/integration/test_dev_pulsit.py`
- Test: `backend/tests/unit/test_dev_pulsit_writes_nothing.py`
- Create test: `backend/tests/unit/test_dev_truck_service.py`
- Test: `frontend/dispatcher/components/dev/__tests__/DevTriggerPanel.test.tsx`

**Interfaces:** extend `MoveTruckRequest` compatibly with nullable `trip_stop_id: UUID` and nullable `scenario: Literal['at_stop','inside_tolerance','outside_tolerance','three_km','fifty_km','no_signal']`; retain optional legacy `waypoint_id`. Exactly one input mode is accepted. New mode requires a stop except `no_signal`. Do not infer a stop from display text. Existing legacy presets continue to work and are labeled fixed demo locations.

Response retains legacy fields and adds nullable `target_trip_stop_id`, `target_precinct_name`, `expected_trip_stop_id`, `expected_precinct_name`, and `scenario`. Existing distance/verdict fields describe the expected phase stop; additional `target_distance_metres` describes the target. Never ambiguously label both distances “from the precinct.”

- [ ] Add parameterized tests with non-Cape-Town origin/destination and a repeated-precinct multi-stop trip. Assert staged coordinates equal the requested stop's coordinates, and the expected-stop verdict still uses the phase ledger.
- [ ] Run `pytest tests/integration/test_dev_pulsit.py tests/unit/test_dev_pulsit_writes_nothing.py` from `backend` and confirm new requests fail before implementation.
- [ ] Extract stop resolution and scenario generation into the orchestration service. Validate trip ownership, stop membership and missing geometry before the mock write. Return 404 for foreign/missing trip or stop, 422 for incompatible request modes, 409 for unavailable target geometry or non-mock client.
- [ ] Generate offsets with spherical destination-point math. Use radius + configured geofence tolerance minus/plus 10 m for boundary scenarios (clamp the inside distance at zero); 3000/50000 m are relative to the selected stop centre. Use a documented deterministic bearing, and verify resulting distance through existing `haversine_metres`. Arbitrary coordinates are not accepted from the browser.

```python
# Core scenario rule, tested independently of HTTP/Redis:
distance = {
    'at_stop': 0.0,
    'inside_tolerance': max(0.0, radius + tolerance - 10.0),
    'outside_tolerance': radius + tolerance + 10.0,
    'three_km': 3000.0,
    'fifty_km': 50000.0,
}[scenario]
```

- [ ] Stage only the selected horse tracker. Read it back through the existing adapter. Do not stage the phone or trailers implicitly; do not write trip/phase/exception tables or call completion endpoints. Preserve both development guards and organization scoping.
- [ ] Build ordered stop controls from `DevTripSummary.stops`; clear results when selection changes and reject stale asynchronous responses by request selection key. No new endpoint is needed just to list stops already in the trip summary.
- [ ] Run backend tests and `npm test -- components/dev/__tests__/DevTriggerPanel.test.tsx`. Include missing geometry, no signal, same horse shared by demo trips, and invalid stop ID. Explain in panel copy that mock state belongs to the device: trips using that same device observe it too.

### Task 4: Define a pure location assessment contract

**Requires:** approved P1–P6. Do not choose numeric policy by silently accepting this document.

**Files**
- Create: `backend/app/schemas/action_location.py`
- Create: `backend/app/orchestration/proximity_service.py`
- Modify: `backend/app/core/config.py` (coordinate shared ownership)
- Create: `frontend/shared/lib/types/action-location.ts`
- Create test: `backend/tests/unit/test_proximity_service.py`

**Interfaces:** a versioned assessment shared by preview, persistence and display. Define these names once and reuse them:

```python
class ActionLocationAssessment(BaseModel):
    schema_version: Literal[1] = 1
    policy_version: str
    evaluated_at: datetime
    driver_lat: float | None
    driver_lng: float | None
    driver_captured_at: datetime | None
    driver_accuracy_metres: float | None
    tracker_lat: float | None
    tracker_lng: float | None
    tracker_captured_at: datetime | None
    separation_metres: float | None
    proximity: Literal['within_limit', 'separated', 'unverified']
    reasons: list[Literal['missing_phone', 'missing_tracker', 'missing_time',
        'missing_accuracy', 'poor_accuracy', 'stale_fix', 'time_skew', 'future_fix']]
    max_separation_metres: float
    max_age_seconds: int
    max_skew_seconds: int
    max_phone_accuracy_metres: float
    expected_trip_stop_id: UUID | None
    precinct_id: UUID | None
    precinct_lat: float | None
    precinct_lng: float | None
    precinct_radius_metres: float | None
    precinct_tolerance_metres: float | None
    driver_in_precinct: bool | None
    truck_in_precinct: bool | None
```

All datetimes are aware; reject nonfinite/out-of-range coordinates and negative accuracy. Preserve actual source times. Geometry is captured at evaluation; historical records without it retain “current boundary, reference only.” Mirror the wire fields in `ActionLocationAssessment` TypeScript, using strings for UUID/date values. No client-supplied assessment is authoritative.

Produce `evaluate_proximity(*, driver_lat: float | None, driver_lng: float | None, tracker_lat: float | None, tracker_lng: float | None, driver_captured_at: datetime | None, tracker_captured_at: datetime | None, driver_accuracy_metres: float | None, evaluated_at: datetime, max_separation_metres: float, max_age_seconds: int, max_skew_seconds: int, max_phone_accuracy_metres: float) -> tuple[Literal['within_limit','separated','unverified'], float | None, list[str]]`. Keep geometry evaluation in the existing geofence service; orchestration assembles the typed assessment.

- [ ] Write pure tests at coincident fixes, exactly threshold, just below/above, missing coordinates, missing time, missing accuracy, poor accuracy, old fixes, excessive skew and future timestamps. Use injected clock and coordinates generated by the verified geo helper; never sleep.
- [ ] Run `pytest tests/unit/test_proximity_service.py -v` and establish failure.
- [ ] Implement deterministic evaluation: compute factual straight-line separation when both coordinates exist, but only label it `separated` when every quality condition passes. Unverified may still carry a distance; UI must identify that it is not a reliable proximity verdict.

```python
assert verdict_at_exact_limit == 'within_limit'
assert verdict_above_limit == 'separated'
assert verdict_with_stale_tracker == 'unverified'
# Unknown does not become within_limit through a zero-distance fallback.
```

- [ ] Add distinct positive settings `DRIVER_TRUCK_MAX_SEPARATION_METRES`, `DRIVER_TRUCK_MAX_FIX_AGE_SECONDS`, `DRIVER_TRUCK_MAX_SKEW_SECONDS`, `DRIVER_TRUCK_MAX_PHONE_ACCURACY_METRES`. Populate only approved defaults. Do not alter `GPS_TOLERANCE_METRES` or the existing corroboration window as collateral work. Document new keys in the executor report; do not inspect `.env`.
- [ ] Test yard-radius membership separately from separation: both inside but far apart; both outside but together; truck inside/driver outside; phone inside/truck outside. Transit assessments have no invented expected geofence.

### Task 5: Persist assessment snapshots and distinct separation findings

**Files**
- Modify: `backend/app/db/models/phases.py`, `backend/app/db/models/transit.py`
- Modify: `backend/app/schemas/phases.py`, `backend/app/schemas/transit.py`
- Modify: `backend/app/orchestration/corroboration_service.py`, `backend/app/orchestration/phase_service.py`
- Modify: `backend/app/db/models/enums.py`
- Modify: `frontend/shared/lib/types/phase.ts`, `frontend/shared/lib/types/checkpoint.ts`, `frontend/shared/lib/types/exception.ts`
- Modify: `frontend/shared/lib/constants/status-meta.ts`
- Modify: `frontend/dispatcher/lib/format/exception.ts`
- Create: `backend/app/orchestration/action_location_service.py`
- Create migration: `backend/migrations/versions/2026_09_15_ciaran_action_location_assessment.py` (coordinate and verify the current migration head before creation)
- Test: `backend/tests/integration/test_phase_corroboration.py`, `backend/tests/integration/test_gps_mismatch.py`
- Create test: `backend/tests/unit/test_action_location_service.py`

**Interfaces:** nullable `action_location_assessment` JSONB field on phase events, checkpoints and driver exception reports, serialized/validated through `ActionLocationAssessment`, not arbitrary dictionaries at API boundaries. Existing rows remain null. Return assessment from corroboration while retaining existing position/verdict writes for compatibility. Persist the exact tracker timestamp rather than inventing one during display.

Create all additive storage needed by downstream tasks in this migration before applying it: phase `location_warning_acknowledged_at` (aware nullable timestamp) and `location_warning_reason` (nullable text); checkpoint `client_report_id` (nullable UUID) and `phase_event_id` (nullable FK to phase_events), with the per-trip partial unique checkpoint report index. Tasks 7–8 wire these fields through their callers; they must not edit an already-applied migration. Include new indexes in SQLAlchemy model metadata as well as Alembic so isolated test schema creation has the same constraints.

Add exception type `driver_vehicle_separation`. Preserve historical `gps_mismatch` meaning and descriptions. Produce `record_separation_finding(db: AsyncSession, *, trip: Trip, phase_event_id: UUID | None, checkpoint_id: UUID | None, assessment: ActionLocationAssessment) -> None`; exactly one source event is supplied. SYSTEM source, WARNING severity, explicit NEEDS_REVIEW per P5. For driver exception reports, embed a location warning in that report's assessment rather than recursively generating another report.

- [ ] Add regressions showing a reliable far-away phone raises separation even when truck geofence is true; co-located sources outside the precinct raise the existing geofence finding but no separation; both failures may coexist as different findings.
- [ ] Add replay/concurrency tests. Use partial unique indexes per `(phase_event_id, exception_type)` and `(checkpoint_id, exception_type)` restricted to the new type. Do not add broad uniqueness that changes other exception behavior. Existing idempotency keys remain authoritative for phase completion.
- [ ] Run the focused suites and confirm the missing behavior fails.
- [ ] Implement additive migration with no historic backfill. Validate JSON snapshots on read/write, freeze policy values/geometry/timestamps, and reject client attempts to supply backend verdicts. Migration creation requires coordination; do not fetch/rebase to “resolve” another developer's migration chain.
- [ ] Refactor a single tracker acquisition to feed both legacy corroboration and new assessment; do not make two independent tracker reads for one action. Keep the quality rules separate where their historical contracts differ.
- [ ] Add the new finding before returning the final phase response and publish the existing exception-raised event after commit. Preserve successful evidence even when the external tracker is unavailable. Do not swallow database failures and pretend persistence succeeded; use existing transaction/savepoint patterns for optional enrichment and uniqueness races.
- [ ] Confirm legacy clients without accuracy/times are accepted, assessment is unverified, and stored old records retain their original labels/verdicts. Run migration upgrade/downgrade against an isolated DB and verify no change to anchor payload hashes.

### Task 6: Add a non-writing phase location preview

**Files**
- Modify: `backend/app/api/v1/endpoints/phases.py`
- Modify: `backend/app/schemas/action_location.py`
- Modify: `backend/app/orchestration/action_location_service.py`
- Modify: `frontend/driver-pwa/lib/api/phases.ts`
- Create test: `backend/tests/integration/test_phase_location_preview.py`

**Interfaces:** add `POST /api/v1/trips/{trip_id}/phases/{phase_event_id}/location-preview` to the existing phases router, respecting its existing prefix. Body contains phone lat/lng, `driver_captured_at`, nullable `driver_accuracy_metres`; response is `ActionLocationAssessment`. This POST reads independent tracker data but writes no trip evidence, exceptions or phase state. It requires the assigned driver and a valid phase on their trip. Do not register a second router in `main.py`.

- [ ] Write success, unauthenticated, wrong driver/organization, foreign phase, malformed location and unavailable tracker tests. Assert no evidence rows or phase progression changed.
- [ ] Run `pytest tests/integration/test_phase_location_preview.py -v` and establish failure.
- [ ] Implement thin route → orchestration → tracker/geofence/pure evaluator, with bounded adapter timeout and an explicit unavailable result when telemetry cannot be obtained.
- [ ] Expose `previewPhaseLocation(tripId: string, phaseEventId: string, capture: DriverLocationCapture): Promise<ActionLocationAssessment>` in the typed client. Define `DriverLocationCapture` in the shared action-location file with nullable coordinates/accuracy and the actual capture timestamp.
- [ ] Test stale/terminal phase handling returns a clear conflict without mutating anything. Final completion never trusts the preview's values as authoritative and never skips evaluation because a preview succeeded.

### Task 7: Driver warnings, retry and explicit continuation

**Files**
- Create: `frontend/driver-pwa/components/phase/LocationCheckNotice.tsx`
- Create test: `frontend/driver-pwa/components/phase/__tests__/LocationCheckNotice.test.tsx`
- Modify: `frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx`
- Modify: `frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx`
- Modify: `frontend/driver-pwa/lib/submission/phase-submitter.ts`
- Modify: `frontend/driver-pwa/lib/api/phases.ts`
- Modify: `frontend/driver-pwa/lib/hooks/useOfflineQueue.ts` only where the persisted envelope needs additive acknowledgment/accuracy fields
- Modify: `frontend/driver-pwa/lib/types/location.ts`, `frontend/driver-pwa/lib/hooks/useLocation.ts`
- Modify: `backend/app/schemas/phases.py`, `backend/app/db/models/phases.py` (acknowledgment fields included in task 5 migration before it is applied)
- Test: existing phase-step, in-transit, API phases, submission and offline-queue suites under their adjacent `__tests__` directories

**Interfaces:** `LocationCheckNotice` consumes `{ assessment: ActionLocationAssessment | null; loading: boolean; error: string | null; onRetry: () => void; onContinue: (reason: string | null) => void }`. Add optional `location_warning_acknowledged_at` and `location_warning_reason` to submission schema/queue and persist them separately from the backend assessment. The acknowledgment describes the warning the driver saw, not an override of measured truth.

- [ ] Test: pass → normal continuation; reliable failure → readable distance/precinct warning with “Retry location” and “Continue with exception”; latter requires a nonblank reason; unknown → non-accusatory unavailable message and permitted continuation.
- [ ] Run focused Vitest suites before implementation.
- [ ] Capture a fresh phone fix for preview, including accuracy and capture time. Preserve it for its corresponding submission; if the user retries, replace capture and preview together. Do not label a cached phone fix with the current time.
- [ ] Implement this message distinction:

```text
Measured mismatch: Driver and truck were recorded 320 m apart. Limit: 100 m.
Wrong precinct: Truck was recorded outside the expected loading precinct.
Unavailable: We could not compare your location with the truck. Your action can still be recorded.
```

Numbers come from the approved backend assessment, never a hardcoded UI limit. Add accessible loading/error states; do not reset the user's evidence form on preview failure.

- [ ] Preserve offline operation: skip unavailable online preview, queue evidence and original capture time, and show “Location not verified while offline.” Do not hold an old queue entry awaiting interactive acknowledgment. Later backend evaluation may remain unverified; never compare an hours-old phone fix with today's tracker as contemporaneous.
- [ ] Preserve existing scan gates and sequencing. No new “start physical loading” claim is introduced. Final response displays a newly detected discrepancy even if preview passed; P1 warning-only policy means this does not roll back the action.
- [ ] Run driver type-check, targeted tests and build/static export after the full driver slice. Do not retrofit P1 warnings onto emergency reporting.

### Task 8: Checkpoints and driver exception reports retain separation evidence

**Files**
- Modify: `backend/app/orchestration/checkpoint_service.py`, `backend/app/orchestration/exception_service.py`
- Modify: `backend/app/api/v1/endpoints/checkpoints.py`, `backend/app/api/v1/endpoints/exceptions.py` only to pass additive typed fields
- Modify: `backend/app/schemas/transit.py`, `backend/app/db/models/transit.py`
- Modify: `frontend/driver-pwa/lib/api/checkpoints.ts`, `frontend/driver-pwa/lib/api/exceptions.ts`
- Modify: `frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/CheckpointPageClient.tsx`
- Modify: `frontend/driver-pwa/app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx`
- Modify: `frontend/driver-pwa/app/(app)/trip/panic/PanicPageClient.tsx`
- Modify: `frontend/dispatcher/components/domain/ExceptionEvidence.tsx`
- Test: `backend/tests/integration/test_checkpoints.py`, `backend/tests/integration/test_exceptions.py`
- Test: driver checkpoint/exception/panic adjacent suites and `frontend/driver-pwa/lib/api/__tests__/checkpoints.test.ts`

**Interfaces:** reuse `ActionLocationAssessment` and source phone capture metadata. Add optional checkpoint `client_report_id: UUID` and per-trip partial unique index to the task 5 migration, mirroring exception report replay protection. Preserve legacy absent-ID acceptance. Persist checkpoint `phase_event_id` (nullable FK) for exact leg attribution after verifying it belongs to the trip; do not assign replayed checkpoints to whatever phase is current at synchronization time.

- [ ] Write tests for checkpoint separation, one finding on duplicate/concurrent retries, different checkpoints producing distinct evidence, missing phone/tracker and stale offline capture. Verify `checkpoint_id` and correct leg/stop scoping on generated findings.
- [ ] Write driver-report tests proving the report survives tracker outage, records its own capture assessment, and does not borrow coordinates from a phase. Panic must not require a location preview or acknowledgment and must retain original severity.
- [ ] Implement one bounded corroboration attempt as optional enrichment; primary report persistence must not depend on telemetry succeeding. Keep the UI's existing immediate emergency submission feedback, and test response-time behavior using a timed-out adapter mock rather than real sleeps.
- [ ] Store location details on the driver report itself; render an explicit separation/unverified annotation in its evidence. A driver report's source stays DRIVER; label the location annotation as a system comparison. Do not recursively generate separation reports from system-generated exceptions.
- [ ] Extend capture/queue fields compatibly. New checkpoints reuse one ID for retries, rather than creating it inside each API call. Derive period/leg attribution from the original validated context, leaving legacy unassignable records trip-level.
- [ ] Test foreign trip/phase/artifact IDs, endpoint 401/422/404 behavior, successful DB state and no cross-organization reads. Extend dispatcher exception details to show this event's snapshot; no new continuous tracking loop or checkpoint-feed UI is included.

### Task 9: Keep journey summaries outside phase disclosure

**Files**
- Modify: `frontend/dispatcher/components/trips/PhaseTimelineItem.tsx`
- Modify: `frontend/dispatcher/components/trips/TripTimeline.tsx`
- Modify: `frontend/dispatcher/components/trips/PhaseEvidence.tsx`
- Modify: `frontend/dispatcher/components/domain/InTransitTimeline.tsx`
- Create: `frontend/dispatcher/components/trips/TransitJourneySummary.tsx`
- Test: `frontend/dispatcher/components/trips/TripTimeline.test.tsx`
- Create test: `frontend/dispatcher/components/trips/TransitJourneySummary.test.tsx`
- Test: `frontend/dispatcher/components/domain/__tests__/InTransitTimeline.location.test.tsx`

**Interfaces:** add `persistentContent?: ReactNode` to `PhaseTimelineItem`, rendered outside its toggle button and before disclosed children. `TransitJourneySummary` consumes `{ phase: PhaseDescriptor; allPhases: readonly PhaseDescriptor[]; originName: string; destinationName: string; exceptions: readonly TripException[]; onOpenExceptions: () => void }`. Exact phase IDs identify repeated transit legs.

- [ ] Write tests that completed, active and pending transit summaries are visible with evidence closed; pending means awaiting departure; completed uses recorded departure/arrival; overrides do not fabricate arrival.
- [ ] Run `npm test -- components/trips/TripTimeline.test.tsx components/trips/TransitJourneySummary.test.tsx` and establish failure.
- [ ] Extract compact journey nodes into the new summary using existing `legDepartureAt`. Leave full arrival location evidence in `PhaseEvidence`. Remove duplicated departure/arrival rendering from the expanded detail body.

```tsx
{persistentContent && <div>{persistentContent}</div>}
{children && open && <div id={contentId}>{children}</div>}
```

- [ ] Supply correctly scoped exceptions, chronological by captured/event time when available, otherwise explicitly recorded time; use ID as stable tie-break. Display compact severity markers/counts, not artifact galleries. No exception appears twice as a full timeline card.
- [ ] Replace developer integration prose with “Only recorded journey events are shown.” Do not claim a continuous live route or manufacture weighbridge/checkpoint events.
- [ ] Test two transit legs, repeated stops, cancelled trips, exceptional/overridden legs and background rerenders preserving disclosure. Full coordinates remain available when expanded.

### Task 10: Collapsible phase exceptions and panel navigation

**Files**
- Create: `frontend/dispatcher/components/trips/PhaseExceptionGroup.tsx`
- Create test: `frontend/dispatcher/components/trips/PhaseExceptionGroup.test.tsx`
- Modify: `frontend/dispatcher/components/trips/TripTimeline.tsx`
- Modify: `frontend/dispatcher/components/trips/TripExceptionsPanel.tsx`
- Modify: `frontend/dispatcher/components/trips/TripDetailPanel.tsx`
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`
- Test: existing `TripTimeline.test.tsx`, `TripExceptionsPanel.test.tsx`, `TripDetailPanel.test.tsx` and trip page test

**Interfaces:** group consumes `{ phaseId: string; exceptions: readonly TripException[]; children: ReactNode; onOpenPanel: () => void }`. Initial state collapsed. URL `panel=exceptions&exceptions=all&phase=<phase_event_id>` scopes the panel; absent `phase` means whole trip. Reject/clear foreign phase filters visibly, rather than displaying another trip's records. `onOpenExceptions(phaseId: string): void` is passed from page through timeline/summary.

- [ ] Write a test using two exceptions, one needs-review: badge reads “2 exceptions · 1 needs review”; details hidden initially; one click reveals both; second hides both; no review API invoked.
- [ ] Add tests proving phase expansion and exception expansion are independent and IDs persist through refetch. Test zero, singular and plural copy and duplicate IDs.
- [ ] Implement a real button with `aria-expanded`/`aria-controls`, outside the phase-toggle button; retain visible highest severity and review count. Render ordinary phase cards through existing `ExceptionSummary`/evidence components.

```tsx
<button type="button" aria-expanded={open} aria-controls={contentId}
  onClick={() => setOpen(value => !value)}>
  {count} {count === 1 ? 'exception' : 'exceptions'} · {needsReview} {needsReview === 1 ? 'needs' : 'need'} review
</button>
```

- [ ] For transit, use the same independent disclosure for full exception detail while retaining compact markers in the journey. Collapsing it never hides the marker/count. Do not also render an unconditional full-card stack below.
- [ ] Add selected-phase and clear-filter controls to the panel. Phase-link entry forces `all`; ordinary trip exception entry retains existing needs-review/all preference. Counts explicitly distinguish selected-phase totals from trip totals.
- [ ] Add “Show in timeline” per linked exception. Scroll within the timeline container, expand the target exception group, focus its heading and highlight briefly respecting reduced motion. Clicking from an overlay first closes the overlay; sidebar mode stays docked. No automatic scrolling on polling/refetch.
- [ ] Test Back/Forward, narrow overlay and wide panel, unknown phase URL, trip-level exceptions, warnings hidden by default filter but visible via phase entry, and review-state updates reducing the count without collapsing the user's group.

### Task 11: Clear status, readable density and truthful freshness

**Files**
- Modify: `frontend/dispatcher/lib/phase/location-evidence.ts`
- Modify: `frontend/dispatcher/components/domain/LocationEvidenceSummary.tsx`
- Modify: `frontend/dispatcher/components/domain/LocationEvidencePanel.tsx`
- Modify: `frontend/dispatcher/components/trips/TripSummary.tsx`
- Modify: `frontend/dispatcher/components/trips/TripTimeline.tsx`
- Modify: `frontend/dispatcher/components/trips/TransitJourneySummary.tsx`
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`
- Test: `frontend/dispatcher/lib/phase/location-evidence.test.ts`, `TripSummary.test.tsx`, `TripTimeline.test.tsx`, location-panel and transit-summary suites

**Interfaces:** use persisted `ActionLocationAssessment` for new proximity/geometry results; continue reading legacy stored geofence boolean for old events. Never manufacture a historical proximity pass/fail from current settings. If only legacy coordinates exist, show numerical distance as “Recorded source separation; proximity not evaluated.”

- [ ] Write the original 7.9 km example as a regression: the geofence badge names the truck, and a separate proximity label does not imply 7.9 km is accepted. Verify unverified numeric distance remains neutral.
- [ ] Change copy consistently in compact card, expanded evidence, map and exception supporting evidence:

```text
Truck within precinct tolerance
Truck outside precinct tolerance
Truck precinct check unavailable
Driver–truck separation: 7.9 km
Driver proximity: Outside limit / Within limit / Unable to compare
```

- [ ] For evaluated geometry snapshots, show the recorded boundary and policy. For legacy records, keep “Current precinct boundary (reference only).” Do not switch old historical verdicts when precinct configuration changes.
- [ ] Show “Complete” and “1 exception needs review” as separate adjacent statuses. Trip completion is not evidence that every exception was reviewed. Preserve the record-integrity disclaimer that committed trip fields are not every photo/phase record.
- [ ] Reduce sticky-header padding and move secondary facts behind existing information access. Keep trip/route, current status, exceptions count and driver/vehicle identity readily accessible. At a 1024×768 viewport the header should target no more than about 180px while allowing text zoom/wrapping; do not enforce a clipping fixed height.
- [ ] Add a compact current-leg strip only for an active transit leg while its full row is out of view (IntersectionObserver scoped to the timeline scroller). It shows route/status/count and “Show current leg.” It disappears for completed trips and never auto-scrolls. All observed elements/listeners clean up on navigation.
- [ ] Use at least 12px for journey metadata and 14px for primary journey labels; verify contrast with existing tokens, keyboard focus and 200% zoom. These are local readability changes, not a global design-system rewrite.
- [ ] Label refresh timestamp “Record refreshed …”. Show tracker capture time from persisted assessment when available; otherwise “Tracker reading time not recorded.” Do not call this a live vehicle map. Surface stale/error state without clearing the last good record or shifting focus.
- [ ] Run the affected suites plus dispatcher type-check/lint. Browser-check 390, 1024, 1280 and 1440px, long precinct names, 200% zoom, dark/light themes if supported, reduced motion, many exceptions and keyboard-only operation.

### Task 12: Integrated verification and handoff

**Files:** no unrelated edits. Update only this plan's execution checklist and directly affected tests/documentation when implementation is authorized.

- [ ] Confirm every requirement-map row has a completed task or an explicitly reported unapproved policy dependency. Do not describe a partial implementation as all nine items fixed.
- [ ] Run backend focused suites after each change. After the backend workstream passes, run `pytest` from `backend` once against the isolated test DB. Record actual command/result; do not claim tests passed from an earlier session.
- [ ] In both `frontend/dispatcher` and `frontend/driver-pwa`, run `npm run type-check`, `npm run lint`, `npm test`, then `npm run build` for each changed application. Investigate actual failures; do not upgrade dependencies to bypass them without scope approval.
- [ ] Run the manual matrix below with disposable fixtures and explicit authorization for stateful browser tests. Preserve the user's existing trip records. Pure modal open/close and disclosure checks are read-only.
- [ ] Check `git diff --check` and inspect only the intended diff. Do not stage or commit. Report files, migrations, new settings, shared-file coordination, tests, known limitations and remaining policy decisions.

## Manual acceptance matrix

| Scenario | Expected observation |
|---|---|
| Trip with non-Cape-Town origin and destination | Simulation buttons name/move to those assigned stops |
| Destination simulation during origin loading | Target says destination; expected location remains origin and its check fails |
| Repeated visit to same precinct | Distinct stop IDs/sequence; correct phase and exception attribution |
| Truck in correct precinct, phone 7.9 km away | Truck precinct pass plus independent separation finding when timing/quality valid |
| Both inside a large yard but over approved distance | Independent separation finding; no fabricated truck-geofence failure |
| Driver and truck together at wrong depot | Proximity pass, expected-precinct failure |
| Source timing/accuracy unavailable | Unverified result; no “driver separated” accusation |
| Offline submit synchronized hours later | Original capture preserved; present tracker is not treated as historical corroboration |
| Same action retried/concurrent requests | One action and one finding per type/source event |
| Panic away from truck or without GPS | Report remains possible without preview/reason gate |
| Closed transit phase with evidence collapsed | Departure/arrival mini-timeline remains visible |
| Active transit row scrolled away | Compact current-leg strip remains accessible |
| Phase with two exceptions | Count visible; one toggle opens/closes both; review state unchanged |
| GPS warning opened via phase link | Visible in all-recorded phase-filtered panel |
| Map dragged outside any edge | Modal remains open; map can still be panned |
| Wheel over map vs surrounding dialog text | Map zoom vs dialog scroll respectively |
| Cancel from narrow information overlay | Cancellation centered in viewport; dismiss returns focus; no trip mutation |
| Complete trip with outstanding review | Both completion and review obligation visible |
| Poll/SSE update during reading | Counts update; focus, scroll and disclosure state remain stable |

## Explicit exclusions and future work

- No live Pulsit route feed, new weighbridge feed, response dispatching or automatic rerouting.
- No implicit mock phone movement to make a truck simulation pass. If a phone simulator is desired, specify it separately and label its evidence provenance.
- No dedicated third permanent transit pane. The existing detail panel and persistent compact journey address the requested visibility first.
- No reinterpretation/backfill of old exception records, timestamps or current-boundary maps.
- No automatic claims of loading-start time or continuous driver presence. Submission-time snapshots establish only that recorded moment.
- No unrelated authentication, analytics, dependency, schema cleanup or exception workflow redesign.
- If future policy requires a hard block, revise this plan before code: authorization, attempt evidence, offline behavior and audit semantics are not interchangeable with warning-only recording.

## Session execution strategy for Claude

Use a few focused Claude sessions, with this document as the persistent handoff. Group related tasks rather than opening a new session for every small change or attempting the entire plan in one long session. Session boundaries are review checkpoints; they do not replace each task's regression tests.

### Recommended sessions

| Session | Scope | Tasks | Entry condition | Completion checkpoint |
|---|---|---|---|---|
| 1 | Map gestures, modal dismissal and cancellation positioning | 1–2 | User authorizes these UI fixes | Focused tests pass; browser reproductions verified; no cancellation submitted on an existing trip |
| 2 | Trip-specific truck simulation | 3 | Session 1 reviewed; user authorizes simulation changes | Non-Cape-Town and multi-stop cases pass; mock-only writes verified |
| 3 | Location policy, pure evaluator and persistence | 4–5 | User explicitly approves P1–P6 and coordinates shared files/migrations | Approved policies recorded here; evaluator, persistence, replay and migration tests pass |
| 4 | Driver preview, warnings, checkpoints and reports | 6–8 | Session 3 contracts and storage reviewed | Driver/backend integration, offline compatibility and emergency-report behavior verified |
| 5 | Transit visibility, exception disclosure and UI polish | 9–11 | Location response contracts available; earlier work reviewed | Responsive/browser checks and affected dispatcher tests pass; historical evidence remains truthful |
| 6 | Integrated verification and remaining in-scope fixes | 12 | All implementation sessions reviewed | Full applicable checks and acceptance matrix completed; remaining limitations reported |

Session 3 begins with decisions, not code. “Approve the plan” must not silently accept the proposed numerical settings when the user has left them unresolved. If P1 changes to hard blocking, revise the dependent tasks before implementation. Session 5's UI-only work may be brought forward if requested, but its evaluated proximity display still depends on the location contracts.

Before implementation in every session, have Claude critically check the assigned tasks against current source. Requirements are preserved by this document; proposed API contracts, migration design and implementation details still need verification. Correct material contradictions in the plan and obtain a decision where behavior or scope would change. Do not implement a known flaw simply because it appears in this file.

### Subagent use within a session

- The main Claude session owns scope, architecture decisions, policy interpretation, integration and the final report.
- Use subagents only when the execution request explicitly authorizes them. This strategy describes how to use them; it does not dispatch agents or authorize implementation now.
- Prefer one implementation agent at a time for dependent tasks, followed by an independent reviewer. Use `superpowers:subagent-driven-development` when that mode is selected; otherwise execute inline with `superpowers:executing-plans`.
- Parallel read-only investigations and reviews are useful when their questions are independent. Parallel edits require disjoint, explicit file ownership and stable interfaces.
- Never give concurrent writers ownership of `phase_service.py`, shared types, a migration file or other overlapping files. Coordinate changes to the central settings and model registry before dispatch.
- Give each subagent a self-contained brief: assigned task numbers, exact file ownership, approved policies, required interfaces, tests, exclusions and stop conditions. Tell it that other work may exist and must not be reverted.
- A reviewer checks behavior against this plan and the actual diff, including tests, offline/replay behavior and tenant isolation where relevant. The main session resolves findings and reruns affected checks before marking a task complete.
- Do not run concurrent mutation suites against the same test database or mock namespace. Serialize them unless isolation has been established.

### Reusable session-start prompt

The following prompt starts session 1. For later sessions, replace “tasks 1–2” with the task range in the table and include the preceding session's handoff. For session 3, explicitly supply the approved P1–P6 decisions before authorizing dependent implementation.

```text
Read CLAUDE.md in full and
docs/superpowers/plans/2026-09-15-trip-location-timeline-improvements.md.
Use Graphify to locate relevant code without rebuilding the graph.

Execute tasks 1–2 only, using superpowers:executing-plans. First check the
assigned tasks against current source and flag material contradictions.
You may use subagents for bounded implementation and independent review,
but do not give overlapping file ownership. If using subagent-driven
execution, follow superpowers:subagent-driven-development.

Preserve existing working-tree changes. Do not commit, stage, push,
switch branches or run migrations against the demo database. Follow the
plan's regression tests and browser acceptance checks. Use an isolated
test database for mutation tests; do not change the user's existing trips.

Update the plan with completed steps, actual test results, changed files,
approved decisions and remaining issues. Finish with a self-contained
handoff that a fresh session can follow. Do not begin the next session's
task range automatically.
```

### End-of-session handoff

Append a dated execution record to this document after each implementation session. Include:

1. Session number and task numbers completed, partially completed or not started.
2. User-approved policy decisions and any changes to this plan, with their reasons.
3. Exact files changed and public contracts introduced or altered.
4. Commands actually run, pass/fail results, and specific browser scenarios verified. Separate failures introduced by the work from pre-existing failures using evidence.
5. Migration filename and status: created, tested on an isolated DB, or applied to an explicitly authorized environment. Never imply a migration ran when only its file was written.
6. Remaining defects, blocked decisions and known limitations; leave unfinished task checkboxes unchecked.
7. The next session's task range, dependencies and any important working-tree state it must preserve.

The user reviews each completed group and handles any desired Git checkpoint. Agents must not create commits or switch branches. Start the next session only after the preceding group's implementation, tests and review are complete, or after the user explicitly accepts a documented unresolved dependency.

## Execution record — Session 1 (2026-09-15)

**Mode:** `superpowers:subagent-driven-development` (user-selected). Controller: Opus 5; implementers and task reviewers: Sonnet, one implementer + one combined spec/quality reviewer per task, disjoint file ownership, Tasks 1 and 2 run in parallel. SDD ledger with all rulings: `.superpowers/sdd/2026-09-15-trip-location-timeline-improvements/progress.md` (git-ignored; rulings are also reproduced below so this document stays self-contained).

### 1. Tasks
- **Task 1 — complete in working tree**, task review Approved (no Critical/Important findings). Browser acceptance checks NOT performed (see §4).
- **Task 2 — complete in working tree**, task review Approved (no Critical/Important findings). Viewport centring checks NOT performed (see §4).
- Tasks 3–12: not started. P1–P6 remain unapproved (no user decision was given this session; nothing depending on them was touched).

### 2. Decisions and plan deviations (controller rulings; user has not separately approved these — review and revert any you disagree with)
- **R0** No commits/staging (CLAUDE.md overrides the SDD skill). All work is uncommitted in the working tree.
- **R1** jsdom 25.0.1 has no `PointerEvent`, so `Modal.test.tsx` installs a minimal test-only polyfill and stubs `getBoundingClientRect` on the dialog in every pointer test (the plan's sample regression would otherwise pass vacuously against jsdom's zero rect).
- **R2** Leaflet is not mountable in jsdom, so `LocationComparisonMap.tsx` exports `COMPARISON_MAP_INTERACTION = { scrollWheelZoom: true } as const`, spread into `L.map(...)`, and the test asserts on it. `GeofenceMap.tsx` untouched.
- **R3** `TripInformation` prop `onChanged` was **replaced** by `onCancelTrip: () => void` (its only consumer was the cancel action). `TripDetailPanel` keeps `onChanged` and passes it as `onCancelled`; `app/(app)/trips/[id]/page.tsx` unchanged.
- **R4** `CancelTripAction.tsx` keeps its filename and now exports controlled `CancelTripDialog` plus `isTripTerminal(status)`; the unconsumed uncontrolled `CancelTripAction` component was removed. `TripInformation` renders the "Cancel trip" trigger itself, hidden for terminal statuses.
- **R5** Tasks 1 and 2 implemented in parallel (disjoint ownership; user permitted non-overlapping subagents).
- **R6** `autoFocus` removed from the cancellation `TextArea`: React's `autoFocus` calls `.focus()` at commit, before `Modal`'s effect calls `showModal()`, so inside a closed `<dialog>` it never worked in browsers; in jsdom it made `Modal` capture the textarea as the focus-return target and broke the required focus-return test. Reviewer confirmed no real-browser behaviour change.
- **R7** No separate final whole-branch review was dispatched: the two tasks are disjoint, each had a clean combined review, and the controller ran the full suite/type-check/lint (per the user's standing preference for one reviewer per task).

### 3. Files changed and contracts
All under `frontend/dispatcher/` (10 tracked files modified, 0 created, 0 deleted; no shared files, no backend, no migrations, no new env keys, no dependency changes):
- `components/ui/Modal.tsx` — `ModalProps` unchanged. Dismissal now requires a pointer gesture whose `pointerdown` and `pointerup` (same `pointerId`) both fall outside the dialog's bounding rect, followed by the `click`; gesture state reset on `pointercancel`, after each click, and on close/unmount. A `click` with no recorded gesture never dismisses. Escape/close button/`closeDisabled` unchanged.
- `components/ui/Modal.test.tsx` — 10 tests (was 2): inside-origin drag released outside, genuine backdrop click, outside→inside drag, pointercancel, closeDisabled, differing pointerIds, plus the original Escape/focus/size tests.
- `components/map/LocationComparisonMap.tsx` — exported `COMPARISON_MAP_INTERACTION` (`scrollWheelZoom: true`), spread into `L.map`; comment updated with the modal-context rationale. No custom wheel handlers added.
- `components/map/__tests__/LocationComparisonMap.test.tsx` — +1 test on the interaction constant.
- `components/domain/CancelTripAction.tsx` — **new public contract**: `CancelTripDialog({ tripId: string; status: Trip['status']; open: boolean; onClose: () => void; onCancelled: () => void })`, `isTripTerminal(status: Trip['status']): boolean`. Removed: `CancelTripAction`. Terminal-while-open → renders nothing and calls `onClose()` once; note reset on close/reopen; submission/error handling preserved verbatim.
- `components/domain/CancelTripAction.test.tsx` — rewritten for the dialog (availability, terminal-while-open, required note, trimmed submit, double-submit guard, 409 message, dismissal/no API/reset).
- `components/trips/TripInformation.tsx` — **prop change**: `onChanged` → `onCancelTrip`; renders the trigger, hidden when terminal.
- `components/trips/TripInformation.test.tsx` — trigger calls `onCancelTrip`, renders no dialog, hidden for `closed`/`cancelled`.
- `components/trips/TripDetailPanel.tsx` — `cancelOpen` state; `CancelTripDialog` rendered as a sibling of `DetailPanel` (next to `PrecinctModal`). External props unchanged.
- `components/trips/TripDetailPanel.test.tsx` — narrow-layout structural regression (cancel dialog not a descendant of the "Trip information" dialog), dismiss via "Keep trip active" with no API call/no `onChanged`, focus returns to trigger.

### 4. Commands run and results (this session, 2026-09-15)
- Task 1 TDD: `npm test -- components/ui/Modal.test.tsx` — RED against pre-fix `Modal.tsx`: `5 failed | 5 passed (10)`; GREEN: `10 passed (10)`. Owned suites: `29 passed (29)`.
- Task 2 TDD: `npm test -- components/domain/CancelTripAction.test.tsx components/trips/TripDetailPanel.test.tsx components/trips/TripInformation.test.tsx` — RED before implementation: `15 failed | 4 passed (19)`; GREEN: `19 passed (19)`.
- Controller, after both tasks: `cd frontend/dispatcher && npm test` → **73 files, 779/779 passed**; `npm run type-check` → clean; `npm run lint` → 0 errors, 2 pre-existing `@next/next/no-img-element` warnings in `components/domain/EvidencePhoto.tsx` (untouched). Pre-existing jsdom "Not implemented: navigation" stderr in Driver/Vehicle/PrecinctModal tests (untouched files).
- No backend tests were run or needed (no backend files touched). No database was touched.
- **Browser checks: NOT performed.** The dispatcher dev server (`:3000`, this working tree) requires a signed-in session; the Claude-in-Chrome extension was not connected and the controller does not enter credentials. The user chose to defer browser checks "until everything is done". Outstanding from the acceptance matrix: map dragged outside any edge (left/right/top/bottom, drag returning inside), ordinary outside click, touch/pointer cancellation, wheel over map vs surrounding dialog text, Escape and focus return; cancellation dialog centring at 390/1024/1279/1280/1440px with dismiss-returns-focus (open/dismiss only — never submit on an existing trip). Known residual risk until then: whether Leaflet's drag handling lets `pointerup` reach the dialog's `onPointerUp` in real browsers (reviewer ⚠️).

### 5. Migrations
None created, tested or applied.

### 6. Remaining defects, deferred minors and limitations
- Deferred minor (Task 1): `gestureRef` comment says "keyed by pointerId" but it is a single slot; a second concurrent pointer overwrites the first. Tighten the wording or use a `Map` if multi-pointer matters.
- Deferred minor (Task 1): `handlePointerCancel` clears `dismissGestureRef` even for an unrelated pointerId (theoretical).
- Deferred minor (Task 2): `TripDetailPanel` passes an inline `onClose` closure that sits in `CancelTripDialog`'s terminal-effect deps; harmless (effect re-checks `open && terminal`), `useCallback` if the pattern is copied.
- The unit tests cannot prove native `<dialog>`/Leaflet pointer behaviour; the browser matrix above is still owed.

### 7. Next session
- **Do first:** the deferred browser checks for Tasks 1–2 (sign in on the dev server; read-only on existing trips).
- **Then Session 2 = Task 3** (trip-specific truck simulation; backend + DevTriggerPanel). It does not depend on P1–P6. Entry condition per the plan: Session 1 reviewed by the user.
- **Session 3 (Tasks 4–5) must start with P1–P6 decisions**, not code.
- Working-tree state to preserve: the 10 modified dispatcher files above (uncommitted), plus the pre-existing untracked files (`.agents/`, `.claude/launch.json`, `.codex/`, `.playwright-mcp/`, `PLAN.md`, `docs/reviews/...`, this plan). Suggested commit for the user, once browser checks pass: `fix(dispatcher): keep map modal open through drag gestures and lift trip cancellation out of the detail overlay`.

## Planning-session self-review

- [x] All nine user items and the additional UI observations map to tasks.
- [x] Confirmed defects are distinguished from proposed product policies.
- [x] Numerical defaults are explicitly proposed and approval-dependent.
- [x] No application change is claimed or authorized by writing this document.
- [x] Tasks include file boundaries, interfaces, regression cases, implementation guidance and commands.
- [x] Unknown/stale evidence, multi-stop trips, offline replay and tenant isolation are covered.
- [x] Existing Graphify output was used for navigation; no graph rebuild is part of the plan.
- [x] Repository Git restrictions override skill commit/worktree examples.

**Execution handoff:** Review P1–P6 and approve the implementation scope. Then execute task-by-task inline using `superpowers:executing-plans`, or explicitly request subagent-driven execution. The next executor must reread current source and `CLAUDE.md`, reconcile intervening changes, and keep this document's checkbox evidence current.
