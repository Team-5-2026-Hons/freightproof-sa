# Exceptions UI redesign implementation plan

Date: 2026-10-02 · Planning only · No implementation authorised by this document.

## Handoff

FreightProof SA records freight incidents and the evidence supporting them. This plan improves the dispatcher's exception queue, exception detail, and existing trip exception panel. Keep the existing routes and server-owned review workflow. Make the incident readable, show recorded evidence before asking for an assessment, and return dispatchers to the exact view they came from. Implement one stage at a time; verify its visible endpoint before proceeding. The application has not been changed by this planning task.

Read `CLAUDE.md`, `frontend/DESIGN_SYSTEM.md`, and this entire document before implementation. Start with Stage 0, then Stage 1. Use `docs/superpowers/plans/2026-09-30-fp280-exception-review-inbox.md` for the accepted claim/review rules; its decisions supersede conflicting older workflow proposals. This plan does not implement the older proposals for severity policy, evidence sign-off, or exception anchoring.

**Goal:** A dispatcher can see exceptions in chronological order, immediately identify each exception's trip, inspect the available evidence, record a review, and continue their queue without losing context, at normal laptop and desktop widths.

**Stack:** Existing Next.js 15 App Router, React 19, TypeScript, Tailwind, Vitest/Testing Library, and the existing Leaflet location comparison. No new dependency, API, migration, or global theme refresh.

**Design contract:** Sections 3–6 below. Existing product colours and typography remain governed by `frontend/DESIGN_SYSTEM.md`.

## 1. Evidence and implementation limits

The 2026-10-02 browser assessment found:

- At the original 1208 px browser width, the queue's description cell measured 0 px. At 1440 px it measured 105 px. At 1024 px, later columns and actions were clipped.
- The visible queue contained 16 records from one trip, with several distinct location findings recorded at the same phase/time.
- Detail repeats source/time/status information and puts the review form beneath a long stack of cards. Review note is currently a single-line input.
- Search/date/severity controls are available only on the Reviewed tab. The claimed empty state has no action; empty history is worded as a failed filter match.
- The related trip failed to load after a retry. Trip panel layout must be verified in Stage 0; source inspection is not visual acceptance.

Verified data contracts:

| Surface | Available data | Consequence |
|---|---|---|
| Global queue | `TripExceptionListItem`: trip ID/reference/status, severity, type, description, source, raised time, phase label, numeric stop label, claim/reviewer names, optional assessment | Group by `trip_id`. Do not infer exact phase-event identity from labels, timestamps, or stop numbers. No driver/facility names or photo count can be invented. |
| History | Same list item, cursor pages of 25, server filters `q`, `reviewStatus`, `severity`, `fromDate`, `toDate` | Keep server pagination and ordering. Do not client-filter or group the current page as if it represented the whole archive. Source/type/outcome filtering needs a separate API change and is excluded. |
| Detail | `TripExceptionDetail`: above plus captured GPS, optional location assessment, supporting photo, outcome/note/contact/reviewer time, breakdown vehicle | Use the supplied snapshot and photo. No phase-event ID exists here either. A lone coordinate is not a driver/tracker comparison. |
| Trip panel | Full `TripException`, phases with phase-event IDs, precincts | Exact phase grouping and the existing phase-backed map remain available here. Keep the existing selected-phase filter. |

Use existing `locationEvidenceForAssessment(assessment, undefined)` for detail snapshots and existing `LocationEvidencePanel`/`LocationComparisonModal` for presentation. The captured boundary in the assessment is authoritative; a current precinct lookup must not replace historical evidence. If a detail has no snapshot, retain its recorded coordinate/photo and link to the trip for further context. Do not fetch every trip to enrich queue rows.

## 2. Chosen approach and alternatives

| Option | Benefit | Cost / decision |
|---|---|---|
| Queue-only repair | Fastest improvement to scanning | Leaves detail/review friction. Too narrow for this key feature. |
| **Queue plus existing detail workspace** | Readable queue, durable URLs, evidence beside review on wide screens, existing return path and mutations | **Recommended.** Bounded frontend changes and each stage can ship independently. |
| Queue with an investigation drawer | Fast movement between records | Less evidence space at laptop widths, more focus/draft/navigation complexity, competing detail surfaces. Defer until the improved routes have been evaluated. |

Do not implement speculative next/previous-review controls in this delivery: live queue membership can change while someone reviews. First preserve return state accurately.

### Confirmed ordering decision — 2026-10-02

The default is an ungrouped chronological list, newest raised exception first. This replaces this plan's original proposal to preserve server severity ordering in the displayed queue. Severity remains visible and filterable, but must not move older records above newer ones. The backend queue currently supplies severity-ordered records; the frontend must sort the complete loaded queue by `created_at` before display, without changing the endpoint or mutating its returned array. History already uses server chronological ordering and retains its cursor pagination.

Every row shows a visible full trip reference and an absolute raised timestamp, including year and time in South African time. Show `Newest first` beside the list controls. Relative age may supplement the timestamp but never replace it. This timestamp orders when the exception was raised, not an inferred incident time or a different evidence capture time. Equal timestamps have a deterministic ID tie-break; do not imply one tied event happened earlier. Invalid/missing timestamps, if encountered, appear last as `Raised time unavailable` and are excluded from newest/oldest summaries.

