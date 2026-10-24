# Dispatcher cleanup audit

**Reviewed:** 22 October 2026. **Branch:** `dev`. **Scope:** `frontend/dispatcher/`: 369 non-test source files (about 40,800 lines), 213 test files, and the root configs. This is a companion to the driver-pwa, receiver and client-portal audits of the same date, using the same method and category key.

**Outcome:** the dispatcher is the largest frontend and has the most to clean up.

- **Checks:** it compiles, lints clean apart from two `<img>` warnings, and all 2,989 tests pass.
- **Cleanup volume:**
  - About 250 comments that are references, history notes or essays.
  - 14 dead files.
  - About 40 dead exports, props or variants.
  - A wide band of duplicated helpers.
- **Bugs:** the review also found about 15 real bugs (§2).

No application code was changed during this audit. Line numbers are correct on `dev` as of the review date; recheck them before editing.

---

## 1. How this was produced

| Check | Command (from `frontend/dispatcher/`) | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit` | Clean |
| Unused locals and parameters | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | 13 findings (§3), plus the 5 in `shared/lib/types/phase.ts` already listed in the driver-pwa audit |
| Lint | `npx eslint .` | 0 errors, 2 warnings (`<img>` in `components/domain/EvidencePhoto.tsx`) |
| Unused files and exports | `npx knip@5` | 14 files, 42 exports and 2 duplicate exports. Every file was checked with grep (§4). |
| Tests | `npx vitest run` | 213 files and 2,989 tests pass |
| Comment and code review | Every non-test source file read in full, split across 8 folder groups | §5 to §7 |

Each dead-code, stale-reference and bug claim was checked with `grep` or by reading the code. Claims marked **unverified** were reasoned from the code but not reproduced. **Confirm** marks deletions the owner should agree to first.

Category key: `HIST` changelog or history, `REF` ticket, decision or plan reference, `WHAT` restates the code, `ESSAY` over-explanation, `STALE` points at something that no longer exists or contradicts the code, `DEAD` unused or duplicated code.

**About decision references.** The code cites decision codes such as `(D33)`, `(D42)`, `O5`, `A3`, `R3` and `L1`. They are defined in several different documents, which reuse the same numbers for different decisions:
- `docs/design-notes/2026-10-13-phase-timeline-redesign.md`
- `docs/superpowers/plans/2026-10-12-live-evidence-rail.md`
- the fp294, fp295 and fp296 analytics specs
- `docs/superpowers/specs/2026-09-30-manifest-first-trip-creation-design.md`

A bare `(D5)` can therefore mean six different things, and `(L2)`, `(H1)`, `(A1)` and "4A mockup" are not defined anywhere. In almost every case the sentence already states the reason, so removing the code loses nothing.

---

## 2. Found during the review: not cleanup, needs an owner

Raise these separately from the cleanup PRs. They are ordered by how much a dispatcher would notice them.

| # | File | Finding | Status |
|---|---|---|---|
| B1 | `components/trips/LateDriverEvidencePanel.tsx:33-45` | Every window `focus`, `visibilitychange` and live event calls `refetch` (`useAsyncData`'s `run`), which sets `isLoading`. The panel then returns `null`, so the whole panel disappears and reappears, and **a half-typed acknowledgement note is lost** when the dispatcher switches tabs. A single tab switch fires `focus` and `visibilitychange` together, so it also fetches twice. Fix: use `refetchSilent`. | Verified in code |
| B2 | `lib/context/AuthContext.tsx:143-149` with `components/layout/ProfileMenu.tsx:68-73` | `performSignOut` awaits `port.signOut()` before clearing local state. If the call rejects, the user **stays signed in**, and the menu only logs to the console. The comment at `ProfileMenu.tsx:70-71` claims the opposite. | Verified in code |
| B3 | `components/blockchain/BlockchainBadge.tsx`, `VerifyButton.tsx`, `components/domain/DepartureDetail.tsx`, `components/ui/StatCard.tsx`, `app/(app)/page.tsx` | `rounded-[var(--r-sm)]` and `rounded-[var(--r-md)]` are used 14 times, but `--r-sm` and `--r-md` are not defined anywhere (not in `globals.css`, `tailwind.config.ts` or shared). Those elements probably render with **square corners**. | Grep verified; not viewed in a browser |
| B4 | `components/ui/Card.tsx:14`, `components/domain/PhaseChain.tsx:26` | `bg-secondary-fixed` is not defined in `tailwind.config.ts`, so the `selected` card and the "overridden" phase get **no background**. (`PhaseChain` is dead, see §4.) | Verified |
| B5 | `app/(app)/exceptions/page.tsx:358` | "Return to first page" calls `clearFilters`, which also **wipes the search, severity and date filters**. It should only reset the cursor. | Verified |
| B6 | `lib/trips/trailer-combo.ts:26` | Any invalid two-trailer pair reports "N m + M m **exceeds the 18 m limit**", including 6 m + 6 m (12 m). A missing length counts as 0 ("0 m + 12 m exceeds…"). "18 m" and "Maximum 2" are hard-coded beside `MAX_TRAILERS`. | Verified |
| B7 | `lib/forensic/describeChange.ts:71` | Every boolean renders as **Active/Inactive**, so a precinct's `is_shared: true` reads "Shared with other organisations: Active". | Verified |
| B8 | `components/analytics/fleet/costCopy.ts:54` | The Cost tab's basis line always says "**by week** departed", even when View by is set to Month or Year. | Verified |
| B9 | `lib/format/manifest.ts:23` and `components/domain/ConfirmationDetail.tsx:67` | Plurals: "**1 waybills · 1 parcels**" (it ignores `countLabel`) and "**N parcel** unaccounted for". | Verified |
| B10 | Clipboard copy: `PhaseDetailFields.tsx:49-51`, `EvidencePhoto.tsx:54`, `BlockchainBadge.tsx:77`, `ChainReceiptTag.tsx`, `TripIdStamp.tsx:21`, `IssueAuditPackDialog.tsx:96`, `AccountDetails.tsx:36-40` | Seven separate copy implementations. Four swallow the error and **show "Copied" even when the copy failed**. Two leave the rejection unhandled. One has a timer that is never cleared. | Verified by reading |
| B11 | `components/blockchain/BlockchainBadge.tsx:38` | Treats any truthy `hedera_topic_id` as anchored, including the placeholder `'None'`, so it would render "Verified on blockchain" with a `/topic/None` link. `ChainReceiptTag`, `TripCreatedDetail` and `ExceptionHederaLinks` all guard against this. | Verified by reading |
| B12 | `app/(app)/history/page.tsx:38, 43, 71-74` | `dateRange.to` is fixed at mount, so after SAST midnight the new day's trips are excluded and the empty state wrongly reads "filtered". The search is sent untrimmed but checked trimmed. | By reading |
| B13 | `components/ui/DateRangePicker.tsx:20-26`, `app/(app)/sla/page.tsx:12-20`, `lib/dev/presets.ts:29-31` | "Today" is computed in **UTC** (`toISOString()`), so between 00:00 and 02:00 SAST it is yesterday's date. The picker's presets are also fixed when the module loads. | Verified |
| B14 | Fleet detail pages (`fleet/drivers/[id]/page.tsx:302, 381`, `fleet/vehicles/[id]/page.tsx:94, 180`) | `await refetchSilent()` awaits a function that returns nothing, so the edit panel closes before fresh data arrives. Also, `error \|\| !driver` replaces the whole page with "Could not load" if a background refresh fails while data is on screen. | By reading |
| B15 | `lib/hooks/useAsyncData.ts:30-35, 105-114` | Never refetches when `fetchFn` changes, because it is held in a ref and the effect depends only on `run`. Five detail hooks build the fetcher from an ID. This is harmless today only because the pages remount when the ID changes. | Verified in code; impact latent |
| B16 | `app/(app)/dev/tokens/page.tsx` | It sits under `(app)`, whose layout renders nothing without a user, so the "Force Sign In" button is only reachable when already signed in, and it is then disabled. | Verified |
| B17 | `components/domain/PhaseOverrideAction.tsx:108` | Uses `autoFocus` inside `Modal`. `CancelTripAction.tsx:110-112` documents that this is dropped because it runs before `showModal()`. | Unverified in a browser |
| B18 | `components/trips/new/CrewFields.tsx:97` | Shows the driver's SA ID number in the create-trip form. `DriverModal.tsx:21-23` deliberately hides it under POPIA. | Policy mismatch, team call |

Lower-risk notes from the reviewers, for the owners:
- The `SearchSelect` clear control is a `<span role="button">` inside a `<button>`.
- `Card` handles Space without `preventDefault`.
- `StaticGeofenceThumbnail`'s failure count can never reset once it has tripped.
- `LocationComparisonMap`'s Fixes/Precinct toggle does nothing on a malformed boundary.
- A cancelled trip is offered PP "Delivered" presets on the dev panel (`ParcelPerfectActions.tsx:30`).
- `DeclareIncidentDialog.tsx:58-60` casts away type safety on submit.
- `ParcelHistory.tsx:40-41` places an `<h4>` inside a `<span>`.

---

## 3. Unused locals and imports (tsc)

| File | Line | Symbol | Action |
|---|---|---|---|
| `app/(app)/exceptions/[id]/page.tsx` | 102 | `refetch` | Remove from the destructure |
| `components/map/LocationComparisonMap.tsx` | 12, 14 | `haversineMetres`, `BOUNDARY_NEARBY_METRES` | Delete the imports |
| `components/trips/TimelinePhase.tsx` | 15 | `isResolved` | Delete the import |
| `lib/hooks/useTripResource.ts` | 180 | `entry` | Delete |
| `components/domain/__fixtures__/phase-acts.ts` | 17, 22, 489 | `PhaseEventId`, `CGY_ORG_ID`, `draft` | Delete |
| Test files: `exceptions/[id]/page.test.tsx:183`, `trips/[id]/page.test.tsx:1`, `phase-acts.test.tsx:89`, `PhaseChecks.test.tsx:9`, `ParcelHistory.test.tsx:10` | | `contactField`, `act`, `openCard`, `line`, `follows` | Delete |

Unused props and imports that tsc does not catch:
- `ActivationDetail` declares `artifactLoading`, `artifactError`, `onRetryArtifacts` and `artifactsById`, and never reads them.
- `DriverTransferDetail` declares `onChanged` and never reads it.
- `PhaseActRow.tsx:163` passes `highlighted={false}` to a component that ignores it.
- `PhaseActRow.tsx:15, 17` and `VerificationPanel`-style split imports from the same module should be merged.
- `fleet/drivers/page.tsx:4-5` has two `lucide-react` import lines.

---

## 4. Dead code

### 4.1 Files with no production importer

| File | Lines | Evidence | Action |
|---|---|---|---|
| `app/(app)/trips/[id]/TripHeaderSummary.tsx` | 188 | Imported nowhere | Delete |
| `components/domain/EvidencePacket.tsx` | 44 | Imported nowhere | Delete. This also orphans `Card`'s `exception` variant. |
| `components/domain/ExceptionBanner.tsx` | 34 | Imported nowhere | Delete |
| `components/domain/ManifestPanel.tsx` | 25 | Imported nowhere | Delete |
| `components/domain/PhaseAnchorSection.tsx` | 25 | Imported nowhere | Delete |
| `components/domain/PhaseChain.tsx` | 93 | Imported nowhere | Delete |
| `components/ui/Drawer.tsx`, `StatCard.tsx`, `StepRail.tsx` | 173 | Imported nowhere | Delete |
| `lib/hooks/useBlockchainReceipts.ts`, `usePpCapabilities.ts`, `useVerify.ts` | 66 | Imported nowhere | Delete |
| `lib/hooks/useElementWidth.ts` | 48 | Only mocked by a test (`trips/[id]/page.test.tsx:70`) | Delete it and remove the mock |
| `lib/constants/status-meta.ts` | 1 | Re-export; every caller imports `@shared/...status-meta` directly | Delete |
| `components/trips/PhaseEvidence.tsx` (the `PhaseEvidence` component, 39-60) | ~25 | Only its test imports it. Production uses only `nextTripStop`. | Move `nextTripStop` to `lib/phase/trip-detail.ts`, then delete the component and its test (**Confirm**) |
| `components/domain/InTransitTimeline.tsx` (`InTransitTimeline`, `MiniNode`) | ~100 | Only its test imports them. `PhaseEvidence` imports only `InTransitArrivalLocation`. | Delete (**Confirm**) |
| `components/domain/LocationEvidenceSummary.tsx` | ~60 | Imported only by `LocationEvidencePanel.test.tsx` | Delete (**Confirm**) |
| `app/(app)/sla/page.tsx`, `lib/hooks/useSLAMetrics.ts`, `ROUTES.sla` | ~90 | No navigation link. The hook is a stub that returns `null`, so the page only ever shows "No data". "Export PDF" has no handler, and the page shows the placeholder text "(date range picker — Phase 1 hook)" to users. | Delete or hide behind a flag (**Confirm**) |
| `app/(public)/layout.tsx` | 4 | A layout that only renders its children; route groups do not need one | Delete |
| `app/dev/design/page.tsx` | ~230 | Development-only. Its token preview is out of date: wrong primary and success colours, radii showing 4 px instead of 10 px, and a Material type scale. | Rebuild from `tailwind.config.ts` or retire (**Confirm**) |

### 4.2 Unused functions, props, variants and aliases

| Location | Symbol | Action |
|---|---|---|
| `lib/phase/derive.ts:146` | `phaseLabel()`: never called (every `phaseLabel` elsewhere is a prop) | Delete |
| `lib/api/driverSubstitutions.ts:26` | `listSubstitutions`: no callers | Delete |
| `lib/phase/derive.ts:166-177` | `recordedExceptionLabel`: used only by a test. Its comment says "no dispatcher resolve endpoint yet", but `PATCH /exceptions/{id}/review` exists. | Delete it with its test |
| `lib/phase/geo.ts:9-11, 33-38` | `Geofence`, `geofenceOffsetMetres`: used only by tests | Delete them with the tests |
| `lib/phase/location-evidence.ts:243` | `hasComparison`: used only by tests | Delete it with its test |
| `lib/format/analytics.ts:20-23, 42-45` | `fmtRatio`, `fmtScheduleDelta`: used only by tests | Delete (team call) |
| `lib/format/sast.ts:16-18` | `isoToSastInput`: used only by tests, and **clashes by name** with a different `isoToSastInput` in `lib/trips/manifest-form.ts:79`. `sastInputToIso` clashes the same way. | Merge into one implementation |
| `components/parcels/trace-display.ts:32-43, 133-152, 164-167` | `EXCEPTION_SCOPE_LABELS`, `exceptionTypeGroups`, `scanSummary`: used only by tests | Delete them with their tests (**Confirm**) |
| `lib/types/dev.ts:186-195, 242-247, 296-301`, `lib/hooks/useDevTriggers.ts:62, 189, 253` | `WaypointRead`, `waypoint_id`, `PRECINCT_WAYPOINT_ID`, `waypoints`/`loadWaypoints`: types and wiring for the removed "Fixed demo locations" mode | Delete (**Confirm**) |
| `lib/types/user.ts:19` | `DriverUser` alias: no importer | Delete |
| `components/layout/Sidebar.tsx:21, 235, 240-245` | `adminOnly` filter: no `NavItem` sets it, so `useAuth` and `user` do nothing | Delete |
| `components/trips/DriverSubstitutionDialog.tsx:60, 72-77, 91-92` | `open` prop and reset paths: the caller remounts the dialog each time, so `open` is always true | Delete (**Confirm** with the author) |
| `components/blockchain/BlockchainBadge.tsx:6-10, 61-69` | `state` prop and its `pending`/`failed` branches: the only caller passes `receipt` alone | Delete |
| UI variants with no caller | `Card` `selected`/`section`, `Skeleton` `card`, `Modal` `sm`, `Button` `lg` and `iconRight`, `IconButton` `lg`, `SecHead` `action`/`onAction` (with its inline SVG), `Ic` icons `sat`/`filter` | Delete |
| `components/ui/Ic.tsx:55-56` | `if (!d)` fallback: unreachable, because the record is exhaustive | Delete |
| `components/analytics/fleet/charts/*` | `height?: number` prop on all six chart components: never passed | Delete |
| `components/analytics/fleet/charts/chartStyle.ts:50` | `ROUNDED_BOTTOM`: unused | Delete |
| `lib/hooks/useTripResource.ts:82`, `lib/trips/tripSeed.ts:52` | `__resetTripResourceCache`, `__resetTripSeeds`: aliases kept for tests (knip reports them as duplicate exports) | Point the tests at `clearTripResourceCache` / `clearTripSeeds` and delete the aliases |
| `lib/context/ToastContext.tsx:6` | `export type Toast = ToastData` | Delete; use `ToastData` |
| `lib/cache/sessionCache.ts:15-19` | The returned unregister function is never used | Return `void` |
| `lib/hooks/useVehicleDetail.ts:7`, `useDriverDetail.ts:7`, `components/domain/PhaseActs.tsx:16`, `TripDetailPanel.tsx:24-26`, `TripSummary.tsx:20-21`, `LocationComparisonMap.tsx:101-105` | Type and constant re-exports that nothing (or only a test) imports through this path | Import from the source module; delete the re-exports |
| `'use client'` on plain modules | `lib/cache/sessionCache.ts:1`, `lib/navigation/returnTo.ts:1`, `lib/trips/tripSeed.ts:1` | Delete |
| Small aliases | `const done = results`-style aliases; `stopOptions` in `AllControls.tsx:300`; `onClick={e => handleCopy(e)}` in `TripIdStamp.tsx:28`; `PARCELS_KEY`/`COUNTS_KEY` in `lib/phase/checks.ts:126-127`; `count as number` in `sla/page.tsx:70` | Inline them |
| About 40 exports used only inside their own file | Mostly constants: `MAX_QUESTION_CHARS`, `RATE_LIMITS`, `EDITABLE_RATES`, `MAP_PARAM`, `FleetTile`, `fmtAverage`, `busiestKey`, `countTicks`, `MIDDLE_AXIS_WIDTH`, `COST_PROFILE_PATH`, `FLEET_ANALYTICS_PATH`, `MAX_HISTORY_TURNS`, `RECENT_KEY_MS`, `DEFAULT_MIN_COLUMN_WIDTH`, `baseWidth`, `bookedParcels`, `TRIP_CREATE_TIMEOUT_MS`, `BACKOFF_BASE_MS`, `OVERPASS_URL`, `GEOCODER_URL`, the `lib/map/tiles.ts` and `lib/map/polygon.ts` constants, `TIMELINE_*_ATTR`, `TRIP_RECORD_ANCHOR_ID`, `TRIP_AUDIT_PACKS_SECTION_ID`, `PhaseRailColumn`, `PhaseClock`, `tripOptionLabel`, `hasLocationDetails`, `STRAY_BARCODE_SUFFIX`, and others in the knip output | Drop `export`. Low priority; one mechanical pass. |

### 4.3 Duplicated code

| What | Copies | Action |
|---|---|---|
| Clipboard copy (with the bugs in B10) | 7 | One `useCopyToClipboard` hook that logs failures and reports success honestly |
| `'None'` Hedera-topic guard | 3 (`ChainReceiptTag`, `TripCreatedDetail`, `ExceptionHederaLinks`), and missing in `BlockchainBadge` | One `isAnchoredTopic()` helper |
| HashScan base URL, hash truncation and copy handler | `BlockchainBadge`, `ChainReceiptTag` | Use the existing `lib/format/hashscan.ts` |
| `phase/derive.ts` logic (resolved statuses, `isResolved`, sort by sequence, current/active phase, progress) | `dispatcher/lib/phase/derive.ts` and `driver-pwa/lib/phase/derive.ts` | Move to `frontend/shared/lib/phase/` (coordinate, shared file). The two copies' comments already contradict each other on `isResolved`. |
| Map code: tile-swap effect, failure overlay and Retry, Satellite/Street toggle, scale bar, outline projection, `toRadians`, **three different metres-per-degree constants** | `GeofenceMap`, `LocationComparisonMap`, `GeofenceSchematic`, `StaticGeofenceThumbnail`, `LocationComparisonSchematic`, `lib/map/polygon.ts` | Extract a `useTileSource` hook, a `MapTileControls` component and one `METRES_PER_DEGREE` |
| Failed-load block | 6 list pages | One `LoadError` component |
| Raw search input and select instead of `SearchField`/`FilterSelect` | `precincts/page.tsx:103-111`, `fleet/vehicles/page.tsx:241-288` | Use the shared components |
| `AUTH_ROUTE_PREFIXES` | 3 (`login/page.tsx`, `(app)/layout.tsx`, `AuthContext.tsx`) | Export once from `AuthContext` |
| `isOwner` precinct check and its fallback message | 3 precinct pages | One helper |
| `2020-01-01` range start | `history/page.tsx:28`, `exceptions/page.tsx:439` | One constant |
| localStorage read/persist helpers | `ForensicModeContext`, `SidebarCollapseContext`, `preferences.ts` | One helper |
| Date helpers: `todaySast()` (`lib/format/period.ts:72`) and `SAST_OFFSET` (`lib/format/sast.ts`), both re-defining shared helpers; `MONTH_ABBREVIATIONS`; `MS_PER_MINUTE`/`MINUTES_PER_HOUR` (4 files) | | Import from `@shared/lib/utils/datetime` |
| Duration formatting | `fmtDuration` ("6 h 10 min"), `fmtMinutes` ("6 h 10 m"), `fmtHours` (two definitions), `format/schedule.ts:20-22`. Two formats appear on the same analytics page. | One formatter |
| Exception-kind literal `['exception_raised','exception_reviewed','exception_claimed']` | `useExceptions`, `useExceptionDetail` | One constant |
| `WITHDRAWN_STATUSES` `[401, 403, 404]` | `useTripResource`, `useParcelTrace` | One constant |
| Four hand-written generation-counter fetch hooks | `useAnalyticsList`, `useFleetQuery`, `useTripHistory`, `useExceptionHistory` | One `useLatestRequest` helper |
| Phase wording and constants | `WAREHOUSE_SCAN_BLOCK` (×2), override and waiting headlines (`act-wording.ts` vs `VERDICT_WORDING`), `isRunning` | Single source in `lib/phase` |
| Analytics: `PERCENT` (×4), `laneName`/`laneKey`/`LANE_AXIS_WIDTH` (×2), card-props interface (×5), tooltip `byKey`/`KEY` (×6), `monthsHeading` (×3) | | Shared constants and types in `components/analytics/fleet/` |
| Trips: `when()` timestamp helper (×3, browser-local time with no SAST label), `FOCUS_RING` (×2), `sortRows`/`compareText` (×2), completion-mode label (×2), `isTripTerminal` against `TERMINAL_TRIP_STATUSES` | | Shared helpers. `when()` should use `fmtDateTime`. |
| Domain: "all scanned / excess / not scanned" block (Loading and Unloading), proximity-label ternary (×3), lat/lng null check (×2), Copy-button class string (×2) | | Extract them |
| Parcels: `WRAPPING_CHIP` (×3), `exceptionCountLabel` and the trip-level filter (copies of `lib/phase/exception-rows.ts`) | | Reuse them |
| Timeline reveal and reading-anchor effects | `trips/[id]/page.tsx` and `app/dev/design/_timeline-scenarios/ScenarioView.tsx` | One shared hook |

### 4.4 Tailwind config and tokens

| Lines (`tailwind.config.ts`) | What | Action |
|---|---|---|
| 49-72 | Legacy tokens with 0 uses: `primary.container`, `primary.on-container`, `secondary.container`, `secondary.on-container`, `success.on` | Delete |
| 73-78 | `warning.*` (0 uses in `app/` or `components/`) | Delete after a grep of `lib/` |
| 111-118 | `headline`/`display`/`body`/`label` font families (0 uses, all equal to `sans`) | Delete |
| 50-79 | Trailing "was #xxxxxx, now matches" comments | Delete |
| — | Legacy `surface-*` and `primary-*` names are still used about 144 times (`Card`, `Input`, `TextArea`, `Toast`, `Modal`, `EmptyState`, `DataTable`, `FormField`, `IconButton`, `Skeleton`, `CostRatesCard`, `TripIdStamp`, `TimestampWithIcon`, `driverColumns`). `driverColumns` also uses raw `text-red-500` and `text-amber-500`. | Migrate to the shorthand tokens as a separate, visual-diff PR |
| — | 422 arbitrary `text-[Npx]` sizes, although the config defines four named type steps | Migrate gradually; not a blocker |

### 4.5 Hard-coded hosts

CLAUDE.md says no hard-coded URLs. These should come from `.env` and fail clearly when unset:
- `lib/api/client.ts:14`: `'http://localhost:8000'`
- `lib/format/hashscan.ts`: default host, using `??`, so a blank value produces a relative link
- `lib/map/tiles.ts:126`: Esri satellite URL, with no env override at all
- The public OSM, Photon and Overpass fallbacks: acceptable for development, but they should be documented as non-production

The login placeholder (`login/page.tsx:87`) names a real customer domain; use `example.co.za`.

---

## 5. Comment cleanup: mechanical passes across the codebase

| Pass | Pattern | Hits / files | Rule |
|---|---|---|---|
| P1 | Ticket refs `FP-83`, `FP-142`, `FP-197`, `FP-281 §n`, `FP-291`, `FP-294`, `FP-295` and others | 51 / 37 | Delete the tag |
| P2 | Decision codes `(D5)`–`(D44)`, `O3/O5/O8`, `A1/A3`, `H0/H1`, `L1/L2`, `R3`, `F6`, `spec D7/D13/D14` | 77 / 32 | Delete the code. Where the decision really matters, name the document once in the file header. |
| P3 | `spec §n`, `design note §n`, `DESIGN_SYSTEM 10.3`-style refs | 28 / 20 | Name the document (most are the manifest-first trip-creation spec in `docs/superpowers/specs/`) or delete. Also fix `TripIdStamp.tsx:12-15` (§3 is Shape, not typography) and `ToastContext.tsx:58` (§10.7 is about error colours, not toasts). |
| P4 | `Chart N.N:` prefixes in the analytics tabs | 20 / 5 | Delete. The numbers come from a spec and appear nowhere in the UI. |
| P5 | Process words: `Task 8/9/11`, `Batch 3`, `Stage 5`, "the brief", "Workstream", "this round", "the ticket asks for" | 12 / 6 | Delete |
| P6 | Test strategy in production comments: "Pure so vitest can prove it", "unit-tested", "testable without a DOM", "so a test can pin it" | 25 / 22 | Delete the clause. The tests document themselves. |
| P7 | Box-drawing dividers `// ──` and `{/* ── X ── */}`, plus JSX section labels (`{/* Trip list card */}`, `{/* Breadcrumb */}`, `{/* Search */}`) | 31+ / 14+ | Delete |
| P8 | Paths to files that have moved or been deleted: `orchestration/phase_service.py`, `vehicle_service.py`, `driver_service.py`, `road_check_service`, `resource_service.py`, `phase_gate.py`, `dev_truck_service.py`, `schemas/dev.py`, `dev_triggers.py` | 17 / 9 | Reword to the current paths: `orchestration/phases/{state,override,blocking,advance_confirmation}.py`, `orchestration/fleet/{vehicles,drivers}.py`, `orchestration/evidence/road_check.py`, `app/dev/schemas.py`, `app/dev/services/truck.py` |
| P9 | "handshake": `acts.ts` and `verdict.ts` trigger value `'handshake'` and `HANDSHAKE_FINDING_TYPES`; `AllControls.tsx:577`; **`PrecinctForm.tsx:437` helper text shown to users** ("How close a handshake must be…") | 5 / 4 | Reword the user-facing text now. Rename the trigger value with its fixtures. |

After P1 to P9, about 47 history phrases remain ("previously", "used to", "no longer", "old", "was removed", in 40 files). Each needs a manual rewrite (§6).

---

## 6. Comment cleanup: file by file

Only rows that need judgement are listed; tags covered by §5 are not repeated. "Trim to" gives a suggested replacement that keeps the *why*.

### 6.1 `app/` and root configs

| File:lines | Cat | Action |
|---|---|---|
| `tailwind.config.ts:23-33` | ESSAY, HIST | An 11-line HSL derivation for one hex value. Trim to: "Opaque `ok` tone for the Chip 'complete' pill; `c` read as neon." |
| `tailwind.config.ts:46-48, 100-103` | STALE | "During the UI rebuild" and "~357 literal sizes" (now 422). Reword both. |
| `eslint.config.mjs:15` | STALE | The lint message cites DESIGN_SYSTEM §2.3 (the secondary colour table). Change it to "see DESIGN_SYSTEM.md §2". |
| `.env.example:23-38` | ESSAY | Trim each provider note to one line |
| `app/(app)/page.tsx:29-35` | HIST, STALE | Cites `phase_service.py` and the "old list". Trim to: "`exception_hold` matches nothing yet; kept so a manual hold would show." |
| `app/(app)/page.tsx:62, 87-90, 97` and `history/page.tsx:76` | STALE | "active and closed are derived" (only active is). `allTrips` holds active trips only, so rename it `activeTrips`. "Built per render" is wrong; it is a `useMemo`. |
| `app/(app)/exceptions/[id]/page.tsx:51-56, 92-94, 104-106, 156-165, 266-284` | ESSAY, HIST | Six blocks of 3 to 10 lines. Trim each to one line (see the reviewer suggestions in the PR notes). |
| `app/(app)/exceptions/[id]/page.tsx:66-68, 117-119` | STALE | The comments sit above the wrong declarations. Move them. |
| `app/(app)/trips/[id]/page.tsx:34-40, 218-227` | STALE | Says `phase_event_id` must be added (it already exists) and that nothing links to a `#phase-` hash (parcel search does). Trim both. |
| `app/(app)/precincts/[id]/edit/page.tsx:26-43`, `[id]/page.tsx:49-91` | ESSAY | Duplicated 3 to 5-line ownership and 404 essays. Trim them and share a helper. |
| `app/(app)/fleet/vehicles/[id]/page.tsx:51-53` | HIST | "Supersedes the toggle spec's original horses-only rule". Trim to: "Horses and trailers can both switch to analytics." |
| `app/(app)/fleet/drivers/[id]/page.tsx:264-265` | STALE | Says trailers get no analytics, which is no longer true. Delete. |
| `app/(app)/dev/triggers/page.tsx:6-10` | ESSAY | Badly wrapped JSDoc. Trim to one line. Also note that the panel is gated only by `NEXT_PUBLIC_DEV_PANEL` and `DEV_PANEL_ENABLED`, not by a production check. The backend comment at `app/dev/endpoints/triggers.py:64-67` says this is deliberate. |
| `app/(app)/dev/tokens/page.tsx:26` | STALE | The heading "Mock Auth State" is wrong: the page does a real sign-in. |

