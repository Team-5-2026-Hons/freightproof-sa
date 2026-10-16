# Parcel spine redesign — implementation plan

**Status:** Approved direction 16 October 2026; implementation not started.
**Builds on:** `2026-10-16-parcel-search-ui-ux-redesign.md` (Revision 1, all stages done, uncommitted). Its search form, URL/history, focus, results controller and evidence rules stay as they are.
**Why:** the 16 October audit of `/parcels?barcode=WAY0020001` (13/20) found the page accurate but unsummarised: 36 disclosures, the key facts spread from y≈394 to y≈2152 (desktop) and 545 to 2762 (mobile), exceptions at the bottom, and no single answer to the two questions in `docs/parcel-traceability.md` §0: where was it last recorded, and in which custody stretch could it have gone missing. Direction comes from the "Parcel search" section of the Witness and Pattern artifact (summary, parcel spine, sealed band), restricted to what the trace DTO already returns.
**Stack:** existing Next.js 15, React 19, TypeScript, Tailwind, Vitest. No new dependencies, no backend or shared-type changes.

## Handoff

Read `CLAUDE.md` in full. Frontend only, inside `frontend/dispatcher/components/parcels/`, its tests and fixtures, and `docs/fp149-parcel-search.md`. Execute stages in order, TDD with a confirmed failing test per behaviour, tick checkboxes. No commits, no git writes, no Graphify rebuild. Read the impeccable craft floor before UI edits; no coloured side-stripe bars (the sealed leg becomes a tinted block, not a left rule).

## Target layout (one column, every width)

1. **Search form** (unchanged).
2. **Summary card:** barcode `h2` (keeps `tabIndex={-1}` and `headingRef`), waybill, latest trip reference, then:
   - **Summary line:** recorded facts joined with " · ", no verdict. See "Summary line" below.
   - **Three tiles:** *Parcel scans* · *Last recorded phase* · *Seal*. See "Tiles".
   - **Evidence gaps:** the latest journey's `gaps`, verbatim, as a short list (amber warn icon + text). Omitted when empty.
3. **Parcel spine** for the latest journey, with "Open trip evidence" in its header. Replaces `ParcelTimeline` and `ParcelExceptions`.
4. **Earlier associations:** collapsed section of compact rows; each row expands to that journey's own spine.
5. **About this evidence:** one note merging the scan-source caveat, the "vehicle position is not parcel GPS" caveat and `trace.coverage_note`. Replaces the legend, the scan-block caveat, the per-location caveat and the standalone coverage paragraph.

## Decisions