Trip grouping is an explicit optional view, never the initial view. Within that view, groups are ordered by their newest exception descending and records within every group remain newest-first. Each group shows both its newest and oldest raised timestamps. Returning to `Group by: None` restores chronology across all trips. Filters preserve the selected chronological order. The trip exception panel also defaults to a flat chronological list; any phase grouping there must be explicitly selected.

## 3. Visual and component contract

Direction: restrained evidence workspace, aligned to the existing dark navigation and neutral paper surfaces. Hierarchy comes from incident titles, explanatory text, clear groups, and alignment.

- Keep Inter and current global tokens. Any font or palette replacement is a separate product-wide design decision.
- Incident/detail headings: 18–22 px, weight 600–700. Incident row title: 14 px/600. Descriptions/form text: 14 px, line-height about 1.5. Metadata: at least 12 px. Section labels: 12 px, sentence case.
- Use 8/12/16/24 px spacing. White content surfaces, subtle outline separators, existing small/medium radii. Avoid adding nested shadowed cards or tinted header strips around every subsection.
- Keep existing severity chip colours. Critical red communicates critical severity, not simply an outstanding review. Show ownership/review state primarily as text; an optional neutral background may support it.
- Use the existing ink primary button for submission. Green is available for recorded reviewed/success states. Do not change the global Button or Chip primitives.
- Blue denotes an action or active control. Static timestamps use secondary text, not link blue. IDs/times/counts retain tabular numerals.
- Only meaningful state transitions animate, using existing short durations and reduced-motion support. No entrance choreography, animated counters, or permanent pulsing exception rows.
- Every control has visible keyboard focus. Target 44 px hit areas; small glyphs may sit inside those areas. No hover-only access to full IDs or actions.
- Local presentation rules belong in exception components; do not restyle global Input, Select, TopBar, Sidebar, or other pages.

### Queue row

Use a semantic list of links, not a series of `div role="button"` rows. Each row is one real link to its exception; it contains no nested interactive elements. Give it an accessible name from the incident title and trip reference. Visible trailing action is `Review` for needs-review records and `View review` for reviewed records; legacy recorded rows use `View record`.

At viewport widths >=1280 px, use four columns:

```text
Incident                              Trip / context          Review state       Action
[Warning] Driver–vehicle separation    FP-…32FF7346             Unclaimed          Review →
Recorded description, up to 2 lines    Complete · Confirmation
System · 01 Oct 2026, 12:50            Recorded stop 1
```

Widths: incident `minmax(0,1fr)`, context 180 px, state 160 px, action 96 px; 12 px gaps and 16 px row padding. The action shows its label and arrow within a minimum 44 px hit area. Let long names wrap; do not truncate the entire ownership label.

Below 1280 px, use a two-row item rather than clipping the four-column layout. First row: flexible title/severity and action. Second row: full-width description followed by wrapping context/state metadata. At narrow widths, stack context and state. The main incident text has `min-width:0` and wraps. At 1024 and 1208 px the description must remain readable without horizontal scrolling.

Show the full trip reference on every exception row, including children of an expanded group. It must remain visible without hover, focus or opening detail. If space is limited, wrap the reference onto a second line rather than clipping it to an identical prefix. Keep trip reference, lifecycle state and phase/stop together in a clearly labelled context area. If implementing a copy button, put it in detail rather than nesting it in the row link.

Use `fmtExceptionType` rather than the pages' duplicate title-case functions. Add the override `gps_mismatch: 'GPS mismatch'`; retain existing distinctions between driver outside precinct, tracker outside precinct, and driver–vehicle separation. Format raw phase identifiers with a dispatcher-local helper. Until the API supplies a stop name/display index, write `Recorded stop 0` rather than silently adding one or guessing a facility.

### Queue header and toolbar

Keep `Exceptions` as the page title. Tabs: `Unreviewed`, `Claimed by me`, `History` (renames Reviewed to match its archive/legacy contents). Use tab semantics with selected state and keyboard arrow/Home/End navigation. Counts come from the full queue before display filters; keep existing partition rules, including colleagues' claims in Unreviewed.

Toolbar on each tab: labelled search `Search description or trip reference`, labelled severity select, date range control, and `Clear filters` only when filters are active. Queue tabs filter their complete loaded set locally; History uses the existing server filters. Search settles after the existing 300 ms debounce. Filter changes reset the history page to 1. Default date label is `All dates`, with omitted date params rather than a visible 2020 sentinel. Explicit dates mean South African calendar dates; do not use UTC midnight or the browser's unrelated timezone as today's UI date. The existing history service confirms both dates are inclusive: lower bound is SA midnight on fromDate, upper bound is exclusive SA midnight after toDate. In the dispatcher-local helper, use a named `Africa/Johannesburg` timezone constant and Intl date parts to derive the comparable YYYY-MM-DD calendar day. Do not alter the shared datetime utility for this local requirement.

Queue-only control: `Group by: None / Trip`. Default None shows the complete chronological list, newest first. A plain `Newest first` label states the ordering. Hide grouping on History, which remains server-ordered newest first. Do not add unsupported source/type filters or an archive oldest-first sort without endpoint support.

Show `Showing 4 of 16` when queue filters narrow the tab. History shows its server `totalItems` as matching records, not an unfiltered organisation total. Avoid a second archive fetch just to derive an empty-state message or a dashboard count.