### 6.2 `components/trips/`, `settings/`, `layout/`

| File:lines | Cat | Action |
|---|---|---|
| `layout/ProfileMenu.tsx:70-71` | STALE | "cleared locally either way" is false (B2) |
| `layout/Sidebar.tsx:52-54, 66-68, 92-93` | HIST, ESSAY, STALE | A commit hash that doesn't resolve, speculation about future groups, and a comment placed on the wrong constant |
| `trips/DriverSubstitutionPanel.tsx:59-62` | STALE | Says actions come from `permitted_actions`; they now live in `PendingHandover` |
| `trips/DriverSubstitutionDialog.tsx:44-47` | STALE | The component's JSDoc sits on `initialDraft`; move it up and drop "legacy" and "v2" |
| `trips/PhaseEvidence.tsx:53-55` | STALE | `persistentContent` exists nowhere |
| `trips/PhaseTimelineItem.tsx:10-11, 74-75, 88` | STALE | Refers to "both representations" and "minimised cards", which no longer exist |
| `trips/PhaseCardBody.tsx:35-40` | REF, ESSAY | Repeats `SPLIT_MIN_PX` and "564 px" from `layout.ts`. Trim to a pointer to `chooseBodyLayout`. |
| `trips/TripDetailSkeleton.tsx:15-22`, `TripInformation.tsx:25-28`, `TripExceptionsPanel.tsx:76-78, 191-196, 349-350` | HIST | Before-and-after stories. Trim to the current *why*. |
| `trips/TripExceptionsPanel.tsx:38-39, 92-97, 117-126` | ESSAY | Trim each to 1-2 lines |
| `trips/TripTimeline.tsx:146` | STALE | `exceptionsById` is an array. Rename it `uniqueExceptions`. |
| `trips/TripTimeline.tsx:161-174`, `TripSummary.tsx:89-93`, `TripDetailPanel.tsx:127-129` | ESSAY | Trim. The last one has pixel arithmetic that will go stale. |
| `trips/new/CreateTripSummary.tsx:16-18` | STALE | It documents `canCreate` as "one sentence"; it is a boolean |
| `trips/new/CrewFields.tsx:26, 38-40` | REF | "LFG's decision" is unexplained. Trim. |