| Decision | Rule |
|---|---|
| Summary line is facts only | Built by a pure helper from DTO fields. Allowed fragments, in order: scan-out (time, or "No parcel scan-out recorded"); last recorded consignment phase (name, place, time; "(overridden)" when overridden); journey state from `progressLabel`; seal state from `SEAL_LABELS` for the relevant window; "No destination scan recorded" when every scan row lacks `scan_in_at`; exception count via the existing count wording. Never "lost", "stolen", "missing", "delivered", "in custody", "left custody", "safe", "intact", "verified". A test asserts that regex against every fixture. |
| "Last recorded phase" | The last phase in ledger order whose status is `completed`, `exception` or `overridden` **and** whose `relevance` is `consignment`. If none: "No recorded phase for this consignment". Never choose by timestamp. |
| Relevant seal window | The window whose `phase_ids` contains the last recorded phase; otherwise the last window in ledger order whose departure phase is recorded; otherwise "No sealed leg recorded". Several windows: tile shows the relevant one plus "{n} sealed legs" via `countLabel`. |
| Tiles | *Parcel scans:* scan-out and scan-in per record (two short lines; "Parcel record 2" prefix when several; "No retained scan record" when empty). *Last recorded phase:* phase · place · time, then the vehicle/phone position line from `locationLabel` with source and capture time (keep "Capture time not recorded" and the separate phase-record time). *Seal:* departure seal number, `SEAL_LABELS[status]`, arrival seal when present. Use plain `div`s on the summary card's surface (`bg-surf-low` blocks), not nested cards. |
| Spine rows | One line each: marker · name · place · time (`text-on-surf-v`, never link blue) · status. A native `<details>` per row; the expanded body keeps device capture, location label, seal, anchor sentence, override note, every exception with its own link, and "Open phase evidence". |
| Markers | Text-labelled, not colour-only: square = parcel scan record, filled dot = recorded phase, ring = in progress/pending, dash = not reached, warn icon = exception or location attention. Each marker has an accessible name or adjacent text. |
| Scan rows on the spine | Scan-out rows at the top, scan-in rows (or one "Destination scan not recorded" row in warn) at the bottom, one per parcel record. They are positioned, not sorted: their own timestamps are shown and never interleaved with phase times. |
| Sealed leg | A tinted block (`bg-surf-low`, rounded, no border-l) with a one-line caption: lock icon · "Sealed leg" · origin → destination · departure seal · `SEAL_LABELS` chip. Its phase rows sit inside without their own borders. |
| Not-reached runs | Consecutive phases whose `phaseStatus(...).label === 'Not reached'` collapse into one row: "{n} phases not reached · journey cancelled", expandable to list each phase name and place. Runs never cross a sealed-leg boundary. Every phase still appears exactly once in the DOM. |
| Inline exceptions | On each phase row, group that phase's exceptions by `exception_type` using `fmtExceptionType` (`@/lib/format/exception`): "{label} ×{n} · {k} need review". Exceptions with a null or unknown `phase_event_id` become one final spine row, "Not linked to a phase", listing each. No separate exceptions section. The summary line carries the total count. |
| Scope labels (bug fix) | `EXCEPTION_SCOPE_LABELS.trip_context` = "Whole trip" (backend sets it when `consignment_id` is null, `projection.py:111`). Phase `RELEVANCE_LABELS` stay: "This consignment" / "Other trip context" / "Relevance unknown". |
| Earlier associations | Collapsed section "Earlier associations" with the existing loaded-count wording. Each row: trip reference, progress chip, route, `MEMBERSHIP_LABELS` value, scan summary ("Scan-out 15 Oct, 11:58" or "No retained scan record"), "Open trip evidence". A row expands to that journey's own gaps + spine (its own scans only). Rows keyed by `trip_id`; load-more keeps open state. |
| Type size | Nothing under 12px in parcel components (replace `text-[11px]`). |
| Kept unchanged | `useParcelTrace`, `ParcelSearch`, focus/announcement logic in `ParcelSearchResults`, `LOCATION_LABELS`, `SEAL_LABELS`, `progressLabel`, `phaseStatus`, `tripEvidenceLink`. |

## Files

| File | Action |
|---|---|
| `trace-display.ts` | Add pure helpers: `lastRecordedPhase(journey)`, `relevantSealWindow(journey)`, `summaryFacts(journey, exceptions)` → `string[]`, `spineModel(journey)` → ordered row model (scan-out rows, phase rows, not-reached runs, seal groups, scan-in rows, unlinked-exceptions row), `exceptionTypeGroups(items)`. Fix `EXCEPTION_SCOPE_LABELS`. |
| **New** `ParcelSummary.tsx` | Summary card (line, tiles, gaps). Replaces `ParcelCurrentState`; same `headingRef` contract and zero-journey heading. |
| **New** `ParcelSpine.tsx` | Renders `spineModel` for one journey; props `{ journey; returnTo; headingLevel?: HeadingLevel }`. |
| `ParcelJourneyView.tsx` | Becomes thin: optional identity header, gaps, `ParcelSpine`. Remove `ParcelCurrentState`, `EvidenceSummary`, `ParcelScanObservations` once their tests are migrated. |
| `ParcelHistory.tsx` | Compact earlier rows as above. |
| `ParcelSearchResults.tsx` | Render `ParcelSummary`, latest spine, `ParcelHistory`, evidence note. Remove legend. Keep focus logic. |
| `ParcelTimeline.tsx`, `ParcelExceptions.tsx` | Delete after their behavioural tests are migrated to `ParcelSpine.test.tsx`. List every dropped assertion and where it moved. |
| `__fixtures__/trace.ts` | Add a WAY0020001-shaped fixture: cancelled after departure, 3 exceptions on each of 3 phases sharing two types, one unlinked reviewed exception, seal pending inspection, scan-out only. |
| `docs/fp149-parcel-search.md` | Update the "selected result shows" list. |

## Stages