### Detail workspace

Retain `/exceptions/[id]`, top-left Back, the current `returnTo` validation, and the existing mutation handlers.

```text
Back to exceptions     GPS mismatch             [Warning]  Needs review
Trip FP-…32FF7346 · Complete · Confirmation · Recorded stop 1   View trip →

Incident and evidence                         Assessment
Stored trigger + recorded description         Unclaimed    Claim
Recorded location comparison / map action     Outcome (required)
Supporting photo and capture metadata         Review note (required)
Other recorded metadata                       Contact method (optional)
                                               [Submit review]
```

At >=1440 px, main content uses a flexible evidence column and a 340 px review column with a 24 px gap. Allow content width up to 1280 px. Below 1440 px, stack evidence then review. This deliberately respects the 220 px sidebar: 1024 px is not a useful two-column investigation layout.

Use one context strip for trip/state/phase/time/source. Keep the closed/cancelled/hold notice once, adjacent to review, with its exact existing meaning. A trip's completion is independent of an exception's assessment. Preserve the system-only GPS trigger sentence already tested on the detail page.

Keep the review panel sticky only when its full height fits the available desktop scroller. At shorter heights it participates in normal scroll. On stacked screens, show a labelled `Jump to assessment` control near the incident header, moving focus to the form heading. Avoid an overlapping sticky submission bar. All form controls and Submit remain reachable at 200% zoom.

Reviewed records replace the form with a read-only assessment: outcome, note, reviewer, reviewed time, contact if recorded, and claimer if different. Legacy markers must not masquerade as a new review choice.

### Review fields and ownership

- Field order: Outcome, Review note, Contact method.
- Note is a native textarea with visible label, initially about four lines, vertical resize, and stable ID. Required means non-whitespace note and an explicit outcome.
- Labels: `Outcome (required)`, `Review note (required)`, `Contact method (optional)`.
- Note helper: `Record what you checked and why you chose this outcome.` No autofilled assessment or description copied into the note.
- Retain all five existing outcome values/labels. Contact blank stays the real answer `No contact — reviewed from evidence alone`, submitted as explicit null.
- Retain disabled Submit until required fields are present. Alongside it, explain missing fields in text. Announce validation/pending/failure states without reading the entire form on every keystroke.
- Ownership remains optional: Claim does not gate the form. Retain Claim, Release, Take over, and explicit `Take over and review` with existing payloads.
- A 409 retains note/outcome/contact, refetches silently, and exposes the new ownership. A normal failure retains all fields and exposes retry. Pending submission disables duplicate submission.
- Add a route-local unsaved assessment guard: changed, unsent fields prompt `Leave without submitting this assessment?` on Back/View trip through the existing local navigation controls; Cancel leaves fields and focus intact. Native beforeunload covers reload/tab close. Do not persist free text in localStorage/sessionStorage and do not claim all browser navigation is intercepted if it is not.
- `ReviewFields` is shared with the existing trip batch form. Add an optional `idPrefix` prop so simultaneous forms never duplicate IDs. Each form owns its own validation messages and submit action.

## 4. Evidence presentation rules

Build a detail-only wrapper rather than changing the shared `ExceptionEvidence` layout for all consumers.

1. Snapshot present: show recorded driver/tracker capture times, stored separation and limit, stored proximity/precinct verdicts and recorded policy/boundary. Reuse the existing location components. Render their Field grid inside a two-column grid that becomes one column at narrow widths; locally override full-span fields at that breakpoint so existing `col-span-2` classes do not create an implicit extra column. Mount the existing map modal only when requested.
2. Snapshot absent, GPS present: show `Recorded exception location`, coordinates, and the exception's raised time separately. Do not call raised time GPS capture time or label those coordinates a phone fix unless the contract identifies the source. Display `Recorded location comparison unavailable` for location finding types and `View trip` for further evidence.
3. Photo present with usable signed URL: show the supporting photograph through `EvidencePhoto`, preserving its viewer and metadata.
4. Photo ID present but artifact/URL unavailable: show the existing retrieval-failure state, distinct from no photograph recorded.
5. No photo/fix/snapshot: display `No supporting photo or location recorded for this exception.` This says nothing about evidence held elsewhere in the trip.
6. Missing/poor/stale data means unavailable/unverified, never an inferred pass or a new breach. Never parse numbers or verdicts out of description prose. Do not attach handshake evidence levels or a blockchain tag without a qualifying record.

The existing comparison wrapper accepts an assessment without a precinct object; its recorded boundary is retained. Do not add map libraries, alter map tile destinations, or send personal data to additional services.

## 5. Grouping and trip continuity

Queue grouping is an optional display operation on the filtered complete chronological queue, keyed by `trip_id`. Group order follows each group's most recent raised timestamp descending, and child order is newest first. Show full trip reference, critical/warning/info counts, unreviewed/claim counts, and labelled `Newest` and `Oldest` raised timestamps. Preserve the full trip reference on individual child rows. Use an accessible disclosure button with `aria-expanded` and `aria-controls`.

Open groups containing critical records by default; warning-only groups may start collapsed. Never hide a group's critical count. State explicitly that counts reflect the current filtered results. Expanding a group does not claim or review anything. Keep every unique exception ID once and do not merge three distinct location findings into one synthetic incident.