### 6.3 `components/domain/`, `exceptions/`, `drivers/`, `vehicles/`

| File:lines | Cat | Action |
|---|---|---|
| `TripCreatedDetail.tsx:32-34` | STALE | Cites `resource_service.py`, which does not exist |
| `TripCreatedDetail.tsx:50-94` | WHAT | Five `{/* Driver ──── */}` dividers. Delete. |
| `ExceptionEvidence.tsx:30-50` | STALE, HIST | The JSDoc is detached from its component, and there is a 13-line changelog. Trim. |
| `UnloadingDetail.tsx:43-47` | STALE | Points to a ConfirmationDetail comment that does not exist |
| `InTransitTimeline.tsx:19-22, 69-70, 127-136` | STALE | Mentions a branch that doesn't exist, cites a `legStateFor` function that no longer exists, and quotes a string that isn't in the code (moot if the file is deleted, §4.1) |
| `PhaseOverrideAction.tsx:23-24` | STALE | Cites `phase_service.py`; the code is now in `orchestration/phases/override.py` |
| `PhaseOverrideAction.tsx:30-31` | STALE | "activation is never overridable from this UI", but nothing blocks it. Delete the comment or add the guard. |
| `ReviewFields.tsx:9-11, 20-22, 47-50` | HIST, STALE | "the old resolve-flow file", and a duplicated JSDoc on the wrong function |
| `LocationEvidencePanel.tsx:48-51, 209-210` | STALE | An orphaned comment, and a claim that `separationText` is computed once (it is computed twice) |
| `LocationEvidencePanel.tsx` (about 10 blocks) | ESSAY | The densest essay file in this group. Trim every block to one line. |
| `LocationEvidenceSummary.tsx:11-21` | ESSAY, STALE | 11 lines, citing an "exception branch" that doesn't exist (moot if the file is deleted) |
| `ManifestSnapshot.tsx:14-15` | REF, STALE | "spec §7.3" points at the wrong section. Trim. |
| `DepartureDetail.tsx:30-32` | STALE | "see DepartureDetail report" points at nothing. Delete. |
| `ArrivalDetail.tsx:18-30, 78-83`, `ActivationDetail.tsx:40-41`, `EvidencePhoto.tsx:22-36`, `ExceptionSummary.tsx:57-60` | HIST | Trim to the current *why* |
| `CancelTripAction.tsx:31-41` | ESSAY | An 11-line JSDoc. The nested-modal explanation is repeated in `IssueAuditPackDialog`; keep it once. |
| `TripIdStamp.tsx:12-15` | STALE | Cites the wrong DESIGN_SYSTEM section |
| `exceptionColumns.tsx:16-18` | ESSAY | A width sum written into a comment, which will drift |

