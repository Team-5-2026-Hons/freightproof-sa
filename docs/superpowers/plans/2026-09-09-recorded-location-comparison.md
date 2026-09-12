# Recorded location comparison maps

Status: proposal recorded 9 September 2026; Stage 1 contract review completed 12 September
2026 (see the section at the end). No implementation started.

## Handoff

FreightProof SA records evidence about trips. The user wants to preserve the current
single-leg dispatcher design and assess maps comparing a driver's phone with the truck
tracker at recorded phases or exceptions. Build an on-demand evidence viewer using the
existing map stack, not a live fleet dashboard. Read CLAUDE.md and the current graph
before execution. Source contracts must be checked again because this is a future plan.
Stage 1's data-contract review is done — read "2026-09-12 contract review" below before
Stage 2; it amends the rules and scope above.
Implementation and shared-file/migration ownership must be agreed separately.

## Decision and scope

Recommend a compact phase verdict plus a “Compare recorded locations” disclosure.
Opening it shows a read-only comparison; an existing Modal can offer a larger view.
Use the same viewer from GPS-mismatch exception detail and its trip timeline evidence.
Other exception types get a comparison only when they have corresponding evidence.

Alternatives considered: permanent maps on every phase make the timeline long and load
unnecessary tiles; a standalone map page loses trip context. A local schematic is the
first fallback, and the default if the mapping provider cannot meet the project's data
handling requirements. No continuous tracking, route reconstruction, or new operational
alerts. No new map per pending phase, fabricated capture, or automatic GPS collection.

## What exists and what is missing

- backend/app/orchestration/geofence_service.py calculates radius plus tolerance.
- corroboration_service.py records timely horse fixes, the nullable verdict and trailer
  snapshots. phase_service.py captures phone positions and raises GPS-mismatch records.
- PhaseLocationSection.tsx displays phone/horse coordinates, separation and verdict for
  activation, departure and confirmation. Loading and unloading also call corroboration
  server-side but currently omit this shared location section.
- TripTimeline.tsx and PositionDisagreement.tsx already display GPS-mismatch evidence.
- components/map/GeofenceMap.tsx uses Leaflet, external tiles and a schematic fallback;
  it is precinct-oriented, so reuse infrastructure rather than forcing comparison data
  into an editing component. GeofenceSchematic currently draws only a radius, not fixes.
- The persisted verdict is not a historical geofence snapshot. Current precinct geometry
  can change, and horse fix time is not a separate phase column. Backend driver capture
  time exists but must be checked against the shared frontend read contract.
- Exceptions do not universally have a contemporaneous tracker fix. A linked phase fix
  is phase evidence, not automatically evidence of the exception's location/time.
- In-transit arrival deliberately has no geofence verdict because its phase stop points
  to the origin. Destination-based arrival verification is a separate backend decision.

## Evidence and display rules

1. Label markers “Driver phone” and “Horse tracker”; distinguish by shape and text as
   well as colour. Coordinates identify devices, not proof of the driver's presence.
2. Show source and capture time per fix when known. A phase completion/receipt time is
   not a substitute for a device capture time. Never fetch today's tracker position to
   fill a historical gap. Distinguish mocked and production sources where known.
3. Two usable fixes permit a measured separation. Missing one means “Comparison
   unavailable” and still permits viewing the one recorded point. No zero fallback.
4. Show the stored geofence verdict independently of the drawing. Use “Within accepted
   tolerance”, “Outside accepted tolerance”, or “Not verified”; pending phases say
   “Not checked yet”. Never derive a new historical verdict in the browser.
5. Historical geometry, radius and tolerance may be drawn only if recorded. Otherwise
   omit the boundary by default or explicitly offer “Current precinct boundary — reference
   only”. Do not reconstruct historical geometry from current settings.
6. Draw a separation line, not a travelled route. Fit both fixes and the relevant boundary;
   handle coincident markers, large separation and invalid coordinates without clipping.
7. Exception view names which event each point belongs to. If only phase data is available,
   label it “Linked phase locations” with its time, not “Locations at this exception”.
8. Compact summaries stay useful without opening a map. A mismatch remains visible and
   links to the existing review workflow; opening the map does not mark it reviewed.

## Proposed component responsibilities

Paths are relative to frontend/dispatcher. Names are proposals, not existing exports.