Inside `TripExceptionsPanel`, default to a flat newest-first list, with phase context on every record. If the dispatcher explicitly selects optional phase grouping, group by real `phase_event_id`; null-linked records have their own `Trip-level records` group. Order groups by their newest exception and keep records newest-first within them. Use actual phase/precinct context already supplied there. Preserve invalid-phase handling, existing filters/counts, map actions, and `Show in timeline`. The existing selected-phase filter scopes the list before counts and optional grouping.

Keep batch review in this trip panel. The existing eligible set remains needs-review, non-critical, and either unclaimed or claimed by the current dispatcher. Preserve the existing frozen explicit-ID snapshot when the form opens; enforce/display the existing 100-record cap before opening a batch. Do not silently select the first 100 when more are eligible: prompt the user to narrow using an existing phase filter, or review records individually. No cross-trip bulk action is introduced.

Batch copy: `Review these N exceptions`, listing the selected records, and `This assessment will be recorded on each listed exception.` Newly arriving records are excluded from the open form.

## 6. Navigation and empty/error states

Use the URL as the source for tab, search, severity, dates, and grouping. Use `router.replace` for settled filter changes with scrolling disabled; use normal links for opening detail. Append the complete list URL using existing `withReturnTo`, and continue validating it with `safeReturnTo` on return. Copy/paste of the list URL reconstructs the controls.

History page restoration is part of this delivery, not just filter restoration. Add an optional navigation adapter to `useExceptionHistory`; its default behaviour must stay unchanged for existing callers. Persist cursor-stack/page-index in the list URL: `hp` is zero-based index, repeated `hc` parameters are the non-initial cursors. The implicit first stack entry is undefined. Parse the index as an integer, clamp it to the available stack, and reset stack/index whenever search/severity/date filters change. The hook still determines hasNext from the server, keeps request-generation protection, and never interprets opaque cursors. Failed or invalid cursor requests show the existing error/retry and a `Return to first page` action; do not silently label another page as the requested page.

Queue scroll/group expansion can be retained in sessionStorage as UI state only, keyed by signed-in user ID and canonical list URL. Store scroll offset, selected exception ID, and expanded trip IDs only. Do not store notes, descriptions, coordinates, names, auth tokens, or response caches. On return, restore after rows load; if the reviewed row has left the queue, focus the next remaining row or results heading. Clear transient restoration state on sign-out/user change. If sessionStorage is unavailable, navigation must still work and only scroll restoration degrades.

| Condition | Required presentation |
|---|---|
| Initial load | Loading state with reserved layout; do not flash `0 needing review` as a verified count. |
| Empty full queue | `No exceptions need review.` |
| Empty Claimed by me | `Nothing claimed by you.` + action to Unreviewed. |
| Empty filtered queue | `No exceptions match these filters.` + Clear filters. |
| Empty history, no explicit filters | `No exception history yet.` This archive includes legacy recorded rows as well as reviewed records. |
| Empty filtered history | `No history matches these filters.` + Clear filters. |
| First request fails | Error + Retry, never all-clear. |
| Refresh fails with visible data | Existing records remain visible with stale warning + Retry. |
| Detail refresh fails | Preserve loaded detail and typed form values. |

No source-filtered count or review outcome is displayed when its data is not available from the endpoint.

## 7. File map

All paths below are relative to the repository root. Proposed files do not exist yet.

| File | Responsibility / stage |
|---|---|
| `frontend/dispatcher/app/(app)/exceptions/page.tsx` | Compose tabs, filters, rows, grouping, history pagination; Stages 1–2 and 4. |
| `frontend/dispatcher/app/(app)/exceptions/page.test.tsx` | Queue/history semantics, filtering, navigation, errors; Stages 1–2 and 4. |
| `frontend/dispatcher/components/exceptions/ExceptionQueueRow.tsx` (new) | Responsive semantic link row; Stage 1. |
| `frontend/dispatcher/components/exceptions/ExceptionToolbar.tsx` (new) | Labelled common filter controls with queue-only grouping; Stage 1. |
| `frontend/dispatcher/lib/exceptions/view-state.ts` + `.test.ts` (new) | Parse/serialize URL state, cursor navigation and defaults; Stage 2. |
| `frontend/dispatcher/lib/exceptions/queue.ts` + `.test.ts` (new) | Pure queue filtering/partition/group selectors with stable order; Stages 1 and 4. |
| `frontend/dispatcher/lib/hooks/useExceptionHistory.ts` + existing `.test.ts` | Optional URL paging adapter; Stage 2. |
| `frontend/dispatcher/lib/hooks/useExceptionListRestoration.ts` + `.test.ts` (new) | Scoped UI-only scroll/expansion restoration; Stage 2. |
| `frontend/dispatcher/lib/format/exception.ts` + existing `.test.ts` | GPS label and phase/stop presentation helpers; Stage 1. |
| `frontend/dispatcher/app/(app)/exceptions/[id]/page.tsx` + existing `page.test.tsx` | Detail layout, draft navigation guard, existing mutations; Stage 3. |
| `frontend/dispatcher/components/exceptions/ExceptionDetailEvidence.tsx` + `.test.tsx` (new) | Detail-only snapshot/photo/GPS/unavailable wrapper; Stage 3. |
| `frontend/dispatcher/components/domain/ReviewFields.tsx` + `.test.tsx` (new test) | Textarea, required labels, optional ID prefix; Stage 3. |
| `frontend/dispatcher/components/trips/TripExceptionsPanel.tsx` + existing `.test.tsx` | Default chronological list, optional exact phase groups and batch eligibility presentation; Stage 4. |
| `frontend/dispatcher/components/trips/BatchReviewForm.tsx` + `.test.tsx` (new test) | Explicit scope, form ID prefix, preserve frozen batch; Stages 3–4. |

