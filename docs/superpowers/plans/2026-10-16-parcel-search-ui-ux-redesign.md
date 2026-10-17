# Parcel Search redesign — implementation plan

**Status:** Implemented 16 October 2026 (Stages 1–4); see "Implementation notes" at the end. Nothing committed.
**Date:** 16 October 2026
**Goal:** A dispatcher can search a barcode, quickly distinguish parcel records from associated journey evidence, and investigate gaps without navigating a wall of repeated trip cards.
**Architecture:** Recompose the existing parcel feature and shared UI. Keep the exact-barcode lookup, read-only trace API, domain projections and existing navigation helpers. Separate the stable search form from results that reset for a changed query/account.
**Stack:** Existing Next.js 15 App Router, React 19, TypeScript, Tailwind and Vitest. No new dependencies.
**Spec:** The design and acceptance contract below are the specification for this plan. Supporting evidence: `.impeccable/critique/2026-10-16T11-14-26Z__localhost-parcels.md`, `docs/fp149-parcel-search.md`, and the current source files listed below.

## Handoff

Read `CLAUDE.md` in full before executing. This is an existing dispatcher evidence platform, not a live parcel-tracking service. The user requested a UI/UX review, emphasised reuse of existing components/helpers/classes, and asked for a written plan. The browser audit and source inspection are complete. Search-first with a centred initial form and compact results form is the recommended draft direction; an all-parcels list is deferred. No product changes are authorised by this document alone. Once implementation is requested, execute the stages in order, update their checkboxes, and preserve the evidence semantics below. Do not commit, push, switch branches, rebuild Graphify or discard working-tree changes.

## Decisions and alternatives

| Decision | Reason and rejected alternative |
|---|---|
| Search-first; no all-parcels directory in this change | The known task starts with a supplied barcode. A browse directory requires its own workload, ordering, filters, permissions and API design. Rendering arbitrary batches of 20 would not solve the observed problem. |
| Upper-centred search initially; compact editable form after submission | Gives a clear starting action without wasting result space. A permanently large search hero delays the answer. Do not centre vertically against the full application window. |
| Direct parcel records first, associated journey second | Prevents vehicle location or cancellation being mistaken for parcel location/status. Do not replace these independent facts with one combined confidence/status badge. |
| Latest association expanded; earlier associations collapsed | Removes repeated full histories while preserving access to every retained association. Do not discard cancelled or manifest-only associations. |
| One principal vertical reading path | On mobile, long exception lists must not precede the journey. A persistent evidence sidebar is not needed for the first version. |
| Reuse domain presentation and shared UI where their contracts fit | Reuse does not mean forcing a wizard rail or location widget to accept incomplete data. Avoid changing global components just to fit one page. |
| Use existing API pagination | Lookup pages contain up to 20 matching waybills for one barcode; trace pages contain up to five journeys by default. Neither is a directory of all parcels. Keep continuation cursors and explicit ambiguous-waybill selection. |

These are proposed design choices, not claims that the user has approved every detail. No new filters, fuzzy search, autocomplete, bulk actions, exports or recent-search storage are included.

## Verified baseline

