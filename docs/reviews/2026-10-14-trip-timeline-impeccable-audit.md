# Trip detail page & timeline — Impeccable audit

**Date:** 14 Oct 2026 · **Branch:** `Ciaran` (audited at HEAD `d705086` + staged diff; fixes through `bce9535`, see Resolution status) · **Mode:** Operate (dispatcher app UI)
**Scope:** `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`, the timeline and panel components in `components/trips/`, the rail and row components in `components/domain/`, the UI primitives (`Tabs`, `Button`, `DetailPanel`, `Modal`, `Skeleton`), and `lib/phase/*`. The audit concentrated on the five recent changes: the compact rail, the Evidence | Minimised toggle, Expand/Return, the one-row sticky toolbar, and the Info panel, Cargo skeleton and click-off deselection.
**Not assessed (by design):** phone layout and dark theme. Widths audited: 1440, 1280, 1024 and 768 px.
**Method:** read every scoped file; ran the bundled detector; exercised the live page at `/trips/bca4ccc8-…` (completed trip, 16 exceptions) and the `/dev/design` timeline scenarios in the built-in browser, using keyboard and mouse, with DOM and contrast measurements. No PRODUCT.md or DESIGN.md exists, so the code and `tailwind.config.ts` were treated as the design authority. Nothing was edited apart from writing this report.

> The yellow "Evidence could not be refreshed." banner is a known data issue (the artifacts endpoint returns no CORS header while a migration is pending). It is not counted as a defect. It does take **49 px** of height at every width; see R1.

---

## Resolution status (updated 14 Oct 2026)

The fixes were made in three reviewed batches on `Ciaran`, each verified with the full dispatcher vitest suite, `tsc --noEmit`, lint and a live check in the browser before it was committed. The suite ended at 2,255 passing. The scores below are the original audit's; this page has **not been re-scored**. Run `/impeccable audit` again to get a new score.

| Finding | Status | Commit | Verified by |
|---|---|---|---|
| **A1** (P1) Keyboard route to the selected record | ✅ Fixed | `d18918a` | Live at 1440 px: Enter on a timeline row moves focus to the panel record, which is named by its exception type ("Driver outside precinct"). Escape returns focus to the row. |
| **H1** Click-off deselection too eager | ✅ Fixed | `d18918a` | Escape deselects (except inside fields and open dialogs); card toggles, filters and Group records keep the selection; a click that ends a text selection is ignored. |
| **A3** Selection looked like focus | ✅ Fixed | `d18918a` | Selection is a tint plus a 1 px inset hairline; focus alone is the 2 px outer outline. |
| **L1** Compact connector overlapped the icon | ✅ Fixed | `d18918a` | The connector is drawn inside the icon cell: 2 px gap above and below and 0 px horizontal offset on every exception row (was −6 px overlap). Every row is 32 px, with a 44 px hit area on the buttons. |
| **L2** Revealed rows landed flush under the toolbar | ✅ Fixed | `bce9535` | Live at 1440×900: the owning phase's header lands 16 px below the toolbar with the row in view; when both don't fit, the row lands 16 px below the toolbar. |
| **R1** Tablet space | ◐ Partly | `ab437e8` | The full-width resource banners became one inline status in the toolbar. Reading height went from 64 % to 69 % (1440×900), 57 % to 61 % (1280×800), 51 % to 55 % (1024×768) and 53 % to 54 % (768×1024). The header itself was not restructured. |
| **R3** Fixed 12rem time column | ◐ Partly | `d18918a` | The column is now content-sized through subgrid (178 px, was 192 px), but 5 rows still wrap at 768 px (was 6). A full fix means stacking the clock label under the time. |
| **C1** Verdict wording | ◐ Partly | `ab437e8`, `bce9535` | Clean verdicts are now "Checks passed · n of n" (the full check list stays in the Checked zone). The clock and source vocabulary is unchanged. |
| A2, A4, A5, R2, T1, P1, X1–X4 | ⏳ Open | none | Not in the agreed batches. A5 ("Re-check" contrast) is in `components/blockchain/VerifyButton.tsx`; confirm its owner before changing it. |