### 6.4 `components/ui/`, `map/`, `blockchain/`

| File:lines | Cat | Action |
|---|---|---|
| `ui/Toast.tsx:70` | STALE | "Render once inside DispatcherShell": it is rendered by `ToastProvider` |
| `ui/Toast.tsx:78` | DEAD | `slice(0, 3)` repeats `MAX_TOASTS`. Delete it. |
| `ui/Switch.tsx:12-13`, `InfoRow.tsx:5-6`, `Toast.tsx:19-20`, `BackButton.tsx:17-20`, `Modal.tsx:123-126` | HIST | Changelog voice ("existing call sites keep working", "used to build its own copy"). Trim. |
| `ui/Modal.tsx:36-82` | ESSAY | Five blocks over one gesture flag. Keep the drag-released-over-backdrop reason in one line. |
| `ui/Chip.tsx:17-37` | ESSAY | The same colour story is told in `tailwind.config.ts` and DESIGN_SYSTEM. Keep it once. |
| `ui/Pagination.tsx:16-17` | STALE | "cursor-style", but the props are page and offset based |
| `ui/SearchSelect.tsx:31-33` | HIST | Bug story. Trim to: "cn() is a plain join; use exactly one border colour class." This same mechanism probably affects the error borders on `Input`, `TextArea`, `Select` and `FormField` (unverified). |
| `ui/Button.tsx:35` | STALE | "Cannot be expressed as a static Tailwind class" is untrue |
| `map/GeofenceMap.tsx:129-135`, `StaticGeofenceThumbnail.tsx:233-234` | STALE | "The only module that imports Leaflet" is false |
| `map/GeofenceSchematic.tsx:47-52` | STALE | "Used as the list-card thumbnail" is wrong; it is only the fallback |
| `map/LocationComparisonMap.tsx` (about 25 blocks) | ESSAY, REF, HIST | **The single worst file for comments:** "the brief", "task R2", "pre-R4 behaviour", jsdom strategy, and a Tailwind-scan note repeated three times. Trim it as a whole. |
| `map/LocationComparisonMap.tsx:600-602` | STALE | Points at a "long comment" that is now two lines |
| `blockchain/VerifyButton.tsx:152-159, 176` | WHAT, STALE | The magic `8000` needs a named constant. The "during render" reason is wrong; the real reason is the lint rule. |
| `blockchain/VerifyButton.tsx:40-96` | DEAD | A duplicate "Mismatch report" heading inside the modal, and over-indented code |