- Browser: `http://localhost:3000/parcels?barcode=WAY0020001`, demo dispatcher, desktop 1440×1000 and emulated mobile 390×844. Do not save credentials in source, fixtures or this plan.
- WAY0020001 currently has three returned associations. The latest associated journey is cancelled; its parcel record has an origin scan-out and no destination scan-in. Historical associations are planned manifest membership. Treat this demo data as changeable, not as a permanent assertion in tests.
- Desktop audit: 24 phase disclosures, roughly 4,648px of scroll content; first scan observations around y=1853. Mobile: timeline begins around y=2530 because the exception block precedes it. These are baseline observations, not pixel targets.
- `SearchRoute` keys the entire `ParcelSearch` by account, barcode and waybill. Query transitions remount the form and lose focus. Searches currently use `router.replace`, so Back skips previous searches.
- Editing the input currently calls `clear()` and withdraws the result; component tests explicitly assert that behaviour. The new design intentionally changes draft editing, while retaining withdrawal on submitted-query/account changes.
- Baseline command, run from `frontend/dispatcher`: `npm run test -- components/parcels/ParcelSearch.test.tsx components/parcels/trace-display.test.ts lib/hooks/useParcelTrace.test.tsx` — **21 tests passed** on 16 October 2026.
- Existing Graphify report is dated 12 October 2026. Queried existing nodes and one-hop dependencies around ParcelSearch, ParcelJourneyView, ParcelTimeline and useParcelTrace; then inspected current source. The graph correctly points to the route, read hook, trace DTO, display helpers and UI primitives. No graph rebuild performed; source remains authoritative.

## Design and acceptance contract

### Initial, loading and recovery states

1. Preserve the app shell and navigation. Show a labelled barcode form in a constrained upper-centred content block; reuse the same form instance when the layout compacts.
2. Accept an exact barcode, trim surrounding whitespace, preserve case/leading zeros, and keep the existing 100-character limit. Keep spellcheck and auto-capitalisation disabled. Enter submits.
3. Compact on valid submission or when opening a URL with a barcode. Remain compact for loading, ambiguity, no match and errors. Clear returns to the initial layout.
4. Draft input and submitted barcode are distinct. While editing, the existing result may remain, but its barcode/waybill must stay plainly visible; when the draft differs, show “Showing results for {submitted barcode}”. Never imply the draft has already been searched.
5. On a new submitted query, clear old evidence before the new result renders. Reset on account/organisation change and on authorisation withdrawal. Do not carry stale evidence through a failed query.
6. Keep the form focusable and stable. New successful results receive deliberate focus at their summary heading (`tabIndex={-1}`); ambiguous results at the chooser heading; no-match/error outcomes at their outcome heading. Retain visible focus and loading/status announcements without making the entire evidence tree a repeated live announcement.
7. Record new searches and waybill selections in browser history with `push`. Same-query resubmission refreshes without adding duplicate history. Clear replaces the current query with `/parcels`. Back/Forward restores the URL query, draft and corresponding result. Existing trip/exception return links retain barcode and waybill.

### Result order

1. **Parcel identity and recorded scans:** barcode, selected waybill, explicit association scope; scan-out and scan-in records for the selected/latest association. Show separate records if multiple parcel rows share barcode+waybill. Never pick a convenient timestamp or merge contradictory records. If there are no retained scans, say so.
2. **Latest associated journey:** backend-first journey, trip status via the existing progress helper, route, vehicle and a separately labelled last recorded vehicle/phone observation. Keep capture time distinct from phase-record time. Say “Latest associated journey”, not an unqualified “Current parcel location”.
3. **Important evidence gaps:** short readable rendering of the supplied gaps; preserve exact meaning and make the complete list accessible. No inferred loss verdict.
4. **Recorded journey:** retain ledger order and the existing sealed-load grouping. Compact row headers show phase, recorded status, place/time and a concise finding. Expanded rows retain details and existing phase evidence links. Use `relevance` to distinguish this consignment, other trip context and unknown relevance; never relabel unknown as known trip context.
5. **Recorded exceptions:** a collapsed section with total and needs-review counts. Inside, group by phase-event ID (including a “Not linked to a phase” bucket); use phase labels plus stop/time to distinguish repeated phase types. Preserve every exception, its scope/review state and individual link. Do not deduplicate by similar description or invent a review state for unknown values. `review_status` is typed `string` in the DTO but the backend enum is `recorded | needs_review | reviewed`: label them “Recorded”, “Needs review”, “Reviewed”, show any other value verbatim, and count only `needs_review` as needing review. (The current UI labels everything not `reviewed` as “Needs review”, which misstates `recorded`; this fixes that.)
6. **Earlier associations:** collapsed section, compact per-trip summaries, independently expandable existing journey views. Show loaded count; use “More earlier associations available” when `next_cursor` exists rather than pretending the loaded count is the total. Retain “Load earlier journeys”, cursor handling and stable open state by trip ID.
7. **Coverage note and full evidence:** retain the coverage note and existing links to trip/phase/exception evidence. Do not fetch full trip payloads merely to decorate the summary.

