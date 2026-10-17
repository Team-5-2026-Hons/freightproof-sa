# Parcel-first timeline — implementation plan

**Status:** Direction approved 16 October 2026 from the inline mockup; implementation not started.
**Replaces the presentation of:** `2026-10-16-parcel-spine-redesign.md` (done, uncommitted). Keep its pure helpers where listed; replace its summary card, tiles, spine and earlier-association rows. The search form, URL/history, focus contract and results controller from `2026-10-16-parcel-search-ui-ux-redesign.md` stay unchanged.
**Why:** after the spine redesign the user still found the page too detailed and not organised around the parcel. The approved mockup shows one status line and about five plain-language steps describing what was recorded for this parcel, with everything else one click away.
**Stack:** existing dispatcher Next.js 15, React 19, TypeScript, Tailwind, Vitest. No new dependencies, no backend, shared-type or shared-UI changes.

## Handoff

Read `CLAUDE.md` in full. Scope: `frontend/dispatcher/components/parcels/` (components, tests, fixtures) and `docs/fp149-parcel-search.md`. TDD with a confirmed failing test per behaviour; tick checkboxes; foreground vitest; no git writes; no Graphify rebuild. Read the impeccable craft floor before UI edits. No side-stripe bars, no nested cards, nothing under 12px except the shared `Chip`.

## Target page (the mockup, for WAY0020001)

```
WAY0020001                                   [Trip cancelled after departure]
Waybill WAY002 · Johannesburg Depot (Linbro) → Cape Town Depot (Epping)

Last recorded: departed Johannesburg Depot (Linbro) under seal AB-1111 on 15 Oct, 11:59 SAST.
No arrival, seal check or destination scan recorded.

●  Scanned out at origin                       15 Oct, 11:58 SAST · parcel scan
│
●  Consignment loaded   [3 exceptions · 3 need review]
│  15 Oct, 11:58 SAST · Johannesburg Depot (Linbro) · vehicle CA 123-456
│
●  Departed, sealed AB-1111   [3 exceptions · 3 need review]
│  15 Oct, 11:59 SAST · Johannesburg Depot (Linbro)
│
●  Trip cancelled                              before arrival
┆
○  Not recorded: in transit, arrival, unloading, confirmation, seal check, destination scan
   Cape Town Depot (Epping) · a missing scan is an evidence gap, not proof of loss

Full trip ledger · 8 phases · 4 trip-wide exceptions →   ▸ 2 earlier trips   ▸ How to read this
```

One card, one column, every width. Each step is a native `<details>`: the collapsed summary is the two lines shown, and the expanded body holds the evidence detail.

## Decisions