Read but keep unchanged: `frontend/shared/lib/types/exception.ts`, `action-location.ts`, existing location-evidence helpers, location comparison/map components, `ExceptionEvidence`, `ExceptionSummary`, `reviewState`, `returnTo`, global primitives, global tokens, auth, the backend, the driver PWA, and package files. If a supposedly read-only dependency must change, document why and reassess its consumers before expanding scope.

### Interfaces to keep stable

- `useExceptionQueue()` and its live subscription: unchanged.
- `useExceptionDetail(id)` and claim/release/review API signatures: unchanged.
- `reviewState(exception, currentUserId)`: remains the source of claim/reviewer wording.
- `withReturnTo(target, origin)` / `safeReturnTo(value, fallback)`: reuse, do not bypass.
- `ReviewFields`: preserve current note/outcome/contact callbacks; add only optional `idPrefix?: string`.
- Proposed `filterQueue(items, filters): TripExceptionListItem[]`: q/severity/date only; preserve order and input array.
- Proposed `sortQueueChronologically(items): TripExceptionListItem[]`: return a new array ordered by raised time descending, stable ID tie-break, unavailable timestamps last. Do not mutate hook data or use severity as a tie-break.
- Proposed `groupQueueByTrip(items): ExceptionTripGroup[]`: groups carry trip ID/reference, chronologically ordered items, severity counts, newest raised time and oldest raised time; sort groups by newest raised time, then deterministic trip ID. Do not fabricate phase identity.
- Proposed `ExceptionListViewState`: tab (`unreviewed | mine | history`), q, severity (`'' | ExceptionSeverity`), optional from/to dates, group (`none | trip`), history cursor stack and index. Bad parameters fall back to safe defaults.
- Proposed optional `useExceptionHistory(filters, navigation?)` adapter: navigation receives `{cursorStack: (string | undefined)[], pageIndex: number}` and an `onChange(next)` callback. Existing callers using one argument retain the current hook behaviour. Define this type in `view-state.ts` so parsing and the hook agree.

## 8. Staged implementation

### Stage 0 — Establish a usable baseline

**Visible endpoint:** Existing queue, detail and trip exception panel can be demonstrated with representative data before redesign.

- [ ] Read the in-scope files/imports and current tests. Record git status; preserve unrelated changes.
- [ ] Run existing dispatcher type-check, lint and the focused exception tests. Record failures before changes. Do not repair unrelated failures as part of this plan.
- [ ] Use existing mocks/test fixtures to cover critical + warning, own/other/unclaimed, reviewed/authored/legacy, absent metadata, snapshot/missing snapshot, photo/missing URL, and 100/101 batch-eligible records. Keep fixture additions in the owning test files.
- [ ] Inspect the trip panel, selected-phase view, map modal, and batch form in the browser. Viewing forms is not permission to mutate shared demo records.

**Verify:** The current tests' claim/conflict/batch invariants are understood; any unavailable live route is documented and a mock-backed demonstration exists. **Fence:** No server, seed, auth, or infrastructure changes to make the demo work.

### Stage 1 — A readable queue and usable controls

**Visible endpoint:** At 1024, 1208 and 1440 px, a dispatcher can read an incident and open it without horizontal scrolling.

- [ ] Extract the responsive link row and common toolbar. Remove the fixed-width description-column layout, not merely its overflow rule.
- [ ] Apply the local typography/status contract, shared exception formatter, full visible trip reference on every row, absolute raised timestamp, and readable raw phase/stop labels.
- [ ] Sort the complete loaded queue newest-first before rendering tab/filter results; keep the hook array untouched. Add local queue filtering on complete tab sets. History passes only supported server filters and keeps its server chronological pagination. Keep unfiltered tab counts and label the list `Newest first`.
- [ ] Add tab semantics/keyboard navigation and the specified empty/stale/loading states. Rename Reviewed to History; remove its redundant All statuses/Reviewed control while preserving default archive inclusion of legacy records.
- [ ] Tests: a newer warning appears before an older critical exception despite the server's input order; chronological sorting does not mutate hook data; tied timestamps have deterministic order; unavailable timestamps are last and labelled; local filtering preserves chronology; SA date boundaries match history (21:59Z belongs to the preceding SA day, 22:00Z to the next); search treats percent/underscore as literal text like the server's escaped substring search; colleagues' claims stay in Unreviewed; labels contain no raw underscore; the full trip reference and absolute raised time are visibly rendered on every row; row href identifies the correct record; empty filtered data differs from empty full data; failed loads are never all-clear. Update the existing `keeps queue order from the server` test to assert this confirmed chronological behaviour rather than retaining the old severity-order expectation.