### Evidence rules — non-negotiable

- Scans have `source: parcel_record_source_unknown`. Use “Recorded parcel scan”; never claim live Parcel Perfect provenance or known simulation status.
- Planned manifest membership is not proof of loading. An archived association never borrows scans from a replacement journey.
- Missing destination scan is an evidence gap, not proof of loss. A recorded delivery phase is not a parcel scan-in.
- Vehicle location is not parcel GPS; reference precinct is not an observed position without its recorded verdict. Preserve unknown capture times.
- Matching recorded seals are not proof that loss was impossible. An overridden phase is not physical arrival, intact seal or successful verification.
- Anchor presence is not a fresh integrity verification. Preserve existing pending/failed/overridden states and link to the evidence surface for verification.
- No new witness counts, stale-reading thresholds, evidence tiers or derived delivery/custody claims. The linked “Witness and Pattern” artifact is inspiration, not the API contract.
- Do not assume seven phases, one stop per phase type, one scan record, one seal window or a globally unique barcode.
- Do not add session/local-storage persistence of parcel data. Preserve organisation scoping and auth behaviour.

## Reuse and file responsibilities

Paths are relative to the repository root.

| File/component | Responsibility/action |
|---|---|
| `frontend/dispatcher/app/(app)/parcels/page.tsx` | Keep route parsing, Suspense and account reset. Remove barcode/waybill from the outer form key; keep account/organisation identity in it. |
| `frontend/dispatcher/components/parcels/ParcelSearch.tsx` | Stable form, draft synchronisation, centred/compact layout, submission/history, Clear, and query-keyed results controller. |
| **New** `frontend/dispatcher/components/parcels/ParcelSearchResults.tsx` | Own existing `useParcelTrace` orchestration for one query, ambiguity/loading/error states and result focus. Keep request/account isolation without remounting the form. |
| `frontend/dispatcher/components/parcels/ParcelJourneyView.tsx` | Recompose existing current-state, scan and journey blocks into the result order above. Rename the internal `ScanObservations` to exported `ParcelScanObservations` for the upfront scan block; optional `showScans?: boolean` on journey view prevents duplicate rendering for latest while defaulting true for earlier associations. Replace the `xl` two-column grid (whose aside is `row-start-1`, putting exceptions above the timeline on mobile) with one column: header → gaps → timeline → scans (if `showScans`) → `ParcelExceptions`. `EvidenceSummary` keeps progress + gaps only; its exception list moves to `ParcelExceptions`. |
| `frontend/dispatcher/components/parcels/ParcelTimeline.tsx` | Compact existing native details/summary rows, reuse SealBand/PhaseEntry, correct explicit unknown relevance label. Preserve all phases and each phase once within its sealed band. |
| **New** `frontend/dispatcher/components/parcels/ParcelHistory.tsx` | Latest versus earlier presentation, native disclosures keyed by trip ID, continuation action and honest loaded counts. |
| **New** `frontend/dispatcher/components/parcels/ParcelExceptions.tsx` | Grouped native disclosures and existing exception links; typed props consume the selected `ParcelJourney` and `returnTo`. |
| `frontend/dispatcher/components/parcels/trace-display.ts` | Retain progressLabel, phaseStatus, locationLabel, seal/location labels and tripEvidenceLink. Add only necessary pure presentation helpers here; use existing shared constants/date utilities. |
| `frontend/dispatcher/lib/hooks/useParcelTrace.ts` | Reuse unchanged unless a test demonstrates an orchestration gap. Preserve race suppression, continuation deduplication and evidence withdrawal. |
| Existing `Button`, `Chip`, `Ic`, `Skeleton`, `EmptyState`, `LinkButton` | Reuse actions/status/icons/feedback/link treatment. Keep semantic section/article wrappers; use Card only where it does not erase their meaning. |
| Existing `InfoRow`, `Card`, `cn`, semantic Tailwind tokens | Reuse suitable display patterns/tokens; allow local responsive wrapping and readable text. Do not copy a new palette, spacing system or global CSS class framework. |

