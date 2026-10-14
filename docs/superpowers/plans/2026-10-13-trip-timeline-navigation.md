# Trip timeline navigation implementation plan (Revision 2)

> **For implementation:** Use superpowers:executing-plans, one **run** at a time, task by task. Repository rules: no commits, pushes, branch changes or discarding existing changes; stage only the named files. Stop after each run; the owner reviews and commits before the next run starts.

**Revision 2 (2026-10-13), after review of Revision 1 and of Task 10b:**
- The two views are **Evidence** and **Minimised** (was Summary). **Evidence is the default** when a trip opens.
- Split into three independent runs, in this order: **A** Cargo skeleton, **B** Audit packs inside Info, **C** Minimised/Evidence view and expanded layout. Each run builds and tests on its own and can be dropped without breaking the others.
- Run C no longer has per-view scroll bookmarks or a `useTimelinePosition` hook. Switching view or layout keeps the phase at the top of the reading area by scrolling that phase into view with the existing jump mechanism.
- Layout controls carry `data-keep-exception-selection` so they never deselect the selected exception (D52 in the rail plan: clicking outside the selected record clears the selection).
- The Evidence body is hidden with `hidden` (not just visually) and photos load lazily, so Minimised does not load every thumbnail.
- Base: **Task 10b is committed first.** This plan edits many of the same files; do not start from a working tree that still has 10b staged.

**Revision 3 (2026-10-14), after review of the built Runs A–C and the owner's direction:**
- **Minimised is not a second component.** It is the same phase cards with a more compact *collapsed* state: header, a verdict headline and the exception count ("Needs attention · 2 exceptions · 2 need review"), with no event rail and no reasons. Expanding a card shows everything, exactly as in Evidence, and open cards stay open when the view changes. In Transit stays open with no toggle in Evidence (D31) but collapses like any other card in Minimised, still open while it is the live phase. There is no hidden second tree, no phase-name navigation, and "Show in timeline" no longer switches view. This supersedes the Minimised row and the "Columns: Phase | Time | Verdict | Exceptions" text in Run C. The count is plain text in the verdict, because the card header is already the expand button.
- **Expand keeps the trip title and the info panel.** The facts grid (driver, vehicle, schedule, cargo) stays fixed in normal layout and collapses in expanded layout; the title row, status chips, forensic toggle and the dock stay. The expand control is an icon button (outward arrows, inward when expanded) with an `aria-label` and a tooltip.
- **The overlay state machine is gone** (`expandedOverlayOpen`, the suppressed-panel state, `DetailPanel` `presentation`, `keepOverlayDismissals`), because the dock no longer leaves.
- **The timeline toolbar is one row** (view tabs; refreshed time, Jump and the expand icon on the right). The trip reference and the "TRIP TIMELINE" label are not repeated there (the heading stays for screen readers).
- Kept as built: the reading-phase anchor through view and layout changes and the keep-selection attribute on layout controls.

**Goal:** Let dispatchers scan phase outcomes in Minimised, inspect the compact records and cards in Evidence, and give the timeline the full available width and height without losing their place. Put Audit packs beneath the trip information in the Info panel and replace Cargo's initial circle loader with content-shaped skeletons.

**Architecture:** One mounted timeline, one scroll container. Minimised rows and Evidence cards use the same phase models and exception scoping (`buildPhaseCardModel`, the deduplicated phase-scoped exception list). Expanded layout hides the full header and the detail dock in place and shows a compact toolbar; disclosure state is retained because nothing is re-mounted. Audit packs compose beneath `TripInformation`.

**Stack:** existing Next.js App Router, React 19, TypeScript, Tailwind, Vitest + Testing Library. No new dependencies. Frontend only: no backend, API, shared-type or package changes.

**Global rules for every run:** type every signature, no `any`; comment the why; no magic strings (view names, panel names and attribute names are exported constants); one reusable piece per concern (reuse `PhaseVerdictLine` wording, `Skeleton`/`SkeletonBar`, `AuditPacksPanel`, `ExceptionRowList`, `KEEP_EXCEPTION_SELECTION_ATTR`, `isTripLevelException`); match the surrounding file's comment density. Run from `frontend/dispatcher`: `npm test -- <files>`, then `npm run type-check`, `npm run lint`, `npm test`. A baseline failure that existed before the run is reported, not fixed.

---

## Run A: Cargo skeleton loading