### 6.5 `components/analytics/`

| File:lines | Cat | Action |
|---|---|---|
| `copy.ts:18-20`, `fleet/copy.ts:221-222`, `fleet/FleetTiles.tsx:21`, `fleet/tabs/EvidenceTab.tsx:256-259`, `fleet/charts/axisTicks.tsx:1-3`, `fleet/controls/PeriodControl.tsx:26-28` | HIST | Remove the "were removed" and "replaces" narration |
| `chat/AnalyticsChatPanel.tsx:26-30, 45-46` | REF, ESSAY | "browser check, 19 Oct", and a jsdom guard explained in production code. Stub `scrollIntoView` in `vitest.setup.ts` instead. |
| `DriverAnalyticsSummary.tsx:21`, `SummaryParts.tsx:3-5, 124`, `fleet/charts/PatternStrip.tsx:29`, `fleet/charts/ChartLegend.tsx:20-21` | STALE | Misplaced, or out of date after the precinct summary was added |
| `fleet/tabs/ProblemsTab.tsx:83` | STALE | "Nothing raises info today", but `receiver_verification.py:253` does |
| `fleet/tabs/RoutesTab.tsx:293-296, 414` | STALE | The comment warns about a `window` name trap, then the code uses `window` as a parameter name. Rename it. |
| `fleet/tabs/ReviewDeskTab.tsx:37-40` | STALE | Claims to match the page's duration format; it does not (§4.3) |
| `fleet/map/IncidentMap.tsx:53-63, 88-94` | ESSAY, HIST | An 11-line JSDoc with a `next dev` story, and "matters most during a demo". Trim. |
| `fleet/tabs/EvidenceTab.tsx:190` | REF | "Trial feature:" is defined nowhere |
| `fleet/CostRatesCard.tsx:88-185` | STALE | Uses deprecated token names (§4.4) |