| Component/module | Single responsibility |
| --- | --- |
| lib/phase/location-evidence.ts | Typed mapping from API evidence to fixes, sources, timestamps, boundary provenance and stored verdict |
| components/domain/LocationEvidenceSummary.tsx | Compact recorded verdict and comparison availability |
| components/domain/LocationEvidencePanel.tsx | Legend, text facts, provenance, errors, disclosure and expanded-view control |
| components/map/LocationComparisonMap.tsx | Read-only Leaflet markers, boundary, bounds and resize handling |
| components/map/LocationComparisonSchematic.tsx | Local comparison drawing when tiles are unavailable or disallowed |

Keep fetching in existing trip/exception hooks. Map renderers accept data and never call
Pulsit, mutate a precinct, or own auth. Reuse Modal, shared geo calculations, tile/error
handling and design tokens. Refactor common map internals only where both consumers
actually need them; keep precinct editing behaviour intact.

## Staged execution checklist

### Stage 1 — Confirm the evidence contract

- Goal: agree exactly what each phase/exception can honestly display.
- Where: phase and exception models/read schemas, resource_service, corroboration_service,
  shared phase/exception types; existing location components.
- Work: map field origin and timestamps; decide whether the first release uses existing
  evidence with explicit gaps or also persists future geofence snapshots and reason/source
  metadata. If extending persistence, define capture timing, retry semantics, ownership and
  whether that evidence belongs in an existing anchor payload before writing a migration.
- Visible result: reviewed examples for complete, missing, stale, overridden and exception-
  only evidence showing exact labels, sources and unavailable fields.
- Verify: contract/serialization tests and fixtures derived from backend-shaped responses;
  ensure null, false and true remain distinct. Never backfill guessed historical facts.
- Fence: no collection changes or destination-arrival verification without a separate scope
  decision. Coordinate any migration with the developer integrating into dev.

### Stage 2 — One phase end to end

- Goal: an activation phase can open a comparison while keeping its normal summary.
- Where: proposed location components/model, ActivationDetail, PhaseEvidence and map tests.
- Work: first show coordinates, times and a local schematic; add lazy-loaded tiles only
  after the provider/privacy decision. External tile requests can reveal the viewed area
  through their tile coordinates even when marker coordinates stay in the browser.
- Visible result: two clearly labelled recorded points, separation, appropriate boundary
  provenance, accessible disclosure and optional larger view.
- Verify: component tests for missing/coincident/distant fixes, keyboard/focus return,
  stored false versus null, tile failure and no requests before expansion. Browser-check
  390/768/1440 widths, short screens and enlarged text using safe test fixtures.
- Fence: no reverse geocoding, device identifiers in tile requests, analytics containing
  locations, new dependencies without agreement, or deployment as part of this stage.

### Stage 3 — Reuse across phases and exceptions

- Goal: comparable evidence is discoverable wherever it was actually recorded.
- Where: TripTimeline, applicable phase details, PositionDisagreement and exception detail.
- Work: compact verdict on resolved phase rows; reusable viewer for loading/departure/
  unloading/confirmation where evidence exists. In-transit displays recorded fixes only
  with explicit absence of a destination verdict. Keep one map mounted per opened viewer.
- Visible result: dispatcher moves from an exception to the same attributed comparison
  in the trip, preserving returnTo and review state.
- Verify: phase ownership, exception versus phase timestamps, no invented tracker point,
  no duplicate exception records, correct pending/overridden/terminal rendering and safe
  navigation. Test precinct editing independently after any shared-map extraction.
- Fence: no blanket “Trip verified” badge or implication that a matching geofence proves
  delivery, identity, or that every phase was checked.

### Stage 4 — Security and release verification

- Goal: evidence remains scoped, historically honest and usable under failure.
- Where: existing auth/cache/API tests plus new location-viewer coverage.
- Verify: tenant authorization, sign-out/account switch and rejected refresh clearing,
  out-of-order requests, expired URLs, tile failure, missing timestamps and changed
  precinct boundaries. Run dispatcher tests, lint, type-check and production build; run
  backend unit/integration suites if contracts or persistence changed. Record actual
  results and environment limitations in this document before release.
- Visible result: reviewer can inspect the same record with maps available or unavailable
  without losing the textual evidence or seeing another account's data.
- Fence: no changes to real trips merely to exercise UI states; no production rollout
  or Git history operations without the relevant user/team workflow.

## Open decisions and tripwires

- Historical snapshots: if the available contract lacks timestamps/boundary provenance,
  release an explicitly limited viewer or schedule capture work; do not guess fields.
- Provider/privacy: assess existing providers against project requirements before enabling
  historical personal-location tile requests. Use a local schematic while unresolved.
