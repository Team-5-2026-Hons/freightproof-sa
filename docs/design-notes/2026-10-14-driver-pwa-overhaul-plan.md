# Driver PWA Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans, one stage at a time. Steps use checkbox (`- [ ]`) syntax. **Nothing in this plan is built until Tim has given feedback on every render for that stage and said OK.**

**Goal:** Rebuild every driver-PWA screen to match the overhaul renders. That means full white surfaces, Uber-grade hierarchy, and Settings merged into a Profile tab with the driver's photo. No functionality or navigation may regress.

**Architecture:** Change the theme tokens first, so the white system lands everywhere at once. Then rebuild the shared chrome: tab bar, headers, step frame, footer, swipe and rows. Then go flow by flow in the order a driver meets them. Every stage ends with the same regression loop (§4) before the next one starts.

**Tech stack:** Next.js 15 App Router with `output: 'export'`, so every page is `"use client"`. Also React 19, Tailwind 3.4, Capacitor (iOS/Android), Vitest + Testing Library, and Playwright (scratchpad install) for real-browser walks.

**Renders (source of truth):** https://claude.ai/artifact/G3w1yX4imaWhJp3CWgCD4L. There are 40 artboards in rows 0–10, each with a number such as "5.2". Each task below names the artboards it must match.

**Branch:** `DriverPWAUI`. Driver side only: `dispatcher/` is off limits, and `frontend/shared/` is read-only.

---

## 0. Tim's feedback, 14 Oct (applied to the canvas; it overrides anything below)

- **1.1–1.4 sign-in: DO NOT CHANGE.** It stays exactly as it is today (dark, Revolut-style). Stage 1 is dropped and D4 is closed.
- **2.1 / 2.3:** remove the "On time means arriving by the planned time." footnote. Removed on both for consistency.
- **3.1 Trips:** the root page must NOT scroll. It holds Now, a capped Upcoming list and a capped Past list, sized to end just above the tab bar. Each section has a "See all" that opens its own scrolling list: new **3.5 Past trips** (grouped by month, loads more on scroll) and **3.6 Upcoming trips**.
- **3.2 Trip page:** Proof and Load sections removed. Order is header, vehicle row, status banner, **Progress, then Route**. The vehicle row is tappable and opens **3.7 Truck & trailers sheet** (registration, make/model/year, licence disc expiry, GVM, length; each trailer as a number plate). Rows whose value is null are hidden.
- **3.4 Trip record:** Evidence section removed. The anchored-phases row stays.
- **6.2 Checkpoint:** selfie removed; cargo photo only. The backend already accepts this (`schemas/transit.py`: `selfie_artifact_id: Optional[UUID] = None`; `checkpoint_service` validates only a supplied artifact). The client change: `CheckpointEvidence.selfieDataUrl` becomes optional in `lib/api/checkpoints.ts`, and the selfie upload is skipped when it's absent. Old offline-queued checkpoints that carry a selfie must still replay, so add a test for that.
- **7.1 Panic:** stays white (D5 closed). **New 7.1b:** from pointer-down on the swipe track, a see-through red vignette pulses over the whole screen at 1 Hz (opacity 0.35 to 1 on an overlay whose own alpha is ≤0.45, `pointer-events: none`). That is well under WCAG 2.3.1's three flashes per second. It stops the instant the finger lifts or the swipe is cancelled. Under `prefers-reduced-motion` it becomes a steady tint. While the finger is down the copy reads "Keep going. Let go to cancel."
- **D3 closed:** the tab bar stays visible on the trip pages (3.2 approved as drawn).
- Everything else (2.2, 2.3, 2.4, 3.3, rows 4, 5, 6.1, 6.3, 6.4, 7.2, 7.3, 8, 9, 10) is approved as rendered. Tim specifically likes the Call Dispatch button on 7.2 and 7.3. It dials `SUPPORT_PHONE` (`lib/constants/app.ts`), which is null when `NEXT_PUBLIC_SUPPORT_PHONE` is unset, so the button is hidden. **Set it in `.env.local` before any demo.**

## 1. Decisions Tim must make before the stage that needs them