**Added beyond the audit (from the critique and the `/dev/design` scenario review):**
- The live phase keeps a ring around its node whatever the verdict colour, pulsing only when motion is allowed, with "Live" for screen readers (`d18918a`). Open question: the ring also shows on a current phase that is only waiting for the driver, which blurs the design note's distinction between *waiting* and *under way*.
- The header "N need review" chip jumps to the first unreviewed row, in the same order the timeline draws them: parsed time, then id (`ab437e8`, ordering fixed in `bce9535`).
- The critique's later finding A5 was added to this report after the live detector overlay (see P2 list).

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | **3** | After selecting an exception, a keyboard user must press Tab about 30 times to reach the record in the panel (A1). Phase headings are swallowed by their toggle buttons (A2). |
| 2 | Performance | **3** | No real hot spots. Every card is rebuilt on each URL change, live refetch and one-minute tick, including on closed trips (P1). |
| 3 | Theming | **3** | Timeline colours all come from tokens. The panel and header still use `text-xs`/`text-sm`, and the tabs use 10 px literal type (T1). |
| 4 | Responsive design | **3** | Nothing overflows and long names wrap cleanly. At tablet widths, however, about half the screen is left for reading (R1), and toolbar targets are 26–30 px tall (R2). |
| 5 | Implementation integrity | **3** | The detector is clean on the scoped files. The compact rail's `calc()` offsets put the connector line 6 px into the icon of every exception row (L1). |
| **Total** | | **15/20** | **Good**: fix the weaker areas; the foundation is solid |

## Implementation Integrity Verdict

**Pass, with isolated drift.** This is a product-specific system, not a generic template. The phase model, the clock-source labels ("Driver's phone" / "System recorded"), the verdict line, the "Findings from this confirmation" grouping and the honest artifact states ("Evidence lookup failed", "Time unavailable") all come from FreightProof's evidence domain, and the rail would not make sense in an unrelated product. The colour tokens are used consistently in every timeline file, contrast is strong everywhere, and the ARIA wiring for tabs and tab panels is correct. The drift is local:

- The compact rail aligns its connector with hand-computed pixel offsets that only hold for 32 px rows (L1).
- Two type systems sit side by side on one page (T1).
- A few primitives repeat markup or radii that should be shared (X1).

None of these is systemic.

**Detector (verified):**

- `impeccable detect` on all 28 scoped files: **0 findings**.
- `impeccable detect components/trips components/domain components/ui "app/(app)/trips"` (whole directories): **5 findings, all outside this page**:
  - `components/trips/new/RouteFields.tsx:40` `border-accent-on-rounded`
  - `components/trips/new/form-parts.tsx:9` `border-accent-on-rounded`
  - `components/domain/ExceptionBanner.tsx:22` `side-tab`
  - `components/ui/Card.tsx:13` `side-tab`
  - `components/ui/SearchSelect.tsx:31` `border-accent-on-rounded`

  None of these renders on the trip detail page. (`Card` is used by `EvidencePacket`, which this page does not mount.) They are genuine findings for the trip-creation and exceptions surfaces, but out of scope here.
- A URL scan was not run: the detector's headless browser has no session, so it would have scanned the sign-in redirect. During the critique the detector was **injected into the signed-in live page** instead. It reported 12 issues: 10–11 px text (header chip, tab labels, the "16" badge, Record integrity buttons and text), "Re-check" at 2.7:1 contrast (now A5), and one unconfirmed `nested-cards` on the Record integrity block. These are the runtime and arbitrary-value classes the static scan cannot see.

## Executive Summary

- **Audit Health Score: 15/20 (Good).**
- **Issues:** P0 0 · P1 1 · P2 11 · P3 6 (A5 was added after the live detector overlay).
- **Top issues:**
  1. **A1 (P1)**: there is no keyboard route from a selected timeline exception to its record in the docked panel: about 30 Tab presses with the cards collapsed, and more with them open.
  2. **R1 (P2)**: at 1024×768 the header, banner and toolbar take 49 % of the viewport, leaving 394 px for the timeline. Expand only removes the facts grid (−104 px).
  3. **H1 (P2)**: click-off deselection is too eager. Opening another card, using the Group records menu or selecting text all drop the selection, and the keyboard has no equivalent such as Escape.
  4. **A3 (P2)**: the selected-row ring is the same 2 px blue as the focus ring, so keyboard focus and selection look identical.
  5. **L1 (P2)**: the compact connector overlaps the warning icon by 6 px in every exception row, and the rail mixes 32 px and 44 px rows.