### Stage 1 — label and type fixes (ship-safe on its own)
- [x] 1.1 `EXCEPTION_SCOPE_LABELS.trip_context` → "Whole trip"; timestamps in spine/timeline rows use `text-on-surf-v`; no `text-[11px]` in parcel components. **Tests:** trip_context exception reads "Whole trip" and never "Other trip context"; phase relevance labels unchanged; no `<time>` inside parcel rows has class `text-sec`.

### Stage 2 — pure helpers
- [x] 2.1 Add the helpers to `trace-display.ts` with unit tests in `trace-display.test.ts`. **Tests:** last recorded phase skips `trip_context`/`unknown` relevance and pending phases, takes ledger order over timestamps, labels overridden; relevant seal window for in-leg, after-leg and no-window cases; summary facts for WAY0020001 fixture, zero phases, multiple scan records, delivered-with-override (no "delivered"); forbidden-word regex over every fixture; spine model renders each phase once, collapses not-reached runs without crossing a seal boundary, puts unlinked/unknown-phase exceptions in the final row, and keeps one scan-out/scan-in row per parcel record; exception type groups count and needs-review count.

### Stage 3 — parcel spine
- [x] 3.1 `ParcelSpine.tsx` + `ParcelSpine.test.tsx`; wire into `ParcelJourneyView`; migrate then delete `ParcelTimeline`/`ParcelExceptions` and their tests. **Tests:** WAY0020001 fixture renders scan-out, three recorded rows with inline "×3" groups, a sealed leg with seal and status, two not-reached rows, "2 phases not reached" inside the sealed leg (In Transit, Arrival) and "2 phases not reached" after it (Unloading, Confirmation), matching the live WAY0020001 ledger, "Destination scan not recorded", and the unlinked row; every exception link present with `returnTo`; phase deep links keep query and fragment; pending/failed anchors never read as verified; unknown relevance stays unknown; repeated phase types stay separate rows; the multi-stop fixture still renders every phase once in ledger order.

### Stage 4 — summary card and evidence note
- [x] 4.1 `ParcelSummary.tsx` replaces `ParcelCurrentState`; `ParcelSearchResults` renders summary → latest spine → history → one evidence note; legend removed. **Tests:** DOM order summary → spine → earlier → note; summary line text for the fixture; tiles for multiple scan records, no scans, no phase, several seal windows; capture time vs phase time kept distinct; heading focus and zero-journey heading still pass; exactly one evidence note containing the coverage note.

### Stage 5 — compact earlier associations
- [x] 5.1 Rework `ParcelHistory` rows. **Tests:** earlier rows collapsed with trip, status, route, membership and scan summary visible; expanding shows that journey's own spine and scans only; loaded-count wording with/without cursor; load-more keeps open rows; heading levels sequential inside the section.

### Stage 6 — browser verification and docs
- [x] 6.1 At 1440×1000 and 375×812 on WAY0020001: summary, tiles and spine start within the first viewport on desktop; record new y positions and total scroll height against the audit baseline (desktop 2368px, mobile 3008px); Enter/Space on spine rows, the not-reached row and earlier rows; return links; no horizontal overflow at 320px; nothing under 12px. One inspection batch, one fix batch, one confirmation pass. Screenshots to the scratchpad.
- [x] 6.2 Run the verification commands, update `docs/fp149-parcel-search.md`, tick boxes.

## Verification commands

From `frontend/dispatcher`:

```sh
npm run test -- components/parcels lib/hooks/useParcelTrace.test.tsx "app/(app)/parcels"
npm run type-check
npm run lint
npm run test
```

From the repository root:

```sh
/Users/ciaranformby/.agents/skills/impeccable/scripts/impeccable detect --json frontend/dispatcher/components/parcels
git diff --check
```

## Evidence rules (unchanged, restated)

Scans are "recorded parcel scans" of unknown source; a missing scan is a gap, not loss; vehicle position is not parcel GPS; planned manifest membership is not loading; an override is not arrival, an intact seal or verification; anchor presence is not fresh verification; matching seals do not prove loss was impossible; unknown stays unknown; no new tiers, thresholds or witness counts; no fetching full trip payloads to decorate the summary.

## Out of scope

Backend (including the raw user ID in the cancellation exception description), shared types and UI primitives, the exceptions page, pallet/handling-unit grain, bounded-loss callouts or any wording that states where loss did or did not occur.