| Topic | Rule |
|---|---|
| Which phases become steps | Phases with `relevance === 'consignment'` whose status is `completed`, `exception`, `overridden` or `in_progress`. Phases with `relevance === 'unknown'` that are recorded also become steps, with a muted "Relevance unknown" tag. `trip_context` phases are not steps. They are counted in the ledger link, together with their exceptions. |
| Step titles (pure map, no verdicts) | loading → "Consignment loaded"; departure → "Departed" plus ", sealed {seal}" when the phase `seal_number` or the containing window's `departure_seal` exists; in_transit → "In transit recorded"; arrival → "Arrived at {place}" ("Arrival recorded" if no place); unloading → "Consignment unloaded"; confirmation → "Confirmation recorded"; any other type → "{PHASE_NAMES} recorded". `in_progress` → "{PHASE_NAMES} in progress" with a ring marker. `overridden` → title plus " (overridden)" and an "Overridden" warn pill. Never "delivered", "received", "lost", "safe", "intact" or "verified". |
| Step subline | `fmtDateTime(completed_at)` or "Time not recorded" · place or "Trip-wide record". Loading also shows "vehicle {registration}" when recorded. Times use text-secondary, never link blue. |
| Scan steps | Each parcel record contributes "Scanned out at origin" (with time · "parcel scan") as the first step when `scan_out_at` exists, and "Scanned in at destination" as the last step when `scan_in_at` exists. With several records, add the suffix " · parcel record {n}". Scans are positioned, never sorted against phase times. Records with no scans contribute nothing here; the gap goes in the not-recorded line. |
| Cancelled | When `progress.position === 'cancelled'`, add a "Trip cancelled" step after the last recorded step, with a warn dot. Its subline is "before {next unrecorded consignment phase, lower-case}" or "before any recorded phase". There is no time, because the DTO has none; never borrow one from an exception. |
| Not-recorded line | One muted, dashed-dot final row listing, in ledger order, the consignment phases that weren't recorded (excluding in-progress ones), plus "seal check" when the relevant window's status is `pending` or `unverified`, plus "destination scan" when no record has `scan_in_at`. Use the existing "a missing scan is an evidence gap, not proof of loss" sentence when the destination scan is missing. Omit the line when the list is empty. Never collapse or hide any phase record: each not-recorded phase still appears in this list by name. |
| Status badge | `Chip` using `progressChipType`. Cancelled: "Trip cancelled after {last recorded consignment phase, lower-case}", or "Trip cancelled before any recorded phase". Other positions: the existing `progressLabel`. |
| Status line | "Last recorded: {last step sentence} on {time}." plus, when anything is unrecorded, "No {items} recorded." where items = the next unrecorded consignment phase after the last recorded one (skip in_transit, which is not a place-bound event), then "seal check" and "destination scan" when they apply, joined with commas and a final "or". The full list stays in the not-recorded line. The last step sentence is the step title in sentence form with its place, e.g. "departed Johannesburg Depot (Linbro) under seal AB-1111". With no recorded step: "No recorded step for this parcel yet." |
| Manifest-only latest | When `membership_source === 'creation_manifest'`, show one line under the header: "Planned manifest membership only; it is not proof the parcel was loaded." |
| Issue pill | Shown on the step summary when the phase has linked exceptions: `exceptionCountLabel` text (e.g. "3 exceptions · 3 need review") in a warn pill. If there are no exceptions but the location verdict is `mismatch` or `unwitnessed`, the pill shows `LOCATION_LABELS[verdict]`. At most one pill per step, plus the "Overridden" pill. |
| Step detail (expanded) | Exception type groups (`exceptionTypeGroups`) each followed by the individual exception links (scope label, review label, time). Then the location label. If `last_recorded_location.phase_event_id` is this phase, add its source, capture time, phase-record time and "not parcel GPS or live tracking". Then the device capture time, recorded seal, "Contents of a sealed load are not observable" (departure inside a sealed window), the override note, the anchor sentence, and "Open phase evidence" (`tripEvidenceLink` with phase fragment). Scan steps: "Recorded against the barcode; source system not identified" plus the stored scan status. |
| Footer | (1) "Full trip ledger · {n} phases · {k} trip-wide exceptions →", linking to `tripEvidenceLink(trip_id, returnTo)`. k counts exceptions on non-step phases plus unlinked ones; omit the exception part when k is 0. (2) "▸ {n} earlier trips" as a native disclosure (wording below). (3) "▸ How to read this" as a native disclosure holding the three caveats and `coverage_note`. |
| Earlier trips | Disclosure summary: `countLabel(n, 'earlier trip')`, plus " · planned manifest only" when all of them are manifest-only, plus " · more available" when `next_cursor` exists ("No earlier trips loaded · more available" when n is 0 with a cursor). Expanded: one compact row per journey (trip reference, status badge, route, scan summary), each itself a disclosure that shows that journey's own timeline (same component, compact header) and its ledger link. Keep "Load earlier journeys", the `trip_id` keys and open state across load-more. |
| Zero journeys | Header with the barcode `h2` (focus target) and "No associated journey is recorded". No timeline. |
| Focus/headings | The barcode `h2` keeps `tabIndex={-1}` and `headingRef`. The timeline has a visually hidden `h3` "What was recorded for this parcel". Earlier-trip timelines use the next heading level. |
| Kept helpers | `lastRecordedPhase`, `relevantSealWindow`, `exceptionCountLabel`, `exceptionTypeGroups`, `scanSummary`, `progressLabel`, `progressChipType`, `phaseStatus`, `tripEvidenceLink`, `locationLabel`, the label maps and `Heading`. |
| Removed | `summaryFacts`, `spineModel` and their row types; `ParcelSummary`, `ParcelSpine`, `ParcelJourneyView`, the current `ParcelHistory` rows, and `EvidenceNote` (its text moves to "How to read this"). Before deleting, migrate every behavioural assertion and list it as moved or dropped, with the reason. |