- Exception evidence: if matching-time tracker data does not exist, show the exception's
  own point and separately attributed phase evidence; future capture is a separate task.
- Arrival geofence: leave the current backend rule intact unless a destination lookup and
  corresponding tests are independently approved.

## 2026-09-12 contract review (Stage 1 findings)

Stage 1 was carried out as a source check against the branch at `0eac054` (Ciaran, with
FP-68 merged). These findings amend the sections above; where they conflict, this section
wins. No code, schema, data or tests were changed for this review.

### Corrections to "What exists and what is missing"

| Claim / rule | Finding | Amendment |
| --- | --- | --- |
| Driver capture time "must be checked against the shared frontend read contract" | `PhaseEventRead.driver_captured_at` exists (`backend/app/schemas/phases.py`) and the driver app sends it, but `PhaseDescriptor` in `frontend/shared/lib/types/phase.ts` does not declare it, so the dispatcher cannot read it today. | Stage 2 adds `driver_captured_at: string \| null` to `PhaseDescriptor`. This is a `frontend/shared/` change — flag it in TASK COMPLETE. |
| Horse fix time "is not a separate phase column" | Confirmed (`corroboration_service.py`, module docstring). However, the skew gate only persists a horse fix already proven within tolerance of `driver_captured_at`. | Label the tracker fix as captured "within N s of the driver capture" (N = the corroboration skew constant), never with its own timestamp. |
| Rule 2: "distinguish mocked and production sources where known" | `PulsitFixSource` (mock/live) lives on the in-memory fix and is never persisted to `phase_events`. Not knowable from the read model. | Dropped for v1. A `horse_fix_source` column is a separate, ownership-agreed task. |
| Rule 5: historical geometry, radius and tolerance "may be drawn only if recorded" | Distance, radius and tolerance are logged at verdict time and not stored. | Confirmed: v1 draws only "Current precinct boundary — reference only", or omits it. No persistence added in v1. |
| Stage 2: "keep its normal summary" | `PhaseLocationSection.tsx` already violates rules 4–5: it computes `geofenceOffsetMetres` against the *current* precinct in the browser, and renders a null verdict as "Awaiting Pulsit". After FP-68, null means "not evaluated" (in-transit, no usable fix, skew-gate failure, or unresolved precinct). | Stage 2 rewords the existing summary: null → "Not verified", drop the per-fix browser-computed fence offset or label it as against the current boundary. The summary must not outlive the plan's own rules. |
| Rule 7 and Stage 3: `gps_mismatch` exception evidence | FP-145 raises `gps_mismatch` only on `pulsit_geofence_confirmed is False` — the *tracker* was outside the stop's fence. The exception row stores the driver phone position. `PositionDisagreement` shows phone-vs-tracker separation, which is context for the dispatcher, not the trigger (also noted in `docs/reviews/2026-09-10-ciaran-branch-review.md`). | The exception view states the trigger explicitly ("Vehicle tracker outside the facility boundary") and presents the separation as an accompanying measurement, not the reason. No phone-vs-tracker disagreement rule exists; do not imply one. |
| (not mentioned) trailer positions | `trailer_gps_snapshots` is written per trailer per phase and `TrailerGpsSnapshotRead` exists, but no endpoint returns snapshots. | Out of scope for v1. Recorded here so the viewer's data model leaves room for additional labelled fixes later. |

Still accurate and unchanged: loading and unloading omit the location section;
`GeofenceMap.tsx` is editing-oriented (draggable marker, `onPositionChange`) so a separate
read-only renderer is the right shape; in-transit deliberately carries no verdict
(`_PHASES_WITHOUT_A_GEOFENCE_VERDICT`).

### Revised scope for v1

- Read-side only. No migration, no new persistence, no backend changes.
- One shared-type addition (`driver_captured_at` on `PhaseDescriptor`).
- Stage 1 is closed by this section. Execution starts at Stage 2.

### Preconditions before Stage 2

1. Merge `origin/dev` into the working branch first (it carries the PR #48 merge commit and
   FP-236, unrelated but avoids a mid-feature rebase).
2. Confirm with Tim that dispatcher-side display of the FP-68 verdict is not inside
   FP-87 / FP-116. Backend Pulsit/geofence work is his per `iteration3_plan.md`.

## Progress

- 2026-09-09: proposal recorded only. Existing map/data paths inspected. No application
  code, schema, data, tests or deployment changed for this planning task.
- 2026-09-12: Stage 1 contract review completed against source; findings recorded above.
  No application code, schema, data or tests changed.