**Verify:** Focused queue/page/formatter tests plus browser at the three widths. The longest fixture descriptions and claim names remain usable. **Fence:** No grouping or new API fields yet; no global design changes.

### Stage 2 — Preserve the dispatcher’s place

**Visible endpoint:** Open detail from any tab, then Back; tab, filters, history page, and queue position return accurately.

- [ ] Implement tested URL state parser/serializer; round-trip valid state and reject unknown tabs/severities/groups, malformed dates/indexes. Date parsing checks actual calendar validity (2026-02-30 is invalid) and rejects inverted ranges rather than silently normalising them.
- [ ] Wire the page to URL state. Update settled search/filter values without stealing input focus; changing archive filters resets cursors.
- [ ] Pass full origin through `withReturnTo` on row links. Add the optional history navigation adapter and preserve stale/request-generation protections.
- [ ] Implement user-scoped UI-only scroll restoration with unavailable-storage fallback. Restore after data loads; focus remaining results when the reviewed row disappears.
- [ ] Tests: return from mine/history; history page 2 survives remount; changing q/severity/dates clears old cursor stack; a slow previous request cannot overwrite the new page; invalid cursor stays an honest error with first-page recovery; hostile returnTo still falls back safely; user switch cannot restore another user's state.

**Verify:** Focused parser/restoration/history-hook/page/detail tests; browser refresh and Back from a history page beyond page 1. **Fence:** No response caching, persisted notes, or authentication changes.

### Stage 3 — Evidence beside a clear assessment

**Visible endpoint:** Detail presents the incident and honest evidence clearly; wide screens put the assessment beside it, and stacked screens reach it directly.

- [ ] Consolidate metadata/context and implement the layout contract around the existing handlers. Replace needs-review critical colouring with neutral workflow text.
- [ ] Add the detail evidence wrapper using existing recorded-location and photo presentation. Keep the system-only GPS trigger and legacy capture semantics.
- [ ] Update ReviewFields to a labelled textarea and required/optional labels; order outcome/note/contact. Supply unique ID prefixes from detail and batch form.
- [ ] Add missing-field explanation, pending/validation feedback, and the limited unsaved-navigation guard without persisting text. Preserve claim/take-over payloads and 409 recovery.
- [ ] Tests: note is multiline; blank/whitespace note or unset outcome blocks keyboard submission; contact remains optional/null; competing claim preserves fields; no snapshot cannot become a comparison; snapshot is mapped through recorded helpers; missing photo is distinct from retrieval failure; leaving can cancel; reviewed/authored records remain read-only with correct identity.
- [ ] Inspect 1440/900, 1440/768, 1208/984, 1024/768 and 768/1024. At 200% zoom, every field/action is reachable and neither sticky content nor map controls obscure focus.

**Verify:** Detail, ReviewFields, evidence wrapper, existing location evidence and batch regression tests, followed by browser inspection. **Fence:** No inferred evidence, extra trip fetches for enrichment, rewritten review policy, or shared map redesign.

### Stage 4 — Group related records without hiding them

**Visible endpoint:** A trip's related warnings are easy to explore while critical counts, individual records, and review ownership stay explicit.

- [ ] Implement optional trip grouping on the complete filtered queue; default flat/newest-first. Keep every record, groups sorted by newest exception, children sorted chronologically, newest/oldest group timestamps, full trip references on children, and default-open critical groups.
- [ ] Retain the flat chronological default in TripExceptionsPanel and add explicitly selected phase-event grouping, retaining selected/invalid-phase handling, unique-ID dedupe and existing map/timeline actions.
- [ ] Present batch scope/cap clearly. Retain frozen IDs and eligibility; require narrowing if eligible count exceeds 100. Apply the shared form improvements without cross-trip review.
- [ ] Tests: initial view is ungrouped/newest-first; selecting trip grouping orders groups by latest exception and children newest-first, with correct newest/oldest summaries; clearing grouping restores global chronology; trip reference stays visible on group children; same phase label on separate trips never merges; multiple phase IDs with identical labels remain separate in optional trip-panel phase groups; null-linked records remain visible; duplicate IDs render once; critical and colleagues' claims never enter a batch; 100 is allowed and 101 requires narrowing; a warning arriving after form-open does not change submitted IDs; map/timeline actions still open the right evidence.

**Verify:** Pure queue sorting/grouping tests plus queue, TripExceptionsPanel and BatchReviewForm tests; browser keyboard expand/collapse and narrow-screen panel. **Fence:** No synthetic incidents, phase grouping in the global queue, group-level review, new selection workflow, or backend ordering changes. Display chronology is explicitly frontend-owned for the complete queue.

### Stage 5 — Final visual and regression acceptance

**Visible endpoint:** Queue → evidence → assessment → return is coherent across all supported views and reviewed against the design contract.