Also reuse: `countLabel` from `@/lib/format/count` for every counted noun (“1 exception”, “2 earlier associations”) and the “· 1 needs review” wording of `exceptionCountLabel` in `@/lib/phase/exception-rows.ts` (copy the wording; that helper is typed to `TripException`, so do not widen it). `EmptyState` renders an `h3` with no id/tabIndex — focus a local wrapper (`<section tabIndex={-1} aria-labelledby=…>` or a wrapper with `aria-label`) rather than editing the shared component.

**Composition (decided in review):** `ParcelSearch` (form, draft, URL, layout) → `ParcelSearchResults` keyed by `${barcode}:${waybill}:${refresh}` (hook, chooser, loading/error/no-match, focus) → on success: `ParcelCurrentState` (identity h2 with `tabIndex={-1}`, `ParcelScanObservations` for `journeys[0]`, then the “Latest associated journey” block) → `ParcelHistory` (latest `ParcelJourneyView` with `showScans={false}` rendered open, earlier ones as collapsed `<details>` keyed by `trip_id`, “Load earlier journeys”) → coverage note. Keep the evidence legend, relabelled to match the new terms, directly above the latest timeline.

**Do not force reuse:** `StepRail` assumes earlier steps are complete; `LocationEvidenceSummary` expects richer location data absent from the parcel DTO; `SearchField` is a list-search control without all exact-barcode behaviours. Keep the labelled barcode input unless adapting a shared control is explicitly scoped later. `DetailPanel`, a new custom witness glyph and DataTable/Pagination are not required here. Do not alter global shared components, package files or backend schemas to satisfy this redesign.

## Implementation stages

Each stage ends with a working visible capability. Execute sequentially; no product edits as part of drafting this plan. Before each behaviour change, add a meaningful regression test, confirm its failure, implement, and rerun the relevant suite. Use the repository's native execution workflow; no Git write operations.

### Stage 1 — stable search and honest state transitions

**Visible outcome:** centred empty search becomes a compact form, and query changes/Back/Clear work without confusing the displayed barcode.

- [x] **1.1 Goal:** Separate stable form from query-scoped results. **Where:** route, ParcelSearch, new ParcelSearchResults, existing ParcelSearch tests. Keep the account key on the outer feature; key only the results controller by submitted barcode, waybill and a local refresh counter. Keep `useParcelTrace` inside that controller. **Verify:** tests assert the textbox DOM node survives a barcode query rerender, a changed submitted query removes old evidence immediately, and account remount removes it. **Fence:** do not weaken auth/race handling or store evidence outside the feature.
- [x] **1.2 Goal:** Implement draft/query synchronisation and navigation. **Where:** ParcelSearch and `ParcelSearch.test.tsx` (there is no route test file; simulate URL/Back/Forward by `rerender` with new `initialBarcode`/`initialWaybill` props, and add `push` to the `next/navigation` mock, matching `app/(app)/exceptions/page.test.tsx`). An invalid submit shows field validation and leaves the submitted query and its result untouched. Sync draft from URL changes; draft editing does not clear the query result; new search/waybill choice pushes, same-query refresh increments the results refresh key, Clear replaces `/parcels`. **Verify:** assert exact encoded URLs for `000123/a`, push versus replace behaviour, submitted-barcode notice during draft edits, no request before submit, and a same-query resubmit actually refetches. **Fence:** no global router or returnTo helper changes.
- [x] **1.3 Goal:** Handle outcome focus and layouts. **Where:** ParcelSearch/ParcelSearchResults. Keep the existing error/no-match distinctions and loading/aria-busy signals; use one concise result announcement and deliberate heading focus after completion. Move focus only after an in-page transition (submit, waybill choice, Back/Forward, retry); a first load from a deep link leaves focus where the browser put it. Remove the separate “Start with a barcode” EmptyState: its guidance becomes the centred form's intro copy (update that existing assertion). **Verify:** success, ambiguity, no-match and failure tests assert focus on the corresponding heading; validation remains attached to the field; retry uses the submitted query; Clear resets layout. Run `npm run test -- components/parcels/ParcelSearch.test.tsx lib/hooks/useParcelTrace.test.tsx`. **Fence:** no animation dependency or forced scrolling on each keystroke.