### 6.6 `lib/hooks/` and `lib/phase/`

| File:lines | Cat | Action |
|---|---|---|
| `phase/derive.ts:1-5, 25, 88` | STALE | Cites `phase_service.py` three times |
| `phase/derive.ts:136-137` | STALE | "exactly three phase TYPES are anchored", but every phase type is |
| `phase/checks.ts:4-5` | STALE | "until Task 11 deletes them", but the `*Detail` panels still exist. Delete. |
| `phase/act-wording.ts:150` | STALE | The doc says "(device clock)", but the code emits "(driver's phone)" |
| `phase/verdict.ts:47-48` | STALE | "Wording lives here, once" is false (§4.3) |
| `phase/{verdict,acts,act-wording,checks,card,exception-rows,layout,location-evidence,trip-detail}.ts` headers | REF, ESSAY | Headers of 5 to 13 lines full of D-codes and vitest notes. Trim each to 1-2 lines. |
| `hooks/useTripArtifacts.ts:9-11` | STALE | "four siblings": there are six other artifact-id columns |
| `hooks/useExceptions.ts:28-32`, `usePrecinctDetail.ts:17-20`, `useAuditPacks.ts:9` | STALE | `useCallback` around the fetcher does nothing (B15). Delete the wrapper and its comment. |
| `hooks/useSLAMetrics.ts:6-13` | HIST | "Renamed to reflect…", "Phase 1 stub" (moot if deleted) |
| `hooks/useAsyncData.ts:108-111` | ESSAY | Replace with the one fact callers need: "A changed fetchFn does not refetch." |
| `hooks/useExceptionHistory.ts:57-65, 99-122`, `useFleetAnalytics.ts:45-70`, `useAnalytics.ts:31-37`, `useTrips.ts:25-39`, `useResizablePanel.ts:26-46`, `useTableColumns.ts:44-46` | ESSAY | Trim each to 1-2 lines |