- **Next steps:** `/impeccable harden` (A1, H1, L2), then `/impeccable adapt` (R1–R3), `/impeccable polish` (A3, L1, X1), `/impeccable typeset` (T1), `/impeccable clarify` (C1), `/impeccable optimize` (P1), and `/impeccable polish` last.

### Live measurements

| Viewport | Header | Banner | Toolbar | Reading height under toolbar | Panel |
|---|---|---|---|---|---|
| 1440×900 | 204 px | 49 | 52 | 572 px (64 %) | docked, 400 px |
| 1440×900 expanded | 100 px | 49 | 52 | 676 px (75 %) | docked |
| 1280×800 | 224 px | 49 | 52 | 452 px (57 %) | docked, 400 px |
| 1024×768 | 250 px | 49 | 52 | 394 px (51 %) | overlay |
| 768×1024 | 354 px | 49 | 52 | 545 px (53 %) | overlay |

No horizontal overflow at any width. Long stop names (the `/dev/design` "Gauteng North … Block C (Cold Chain)" scenario) wrap onto 2–3 lines in the In Transit meta line at 768 px and are never truncated.

---

## Detailed findings by severity

### P1: Major

**[P1] A1. No keyboard route from a selected timeline exception to its panel record**
- **Location:** `app/(app)/trips/[id]/page.tsx:139-141` (`openException`), `:219` (panel rendered after the whole timeline column); `components/ui/DetailPanel.tsx:48-55`
- **Category:** Accessibility
- **Impact:** Activating an exception row (docked, ≥1280 px) changes the URL and scrolls the panel to the record, but focus stays on the row (verified: `document.activeElement` is the row). To act on the record (Review exception, View on map, Supporting evidence) a keyboard user has to Tab through the rest of the timeline. Measured: 30 tab stops from the first exception row to the panel with every card collapsed, and more once cards are open. There is no skip link, no "Go to record" control and no landmark shortcut for sighted keyboard users. Below 1280 px the overlay's focus trap avoids this, so only the docked layout is affected.
- **WCAG/Standard:** 2.4.1 Bypass Blocks (screen-reader users can jump via the `aside` landmark; sighted keyboard users cannot); 2.4.3 Focus Order is followed only in the narrowest sense.
- **Recommendation:** When a timeline row selects a record in the docked panel, move focus to the selected record's heading or article (`preventScroll` plus the existing scroll), or give the row's action a matching "Go to record" target. Add a return path ("Show in timeline" already exists, so make sure it restores focus to the originating row).
- **Suggested command:** `/impeccable harden`

### P2: Minor

**[P2] A2. Phase headings are swallowed by their toggle buttons**
- **Location:** `components/trips/PhaseTimelineItem.tsx:115` (`<h3>` inside `summaryContent`), `:134` (`<button>` wraps it)
- **Category:** Accessibility
- **Impact:** 7 of the 8 phase titles (all except the always-open In Transit) render as `<h3>` inside `<button>`. Verified in the DOM: "Trip Created [IN BUTTON] … Confirmation [IN BUTTON]". A button's children are presentational, so these headings drop out of screen-reader heading navigation, leaving the phase list (the page's main structure) navigable only through the `role="group"` labels. Each button's accessible name also concatenates the title, time, stop and the whole verdict sentence. `<h3>` is not valid content inside `<button>` either.
- **WCAG/Standard:** 1.3.1 Info and Relationships; HTML content model.
- **Recommendation:** Use the disclosure pattern: `<h3><button aria-expanded …>Activation</button></h3>`, with time, meta and verdict as siblings outside the button (still clickable through the card if wanted). The accessible name becomes just the phase title, and the heading outline returns.
- **Suggested command:** `/impeccable harden`