### Stage 2 — parcel-first summary and compact latest journey

**Visible outcome:** direct scans, latest associated journey status and evidence gaps appear before a compact journey timeline.

- [x] **2.1 Goal:** Recompose the summary with source/scope distinctions. **Where:** ParcelJourneyView, ParcelSearchResults and existing tests/fixtures. Reuse shared DTOs/helpers; export `ParcelScanObservations({ journey }: { journey: ParcelJourney })`; keep ParcelCurrentState's trace prop but use explicit associated-journey copy. **Verify:** test DOM order of scans before journey, multiple distinct scan rows, empty scans, historical membership, unknown capture time, cancellation, delivery override, and no parcel-position/PP-source claim. Run `npm run test -- components/parcels/ParcelSearch.test.tsx components/parcels/trace-display.test.ts`. **Fence:** never fabricate an aggregate parcel status or a latest scan from several ambiguous rows.
- [x] **2.2 Goal:** Compact timeline rows without changing the ledger. **Where:** ParcelTimeline and new `ParcelTimeline.test.tsx`. Retain existing phase helpers, sealed bands, focusable native disclosures, anchors and links. Remove repeated long explanation from collapsed headers; label provenance concisely and correctly. **Verify:** multi-stop fixture with repeated phase types and two seal windows renders each phase once, in ledger order; unknown relevance remains unknown; cancelled/overridden rows keep their status; pending/failed anchors never read as verified; phase deep links retain query and fragment. Run `npm run test -- components/parcels/ParcelTimeline.test.tsx components/parcels/trace-display.test.ts`. **Fence:** do not use StepRail, recompute progress, hide disputed rows or add an artificial cancellation event/time.

### Stage 3 — exceptions and earlier associations on demand

**Visible outcome:** the page initially shows one full journey; exceptions and earlier associations are concise expandable sections.

- [x] **3.1 Goal:** Group exceptions without losing records. **Where:** new ParcelExceptions and `ParcelExceptions.test.tsx`, ParcelJourneyView. Props: `{ journey: ParcelJourney; returnTo: string }`; use existing Chip/Ic and `withReturnTo`. Group by phase ID, not by description, ordered by ledger position; `phase_event_id` null or absent from `journey.phases` goes in the unlinked bucket (labelled “Not linked to a recorded phase”), placed last. Inside the timeline, keep the collapsed “N linked exceptions” count and the expanded per-phase finding text; `ParcelExceptions` is the complete index with links. **Verify:** repeated descriptions remain separate links; repeated phase types form separate groups; total/needs-review counts match source records; reviewed/unknown states are preserved; Enter/Space opens sections. Run `npm run test -- components/parcels/ParcelExceptions.test.tsx`. **Fence:** no new exception severity/review logic, no writes and no cross-consignment inference.
- [x] **3.2 Goal:** Collapse earlier associations and keep continuation. **Where:** new ParcelHistory and `ParcelHistory.test.tsx`, ParcelSearchResults. Props: `{ trace: ParcelTraceResponse; returnTo: string; loadingMore: boolean; onLoadMore: () => void }`; reuse existing journey rendering and `moreJourneys`. Latest scans appear upfront once; historical scans stay scoped to their expanded journey. **Verify:** three-association fixture opens latest only; earlier summaries retain manifest-only warning; opening/loading more keeps prior open state; next_cursor means count is loaded count; zero journeys remains safe. Run `npm run test -- components/parcels/ParcelHistory.test.tsx lib/hooks/useParcelTrace.test.tsx`. **Fence:** no new directory endpoint, no first-page total assumption, no importing scans across associations.