**Modify:** `components/domain/ManifestContent.tsx`, `components/domain/__tests__/ManifestContent.test.tsx`. **Create:** `components/domain/ManifestContentSkeleton.tsx`. **Reuse unchanged:** `components/ui/Skeleton.tsx`. **Out of scope:** data fetching, API, the loaded view, the refresh control.

**Behaviour**
- Shown only for `!manifest && isLoading`. Shaped like the loaded panel: the two-column summary grid (four placeholders), search/filter area, three collapsed waybill rows, refresh footer. Fills the panel's real width; no invented cargo values or counts.
- One accessible status, `Loading cargo…`; placeholders are `aria-hidden`; no focusable fake controls; keeps the primitives' reduced-motion behaviour.
- A failed request ends the skeleton and shows the existing recoverable message. 404 / no-manifest, snapshot-only, empty and stale-refresh-error states are unchanged. During background refresh the loaded cargo, search, filter and open waybills stay (no skeleton).
- Remove the now-unused `Spinner` import.

**Tests** (extend the existing file): initial loading exposes one `Loading cargo…` status and the skeleton structure, no spinner, no focusable placeholder; it becomes real cargo when the hook returns a manifest; background validation keeps cargo, query, filter and an open waybill with no skeleton; error/retry, 404 and snapshot-only tests still pass.

- [ ] Step 1: failing tests. Step 2: implement. Step 3: targeted tests, type-check, lint, full suite. Step 4: in the browser, throttle the cargo request and check the 400 px dock and the overlay (spacing, no overflow), then refresh loaded cargo. Step 5: stage the four files; suggested commit `feat(dispatcher): cargo skeleton while the manifest loads`.

---

## Run B: Audit packs inside Info

**Modify:** `components/trips/TripDetailPanel.tsx` + test, the `TripPanel` type in `components/trips/TripSummary.tsx` + test, `app/(app)/trips/[id]/page.tsx` + test, `lib/trips/panel-query.test.ts`. **Reuse unchanged:** `AuditPacksPanel.tsx` and its test (the action regression suite). **Out of scope:** audit actions, permissions, the dialogs' content.

**Behaviour**
- `TripPanel` becomes `'information' | 'manifest' | 'exceptions'`. Selectors read **Info | Cargo | Exceptions**; the standalone Audit packs selector and panel branch are removed.
- Info renders `TripInformation`, then a separated **Audit packs** section (heading, stable id `trip-audit-packs`) containing the existing `AuditPacksPanel`. One scroll container: no nested scroller.
- `TripDetailPanel` keeps `packsVersion`, the issue/declaration callbacks and the dialogs as siblings; the refresh key stays on `AuditPacksPanel` alone, so an issue or declaration does not remount the trip information or reset the panel scroll. Dismissing a dialog restores focus to its trigger.
- An audit permission, loading or error state never stops the trip information above it from rendering.
- Old `?panel=audit` links resolve to `information`, then scroll the panel's own container to the audit section once it is visible (docked and overlay). A legacy alias only: generated navigation uses `information`, `manifest`, `exceptions`. The landing scroll happens once, not on each background refresh.

**Tests:** exactly three selectors; audit follows information in Info and is absent under Cargo/Exceptions; audit loading/permission/error leaves Info usable (mock audit data in the existing Info tests); `?panel=audit` lands on the section in dock and overlay without re-scrolling after refetch; ordinary Info opens at the top; `buildTripPanelQuery` never produces `audit`.

- [ ] Steps: failing tests, implement, targeted tests (`components/trips/TripDetailPanel.test.tsx components/trips/AuditPacksPanel.test.tsx 'app/(app)/trips/[id]/page.test.tsx' lib/trips/panel-query.test.ts`), type-check, lint, full suite; browser check on the docked panel and a narrow overlay with long recipient names and wrapped buttons; issue and declare once and confirm the section refreshes and the scroll stays. Stage; suggested commit `feat(dispatcher): audit packs inside trip information`.

---

## Run C: Minimised view and expanded timeline