## Files

| File | Action |
|---|---|
| `trace-display.ts` | Add `parcelSteps(journey)` → ordered step model (scan-out, phase steps, cancelled, scan-in), `notRecordedItems(journey)`, `statusBadge(journey)`, `statusLine(journey)`, `hiddenLedgerCounts(journey)`. Remove `summaryFacts` and `spineModel` once unused. |
| **New** `ParcelTimeline.tsx` | `{ journey; returnTo; headingLevel?; compact? }`. Renders the steps, the not-recorded line and the ledger link. |
| **New** `ParcelOverview.tsx` | Header (barcode, badge, waybill and route, status line, manifest line) + `ParcelTimeline` + footer disclosures. Replaces `ParcelSummary` + spine card + `ParcelHistory` + evidence note. |
| `ParcelSearchResults.tsx` | Renders `ParcelOverview` on success. Focus and announcement logic are unchanged. |
| `ParcelHistory.tsx` | Becomes the earlier-trips disclosure body used by the overview footer, or is folded into `ParcelOverview`; choose whichever keeps the file under ~120 lines. |
| `__fixtures__/trace.ts` | Reuse `makeWayJourney`. Add: a delivered-with-scan-in journey, an overridden-arrival journey, an unknown-relevance recorded phase, and a manifest-only latest. |
| `docs/fp149-parcel-search.md` | Rewrite the "selected result shows" list. |

## Stages

### Stage 1 — step model helpers
- [x] 1.1 Add the helpers to `trace-display.ts` with tests. **Tests:** the WAY fixture gives exactly scan-out → loaded → departed (sealed) → cancelled, and trip_context phases never become steps. The not-recorded list for WAY is "in transit, arrival, unloading, confirmation, seal check, destination scan" (phase names lower-cased); the status line names only "arrival, seal check or destination scan". Badge: "Trip cancelled after departure". The status line equals the mockup text. Delivered fixture: a scan-in step last, no not-recorded line, and no "delivered" word. Overridden fixture: " (overridden)" title and pill. Unknown relevance: the step is tagged. Several parcel records: suffixed steps, never merged. No recorded step: the fallback status line. Hidden ledger counts for WAY: 8 phases and 4 trip-wide exceptions. A forbidden-word regex runs over every helper output for every fixture.

### Stage 2 — timeline and overview
- [x] 2.1 `ParcelTimeline.tsx` + tests; `ParcelOverview.tsx` + tests; wire into `ParcelSearchResults`. **Tests:** DOM order header → status line → steps → not-recorded → footer. Each step's summary shows only title, time/place and at most one issue pill (plus "Overridden"). Expanded steps keep every exception link with `returnTo`, phase deep links with the fragment, capture vs phase-record time on the position's own phase, and "not parcel GPS". Pending or failed anchors never read as verified. "Contents of a sealed load are not observable" sits on the sealed departure. The ledger link targets the trip page with `returnTo`. "How to read this" contains `coverage_note` once. The zero-journey heading gets focus. The manifest-only line shows.

### Stage 3 — earlier trips and removal
- [x] 3.1 Earlier-trips disclosure; delete the replaced components and helpers after migrating their assertions. **Tests:** the summary wording with and without a cursor and for all-manifest. Each row expands to its own timeline with its own scans only. Load-more keeps open rows. Heading levels are sequential.

### Stage 4 — browser verification and docs
- [x] 4.1 WAY0020001 at 1440×1000 and 375×812. Record the header and status line, the first step and the footer y positions, plus the total height, against the spine baseline (desktop 1653px, mobile 2990px). The goal is the full timeline inside the first desktop viewport and the status line inside the first mobile viewport. Check Enter/Space on steps and both footer disclosures, the return links, no overflow at 320px, and nothing under 12px except Chip. One inspection batch, one fix batch, one confirmation pass. Screenshots to the scratchpad; reset the viewport.
- [x] 4.2 Verification commands, docs, ticks.

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