### Stage 4 — responsive verification and handoff

**Visible outcome:** the complete flow works at desktop/mobile widths and retains evidence/navigation protections.

- [x] **4.1 Goal:** Verify the full browser flow and fix defects in one bounded batch. **Where:** scoped parcel files only. At 1440×1000 and 390×844, test initial search, WAY0020001, another query, Back/Forward, no match, Clear, ambiguity via fixture, expanded phases, historical journeys, and trip/exception return links. **Verify:** summary contains scan and associated-journey distinctions before full timeline; exceptions do not form a wall above it; no horizontal overflow; long identifiers wrap; control targets reach 44px where practical; visible keyboard focus and 200% zoom remain usable. Check reduced-motion preference if a compacting transition exists. Save desktop/mobile screenshots. **Fence:** no live data mutation to manufacture a fixture; use component fixtures for unavailable live states. Restore viewport after testing.
- [x] **4.2 Goal:** Confirm regressions and record results. **Where:** dispatcher, scoped files and docs. Run the commands below. Update `docs/fp149-parcel-search.md` to match the implemented form/history/navigation behaviour, leaving API/evidence rules intact. Update this plan's completed boxes and any deliberately revised decisions. **Verify:** tests/type-check/lint green; mechanical detector output reviewed; `git diff --check` clean; final diff restricted to the planned feature/tests/docs. **Fence:** do not fix unrelated baseline failures or shared-file drift; report exact failures instead.

## Verification commands

From `frontend/dispatcher` after implementation:

```sh
npm run test -- components/parcels lib/hooks/useParcelTrace.test.tsx
npm run type-check
npm run lint
npm run test
```

From the repository root:

```sh
/Users/ciaranformby/.agents/skills/impeccable/scripts/impeccable detect --json frontend/dispatcher/components/parcels
git diff --check
git diff --stat
```

Detector exit 2 means findings to inspect, not an execution crash. One batched desktop/mobile inspection and one confirmation pass after fixes are sufficient. No backend change is planned, so do not run shared-database tests or migrations for this frontend work. If implementation genuinely needs backend changes, stop and revise the scope before proceeding.

## Review focus and risks

| Tripwire | Required response / owning stage |
|---|---|
| The form keeps focus by retaining old evidence after a submitted query or auth change | Stage 1: stable form plus keyed results, immediate identity-bound withdrawal. Test delayed old response and account reset; retain existing hook authorisation/race tests. |
| A barcode matches several waybills or several parcel records | Stages 1–2: explicit waybill choice; retain per-record scans; no arbitrary selection when next_after exists. |
| A newer manifest-only cancelled association has no scans | Stage 2: show that truth for that association; do not search older records for a better-looking summary or borrow replacement scans. |
| “More journeys” makes the loaded count look complete or closes open details | Stage 3: loaded-count wording, cursor-aware continuation, stable trip keys. |
| A repeated phase type, unknown relevance, override or missing timestamp is flattened into reassuring progress | Stage 2: explicit states and multi-stop fixtures; preserve backend order/progress and timestamp distinctions. |
| Existing primitives need global changes or the proposed panel needs absent DTO fields | Stay local using existing semantic tokens/disclosures and compact DTO labels; link to full trip evidence. Broader shared/backend work requires a revised plan. |