- [ ] Run dispatcher type-check, lint, full test suite and build once after all changes. Rerun only after subsequent changes or new failures.
- [ ] Exercise keyboard-only tabs/filtering/row link/Back/textarea/outcome/map modal/disclosures. Confirm focus returns after closing the modal and returning from detail.
- [ ] Check 768, 1024, 1208, 1440 and 1920 px widths, 768 px heights, 200% zoom and reduced motion. At small widths, controls wrap; no essential action or incident description clips. Do not infer layout from JSDOM.
- [ ] Measure text contrast against actual computed surfaces: 4.5:1 for ordinary text; focus/control boundaries remain discernible. Verify labelled fields and screen-reader announcements.
- [ ] Capture review screenshots of queue flat/grouped, empty/filter error states, detail snapshot/no-snapshot/photo failure, claimed-by-other, reviewed state, and trip batch scope using non-sensitive fixtures.
- [ ] Review git diff against this file map. Report changed files, checks, screenshots, and unresolved baseline/environment failures. Do not commit, push, stage unrelated files, or claim backend health from frontend results.

**Verify:** Acceptance checklist below passes, or a specific limitation is recorded with its affected view. **Fence:** This is not permission to fix unrelated backend failures or expand the redesign to the driver app.

## 9. Commands and acceptance checks

Run from `frontend/dispatcher`:

```sh
npm run type-check
npm run lint
npm test -- 'app/(app)/exceptions/page.test.tsx' 'app/(app)/exceptions/[id]/page.test.tsx' lib/hooks/useExceptionHistory.test.ts lib/hooks/useExceptions.test.ts lib/format/exception.test.ts components/trips/TripExceptionsPanel.test.tsx
npm test -- lib/exceptions lib/hooks/useExceptionListRestoration.test.ts components/exceptions components/domain/ReviewFields.test.tsx components/trips/BatchReviewForm.test.tsx
npm test
npm run build
```

The second focused command applies after its new files exist. Existing location/returnTo tests should be included for Stages 2–3; use their established fixture builders. Do not add Playwright/axe dependencies solely for this change: use existing browser automation plus semantic component tests and manual computed-style checks. Build requiring unavailable environment config is an explicit verification limitation, never a reason to read secrets.

- [ ] Incident explanation remains visible at 1024/1208 px; no hidden review action.
- [ ] Default lists are ungrouped/newest-first regardless of severity; filtering preserves chronological order.
- [ ] Every exception visibly identifies its trip and absolute raised time, including grouped children.
- [ ] Optional trip groups and their children follow chronology and show correct newest/oldest timestamps.
- [ ] Full identifiers and long claim names remain accessible and distinguishable.
- [ ] Severity, trip lifecycle and review status never imply the same state.
- [ ] Queue filters count the full tab set; history counts/pagination describe server results.
- [ ] Back restores controls, exact history page and useful queue position.
- [ ] Unverified/missing evidence never becomes confirmed evidence.
- [ ] Optional claims, explicit take-over, immutable review and null contact semantics remain intact.
- [ ] Reviews on closed/cancelled trips never reopen or change those trips.
- [ ] Batch contains explicit eligible IDs on one trip, with the existing cap and frozen scope.
- [ ] Existing error/stale behaviour and draft values survive failed refreshes.
- [ ] Keyboard/zoom/modal/focus checks pass with representative long-content fixtures.
- [ ] No backend/shared types/global primitive/dependency change was made without a recorded scope revision.

## 10. Risks, tripwires and deferred work

| Risk | Early warning | Required response |
|---|---|---|
| API evidence gaps mistaken for UI omissions | Sample detail has no assessment/phase ID | Use fallback copy/link; do not fabricate a map or enrich every row. A future detail-context API is separate work. |
| Live updates invalidate a draft, claim or batch | New claim/record arrives with a form open | Preserve values and frozen IDs; retain explicit 409 recovery and ownership labels. |
| History URL restoration interferes with cursor races | Filter change fetches with an old cursor, or stale response paints over the new page | Stop Stage 2, pin the failure in a hook test, fix navigation state before proceeding. Keep the optional adapter backward compatible. |
| Shared form styling affects other pages | ReviewFields consumer differs from detail | Verify the batch consumer in Stage 3. Do not alter global Input/Select to solve a local problem. |
| Live environment prevents visual verification | Trip still fails to load; current browser is at login | Use existing mock-backed fixtures and report the limit. Do not create accounts or mutate shared data. |
| Existing backend suite is red | Hook reports failures; one setup error reproduced as no PostgreSQL at localhost:5433 | Track separately. It does not justify backend repairs during a UI plan. Do not describe backend tests as passing. |

Deferred: global phase grouping, named facility/driver enrichment in queue rows, source/type/outcome archive filters, cross-trip batch review, editable reviews, persistent free-text drafts, claim history, severity upgrades, evidence sign-off, chain anchoring, driver exception picker changes, product-wide fonts/tokens, and a new drawer interface.

## 11. Planning status

The plan is ready for product review. All implementation checkboxes remain unchecked. Creating this document did not run implementation tests or change application behaviour. Next implementation action, once requested: Stage 0 followed by the readable queue in Stage 1.

---

## Addendum — 2026-10-05: universal `Table`, trialled on Exceptions

Supersedes the Stage 1 `ExceptionTable`/`ExceptionToolbar` skins and the "Raised ↓" static header. Everything else in this plan stands.

**Why.** The overlap was a bug: `ExceptionQueueRow` split the raised date on `', '`, but Chrome's `en-GB` emits `01 Oct 2026 at 12:50`, so the whole string stayed on one line in an 11% column. Separately, three table skins exist (`ui/DataTable`, the dashboard/History flex-div table with `ChecklistRow`, and `ExceptionTable`). The dashboard table is the behaviour to keep (px base widths, drag-resize, stretch to fill wide screens), so it becomes the shared component. `ui/DataTable` has 8 consumers (Drivers + 7 analytics files) and is **not touched**.

