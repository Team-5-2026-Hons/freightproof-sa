# Timeline and header revert — review handoff

**Date:** 2026-09-16 · **Branch:** `ciaran` · **Scope:** `frontend/dispatcher` only.

Follow-up to [2026-09-15-trip-location-timeline-improvements.md](2026-09-15-trip-location-timeline-improvements.md).
That plan's Tasks 9–11 (dispatcher presentation) were executed by Codex in `015c572` plus
uncommitted work; the user rejected the presentation outcome. Backend, driver-PWA, and
plan Tasks 1–8 are untouched by this handoff.

## What was wrong and what changed

| Observation | Cause | Change |
|---|---|---|
| Header lost Schedule and Cargo; panel buttons duplicated the docked panel's tabs | `TripSummary.tsx`: cells removed, grid collapsed to 2 cols, `xl:hidden` dropped from the button group | Restored to the `82fe73f` layout. Kept the added "N exceptions need review" chip. |
| In-transit "Journey" mini-timeline reduced to one text line | Departure/arrival moved to `TransitJourneySummary`; `InTransitTimeline` stripped to exception nodes but `PhaseEvidence` passed `exceptions={[]}` | `InTransitTimeline` again renders Departed → exception markers → Arrived / En route, now as the row's `persistentContent` (visible collapsed — the plan's real Task 9 goal). `TransitJourneySummary` deleted. Arrival fix lives in `InTransitArrivalLocation` behind the toggle. |
| Exceptions moved inside the phase card | `PhaseExceptionGroup` rendered in `persistentContent` | Back to a branch off the rail: one yellow diamond with the count, compact line `N exceptions · R need review` + highest-severity chip, click expands the full cards (chronological). "Open in exceptions panel" link inside the expanded branch. |
| "Show in timeline" flashed warn-yellow inside a yellow card | highlight was `bg-warn-c/50` on the in-card group | Same reveal plumbing (`revealRequest`), now focuses the branch toggle and rings the cards `ring-sec/60` for 1.4 s. |
| No map from the exceptions panel; none for `driver_vehicle_separation` | map modal only reachable via `PositionDisagreement` → `LocationEvidencePanel` | `LocationComparisonModal` extracted from `LocationEvidencePanel`; new `ExceptionMapButton` ("View on map") on panel entries and expanded timeline cards for `gps_mismatch` / `driver_vehicle_separation`. Separation findings use the record's own snapshot via new `locationEvidenceForAssessment` (verdict `not_verified`, never a phase explanation). |
| Precinct modal had no map | — | `PrecinctModal` embeds read-only `GeofenceMap`. |

## Deliberately not changed

- Yellow phase cards: `phase.status === 'exception'` is set by the backend only for seal / count outcomes. Not a review-state indicator. Unchanged.
- Review policy (`exception_service.initial_review_status`): critical → needs_review, warning → recorded, driver-separation → needs_review (P5). Making every exception need review is a separate decision.
- `CurrentLegStrip` ("Show current leg" sticky strip), `uniqueExceptionsById` dedupe, "Record refreshed" copy — kept from Codex's work.
- "Trip updates unavailable" banner: pre-existing `page.tsx` behaviour, triggered by a failed *background* refetch. The 10 s poll from `dev` (FP-154, `useTripDetail`) runs while any completed phase owes an anchor receipt — forever locally without Hedera. Needs the error text to diagnose; not touched here.

## Verification

- `npx vitest run` — 845/845 (75 files).
- `npx tsc --noEmit` — clean. `next lint` — two pre-existing `<img>` warnings only.
- Browser check on a logged-in trip page still owed (login required in the Browser pane).

## Codex leftovers to delete or ignore (untracked, repo root)

`.agents/`, `.codex/`, `.playwright-mcp/`, `PLAN.md` (a stale 9 Sep plan copy).