## Scope and completion

Only parcel feature code/tests, its route, and the existing parcel documentation are in implementation scope. New files are the three focused components and their tests plus ParcelTimeline tests; extend existing fixtures rather than creating another data model. Hook changes are conditional on demonstrated need. Shared UI primitives, global styles, packages, backend, driver app, client portal, migrations, analytics and Graphify outputs are excluded.

Done means: the acceptance contract above is demonstrated in component tests and browser checks; existing protections remain; all scoped checks pass or an unrelated baseline failure is clearly documented; screenshots and a concise handoff are supplied. No commit, staging, deployment or Git history operation is part of completion.

## Revision 1 — review notes (16 October 2026)

Checked against current source, DTOs (`frontend/shared/lib/types/parcel-trace.ts`, `backend/app/schemas/parcel_trace.py`), shared UI, tests and the 12 October graph. Baseline re-run: 21/21 pass. No product files changed.

- Exception review states: DTO is `string`, backend enum is `recorded | needs_review | reviewed`; current UI shows `recorded` as “Needs review”. Contract item 5 now defines the labels and count rule.
- Added the composition (who renders what), because the plan named components but not their nesting or where the legend, gaps and coverage note go.
- ParcelJourneyView: the `xl` aside grid is the source of the mobile “exceptions before journey” problem. Now one column; exceptions move out of `EvidenceSummary` into `ParcelExceptions` so they render once.
- 1.2: no route test exists; tests rerender `ParcelSearch` with new props and the router mock gains `push`. Invalid submit no longer clears the result.
- 1.3: focus moves only after in-page transitions, not on a deep-link first load. `EmptyState` cannot take focus, so wrap it locally. Initial EmptyState folded into the centred form.
- 3.1: defined bucket order and the unmatched-phase-ID case; timeline keeps its inline count. Reuse `countLabel` and the `exceptionCountLabel` wording.
- Kept all three new components: each owns logic with its own tests (query-keyed isolation, grouping, open state across pagination).
- Deliberately not included: the audit's “group unreached phases on cancelled journeys” (compact rows make this cheap, and it interacts with seal bands); renaming `LOCATION_LABELS`/`SEAL_LABELS` copy (tested evidence wording); app-shell nav and TopBar forensic-toggle target sizes (shared, out of scope).

**Drafting checks completed:** current source/DTOs and graph dependencies inspected; existing baseline 21 tests pass; no product files changed. Proposed design choices remain reviewable in this document.

## Implementation notes (16 October 2026)

Deliberate departures from the text above, all verified in tests or the browser:

- Added `app/(app)/parcels/page.test.tsx`: the form-survival and account-reset guarantees live in the route's key and cannot be proved from `ParcelSearch` alone.
- The summary's focus target is a native `tabIndex={-1}` heading with a ref (`ParcelCurrentState` `headingRef`). A trace with no journeys still renders that heading plus "No associated journey is recorded".
- Evidence legend: two entries remain ("Recorded parcel scan", "Missing or disputed evidence"); the truck entry matched nothing the timeline renders. It sits above the latest journey, not directly above its timeline.
- The latest journey renders without a second identity header or progress line (`showIdentity={false}`, `showScans={false}`); earlier associations render flat (`embedded`) inside collapsed rows, with their reference as an `h4` and section headings at `h5`/`h6`.
- Review labels, the scope wording ("Other trip context") and membership wording live in `trace-display.ts` so rows, exceptions and summaries agree. `LOCATION_LABELS` and `SEAL_LABELS` are unchanged.
- Collapsed phase rows show a location result only when it needs attention; the full label is in the expanded row.
- Touch targets were raised to 44px where local (form buttons, evidence links, section summaries). Shared app-shell controls and single-line exception group headers (32px on desktop) were left.
- Known leftover: the planned-membership wording appears in both an earlier row's summary and its expanded header.