### 6.7 The rest of `lib/`, `lib/dev/`, `lib/types/`, `components/dev/`, `parcels/`, `precincts/`

| File:lines | Cat | Action |
|---|---|---|
| `lib/api/client.ts:234-235` | STALE | `TripDetailResponse` does not exist; the wrappers return `Trip` |
| `lib/api/client.ts:179-181`, `lib/context/AuthContext.tsx:59-65` | DEAD | Errors swallowed without logging (against CLAUDE.md). Log them. |
| `lib/context/AuthContext.tsx:75-76, 85, 91-93` | STALE, HIST | "won't null the user" (on load it is already null). "ONLY path that clears the user" (sign-out also clears it). A bug story. |
| `lib/forensic/describeChange.ts:1-11, 90-94` | STALE | Cites `vehicle_service.py` and `driver_service.py`, and calls the data "readable PII" while line 120 says it "isn't PII" |
| `lib/format/exception.ts:21-23` | STALE | Cites `road_check_service` |
| `lib/map/polygon.ts:157` | STALE | The example string doesn't match the real output |
| `lib/realtime/sse.ts:11-15` | STALE | A misplaced comment, and "2.5 heartbeats" (it is about 2.7) |
| `lib/tokens.ts:1-2` | STALE | Cites "the dataviz skill's validate_palette.js", an AI-tool script that is not in the repo. Trim to: "Raw hex chart colours; colour-blind safe." |
| `lib/geocode/overpass.ts:1-9`, `lib/map/tiles.ts:69-104, 159-168`, `lib/realtime/RealtimeProvider.tsx:30-96`, `lib/trips/{panel-query,sort}.ts`, `lib/settings/section-query.ts:14-21` | ESSAY | Trim each to 1-2 lines |
| `lib/types/dev.ts:1-23, 214-226` | STALE, ESSAY | Wrong backend paths (`schemas/dev.py`, `dev_truck_service.py`) and descriptions of removed UI |
| `lib/types/dev.ts:51-54, 285-286` | STALE | Departure is described as the precondition (it is arrival). `formatTargetDistance` doesn't exist. |
| `lib/dev/demo-stage.ts:63-65` | STALE | Cites `phase_gate.GATED_PHASES`; it is now `phases/blocking.py` |
| `components/dev/AllControls.tsx:97-111` | STALE, ESSAY | 15 lines citing non-existent files, and wrong about which phases gate scan IN |
| `components/dev/AllControls.tsx:824-828` | HIST | **Text shown to users** cites "the verified 2026-08-04 finding" and "a separate ticket". Reword it. |
| `components/dev/AllControls.tsx` (6 more blocks of 5 to 8 lines) | ESSAY | Render-time reset and lint rationale. Trim. |
| `components/parcels/trace-display.ts:48, 95, 170-171` | STALE | "shown as recorded" (it is returned raw). "nothing here sorts by time" (`scanOutText` sorts). |
| `components/precincts/OutlinePanel.tsx:29-33` | STALE | Points at the wrong file for the button style |
| `components/precincts/PrecinctForm.tsx:163-172, 323-329` | ESSAY, REF | A 10-line JSDoc, and "DESIGN_SYSTEM 10.5". Trim. |