**[P2] A5. "Re-check" fails text contrast (added after the critique's live detector overlay)**
- **Location:** `components/blockchain/VerifyButton.tsx:207` (`text-[10px] font-[500] text-chain opacity-60`), rendered in the Record integrity block under the timeline (`IntegritySummary`)
- **Category:** Accessibility
- **Impact:** The overlay measured #62a0a7 on #f6f3f4, about **2.7:1**, for 10 px text. It is also 15 px tall (see R2). The same block's mismatch description is 11 px (`text-[11px] text-on-err-c/80`). This file lies outside the scoped list, but it renders on the page, so the original "contrast passes everywhere" claim was wrong for this one control.
- **WCAG/Standard:** 1.4.3 Contrast (Minimum).
- **Recommendation:** Drop `opacity-60` (use full `text-chain`, 6.5:1 on white), raise the text to at least `meta`, and give it a 24 px or larger hit area.
- **Suggested command:** `/impeccable harden`

**[P2] A3. Selected exception looks identical to keyboard focus**
- **Location:** `components/domain/ExceptionRow.tsx:37` (`EXCEPTION_SELECTION_OUTLINE = 'ring-2 ring-sec'`), `:52` / `:89` (focus-visible `outline-2 outline-sec`); `app/globals.css:21-25`
- **Category:** Accessibility
- **Impact:** Both are a 2 px `#0051d5` line around the row. Verified live: the selected row computes `box-shadow … rgb(0,81,213) 0 0 0 2px`, while focus is a 2 px outline of the same colour. When a keyboard user tabs past a selected row, two rows look "selected" and it is unclear which one has focus. The selected state does not rely on colour alone (it has a ring, a tint and `aria-current`), but its one non-colour cue is the same shape as the focus indicator.
- **WCAG/Standard:** 2.4.7 Focus Visible (it is visible but ambiguous); 1.4.1 is met.
- **Recommendation:** Give selection its own form: a 3 px leading bar or inset left rule plus the tint, or a "Selected" text token in the compact row (the panel already says "· Selected exception"). Keep the outer ring exclusively for focus.
- **Suggested command:** `/impeccable polish`

**[P2] H1. Click-off deselection is too eager, and has no keyboard equivalent**
- **Location:** `components/trips/useDismissExceptionSelection.ts:20-29`; `PhaseTimelineItem.tsx:134` (card toggle has no keep attribute); `TripExceptionsPanel.tsx:112` (Group records `<select>`)
- **Category:** Accessibility / Implementation integrity
- **Impact:** Any click outside the record, a `data-keep-exception-selection` control or another exception row clears the selection with `router.replace`. Each of the following was verified by code path; the toolbar-text case was also confirmed live (URL lost `exception=` and focus fell to `<body>`):
  - opening or closing *another* phase card to compare;
  - clicking the Driver or Vehicle links in the header;
  - changing "Group records" in the panel;
  - clicking empty card text to select and copy it;
  - in the overlay, any click inside the modal outside the selected record.

  Selection is navigation state, so losing it while comparing evidence is costly. Keyboard users cannot deselect at all except by activating some other control, because Escape is not handled.
- **Recommendation:** Narrow the dismiss rule to deliberate "away" gestures (a click on the timeline background or on another row), add `data-keep-exception-selection` to card toggles and panel controls, ignore clicks that end a text selection (`getSelection().isCollapsed === false`), and add Escape to deselect.
- **Suggested command:** `/impeccable harden`

**[P2] L1. The compact rail connector is mis-aligned in exception rows, and row rhythm is uneven**
- **Location:** `components/domain/CompactActLine.tsx:13-18` (`COMPACT_CONNECTOR = '… left-[calc(12.5rem+6px)] top-[23px] bottom-[-10px] …'`, `GRID = 'grid grid-cols-[12rem_1rem_minmax(0,1fr)] …'`); `ExceptionRow.tsx:87-93`
- **Category:** Implementation integrity / Layout
- **Impact:** `top-[23px]` assumes a 32 px row (8 px padding, 2 px margin and a 13 px icon). Exception rows are `min-h-11` (44 px) buttons, which centre their content vertically, so the icon moves down 6 px. Measured: `connector.top − icon.bottom = −6 px` on every exception row, so the line runs into the warning glyph. The rail also alternates 32 px record rows and 44 px exception rows, so the "one line per record" rhythm breaks exactly where findings cluster. The horizontal offset (`12.5rem+6px`) is correct today (connector and icon centre both at x=383) but only by arithmetic coincidence with the 13 px icon.
- **Recommendation:** Draw the connector from the icon cell itself, for example a `::after` on `[data-compact-icon]` or a flex column holding the icon and a `flex-1` line, as `RailRow` already does at `PhaseActRow.tsx:65-70`. Then the line follows the icon wherever the row's height puts it. Give every compact row the same minimum height (either all 44 px, or 32 px with the 44 px hit area provided by padding or a pseudo-element on the buttons).
- **Suggested command:** `/impeccable polish`

**[P2] L2. "Show in timeline" lands flush under the toolbar and hides the phase context**
- **Location:** `app/(app)/trips/[id]/page.tsx:39-43` (`scrollIntoTimeline` subtracts only the toolbar height), `:215`; `components/trips/TripTimeline.tsx:208` (`CurrentLegStrip` is sticky at the toolbar's height)
- **Category:** Layout / Harden
- **Impact:** Verified at 1440 and 1024: the revealed row's top is exactly **0 px** below the toolbar. The card's title, verdict and the "Findings from this confirmation" heading sit above the fold, so the reader lands on a finding without knowing which phase it belongs to, and the highlight starts touching the toolbar border. On a live trip whose In Transit leg is scrolled away, the sticky "Current transit leg" strip occupies the same band, and the arithmetic does not subtract it, so the revealed row would land underneath the strip. That last part is inferred from the code; there was no live in-transit trip to test it on.
- **Recommendation:** Scroll so the owning phase card's header is visible, or add a fixed reading inset (one spacing step) below the toolbar. Measure any sticky strip as well as the toolbar, for instance by having both write into one CSS variable.
- **Suggested command:** `/impeccable layout`

**[P2] R1. At tablet widths the chrome leaves half the screen for the timeline**
- **Location:** `components/trips/TripSummary.tsx:43-95`; `page.tsx:206-209`; `TripTimeline.tsx:132`
- **Category:** Responsive
- **Impact:** See the measurements table above. At 1024×768 only 394 px (51 %) remains for evidence; at 768×1024 the header alone is 354 px, because the title, the chips row, a 2×2 facts grid and the "Info / Cargo / Exceptions" button row all stack. Expand reclaims only the facts grid (−104 px at 1440). The panel trigger row and the 49 px banner remain. With the banner present, a 1024 px tablet shows about 2.5 collapsed cards.
- **Recommendation:** At widths below `xl`, fold the panel triggers into the timeline toolbar row (it has room: tabs, refreshed time and icon), compress the facts grid to one inline line of key facts, and make the resource banners collapsible or a single-line inline status inside the toolbar. Consider letting Expand also hide the banners and the trigger row.
- **Suggested command:** `/impeccable adapt`

**[P2] R2. Touch targets fall below 44 px on the tablet layouts the page supports**
- **Location:** `components/ui/Tabs.tsx:62` (`py-[6px] text-[10px]` gives **27 px** view tabs and **29 px** panel tabs); `TripTimeline.tsx:144` (Expand icon button **44×26**); `components/ui/Button.tsx:17` (`sm` gives 28–30 px: Jump, Retry, Issue audit pack, Show in timeline); `TripSummary.tsx:70` (driver phone link **16 px** tall); `components/blockchain/VerifyButton.tsx:210` ("Re-check", **15 px** tall); `components/ui/Modal.tsx:158` (close, **32×32**)
- **Category:** Responsive / Accessibility
- **Impact:** All of these clear the WCAG 2.2 AA 24 px floor except the phone link and Re-check. They are well under the 44 px expected on a tablet, which is a target device for this page (768 and 1024 are audited widths). The exception rows, "+n more" and "Location details" already use `min-h-11`; the toolbar and panel controls do not.
- **WCAG/Standard:** 2.5.8 Target Size (Minimum) fails for the phone link and Re-check; 2.5.5 (AAA) and platform guidance fail for the rest.
- **Recommendation:** Add a `touch` size, or raise `sm` to a 44 px hit area through padding or a pseudo-element on coarse pointers (`@media (pointer: coarse)`), and apply it to the toolbar, the panel tabs and the Modal close button. Pad the phone link and Re-check to at least 24 px now.
- **Suggested command:** `/impeccable adapt`

**[P2] R3. The compact rail's fixed 12rem time column crowds the record text at 768 px**
- **Location:** `components/domain/CompactActLine.tsx:18`
- **Category:** Responsive / Layout
- **Impact:** The time column is a fixed 192 px wide whatever its content ("12:29 SAST" plus "System recorded"). At 768 px the detail column is 325 px, and 6 records wrap to two lines (48 px rows), so "one line per record" no longer holds. At 1440 px the same column leaves about 70 px of air after the clock label.
- **Recommendation:** Size the column to its content (`grid-cols-[max-content_1rem_minmax(0,1fr)]`, shared by all rows through a subgrid or a container-level grid so the columns still align), or stack the clock label under the time below a container width. The connector offset must stop depending on the column width either way (L1).
- **Suggested command:** `/impeccable layout`

**[P2] C1. The same facts are worded differently across views**
- **Location:** `components/trips/TimelinePhase.tsx:101` and `:126-127` (Minimised reasons) vs `lib/phase/verdict.ts` reasons (Evidence); `ExceptionRow.tsx:90-92` (compact) vs `:107-113` (full); `ExceptionSummary.tsx:59` (panel)
- **Category:** Implementation integrity / Copy
- **Impact:** For the Activation phase, Evidence reads "Needs attention · 2 exceptions to review · Driver separated from truck", while Minimised reads "Needs attention · 2 exceptions · 2 need review". One exception appears as "12:29 SAST System recorded" (compact rail), "01 Oct, 12:29 SAST (system recorded) · Raised by system" (full rail) and "System" (panel card). The source and clock concepts are close enough that a dispatcher has to work out whether "Raised by system" and "System recorded" are the same claim. On an evidence platform, wording that drifts between views undermines trust in the record.
- **Recommendation:** Use one count phrase for both views (for example "2 exceptions · 2 need review") and keep the extra reason only in Evidence. Separate the *clock* ("Recorded by system clock" / "Driver's phone clock") from the *source* ("Raised by system") with fixed vocabulary in `act-wording.ts`, and have the panel card use the same words.
- **Suggested command:** `/impeccable clarify`

**[P2] T1. Two type scales on one page, and tab labels below the project's own minimum**
- **Location:** `tailwind.config.ts` (D37 `label/meta/body/title`); the timeline files use D37 throughout. `TripSummary.tsx` (10 uses of `text-xs`/`text-sm`), `TripExceptionsPanel.tsx` (11), `ExceptionSummary.tsx` (6, plus `text-[12px] font-[700]` at `:55`), `ManifestContent.tsx` (10, plus `text-[11px]` at `:117`), `Modal.tsx:152` (`text-lg`). `Tabs.tsx:62,72` (`text-[10px]` uppercase labels and badge count).
- **Category:** Theming / Typography
- **Impact:** The left column reads on the 11/12/13/15 px D37 scale, while the header and panel use Tailwind's 12/14/18 px. A panel exception card (`text-sm`, 14 px) sets its body larger than the timeline row describing the same exception (`text-body`, 13 px). The tab labels, and the Exceptions **count badge**, are 10 px, which breaks D37's own rule in `tailwind.config.ts` that anything carrying a value is never below `meta` (12 px).
- **Recommendation:** Move the header, panel, exceptions panel, Modal and Tabs onto D37 roles, starting with the trip-detail surfaces because they share a screen with the timeline. Raise the tab labels and badge to at least `label`/`meta`, and drop letter-spaced uppercase for the badge number.
- **Suggested command:** `/impeccable typeset`

### P3: Polish

**[P3] P1. Every card is rebuilt on each render of the page, including a once-a-minute tick on closed trips**
- **Location:** `TripTimeline.tsx:104` (`useNow(60 000)`), `:107-112` (new `lookup` object every render), `:160-178` (unmemoised `TimelinePhase` map, per-phase `filter` + `sortExceptionsByEventTime` with `Date.parse` inside the comparator); `TimelinePhase.tsx:64` (`buildPhaseCardModel` each render); `TripTimeline.tsx:96-98` (a `window` resize listener next to a `ResizeObserver` that already covers it)
- **Category:** Performance
- **Impact:** Today this costs little (7–11 phases, a few dozen exceptions), and data refreshes are driven by live events, not a timer: `useTripDetail.ts` only polls every 10 s while an anchor receipt is owed. But selecting an exception (a URL change), every live refetch and every minute rebuild all phase models and re-render every card and rail row, including on completed or cancelled trips where nothing is counting. The `document` click listener is fine: it is bound only while a selection exists and does constant work per click.
- **Recommendation:** Run `useNow` only when a phase is live (`activeTransit` or `model.running`); wrap `TimelinePhase` in `memo` with a stable `lookup` (`useMemo`) and stable callbacks; precompute the exceptions grouped by phase, with parsed times, once per `trip`/`artifactsById`. Drop the redundant resize listener.
- **Suggested command:** `/impeccable optimize`

**[P3] A4. Smaller ARIA and naming details**
- **Location:** `PhaseTimelineItem.tsx:134,137`; `TripTimeline.tsx:143-146`; `ExceptionRow.tsx:87-93`; `ExceptionSummary.tsx:69`; `Modal.tsx:157`
- **Category:** Accessibility
- **Impact:**
  - `aria-controls` points at an id that does not exist while the card is collapsed (verified: `controlsExists: false`). Harmless, but invalid.
  - Expand/Return signals its state only by swapping its label; `title` repeats `aria-label`, so the tooltip and name always match, which is fine. `aria-pressed` with a stable name would be clearer.
  - "Jump to current phase ↓" and "Review exception →" read the arrow glyphs aloud.
  - The compact exception row's name omits the action ("Open in exceptions panel"), which the full row includes.
  - The Modal close button is named "Close modal" rather than after the panel ("Close trip exceptions").
- **Recommendation:** Render the body hidden (`hidden`) rather than unmounting it, or drop `aria-controls` while collapsed. Put the arrows in `aria-hidden` spans. Align the compact and full row names.
- **Suggested command:** `/impeccable harden`

**[P3] X1. Primitive drift: radii, duplicated clock markup, literal colours**
- **Location:** `ExceptionSummary.tsx:55` (re-implements `PhaseClock` from `PhaseTimelineItem.tsx:79-83` with `text-[12px] font-[700] gap-[4px]`), then repainted by `TripExceptionsPanel.tsx:157` (`[&_time]:text-on-surf-v`); radii: compact exception row `rounded` (3 px), full row `rounded-md` (6 px), Tabs `rounded-[10px]` (the `lg` value as a literal), Modal close `rounded-xl`; `PhaseTimelineItem.tsx:17-18,71-72` (`text-white`, `h-[30px] w-[30px]`, `gap-[14px]`, `mb-[5px]`); `Button.tsx:43` (inline gradient hex `#1b1b1c`/`#303031`)
- **Category:** Theming / Implementation integrity
- **Impact:** None of these is visible on its own. Together they explain why the panel time looks almost, but not quite, like the timeline time, and why the selected and hover states differ in corner radius between the compact and full rows.
- **Recommendation:** Export `PhaseClock` and give it a `tone` prop instead of the descendant-selector override. Pick one radius per role (row `md`, card `lg`, control `md`). Replace `text-white` with the `*-on` tokens that already exist (`ok.on`, `sec.on`).
- **Suggested command:** `/impeccable polish`

**[P3] X2. The `/dev/design` "visual sign-off gate" shows stale token values**
- **Location:** `app/dev/design/page.tsx:2` imports `TOKENS` from `frontend/shared/lib/tokens.ts:11,23,37`
- **Category:** Theming
- **Impact:** The page shows `secondaryContainer #316bf3`, `success #1a7c3e`, `surfaceContainerHigh #eae7e8` and `rounded-sm 2px`. The shipped `tailwind.config.ts` uses `#d8e2ff`, `#006c4c`, `#e5e2e3` and `3px`. The page that says "verify every token … before building pages" no longer describes the product. Fixing it touches `frontend/shared/`, which this audit had to leave alone, so it is flagged here for whoever owns shared.
- **Suggested command:** `/impeccable document`

**[P3] X3. The Cargo skeleton does not match the loaded shape**
- **Location:** `components/domain/ManifestContentSkeleton.tsx:3-4`
- **Category:** Implementation integrity
- **Impact:** The skeleton shows 4 stat tiles and 3 waybills; this trip loads 5 tiles (Units included) and 1 waybill, so the panel jumps when the data arrives. It is only seen on first open (verified: a second visit is served from cache with no skeleton). The announcement is correct: one `role="status"` "Loading cargo…", with the shapes `aria-hidden`.
- **Suggested command:** `/impeccable polish`

**[P3] X4. Closing the overlay through "Show in timeline" leaves a stale query parameter**
- **Location:** `page.tsx:160` (`setPanel(null)`), `lib/trips/panel-query.ts`
- **Category:** Harden
- **Impact:** Verified at 1024 px: the URL went from `?panel=exceptions&exceptions=all&phase=…` to `?exceptions=all`. The parameter does nothing visible until the panel is reopened, which then opens on "All recorded" instead of the default "needs review". Copied links carry it.
- **Suggested command:** `/impeccable harden`

---

## Patterns and systemic issues

1. **Pixel arithmetic in place of structure.** The compact connector (L1), the reveal scroll (L2) and the sticky strip offset all compute positions from assumed heights. Where the code lets layout do the work instead (`RailRow`'s flex column, the `--timeline-toolbar-height` variable written by a `ResizeObserver`), it holds up. Where it hard-codes `23px` or subtracts only the toolbar, it drifts as soon as a row or strip changes height.
2. **Two type systems.** D37 tokens cover the timeline; the header, panel, Modal and Tabs still use Tailwind's scale and pixel literals (T1, X1).
3. **Desktop-sized controls on a tablet layout.** The `sm` button and tab sizes (26–30 px) are used for every toolbar and panel control, while rows already use `min-h-11` (R2).
4. **Selection is managed by a global rule.** One document-level heuristic decides what counts as "away" (H1), and keyboard access to the selected record was never designed (A1). Selection needs an explicit model: focus target, Escape, keep-zones.

## Positive findings

- **Contrast is excellent across the timeline and panel** (one exception, A5 below). `on-surf-v` #46464f gives 9.3:1 on white, 8.5:1 on `surf-low`, 7.2:1 on the active `sec-c` card and 7.8:1 under the reveal highlight. `text-sec` stays at or above 5.2:1 on every card and selection background, and `text-warn` at or above 5.0:1. The 11 px `text-label` clock labels pass AA with room to spare.
- **The tab wiring is correct.** Both tablists use roving `tabIndex`, arrow-key switching that moves focus, unique `useId` ids, and an `aria-controls` / `aria-labelledby` pair that resolves (verified). Switching Evidence ↔ Minimised by keyboard keeps focus on the tab and preserves the reading position through `readingPhaseAnchor`.
- **Expanding keeps focus.** Expanding a card keeps focus on its header button with `aria-expanded="true"`. Expand/Return keeps focus on the same button under its new name.
- **"Show in timeline" works end to end at both layouts.** It opens the card, bypasses the "+n more" cap, focuses the row, highlights it for 2 s, and, in the overlay, waits for the dialog to close before moving focus.
- **Reduced motion is safe.** The global `0.01ms` rule leaves state legible: the reveal highlight still shows and then clears, `animate-pulse` on the active node becomes static, and transitions on the chevron and row colours carry `motion-reduce:` variants.
- **Honest states.** "Time unavailable", "Evidence lookup failed · Retry …", "Submitted at completion" and the transit "No location verdict is recorded…" note never invent data. The Cargo skeleton announces once and hides its shapes.
- **The sticky toolbar is sound.** It is opaque `bg-surf-lowest`, spans the full scroller with `-mx`, its height is measured (not assumed) into `--timeline-toolbar-height`, and every phase anchor and the Trip-record anchor use it as `scroll-margin-top`. No content shows above it at any tested width.
- **Long names wrap cleanly.** Stop names and In Transit routes wrap at 1024 and 768 px with no truncation or overflow.

---

## Recommended actions (in order)

1. **[P1] `/impeccable harden`**: move focus to the selected record in the docked panel and provide a way back (A1). In the same pass: narrow click-off dismissal, add Escape, keep selection on card toggles and panel controls (H1); disclosure-pattern headings (A2); the ARIA details (A4); the "Re-check" contrast (A5); the stale query parameter (X4).
2. **[P2] `/impeccable adapt`**: tablet vertical budget: fold the panel triggers into the toolbar, compress the facts, make the banners inline or collapsible (R1); 44 px targets on coarse pointers (R2).
3. **[P2] `/impeccable layout`**: land "Show in timeline" with the phase header visible and account for the sticky strip (L2); a content-sized time column for the compact rail (R3).
4. **[P2] `/impeccable polish`**: make selection distinct from focus (A3); a connector drawn from the icon cell and an even row rhythm (L1).
5. **[P2] `/impeccable typeset`**: move the header, panel, Modal and Tabs onto D37 and raise the 10 px tab and badge text (T1).
6. **[P2] `/impeccable clarify`**: one count phrase across views; separate vocabularies for clock and source (C1).
7. **[P3] `/impeccable optimize`**: gate `useNow` on live phases, memoise cards, precompute grouped exceptions (P1).
8. **[P3] `/impeccable document`**: re-sync the `/dev/design` token preview with `tailwind.config.ts` once `frontend/shared` can be touched (X2).
9. **`/impeccable polish`** (final pass): primitive drift (X1), skeleton shape (X3).

> You can ask me to run these one at a time, all at once, or in any order you prefer.
>
> Re-run `/impeccable audit` after fixes to see your score improve.