## Evidence rules (unchanged)

Scans are recorded parcel scans of unknown source; a missing scan is a gap, not loss; vehicle position is not parcel GPS; planned manifest membership is not loading; an override is not arrival, an intact seal or verification; anchor presence is not fresh verification; matching seals do not prove loss was impossible; unknown stays unknown; no new tiers, thresholds or witness counts; no invented times; no extra fetches to decorate the page.

## Out of scope

Backend (cancellation time, the raw user ID in the cancellation description), shared types and primitives, the trip page, pallet grain, any statement about where loss did or did not occur.

## Follow-up 1 — footer and earlier trips

Approved after Stage 4. Scope: `components/parcels` and its tests, plus one additive prop on `components/analytics/fleet/InfoPopover.tsx` (teammate-owned; flag in the report).

- [x] F1.2 InfoPopover: add optional `ariaLabel?: string` (button and panel label); default label unchanged, with a test for both. Replace the "How to read this" disclosure with the popover beside the header badge (title "Parcel record", question "How to read this parcel record", the three caveats and the coverage note). Check the panel at 320px; fix placement in the parcels code only. Overview tests: labelled button, opens to show the four texts, closes on Escape.
- [x] F1.1 View trip: replace the "Full trip ledger" link with `LinkButton` labelled "View trip" (same `tripEvidenceLink` href), and a muted "{n} phases · {k} trip-wide exceptions" line beside it (no exceptions part when k is 0). Earlier-trip timelines use the same button.
- [x] F1.3 Status colour and earlier trips: header badge keeps `statusBadge` wording but takes its chip type from `TRIP_STATUS_META.cancelled.chipType` when cancelled; earlier-trips disclosure becomes a plain bottom section (h3 "Earlier trips", muted count, one `<details>` row per trip: reference, `TRIP_STATUS_META` chip, route, muted "Planned manifest only"); the long status text moves into the expanded body. Load-more, trip_id keys and open state kept; section omitted with no earlier trips and no cursor.
- [x] F1.4 Visual consistency: `ParcelTimeline` dots and rail use the trip page timeline's sizes, colours and line weight (`NODE_STYLE` / `LINE_STYLE` from `PhaseTimelineItem`).
- [x] F1.5 Browser pass on WAY0020001 at 1440×1000 and 320px, plus `/analytics`; screenshots to the scratchpad; viewport reset.
- [x] F1.6 `npm run test -- components/parcels components/analytics lib/hooks/useParcelTrace.test.tsx "app/(app)/parcels"`, `npm run type-check`, `npm run lint`.

## Follow-up 2 — calmer timeline

Approved after reviewing Follow-up 1 on screen: the expanded step and the earlier trips were too wordy, and exceptions read as a wall of blue links. Scope: `components/parcels` and its tests only.

- [x] F2.1 Exceptions inside a step become compact one-line links (warning icon, time, type, severity, review state) like the trip page's exception rows; no group headers, no scope label, no description (it stays in the accessible name and on the exception page).
- [x] F2.2 Expanded step body: a label/value block (Location, Position, Device capture, Recorded seal, Anchor) instead of a sentence per line; notes and the phase-evidence link after it.
- [x] F2.3 Status line is only "Last recorded: … on …."; the not-recorded row carries what is missing.
- [x] F2.4 Earlier trips: drop the duplicate long status chip from the expanded body; summary content wraps in its own column beside the chevron; body indented to that column.
- [x] F2.5 Layout: timeline content capped at `max-w-3xl` so chevron and text stay together; rail lines no longer stubs (row spacing and line end).
- [x] F2.6 Browser check on WAY0020001 (1440 and 320), screenshots sent; `npm run test -- components/parcels components/analytics lib/hooks/useParcelTrace.test.tsx "app/(app)/parcels"`, `npm run type-check`, `npm run lint`; docs updated.