| # | Decision | Needed by | Recommendation |
|---|---|---|---|
| D1 ✅ closed: on the phone only | **Driver photo storage.** The `Driver` model and the shared type have no photo field. (a) The driver takes their own photo and it is stored only on the device (Capacitor Preferences / IndexedDB). (b) A new `drivers.photo_artifact_id` column, an Alembic migration and a Supabase Storage upload. | Stage 2 | **(a)** for the demo. It needs no backend, no shared-file change and no migration. A photo is POPIA personal data, and keeping it on the device is the safest choice. Initials are the fallback until a photo exists. |
| D2 ✅ closed: rename to /profile | **Profile route.** Rename `/settings` to `/profile`, with `/settings` redirecting, or keep the `/settings` path and only relabel it. | Stage 2 | Rename. URLs should say what the screen is. A small static redirect page keeps old links working. |
| D3 ✅ closed: visible | **Tab bar on drill-in pages.** The renders keep it visible on the trip pages (HIG `tab-bars.md`). In Transit and the phase steps stay full-screen. | Stage 3 | As rendered. |
| D4 ✅ closed: unchanged | **Sign-in screens.** They are currently always dark (Revolut style, chosen Oct 12). The renders make them white with the photo on top. | Stage 1 | As rendered, to match the white-everywhere direction. |
| D5 ✅ closed: white + pulse | **Panic.** White with red controls (as rendered) or full red as today. | Stage 6 | Tim's call. White is consistent; red is unmistakable. |
| D6 ✅ closed: build (10 approved) | **New Profile rows.** Location/Camera status and the "Waiting to send" queue row are new wiring. | Stage 2 | Build them. Both read existing state (permissions API, `useOfflineQueue`). |
| D7 ✅ closed: no image (Tim, 14 Oct) | **Receiver signature thumbnail** on 9.3 (3.4's evidence section was removed). This needs the signature artifact to be fetchable by the driver. | Stage 8 | Show it only if an endpoint already exists. Otherwise ship without the image. |
| D8 ✅ closed: keep as sheet | **Appearance switch.** HIG `settings.md` says not to duplicate system settings. Tim chose to keep it on Oct 12. | Stage 2 | Keep it, as a sheet (10.2). |

## 2. File map

| Area | Files (all under `frontend/driver-pwa/`) | Renders |
|---|---|---|
| Tokens | `app/globals.css` (light `--fp-surface` 252 248 249 → 255 255 255; new fill #F3F3F3, hairline #EBEBEB, ink #141414, secondary #6B6B70), `tailwind.config.ts`, `lib/tokens.ts`, `lib/constants/type-scale.ts` | 0 |
| Shell + tabs | `components/layout/AppShell.tsx`, `BottomNav.tsx` (three tabs, Profile shows the photo), `lib/navigation/nav-items.ts`, `lib/constants/routes.ts` | every tab screen |
| Profile | `app/(app)/settings/page.tsx` → `app/(app)/profile/page.tsx`, `components/layout/ProfilePanel.tsx` (retired once merged), `components/settings/ThemeSelect.tsx` (becomes the sheet), new `components/profile/DriverPhoto.tsx`, new `lib/profile/driver-photo.ts` | 10.1–10.3 |
| Auth | `components/auth/AuthFrame.tsx`, `app/login/page.tsx`, `app/login/phone/page.tsx`, `app/otp/page.tsx`, `components/ui/OtpInput.tsx`, `CountryCodeSelect.tsx` | 1.1–1.4 |
| Home | `components/home/HomeContent.tsx`, `NowCard.tsx`, `DriverRecord.tsx`, `components/trip/HoldNotice.tsx`, `ExceptionCard.tsx` | 2.1–2.4 |
| Trips | `app/(app)/trips/page.tsx`, `components/trip/TripTable.tsx`, `TripDetailView.tsx`, `PhaseProgressBar.tsx`, `CurrentPhaseCard.tsx`, `app/(app)/trips/{active,detail,[id]}/*` | 3.1–3.4 |
| Step frame | `components/phase/StepHeader.tsx`, `StepLayout.tsx`, `SwipeToConfirm.tsx`, `CameraCapture.tsx`, `EvidenceReview.tsx`, `SealInput.tsx`, `WarehouseWaitCard.tsx`, `LocationCheckModal.tsx` | 4.x–9.x |
| Steps | `components/phase/steps/**` (10 steps) | 4.1, 4.3–4.4, 5.1–5.3, 8.1–8.4, 9.1–9.5 |
| Receipt | the existing receipt toast / AnchorProgress components | 5.4 |
| In Transit | `app/(app)/trip/in-transit/InTransitPageClient.tsx`, `components/map/DriverMap.tsx`, `checkpoint/CheckpointPageClient.tsx`, `exception/LogExceptionPageClient.tsx` | 6.1–6.4 |
| Emergency | `app/(app)/trip/panic/PanicPageClient.tsx`, `panic/submitted/PanicSubmittedPageClient.tsx` | 7.1–7.3 |
| UI kit | `components/ui/Button.tsx`, `Input.tsx`, `TextArea.tsx`, `Switch.tsx`, `Tabs.tsx` (retired from Trips), `Drawer.tsx`, `Modal.tsx`, `Toast.tsx`, `EmptyState.tsx` | all |

**Shared files (flag in TASK COMPLETE, do not edit without coordinating):** `frontend/driver-pwa/package.json` (no new dependencies planned) and anything in `frontend/shared/` (read-only, so nothing planned there).

## 3. Stages

Each stage: get Tim's feedback on its renders → write that stage's detailed tasks with code (TDD: failing test, implement, pass) → run the regression loop (§4) → screenshot it next to its renders → Tim reviews → stage files only (no commits by Claude).

- [x] **Stage 0: Tokens and primitives (render 0). DONE 14 Oct.** Shipped: white light palette plus fill/hairline/tint/attention tokens in both themes, guarded by `lib/constants/__tests__/contrast.test.ts` (31 pairs). Button `fill` variant and `pill`/`pill-sm` sizes, added rather than changed. `StatusBanner`, `ListSection`/`ListRow`, `RouteRail`, `SectionHeading`, `RequirementChips` (unused until their stages). Swipe sizing moved to Stage 4, where the step frame uses it. Loop: 1023 tests; tsc and lint clean; export build OK; sign-in pixel-identical (6/6); nav walk, flow walk and swipe measure all pass. Original scope:** Pure-white surface. Fill, hairline, ink and secondary tokens. Button variants: primary 56pt black pill, secondary 50pt #F3F3F3 pill, danger. Status banner component. List row (icon column, label over value, inset hairline). Route rail. Requirement chips. Swipe track sizes and the disabled "waiting" face. Unit tests per primitive. Increase Contrast and dark-mode tokens are re-derived and checked at ≥4.5:1.
- [x] **Stage 1: Sign in. DROPPED (Tim, 14 Oct).** `app/login/**`, `app/otp/**` and `components/auth/AuthFrame.tsx` are not touched. Stage 0's token change must not leak into them: the auth frame keeps its scoped `dark` class, so check the sign-in screens are pixel-identical after Stage 0.
- [x] **Stage 2: Shell, tabs and Profile — DONE 14 Oct.** Shipped:
  - A three-tab glass bar (Home / Trips / Profile). The Profile tab shows the driver's photo or initials, the selected tab is ink rather than blue, and the profile circle is gone.
  - `/profile`, with Settings merged in. Licence and vehicle tiles; Appearance and Sign-out sheets (`components/profile`); Location, Camera and Waiting-to-send rows (`usePermissionStatus`, `useOfflineQueue`). `/settings` replace-redirects to `/profile`. ProfilePanel is deleted, and its tests and the old Settings tests are ported to `ProfilePage.test`.
  - Photo stored on the phone only (`lib/profile/driver-photo`, keyed by driver id, cleared on sign-out). Photo resizing is moved to `lib/utils/image.ts` and shared with CameraCapture.
  - The Drawer is now a named modal dialog for screen readers (no pixel change; sign-in is still identical).
  - Loop results: 1075 tests; tsc and lint clean; export OK; sign-in diff 6/6; nav walk (plus the /settings redirect), flow walk and swipe measure all pass.
  - Original scope: (10.1–10.3, D1/D2/D6/D8).** Three-tab glass bar with the driver photo as the Profile tab icon. Profile screen with the merged settings. Appearance sheet. Sign-out sheet. Photo capture and storage. The home badge rule is unchanged (`tripNeedsAttention`).
- [x] **Stage 3: Home and Trips (2.1–2.4, 3.1–3.7). DONE 14 Oct.** What shipped:
  - Home: date line plus greeting, and NowCard in three states (underway, assigned, on hold). Exception rows restyled. Record tiles without the footnote. The no-trip card links to past trips.
  - Trips: a page that never scrolls (AppShell fit mode). It shows the current-trip card, then Upcoming (1–2 rows) and Past (as many rows as fit, via `useRowsThatFit`), each with "See all". The two new routes are `/trips/past` (by month, with the place/date filter that used to live on the Past tab) and `/trips/upcoming`.
  - Trip page: one view with three variants (in progress, upcoming, record). In progress shows vehicle row, banner, Progress and Route; the upcoming variant adds "What you'll record"; the record shows outcome, timeline and anchor count. The vehicle sheet, `PhaseList` (with honest anchored/anchoring/receipt-owed states) and the tab bar on trip pages (`TabSubpage`) are in.
  - Retired: PhaseProgressBar, CurrentPhaseCard, TripTable, Tabs, AnchorBadge. Their checks were ported to the new tests.
  - Not built, and why: the "Directions" pill (Trip has no destination coordinates) and the "Receipts" pill (no receipt screen exists).
  - Bug caught by measuring in the browser: the transition frame broke the flex chain, so Past showed only 1 row. AppShell now passes the height through.
  - Loop: 1103 tests, tsc and lint clean, export OK (37 pages), sign-in diff 6/6, nav walk passes (now including the See-all round trips), flow walk passes on rerun, swipe measure passes.
  - Original scope:** Greeting with the dark Now card (no on-time footnote). No-trip, upcoming and hold states. Trips root is non-scrolling: Now, plus Upcoming and Past capped to fit above the tab bar, each with "See all". The segmented `Tabs` is removed. New static routes `/trips/past` and `/trips/upcoming` hold the scrolling lists. Add them to `ROUTES` and to the back stack so back returns to `/trips`, and add them to the nav walk. Trip page: vehicle row, banner, Progress, Route, with no Load or Proof. A vehicle sheet (`Drawer side="bottom"`) shows the horse and trailers. Upcoming trip page has "What you'll record" from `STEP_NAMES`. Completed record has no Evidence section. Floating primary action above the tab bar.
- [x] **Stage 4: Step frame plus Activation and Loading (4.1–4.4). DONE 14 Oct.** What shipped:
  - **Step frame (every step).** `StepHeader`: a round back button, the phase name with "Phase n of N · Step x of y" (the step count is left out for one-step phases), a round panic button, and the 7-segment trip bar from the session plan (`useOptionalTrip`; the bar is hidden without a session). `StepLayout`: an h1 saying what to do (`lib/phase/step-titles.ts`), a lede, and a pinned glass footer with `RequirementChips` and the swipe. `showTitle={false}` is for screens that bring their own h1.
  - **Swipe.** The `waitingLabel` prop shows on the track while disabled ("Add the sheet photo first"), with a fill track and a locked grey thumb. The slider's accessible name stays the action.
  - **Camera.** A 196px fill tile with an ink camera disc, plus optional `actionLabel`/`hint` set per call site. Once captured: a "Captured" chip and a white Retake pill.
  - **4.1 Activation.** Route rail, plus "Recorded when you swipe" tiles (Location / Time / Anchored); every phase anchors, per backend `ANCHORED_PHASES`. Label: "Swipe to Start Trip". The render's "· you are here" is not shipped: the phone's position is unknown until the check runs.
  - **4.2 Location check.** `Modal` is now a floating bottom sheet: an inset rounded card, an icon disc, a title, a description, and stacked pill actions. Escape, overlay and close handling are unchanged. `LocationCheckModal` states:
    - checking (spinner);
    - could not complete (amber);
    - not compared (grey);
    - matches (green);
    - doesn't match: a facts box ("Phone to truck · n m apart" / "Allowed · n m"; precinct sentences unchanged), a fill reason field, then Continue with Exception and Retry Location.
  - **4.3 Linehaul.** Fact rows on a fill, the camera tile ("Photograph the sheet"), the "Sheet photo" chip, and the waiting swipe.
  - **4.4 Waiting.** `WarehouseWaitCard` now takes `title` and gives the screen its own h1 ("Loading in progress" / "Unloading in progress" / "Scanning in progress"). It keeps the "Waiting for the warehouse" pill, Check Now and last-checked; `WarehouseWaitAction` adds a pinned View Trip.
  - **Hold.** `HoldNotice` uses the amber StatusBanner style.
  - **Loop.**
    - 1113 tests pass; tsc and lint are clean; the export builds (37 pages).
    - Sign-in is pixel-identical (6/6).
    - Nav walk, flow walk and swipe measure all pass, on a warm rerun after one cold-compile flake each.
    - Activation, Linehaul (empty and captured), the waiting state and the location sheet were screenshotted in light and dark, using a temporary demo-trip rewind that was reverted and verified identical to HEAD.

  Original scope: new `StepHeader`: back, phase name with "Phase n of 7 · Step x of y", panic. Seven-segment trip bar. Step title and lede. Pinned footer with chips and swipe. Location-check sheet in its checking, warning (with reason) and passed states. Linehaul. Warehouse-waiting state.
- [x] **Stage 5: Departure plus the receipt moment (5.1–5.4). DONE 14 Oct.** What shipped:
  - **Input.** Now the overhaul fill field: 56pt, no border, a red ring on error. Sign-in doesn't use it.
  - **5.1/5.2 Capture seal.**
    - Large, letter-spaced seal number with the hint "Two letters, a dash, four digits."
    - The format error replaces the hint as soon as the number can't be valid, with a red ring.
    - Camera tile "Photograph the seal"; once captured, "Captured hh:mm" (the `capturedAt` prop) and Retake.
    - Swipe "Swipe to Save Seal"; while waiting, "Add number and photo" (shortened from the render: the longer copy wrapped in the 64pt track).
  - **5.3 Review (`ReviewRow`).**
    - Seal number with Edit; seal photo thumbnail plus "Captured hh:mm" with Retake. Both return to the capture step, with the draft kept.
    - "Heading to <destination> · due hh:mm", shown only with a trip session.
    - Swipe to Depart.
  - **5.4 Receipt.**
    - SwipeToConfirm gained `committedLabel`/`committedHint`: green "Departed" with "Opening In Transit…".
    - **Departure now hands off to /trip/in-transit (Tim, 14 Oct). Every other phase still goes Home.**
    - Toast restyled to the render: a white card with a tinted disc.
    - New `anchor` field. 'anchored' only when the server returned a receipt id; 'anchoring' shows an indeterminate bar (no fake percentage). Demo and queued receipts get no anchor row and say "Stored on this device".
    - Place line from `lib/phase/recorded-place.ts`: the origin or destination area when the precinct is known, else time only.
  - **Loop.**
    - 1130 tests pass; tsc and lint are clean; the export builds (37 pages).
    - Sign-in is pixel-identical (6/6).
    - Nav walk, flow walk and swipe measure all pass (nav and flow on a warm rerun).
    - A new departure walk passes in light and dark: type, photo, review, Edit round-trip, drag Depart, location check, lands on In Transit, receipt toast. It runs on a temporary demo rewind, reverted and verified identical to HEAD.

  Original scope: seal entry with the inline format check and the captured-photo tile (Retake, timestamp). Review with Edit and Retake. Green "Departed" swipe end state plus the receipt toast and anchoring bar.
- [x] **Stage 6: In Transit and Emergency (6.1–6.4, 7.1–7.3, D5). DONE 14 Oct.** What shipped:
  - **6.1 In Transit.**
    - The map is full-bleed and larger than before. It stops 1.75rem above the sheet's overlap so Google's logo and attribution stay visible.
    - Floating controls: Back, a red Panic pill and a Navigate chip. Navigate uses `lib/utils/directions.ts` (Apple Maps / Google Navigation / web; known precincts only, hidden otherwise). The map's own Open in Maps moves bottom-left via `DriverMap.handoffClassName`.
    - Sheet: "Heading to" + ETA, open exceptions (height-capped), "Swipe to Arrive", and Checkpoint / Exception pills.
  - **6.2 Checkpoint.**
    - Cargo photo only; the selfie is gone. `CheckpointEvidence.selfieDataUrl` is optional, and `submitCheckpoint` uploads and sends a selfie only if one is present, so old queued checkpoints still replay (tested).
    - Route-deviation switch row and the "Note for dispatch (optional)" field kept.
  - **6.3/6.4 Exception.**
    - The category list is now radios with icons. Once chosen it collapses to one row with Change.
    - Breakdown: a Truck/Trailer segmented control, then trailers drawn as number plates (radios).
    - Description field, then a compact photo row (`CameraCapture variant="row"`).
    - Pinned footer with chips and a "Submit Exception" pill. The label stays put; the chips say what's missing.
  - **7.1 Panic.** A white page.
    - "Your location: Finding… / Found / Not available" from one warm-up reading on open. Display only: the send path is unchanged except it now passes on its own `triggeredAt` and whether a fix went with it.
    - Trip row, a red swipe ("Swipe to Send Panic"), and Cancel.
  - **7.1b Pulse.** `SwipeToConfirm.onPressChange`, driven by isDragging, so it clears on release and on OS cancel alike. It shows a see-through, inert red vignette at 1 Hz and "Keep going. Let go to cancel."; under reduced motion, a steady tint.
  - **7.2/7.3 Sent / Saved.** Sent or Recorded hh:mm:ss, Location Attached / Not available, and Record Timestamped or Status Waiting for signal. The values come from URL params set by the panic page and are left out when absent. Then `components/trip/CallDispatch.tsx` (hidden without `NEXT_PUBLIC_SUPPORT_PHONE`) and Back to In Transit.
  - **Shared.**
    - TextArea uses the fill-field style.
    - SubpageHeader has a `titleVariant="bar"` (centred inline title).
    - Contrast pairs added: error-on/error and chain/surface.
  - **Loop.**
    - 1166 tests pass; tsc and lint are clean; the export builds (37 pages).
    - Sign-in is pixel-identical (6/6).
    - Nav walk, flow walk and swipe measure all pass (nav and flow on a warm rerun).
    - A new Stage 6 walk passes in light and dark: checkpoint logged; exception with breakdown, trailer plate and photo submitted; panic pulse on press, stops on release, a short release doesn't send, a full swipe sends with `at`/`loc`; saved state; back to In Transit.
    - Drawer's spring test failed once under parallel load and passed 3/3 alone (flake, untouched code).

  Original scope: full-bleed map under a bottom sheet (do NOT shrink the map). Panic pill and Navigate chip on the map. Checkpoint with a cargo photo only (selfie removed, see §0). Exception as a radio list that collapses to one row, the breakdown vehicle question with trailer plates drawn as number plates, and a submit button. Panic stays white, with the 1 Hz red pulse from pointer-down (§0). Then sent and saved, both with Call Dispatch.
- [x] **Stage 7: Arrival and Unloading (8.1–8.4). DONE 14 Oct.** What shipped:
  - **8.1/8.2 Seal inspect (`SealVerify`).**
    - Condition tiles with icons (Intact / Damaged / Missing). They stay in a row at normal text sizes and stack at AX sizes.
    - "Seal number you see" field with "Type what is printed. Don't copy it from paperwork."; the format error replaces the hint.
    - Missing hides the field and shows an amber "Recorded as a finding" banner, with the tile reading "Photograph the door latch".
    - One neutral label in every condition: "Swipe to Record Seal". The waiting track names the next missing thing.
    - The departure seal number is still never shown (checked in the browser walk too).
  - **8.3 Visual count.**
    - A stepper (− / big number / +). The number can also be typed.
    - "parcels unloaded", or "Not counted" when blank.
    - An "I couldn't count" pill, lit while blank. It clears to null, never zero, and − stops at a real 0.
    - The count stays blind: no reference number is shown.
    - "Swipe to Confirm Count".
  - **8.4** shipped in Stage 4 (unloading waiting).
  - **Loop.**
    - 1172 tests pass; tsc and lint are clean; the export builds (37 pages).
    - Sign-in is pixel-identical (6/6).
    - Flow walk passes through the new seal and count screens on a warm run; its photo selector was widened to the new tile names.
    - Nav walk failed on the first two runs right after a cold start (the failing check wasn't captured), then passed 3 times in a row.
    - Swipe measure passes.
    - A new Stage 7 walk passes in light and dark.
    - The count screen's dev-overlay "issues" are the known demo location-preview errors from the earlier swipes.

  Original scope: seal-condition tiles. Number field hidden when Missing. Never show the departure seal number. Visual-count stepper plus "I couldn't count" (sends `null`). Unloading-waiting state.
- [x] **Stage 8: Confirmation (9.1–9.5, D7). DONE 14 Oct.** What shipped:
  - **9.1 Delivery photo.**
    - Camera tile: "Take Photo / Whole load in frame", with the capture time once taken.
    - "Delivery photo" chip; "Swipe to Save Photo", waiting on "Add the delivery photo first".
  - **9.2 Handover QR.**
    - A white plate with an explicit width. This fixes an existing bug where the "Generating code" / "Code unavailable" placeholder collapsed to nothing in a shrink-wrapped plate.
    - A blue progress dot with "Waiting for the receiver" or "The receiver has opened the link".
    - Error and "Show a New Code" as fill pills.
  - **9.3 Receiver signed.** **D7: no signature image** (Tim: "it just says signed"). A green disc, "Receiver signed", and "Signed at hh:mm on their own device, with their own location."
  - **9.4 Reconciliation.**
    - Icon rows: "Parcels you counted" (or "Not counted"), Delivery photo, and Receiver signature. Each mark is a green/red disc named for screen readers.
    - "Swipe to Confirm All".
  - **9.5 Delivered.**
    - Green disc, "Delivered", and "Every phase is on the record. Close the trip to finish."
    - Facts from the session trip's ledger (`lib/phase/delivered-summary.ts`):
      - Route.
      - Arrived hh:mm · on time / late (no-grace rule). Hidden when the ledger has no arrival time — demo mode, since its completions are only in-memory markers.
      - Proof: "n of N anchored".
    - "Swipe to Close Trip".
  - **Not shipped: "ends on the trip record (3.4)".** Close Trip still hands off to Home. The hand-off runs before the close submission lands (Workstream 1), so the record page would fetch a still-open trip, or in demo a mock that never closes. The Delivered screen is the summary instead.
  - **Loop.**
    - 1186 tests pass; tsc and lint are clean; the export builds (37 pages).
    - Sign-in is pixel-identical (6/6).
    - Nav walk, flow walk and swipe measure all pass. The cold-start failure this time was captured: "/ → Profile landed on /", the first tab tap mid-compile.
    - A new Stage 8 walk passes in light and dark: POD → QR → (receiver signature seeded into the stored draft, test-only, since demo can't sign) → signed (no image) → reconciliation → delivered → Close Trip → Home.

  Original scope: delivery photo, QR plate, receiver signed, reconciliation rows, "Delivered" close screen that ends on the trip record (3.4).
- [x] **Stage 9: Polish pass. DONE 14 Oct.** What shipped:
  - **Audit.** A scripted audit (scratchpad `audit.cjs`) covers 25 screens: every tab, See-all lists, Profile and its sheets, trip pages, vehicle sheet, In Transit, checkpoint, exception (+ breakdown), panic (+ sent/saved), seal (+ missing), count, POD and the QR. Each screen is checked for horizontal overflow, targets under 44pt, unnamed buttons, controls pushed off-screen and clipped text. Final run: **0 findings in all 7 passes**:
    - light 393;
    - dark;
    - 320px wide;
    - 23px (largest standard size);
    - 28px (AX1);
    - 53px (AX5, capped);
    - Increase Contrast + Reduce Transparency + Reduce Motion.

    Trips does not scroll in any pass, even at 28px.
  - **Fixes from the audit.**
    - The Navigate chip was 40pt tall; now 44pt.
    - Header rows wrap at large text instead of pushing their control off-screen: SectionHeading, NowCard, SubpageHeader, and the Drawer title (whose close button stays).
    - Label/value fact rows wrap (panic, sent/saved, Delivered, Linehaul, location sheet), and grid text columns shrink (`minmax(0,1fr)`).
    - The QR plate got an explicit width (Stage 8).
    - The count stepper's controls are capped in px.
  - **Large text.**
    - `useAccessibilityTextSize` (root ≥ 28px) un-pins the step, Checkpoint and Exception footers. Pinned, they covered more than half the screen.
    - The swipe label uses the space right of the thumb.
    - In Transit stacks Checkpoint and Exception, and moves Navigate into the sheet.
    - Trips may scroll when content can't fit; `TAB_BAR_SPACER` sits at the page end.
  - **Text-size cap (decision for Tim).** `TextSizeCap` holds the root at **28px (AX1)**.
    - Above that, the rem-based spacing, icons and tiles grow with the text. At 33px the In Transit map collapses and paired controls overflow, and 40px was worse.
    - The cap follows UIKit's `maximumContentSizeCategory`.
    - Raising it needs the spacing system moved to px with text alone in rem. That is a refactor, not polish.
  - **Loop.**
    - 1194 tests pass; tsc and lint are clean; a clean export build succeeds (the theme script is intact in `out/index.html`).
    - Sign-in is pixel-identical (6/6).
    - Nav walk, flow walk and swipe measure all pass (the usual first-tap-while-compiling failure on run 1).
    - The Stage 6, 7 and 8 walks were re-run and pass.
  - **Device.** `cap sync ios` was run (no tracked iOS files changed) and a signed Debug build succeeded (`xcodebuild -allowProvisioningUpdates`, generic iOS). Installed on Tim's iPhone 13 and launched (14 Oct), after the phone finished preparing. `pod install` inside `cap sync` needs `LANG=en_US.UTF-8` in this shell. Tim's on-device check is still to come.

  Original scope: dark mode for every screen. Reduced motion, transparency and contrast. Dynamic Type at the largest size. 320px width. Device run on Tim's iPhone after `cap sync`.

## 4. Regression loop (run at the end of every stage — all must pass before moving on)

Run from `frontend/driver-pwa` with Node 22 (`nvm use 22`).

1. **Unit and component tests:** `npx vitest run`. Expected: all pass. The baseline on 2026-10-14 is 965 tests in 101 files. Tests that assert old copy or classes are updated in the same task, never deleted to go green.
2. **Types and lint:** `npx tsc --noEmit` and `npx next lint`, both with zero errors.
3. **Static export build:** `rm -rf .next out && npx next build`. Expected: export succeeds (Capacitor needs `out/`).
4. **Navigation walk (real Chrome, demo mode on port 3011):** run the scratchpad `nav-walk.cjs`. It asserts:
   - Every tab reaches its root from every other tab.
   - Every back control lands on the screen it says it does (its accessible name).
   - A cold start on each route (`/`, `/trips`, `/trips/active`, `/trips/detail?id=…`, `/trip/in-transit`, its checkpoint and exception sub-routes, `/trip/panic`, `/profile`) backs out to a tab root within 3 presses, with no URL repeating. This is the Oct 14 loop guard.
   - The edge-swipe back still works where a back control registers.
   - Phase-step URLs still redirect to the current step.
5. **Flow walk:** run a demo trip from Start Trip to Close Trip. Every swipe commits once (and `onPointerCancel` does not commit). Every phase produces its receipt. The Home badge appears and clears on hold.
6. **Swipe geometry:** use the `measure.cjs` pattern. Every swipe track must be wider than 0 and fill its footer (the Oct 12 checkpoint 0px bug).
7. **Visual check:** screenshot each changed screen at 393×852 in light and dark, then compare against its artboard.
8. **Accessibility:** targets ≥44pt, a label on every icon-only button, contrast figures from tokens, and no meaning carried by colour alone.

A stage that fails any step is not done. Fix it, then rerun the whole loop.

## 5. Out of scope

Backend and API changes (unless D1(b) is chosen, which then needs its own migration plan per CLAUDE.md), the dispatcher portal, `frontend/shared/`, new npm dependencies, and the app icon PNG (tracked separately).