---

## 7. Suggested execution plan

The dispatcher is shared ground for all four developers, so split the work by area and keep each PR reviewable.

| PR | Contents | Risk | Verify with |
|---|---|---|---|
| 0. Bugs | §2: B1, B2, B5–B11 first (small, local, visible to users), then B3/B4 (CSS variables and tokens, check in a browser), then the rest | Behaviour change | `npx vitest run`, plus a manual check of each screen |
| 1. Dead code | §3, §4.1, §4.2. Rows marked **Confirm** go in only after the owner agrees. | Low to medium | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`, `npx eslint .`, `npx vitest run`, `npm run build` |
| 2. Mechanical comment passes | §5 P1–P9, one commit per pass | Very low | `npx tsc --noEmit`, plus a read of the diff |
| 3. File-by-file comment trims | §6, one PR per subsection so each owner reviews their own area | Very low | The same |
| 4. Duplication | §4.3, starting with the clipboard hook, the `'None'` guard and `LoadError`. Do the `derive.ts` move to `shared/` with the driver-pwa owner. | Medium | Full test suite and a visual check |
| 5. Tokens | §4.4: delete the unused tokens, then migrate the legacy names | Visual | Before-and-after screenshots |

After PR 1, turn on `noUnusedLocals` and `noUnusedParameters` in `tsconfig.json`, and add `knip` to CI, so dead code fails the build instead of accumulating.

Add one line to the review checklist: **comments state the current *why*. Ticket numbers, decision codes, dates, plan section numbers, test strategy and "previously…" narration go in the commit message or the design note.**

---

## 8. Out of scope

- **Test files and `__fixtures__/`:** checked for unused locals only.
- **`frontend/shared/`:** the `derive.ts` duplication (§4.3) and `shared/lib/types/phase.ts` need coordination, because the shared folder is used by every frontend.
- **Backend:** findings point at the current backend paths but do not review backend code.