**Scope.** Exceptions page only. The dashboard, History, Drivers and `ChecklistRow` migrate later, by the owner of each page, once the table has proven itself here.

### New shared pieces (all `components/ui/` + `lib/hooks/`)

| File | Purpose |
|---|---|
| `ui/Table.tsx` | Real `<table>` + `<colgroup>`, `table-layout: fixed`, sticky header, resize handles, sortable headers, flat `rows` or collapsible `groups`, loading/error/empty are the caller's job |
| `lib/hooks/useTableColumns.ts` | Column widths (px base, scaled up to fill the container — same maths as the dashboard), drag-resize, per-table `localStorage` persistence (try/catch, validated), `hideBelow` column hiding from container width |
| `ui/SearchField.tsx`, `ui/FilterSelect.tsx`, `ui/ListToolbar.tsx` | The search/select skin currently copy-pasted on 4 pages; toolbar = flex-wrap row with the shared gap |
| `lib/hooks/useNow.ts` | One interval clock so relative times tick without each row owning a timer |

```ts
interface TableColumn<T> {
  id: string; label: string
  width: number            // base px; columns scale up proportionally on wide screens
  minWidth?: number        // default 80
  hideBelow?: number       // hide when the container is narrower than this (px)
  sortable?: boolean
  render: (row: T, ctx: { hidden: ReadonlySet<string> }) => ReactNode
}
interface TableProps<T> {
  tableId: string          // localStorage key for widths
  columns: TableColumn<T>[]
  rows?: T[]                                    // flat…
  groups?: { id: string; header: ReactNode; rows: T[]; collapsed?: boolean }[]  // …or grouped
  getRowKey: (row: T) => string
  rowClassName?: (row: T) => string | undefined
  sort?: { id: string; dir: 'asc' | 'desc' }
  onSort?: (id: string) => void                 // controlled: the owner sorts the data
  scrollRef?: Ref<HTMLDivElement>               // owner needs the scroller (scroll restoration)
  caption: string                               // sr-only
}
```

**Sorting vs filtering (answer to "is it big?").** Sorting is small and lives in the table: `aria-sort`, a real `<button>` in the `<th>`, a direction arrow; the owner holds the state and sorts. It is **client-side only**, so it is enabled on the Unreviewed/Claimed tabs (complete set in memory) and **disabled on History** (cursor-paginated server-side; sorting one page would mislead) and in trip-grouped view. Per-column filtering is a different size (popover UI, focus handling, per-type inputs, URL state, server support for History). Not in this change; severity/date/search stay in the toolbar. If wanted later it is an optional `filter` slot on `TableColumn`.

### Exceptions page changes
- `lib/format/exception.ts`: `fmtExceptionRaisedParts(iso) -> { day, time }` from `formatToParts` (no string splitting); `fmtExceptionRaised` stays for the detail page. `fmtClaimedFor(iso, now)` → "just now" / "2 min ago".
- `lib/exceptions/queue.ts`: `sortQueue(items, { key, dir })`, keys `incident | trip | crew | raised | status`, ties by chronology then id; `lib/exceptions/view-state.ts`: `sort`/`dir` in the URL (default `raised`/`desc` omitted).
- Columns: Incident, Trip & route, Driver & vehicles (`hideBelow` 1100 — driver line moves under the trip), Raised, Status. Status cell: unclaimed (muted) · "You" chip · initials + "Claimed by Tim" + "2 min ago". Action: "Review", or "Take over" on a colleague's claim.
- Live: the queue already refetches on `exception_claimed`. Add a short row highlight and a polite sr-only announcement when a row's claim holder changes (`useRecentlyChanged`), no backend change.
- Page layout = Trip History's: `ListToolbar` above one card (`SecHead` + scrolling table + `Pagination` footer). Tabs size to content (no `max-w-md`, no truncation). Date filter uses `DateRangePicker` with the full-range-means-unfiltered mapping.
- Delete `ExceptionTable.tsx`, `ExceptionToolbar.tsx`; `ExceptionQueueRow.tsx` becomes cell renderers.

### Tests (Vitest/RTL; geometry is checked in the browser, not JSDOM)
- `fmtExceptionRaisedParts` returns separate day/time whether the runtime separator is `, ` or ` at `; SAST boundary (21:59Z vs 22:00Z).
- `sortQueue`: each key both directions; null driver sorts last; ties deterministic; input not mutated.
- `useTableColumns`: scale-to-fill when container wider; drag changes one column and respects `minWidth`; persisted widths restored, corrupt/unavailable storage falls back; `hideBelow` hides/returns columns.
- `Table`: `aria-sort` + one `<button>` per sortable header; click calls `onSort`; non-sortable has no button; collapsed group body hidden; header cell count = visible column count.
- Page: sorting by Trip reorders rows; sort disabled on History and grouped view; claimed-by-other row shows the name and "2 min ago" and a Take over action; a claim change announces once; date range mapping (default range → no `from`/`to`).

### Acceptance (browser, after sign-in)
No overlap at 1024/1208/1440/1920; widths drag and persist across reload; wide screen stretches to fill; claim by a second session appears in the first without reload.