**Decisions**
- **N1:** `TimelineView = 'evidence' | 'minimised'` exported from `TripTimeline.tsx`; labels "Evidence" and "Minimised". Default `'evidence'`. Local to the trip page (state resets when another trip opens); no URL parameter.
- **N2:** Expanded layout is local state, `timelineExpanded`; no URL parameter.
- **N3:** Layout controls (view selector, Expand/Return, Jump to current phase, Info/Cargo/Exceptions in the toolbar) carry `data-keep-exception-selection`.
- **N4:** No reading-position store. Before a view or layout change, record the id of the phase at the top of the reading area; after the change, scroll that phase into view (`scroll-margin-top` = the sticky toolbar's height). Explicit navigation (phase-name click, hash, exception reveal) overrides it.

**Files:** modify `components/trips/TripTimeline.tsx`, `TimelinePhase.tsx`, `PhaseTimelineItem.tsx`, `TripDetailPanel.tsx`, `TripSummary.tsx`, `components/ui/DetailPanel.tsx`, `app/(app)/trips/[id]/page.tsx`, the `ScenarioView.tsx` caller (wiring only), `components/domain/EvidencePhoto.tsx` (`loading="lazy"` only), and their tests. **Create:** `lib/phase/minimised.ts` (+test), `components/trips/PhaseMinimisedRow.tsx` (+test), `components/ui/DetailPanel.test.tsx`. **Out of scope:** backend, verdict policy, evidence capture, exception review rules, driver PWA, global layout, dependencies, Runs A and B.

### Minimised view

- One row per actual plan phase, by `sequence_number`, keyed by `phase_event_id` (repeated types at different stops stay separate). Columns: **Phase | Time | Verdict | Exceptions**. Beneath the phase name, the existing stop/leg label; the current phase is marked in words and visually.
- **Time** is `completed_at`, labelled accessibly as the recorded completion time. Trip creation uses `trip.created_at`. A missing completion shows `—`; never a planned time or `updated_at`.
- **Verdict** is `buildPhaseCardModel(...).verdict`: the existing headline, with the full reasons available accessibly, not dumped into the row. Phases with no verdict use the existing state wording: `Current phase`, `Not started`, `Not reached`; trip creation reads `Trip created`. Transit's "No exceptions recorded" is never shown as "Checks passed".
- **Exceptions** are the full deduplicated phase count, including zero. Needing review reads e.g. `5 exceptions · 2 need review` with text and an attention icon; reviewed records still count. A flagged check with no linked exception keeps the model's `Needs attention` verdict and never invents a count.
- A nonzero count is a button that calls `onOpenException(null, phaseId)` (all records for that phase, exactly as "+n more"). Zero is plain text. Selecting a record in the panel marks its owning row selected without changing counts or clearing the selection.
- Clicking the phase name switches to Evidence and scrolls to that phase **without opening it** or changing any open card.
- **Trip record** keeps its own row below the phases (count and needs-review count); its count calls `onOpenException(null, null)`, which already maps to `TRIP_LEVEL_SCOPE`. A selected trip-level record marks this row.
- An anchor-failure warning stays on its row as a compact warning, separate from the verdict.
- Pure projection: `buildPhaseMinimised({ trip, phase, card, exceptions, selectedExceptionId }): PhaseMinimisedModel` with `completedAt`, `verdict`, `fallbackLabel`, `exceptionCount`, `needsReviewCount`, `selected`. The caller passes the already deduplicated, phase-scoped exceptions (the same list the Evidence card uses).

### View switching

- `TripTimeline` takes `view`, `onViewChange`, `onShowPhase(phaseId)`; the page owns the state. Both representations live in the same mounted phase wrappers; each phase exposes **one** `phase-<id>` anchor. The Evidence body is hidden with the `hidden` attribute while Minimised is showing: it stays mounted (open cards and nested disclosures survive a round trip) but leaves the tab order and the accessibility tree. Transfer focus before hiding a focused subtree. Never expand-all.
- Evidence keeps today's behaviour: caps, evidence groups, forensic gates, in-transit always open, `Jump to current phase`.
- `Show in timeline` from the panel switches to Evidence, opens only the addressed phase if needed, pins a capped exception, then focuses, highlights and scrolls to its row (trip-level reveals land on the Trip record row). It never targets a hidden element: issue the reveal after the view has switched.

### Expanded layout

- Control top right of a sticky toolbar inside the timeline scroller: `Expand timeline` / `Return to trip layout`. The toolbar also holds a compact trip reference, `Evidence | Minimised`, `Jump to current phase` where applicable, and Info / Cargo / Exceptions buttons (Audit packs live in Info). Do not repeat the header's driver, vehicle, schedule and cargo grid.
- Expanded: the full `TripSummary` header is hidden in place (`hidden`, so it leaves keyboard and accessibility navigation, but stays mounted) and the 400 px dock is not shown; the timeline loses its `max-w-4xl` cap and uses the freed width and height through the existing flex layout (`min-h-0 flex-1`, one scroller). No fixed pixel heights, no header-height subtraction. The toolbar may wrap; its real height sets the reading space.
- The same timeline instance, keys and scroller throughout: no second timeline, no fullscreen modal.
- Details are on demand while expanded: `DetailPanel` and `TripDetailPanel` get `presentation?: 'responsive' | 'overlay'` (default `'responsive'`, every other caller unchanged). Entering expanded layout never raises an overlay. A toolbar button, or opening an exception, raises it even if that panel is already selected in the URL. One local boolean, `expandedOverlayOpen`, records that request; closing the overlay clears it but keeps the URL selection and filter. Returning to normal layout restores the header and the responsive dock (docked at ≥ 1280 px, overlay below); a remaining URL selection never raises an overlay on its own.
- Expansion and return never change the view, any open card, the selected exception, the review filter or forensic mode.
- The reveal code in `page.tsx` assumes `matchMedia('(min-width: 1280px)')` means "docked"; effective docking is that breakpoint **and** normal layout. Replace the viewport-only assumption and the `selected === null` pending-reveal gate with effective panel visibility.

### Tests

- `lib/phase/minimised.test.ts`: counts, zero, review states, selection, missing times, trip creation, cancelled/unreached and overridden phases, transit wording kept ("No exceptions recorded"), a flagged check with zero exceptions, multiple loading and transit legs.
- `PhaseMinimisedRow.test.tsx`: count and phase-name callbacks (`onOpenException(null, phaseId)`, `onShowPhase`), zero is not a button, accessible time label, keyboard operation.
- `TripTimeline.test.tsx`: default view is Evidence; switching to Minimised shows one row per phase plus the Trip record row and no accessible evidence rows; a phase and a nested photo group opened in Evidence are still open after Minimised → Evidence; closed phases stay closed; unique DOM ids; a trip-level selection marks the Trip record row; the evidence body has the `hidden` attribute in Minimised and photos use lazy loading.
- `page.test.tsx`: expand and return keep the same timeline node and scroller, remove and restore the width cap, hide and restore the header (hidden controls are not reachable), and keep the selected exception and URL; entering expanded layout with Exceptions already selected leaves the overlay closed; a toolbar button opens it; closing it keeps the URL; the selection survives clicking the view selector and Expand (they carry the keep attribute); a reveal from Minimised with the overlay open closes the overlay, switches to Evidence, opens only the addressed phase and focuses a capped fifth exception; trip-level reveal and repeated reveal requests work.
- `DetailPanel.test.tsx`: responsive default unchanged; forced overlay on a desktop viewport; dismissal.
- Phase position: after a view or layout change with mocked geometry, the phase that was at the top is scrolled into view; an explicit navigation wins; a background refresh does not scroll again.

### Steps

- [ ] 1: failing tests (`minimised.ts`, `PhaseMinimisedRow`), then implement; **stage and stop for review** (suggested commit `feat(dispatcher): minimised phase rows`).
- [ ] 2: failing view-switch tests, then add the toolbar selector, hidden Evidence body, lazy photos, reveal ordering; stage and stop (suggested commit `feat(dispatcher): minimised and evidence views`).
- [ ] 3: failing expansion and `DetailPanel` tests, then expanded layout, compact toolbar, overlay presentation, position keeping; type-check, lint, full suite; stage (suggested commit `feat(dispatcher): expand the timeline into the header and dock space`).
- [ ] 4: real-browser check (JSDOM cannot prove layout or native dialog focus) on a completed trip with many exceptions, at 1440 px, around 1280 px and at a narrow width: extra height after expansion, header restored on return, live resize and browser zoom, view round trips with a phase and a nested photo group open, overlay Escape and focus return, current-phase jump, the 15-exception phase, live refresh. Report the results; fix only defects in this run's files.

## Review focus

1. Repeated phase labels in a long cross-dock plan keep separate counts, anchors and selected states.
2. Five or more phase exceptions, trip-level records and duplicate polling records keep accurate totals and reachable selected records.
3. Missing timestamps, cancellation, override and transit keep their honest wording.
4. A selected exception stays selected through view switching and expansion, with no dock raised and no focus trap; hidden header controls are not keyboard-reachable.
5. Refreshes never scroll the reader back to an old selection or reveal.
