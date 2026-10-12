# Driver PWA — design audit (iOS demo readiness)

**Date:** 2026-10-12 · **Owner:** Tim · **Surface:** `frontend/driver-pwa` · **Status:** audit complete, fixes not started

Lenses used: the `apple-design` skill (Apple HIG, 123 pages, cited as `file.md › Heading`) and the
`emil-apple-design` skill (fluid motion, materials, typography from WWDC talks). The improvement
pass will add `impeccable`. This document is the working list for that pass: we go through it
step by step and settle the open design questions at the bottom first.

---

## 1. How this was audited, and what it can't see

- Ran the app in demo mode (`NEXT_PUBLIC_DEMO_MODE=true`, fixture trip TRP-2026-0041, phase 4
  *In Transit*) and screenshotted every reachable screen at **iPhone 15 Pro size (393×852 @2x)**
  in **light and dark**, through the real login → OTP flow.
- Read the shell, tokens, and every shared UI component; computed contrast from the actual
  `--fp-*` channel values in `app/globals.css`.
- **Limits.** The browser was desktop Chrome with an iPhone viewport and UA, not WKWebView, so:
  no real safe-area insets (the 20px `.pb-safe` fallback was used), no status-bar rendering, no
  haptics, no keyboard. The phase-step gate redirects every step URL to the trip's current step,
  so only **Arrival › Inspect Seal** was rendered; the other steps were reviewed from code. Device
  checks needed on a real iPhone are listed in §9.

## 2. Summary

**Rating: Critical issues.** The underlying engineering is careful. The token system swaps
light and dark cleanly, touch targets mostly meet 44pt, safe-area handling is real, and
there are good accessibility fallbacks such as tap-to-confirm. The visual layer on top of it is
unfinished, and on an iPhone it reads as an Android/Material web form:

- ALL-CAPS bold buttons everywhere
- black "← Back" pills
- an icon-only nav
- web-table phase lists
- a right-side drawer
- duplicated titles

Two of the most important controls are effectively invisible: the **panic swipe track** and the
**settings switch**. Nothing in the app moves or feels physical. There is no spring, no haptic,
and no transition between screens.

**Thesis the app should have:** *one clear next action, and proof that it was recorded.* Every
screen should answer "what do I do now?" in one glance, and every confirm should land with an
unmistakable "recorded" moment. Today there is no signature moment. The swipe-to-confirm is the
closest candidate and the obvious place to spend the boldness (see §6).

---

## 3. Critical — fix before any demo

### C1. Panic swipe track is invisible on the panic screen
- **What:** `/trip/panic` paints the page `bg-error` and renders `SwipeToConfirm variant="danger"`,
  whose track is also `bg-error`. Track contrast against the page is **1.0:1**. The driver sees a
  white circle floating beside the words "SEND PANIC", with no visible rail to drag along. This is
  the single most safety-critical control in the product.
- **Why:** `accessibility.md`: "there's enough contrast between foreground text and icons and
  background colors"; `toggles.md › Best practices`: "Make sure the visual differences … are obvious."
- **Fix:** give the danger track on a red page its own surface: a darker red container
  (`error-on-container`-ish tone) or a translucent white rail (`bg-error-on/15`) with an inner
  border. Add a resting "nudge" hint (the thumb moves 8px right and springs back once on mount).
  Files: `components/phase/SwipeToConfirm.tsx`, `app/(app)/trip/panic/PanicPageClient.tsx`.

### C2. Settings switch "off" state is invisible (both themes)
- **What:** `components/ui/Switch.tsx` paints the off track `bg-muted`. That is `#f6f3f4` light,
  the same as the `Card variant="section"` behind it (`#f6f3f4`): **1.0:1**. The white thumb
  against it is **1.1:1**. Dark mode is identical (track `#212126` on card `#212126`). In the
  screenshot the toggle appears as a stray white dot.
- **Why:** `toggles.md › Best practices`: "Be sure to use a color that provides enough contrast
  with the uncolored appearance to be perceptible."
- **Fix:** off track `surface-container-highest` (or a 1px `outline` ring), iOS proportions
  (51×31 track, 27pt thumb), on = `success` green or the accent.

### C3. No Dynamic Type, and pinch-zoom is locked
- **What:** all type is fixed `rem`/`px` against a fixed root, so the iOS text-size setting does
  nothing. `app/layout.tsx` also sets `maximumScale: 1, userScalable: false`. There are 16
  `text-[10px]`/`text-[11px]` uses. In the product UI these include the phase-table header,
  the trips tab counters, and the `SubpageHeader` reference caption.
- **Why:** `accessibility.md › Vision`: "give people the option to enlarge text by at least 200
  percent"; `typography.md`: iOS default 17pt, minimum 11pt.
- **Fix:** in WKWebView, setting `html { font: -apple-system-body }` makes `1rem` track the
  user's Dynamic Type size. Scale everything in `rem` from there, raise the 10px labels to
  ≥ 12px, and test at the largest accessibility size. Decision needed on zoom lock (Q7).

### C4. "Required" helper sits on the wrong field (Log Exception)
- **What:** the description `TextArea`'s `helperText="Required"` renders below the field, directly
  above the next label "Photo (optional)". It reads as *"Required / Photo (optional)"*: the
  screen contradicts itself.
- **Why:** proximity implies relationship (emil § Grouping & mapping). `writing.md › Best
  practices`: "Give clear guidance."
- **Fix:** put "Required" in the field label ("Description · required") and add spacing between
  groups. File: `app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx:383`.

---

## 4. High — what makes it look rushed on an iPhone

### H1. ALL-CAPS, wide-tracked bold labels on every button, chip and section label
- **What:** 26 `uppercase` uses. Every `Button` is `font-bold uppercase tracking-wider`, as are
  every chip, the segmented trip tabs, the swipe labels ("SWIPE TO SUBMIT"), and the ghost links
  ("WRONG NUMBER? GO BACK"). This is the Material button voice, and the most iOS-foreign thing on
  screen.
- **Why:** `buttons.md › Content`: use "title-style capitalization"; `writing.md`: "Adopt
  capitalization rules … then apply them consistently." Labels currently mix three conventions on
  one screen ("SEAL CONDITION" / "Seal photo" / "Tap to photograph").
- **Fix:** title-style labels at 17pt semibold ("Send Code", "Arrive at Destination"). Keep caps
  only where they encode something, e.g. plate numbers and trip references. Decision: Q3.

### H2. Bottom nav: icon-only pill, an opaque slab, and a red dot that means "you have a trip"
- **What:** `BottomNav` is three unlabeled icons in an opaque white pill with `shadow-lg`, plus a
  separate avatar circle. The red dot on Trips means "a trip is assigned", which is the normal
  state, not an alert. The concept matches the iOS 26 floating tab bar; the execution does not.
- **Why:** `tab-bars.md › Best practices`: "Include tab labels to help with navigation … Use
  single words"; "Prefer filled symbols"; "Reserve badges for critical information so you don't
  dilute their impact."
- **Fix:** keep the floating pill and add labels under the icons, with filled icons for the
  selected tab. Use a translucent material (`backdrop-filter: blur(20px) saturate(180%)`) so
  content scrolls under it rather than stopping 112px above it. Drop the red dot or reserve it
  for open exceptions or a hold. Decision: Q2.

### H3. Back navigation is a black pill with a text-glyph arrow
- **What:** `SubpageHeader` renders a filled black `rounded-xl` button "← My Trips" (dark mode: a
  pale grey slab). `StepHeader` uses a bare `←` character in blue. These are two back styles, and
  neither is iOS.
- **Why:** `designing-for-ios.md`: people expect to "swipe to navigate back"; Familiarity
  principle: "things that look the same must behave the same and live in the same place."
- **Fix:** one back affordance everywhere: `ChevronLeft` (lucide) plus the previous screen's
  title in the accent tint, no fill, top-leading, in a 44pt hit area. Edge-swipe-back is a stretch
  goal (Q8).

### H4. Duplicate and competing titles
- **What:** the shell header says "Trips" and the page below says "My Trips"; "Settings" appears
  twice, stacked. The shell header is 14px bold, smaller than the body text under it.
- **Why:** `layout.md › Best practices`: "Order content by relative importance"; Simplicity:
  "every element earns its place."
- **Fix:** iOS large-title pattern. One 34pt bold title in the content that collapses into a 17pt
  semibold inline title in a translucent bar on scroll. Remove the page `<h1>` duplicates.

### H5. The phase list is a web table, and it says "Stop 0"
- **What:** `PhaseProgressBar` is a bordered table with a `PHASE | STATUS` header row (10px caps),
  and every row repeats "DONE" or "PENDING" as text even though the circle already says it.
  Origin-stop phases render as "Stop 0". "PENDING" is `on-variant/60` on white at 10px bold,
  **≈ 3.2:1**, below 4.5:1.
- **Why:** `lists-and-tables` conventions (inset grouped list, no column headers on iOS);
  `color.md`: don't let one cue repeat another; Craft.
- **Fix:** inset-grouped list (or a vertical timeline). Use the state glyph only, with the status
  word reserved for *current* and *exception*. Replace "Stop 0" with the place name
  ("Linbro Park DC"), or hide it when there is a single origin. Note: `PHASE_NAMES` lives in
  `@shared`, which is read-only for driver work, so label overrides stay local.

### H6. Home and "Active trip" are the same screen
- **What:** `/` and `/trips/active` render the same reference, chip, 8-row phase table and
  "Continue driving" button. The active detail adds a boxed "TRIP REFERENCE" block with a 2px
  black border and an outlined order-number pill.
- **Why:** Purpose: "What is this screen for?" Two screens with one job dilute both.
- **Fix:** make Home the **"Now" screen**: one hero card with the current phase, where to go, and
  the one action. Move the full phase history to trip detail. Decision: Q4.

### H7. In-transit hub: panic below the fold, and four competing actions
- **What:** at 852pt tall, the Panic button is cut off at the bottom and needs a scroll. The
  screen stacks a 360pt map, an exception card, the swipe ("ARRIVE AT DESTINATION"), two outline
  buttons and the Panic button. In dark mode the Google map stays light, a glare panel in a dark
  cab. The dispatcher note is truncated with no way to read the rest.
- **Why:** `designing-for-ios.md`: important controls "in the middle or bottom area"; Simplicity:
  "show the common path first."
- **Fix:** shrink the map to a glanceable strip (or put it behind a tap), and pin
  {Arrive swipe, Panic} in a bottom action area that respects the safe area. Checkpoint and
  Exception become a secondary row or a sheet. Pass a dark `styles` array or a dark `mapId` to the
  Maps JS API when `.dark` is active. Make the note expandable.

### H8. Disabled state is a grey slab, and it doesn't say what's missing
- **What:** disabled is `opacity-40`, so "SEND OTP", "VERIFY", "SUBMIT EXCEPTION" and "SWIPE TO
  SUBMIT" all become flat grey bars (white on ink@40%: **2.6:1**). The disabled swipe looks broken
  rather than waiting, and nothing tells the driver which field is outstanding.
- **Why:** `feedback.md`/`writing.md`: errors and blockers "say what went wrong and how to fix
  it"; emil § Feedback: "validate inline, not on submit."
- **Fix:** keep the control at full shape with reduced emphasis, and add a one-line hint above it
  ("Choose the seal condition to continue"). Better still, show a step checklist that ticks off.

### H9. Profile is an Android side drawer
- **What:** `ProfilePanel` slides in from the right as a 320pt panel. The scrim appears and
  disappears with no fade on close, and there is no drag to dismiss. "LOG OUT" is a pink caps
  button.
- **Why:** `sheets.md › Best practices`: "Support swiping to dismiss a sheet"; "Include a grabber
  in a resizable sheet"; consider "the medium detent."
- **Fix:** a bottom sheet (medium detent) with a grabber, drag-to-dismiss with velocity
  projection, and a spring. Log Out becomes a plain destructive row ("Log Out" in red, title style).

### H10. Login and OTP have no product presence, and use jargon
- **What:** the login screen is a centered "FreightProof Driver" in Inter 24px semibold, a caps
  label, and "SEND OTP", with no mark, color or hint of what the app is for. The OTP screen says
  "Enter OTP", with two all-caps blue ghost buttons underneath.
- **Why:** `writing.md`: "avoiding jargon"; this is the first frame of every demo.
- **Fix:** add a brand moment (logo mark + one line, "Proof of every handover"). Rename to "Send
  Code" / "Enter the 6-digit code" / "Resend Code" / "Use a Different Number". Use sentence
  hierarchy, not caps. Decision: Q5.

### H11. Inter instead of the system font
- **What:** `next/font` loads Inter 400–900 for every family token (`sans`, `mono`, `display`, …).
  On iOS this replaces SF Pro, losing its optical sizing, tracking tables and Dynamic Type
  metrics, and costs a font download. `mono` maps to Inter too, so references such as
  "TRP-2026-0041" get no tabular or mono treatment.
- **Why:** `typography.md › Using system fonts`; emil §15: "Default to the platform's system font
  before a custom face."
- **Fix:** `font-family: system-ui, -apple-system, …` (SF on iOS, Roboto on Android). Reserve any
  brand face for display moments only, and use `ui-monospace` with `tabular-nums` for identifiers.
  Decision: Q1.

---

## 5. Medium

| # | Finding | Fix |
|---|---|---|
| M1 | Sticky `hover:` styles on touch. Cards, nav and buttons all use `hover:`; on iOS a tap leaves the hover tint stuck. | `future: { hoverOnlyWhenSupported: true }` in `tailwind.config.ts`, plus explicit `active:` press states. |
| M2 | No press feedback on cards or rows (only `hover`). | `active:scale-[0.98]` or a tint on pointer-down (emil §1). |
| M3 | Step progress bar shows **100% on 1/1** for single-step phases, so it reads as "done" before anything is done. | Show phase-level progress (step *n* of the trip), or hide the bar when total = 1. |
| M4 | Trip list truncates the **time**: "Sat, 09 May, 10:…". The one datum a driver needs is cut. | Two lines (route / time); never truncate the time. |
| M5 | Native web checkbox ("This is a route deviation") on Checkpoint looks foreign on iOS. | Switch row inside an inset group. |
| M6 | Support card shows the placeholder "+27 00 000 0000" and the number isn't tappable. | Real demo number, `tel:` and `mailto:` rows with chevrons. |
| M7 | Settings uses padded grey cards per section, not iOS inset-grouped rows. | Inset grouped list: section header in small caps-free footnote style, rows 44pt+, footers for explanations. |
| M8 | App-level theme switch (System/Light/Dark). HIG says avoid; there's a real daylight-glare reason to keep it. | Decision: Q6. |
| M9 | Dispatcher-note and hold cards use a **4px red left stripe** (`border-l-4`), a template tell. | Full tinted container + icon, or an inset row with an SF-style symbol. |
| M10 | Shadows on primary buttons (`shadow-ambient`) and many cards: 15 + 13 uses of two soft shadows. | Flat fills for controls; reserve elevation for floating layers (nav, sheets, toasts). |
| M11 | `PENDING` labels, placeholders (`on-variant/50`: **2.5:1**) and the panic **Cancel** (`error-on/70` on red: **3.8:1**, caps 14px) sit under the 4.5:1 target. | Raise to full-strength on-variant; Cancel → solid white text, 17pt. |
| M12 | No `prefers-reduced-transparency` / `prefers-contrast` answers. Only reduced motion is handled, as a global kill switch. | Add both media queries to `.glass-nav` and future materials. |
| M13 | Profile stats ("1 Trips completed / 3 Total trips") come from `mockTrips` even outside demo mode (`ProfilePanel.tsx` TODO). Wrong numbers on a real demo. | Functional fix, noted here because it is visible. |

## 6. Motion and feel (emil-apple-design lens)

Today the app is static. Every screen change is a hard cut, nothing responds on pointer-down,
and no haptics are wired, although the Capacitor shell makes them cheap.

| Area | Now | Target |
|---|---|---|
| **Swipe-to-confirm** (the signature candidate) | Follows the finger 1:1 (good). On release it snaps back with a 180ms CSS `transition-transform`: no spring, no velocity, no rubber-band at the end. Confirm is a label swap to "Confirmed". | Spring back with release velocity (damping 1.0, response ~0.35s). Rubber-band past the end. A **haptic tick at the threshold** and a **success haptic on commit**. The thumb morphs to a check, and a "Recorded · Anchoring…" receipt appears. One orchestrated moment, used at every phase confirm. |
| Screen transitions | Hard cuts on every route change. | iOS push and pop: in from the trailing edge, out the same way (spatial consistency, emil §7). The View Transitions API (Safari 18+) can do this without a library. Cross-fade under reduced motion. |
| Sheets and drawers | CSS translate, not interruptible, no drag; the scrim pops. | Drag-to-dismiss with velocity projection (`project(v)`, emil §6), damping 0.8 spring on flick, scrim fades both ways. |
| Press feedback | Buttons use `active:scale-[0.98]` with `transition-all 200ms`; cards and rows have none. | Scale/tint on pointer-down for everything tappable, `transform`-only transitions. |
| Haptics | None. | `@capacitor/haptics`: light impact on selection (seal condition, exception reason), success on confirm, warning on exception or hold, heavy on panic send. **New dependency, so `package.json` is a shared file; coordinate first.** |
| Live indicators | `radar-pulse` 1.2s infinite on the ACTIVE chip, plus `animate-pulse` dots. | Keep one live indicator, not several; slow loops near 0.2Hz are a vestibular trigger (emil §14). |
| Materials | `.glass-nav` (blur 12px, 80% surface) on `SubpageHeader` only; the bottom nav is opaque. | One material for floating chrome (nav pill, inline title bar, sheets): blur 20px + saturate 180%, a bright top hairline, and solid fallbacks under reduced transparency. |
| Type rhythm | One tracking value (`tracking-wider` caps) at every size; no negative tracking on large text. | Large titles at −0.02em, body at 0, footnotes at +0.01em (emil §15). |

## 7. What works — keep these

- **Token architecture** (`--fp-*` channels with `rgb(var() / <alpha-value>)`): the theme swaps
  under every class, and opacity modifiers survive. This is the right foundation; the redesign
  changes values and components, not the plumbing.
- **Pre-paint theme script** (no white flash at 3am) and the dark-ramp reasoning (cards lift, not
  sink).
- **44pt hit areas** padded without growing visuals (Switch, Modal close, Toast close).
- **Safe-area discipline**: `pt-safe`/`pb-safe`, `viewportFit: cover`, `h-dvh` shell, and the
  sticky-header overflow fix.
- **SwipeToConfirm engineering**: pointer capture, a 0.9 threshold, a re-entry guard, a
  tap-to-confirm alternative, a keyboard path, and honest ARIA.
- **Top-anchored toasts** away from the thumb zone; error toasts don't auto-dismiss.
- **OTP**: `autocomplete="one-time-code"` on the first box, auto-submit on the 6th digit,
  `inputMode="numeric"`, 16px inputs to stop iOS zoom-on-focus.
- **Copy honesty**: panic "queued vs sent", hold notice outranks driving, "Continue driving"
  instead of offering an evidence step at 100 km/h. This is good product thinking; the visual
  layer just doesn't express it yet.
- **Seal-condition choices** do have a filled selected state and `aria-checked`.

## 8. Screen-by-screen notes

| Screen | Biggest issue | Second |
|---|---|---|
| Login | No brand or purpose; caps "SEND OTP" | Disabled grey slab |
| OTP | "Enter OTP" jargon | Two caps ghost buttons shouting |
| Home | Same as Active Trip (H6); web table (H5) | "Stop 0" |
| Trips | Duplicate title (H4); caps segmented tabs | Truncated time (M4) |
| Active trip | Black back pill + boxed reference block (H3) | Duplicate of Home |
| In transit | Panic below fold, 4 competing actions (H7) | Light map in dark mode |
| Checkpoint | Two identical dashed boxes, no hierarchy | Web checkbox (M5); "Optional" floating under the note |
| Log exception | "Required / Photo (optional)" (C4) | Reasons list has no grouping or icons |
| Phase step (Inspect Seal) | Mixed label conventions; disabled swipe looks broken (H8) | 100% progress on 1/1 (M3) |
| Panic | Invisible swipe track (C1) | Low-contrast Cancel (M11) |
| Panic sent | "RETURN TO IN-TRANSIT" (caps + internal jargon) | Fine otherwise; calm |
| Settings | Invisible switch (C2); duplicate title | Placeholder support number (M6) |
| Profile | Android side drawer (H9) | Stats from mock data (M13) |

## 9. Needs a real iPhone (can't verify in Chrome)

1. Status bar: `UIViewControllerBasedStatusBarAppearance = true` in `ios/App/App/Info.plist`, no
   `@capacitor/status-bar` plugin, plus `statusBarStyle: 'black'` metadata (PWA only). Does the
   status-bar text stay legible over the light surface?
2. Home-indicator clearance for the bottom nav and swipe on Face ID devices (real
   `safe-area-inset-bottom` = 34pt rather than the 20px fallback).
3. Keyboard: does the centered login form get covered or pushed?
4. Whether WKWebView honors `userScalable: false`.
5. Swipe-to-confirm vs the system edge-swipe-back gesture conflict (if we add edge-back).

---

## 10. Proposed sequence (one step per session)

Each step: decide → build with `impeccable` → screenshot before/after at 393pt light + dark → move on.

1. **Foundations.** Answer Q1–Q3 and Q6–Q7, then retune tokens: system font, type scale in `rem`
   with Dynamic Type, title-style labels, hover-only-when-supported, material token, contrast
   fixes (C2, C3, M11).
2. **Shell and navigation**: labelled glass tab pill, large-title header, one back style (H2, H3,
   H4, M1, M2).
3. **The confirm moment**: SwipeToConfirm rebuilt as the signature, covering spring, threshold
   haptic, the "recorded" receipt, and the panic variant (C1, §6).
4. **Home = Now screen**: hero current-phase card, phase list rework (H5, H6).
5. **In transit**: bottom action area, map strip, dark map (H7).
6. **Evidence steps**: one step template for all 10 steps, inline "what's missing" hints, camera
   capture tiles (C4, H8, M3, M5).
7. **Panic**, **Login/OTP**, **Settings/Profile sheet** (H9, H10, M6, M7).
8. **Polish**: transitions, reduced-motion/transparency/contrast passes, real-device check (§9).

Constraints to respect throughout: `frontend/shared/` is read-only for driver work; new
dependencies (`@capacitor/haptics`, any spring library) touch `package.json`, which is a shared
file; all pages stay `"use client"` (`output: 'export'`).

## Progress log

### Step 1: Foundations (done 2026-10-12, staged, not committed)

Decisions: **Q1** system font · **Q3** title-style labels, caps only for identifiers ·
**Q6** keep the in-app theme switch · **Q7** Dynamic Type + keep the zoom lock.

- System font stack (`system-ui` → SF Pro on iOS); `next/font` Inter removed; `font-mono` is now
  a real monospace stack (it used to alias Inter).
- iOS text-style roles `text-large-title … text-caption` in `lib/constants/type-scale.ts`,
  registered with both Tailwind and tailwind-merge. Without the tailwind-merge registration
  `text-body` deleted the colour class beside it: a black label on the black primary button.
  `lib/__tests__/utils.test.ts` guards this.
- Dynamic Type: `html { font: -apple-system-body }` on touch WebKit only, so 1rem follows the
  iOS Text Size setting (C3).
- Label voice: every `uppercase tracking-wider` is gone; buttons, chips and tabs are semibold and
  title-style; field and section labels use the grey footnote-semibold style (H1). 27 label
  strings were title-cased, and the tests that match them exactly were updated.
- Contrast: Switch rebuilt to iOS proportions with a visible off track and a white thumb in both
  themes (C2). Placeholders and upcoming/pending labels moved to on-variant/80 (≥ 4.5:1). Panic
  Cancel is full-strength (M11). Tiny 10px text raised to Caption (C3).
- `hoverOnlyWhenSupported`, so tap no longer latches hover tints on iOS (M1).
- `.glass-nav` material: blur 20 + saturate 180, with Reduce Transparency and Increase Contrast
  fallbacks (M12).

Verified: tsc clean, eslint clean (one existing warning), vitest 832/832. Chrome at 393pt in
light and dark, with the root forced to 17px (iOS default), 23px (xxxL) and 28px (AX1). This is
not real WKWebView, because no iOS Simulator runtime is installed.

**New follow-ups found in step 1, for later steps:**
- At AX1 the `StepHeader` title truncates ("Inspe…") next to "1/1" and the panic icon. Fix in
  step 2 (header).
- At AX1 the seal-condition options overflow their thirds ("Damaged"). Stack vertically at large
  sizes in step 6.
- At xxxL the in-transit secondary buttons wrap to two lines and the Checkpoint icon drops. Fix in
  step 5.
- `frontend/DESIGN_SYSTEM.md` still says "Inter, one family, mono not used". The driver PWA now
  diverges on purpose (iOS). That file is shared, so raise it with the team; don't edit it
  unilaterally.

### Step 2: Shell and navigation (done 2026-10-12, staged, not committed)

Decisions: **Q2a** floating pill with labels · **Q2b** Profile stays a separate circle (the
sheet comes in step 7) · **Q2c** badge only for problems · **Q2d** large title that collapses on
scroll.

- **Tab pill** (`BottomNav`): one-word labels under every icon. The selected tab gets the accent
  tint, a capsule and a heavier stroke. Pill and Profile circle use the `.glass-nav` material,
  and content scrolls underneath. Sizes stay in px on purpose, because iOS tab bars don't follow
  Dynamic Type. The press dips at pointer-down (H2).
- **Badge**: `lib/utils/trip-attention.ts`. The badge shows only on an exception hold or an open
  driver-visible exception. The open-exception filter is now shared with the in-transit screen
  instead of duplicated.
- **Large titles** (`AppShell`): one 34pt title per tab, matching the tab label. It collapses into
  a centred 17pt title on a glass bar with a hairline once its midline scrolls under the bar.
  The "Trips/My Trips" and "Settings/Settings" duplicates are gone (H4).
- **One back style**: a tinted `ChevronLeft` plus the destination name, with no fill, in both
  `SubpageHeader` and `StepHeader` (H3). Trip references are a monospace, tabular heading. The
  boxed reference block and the "Trip reference" caption above the heading are gone; the caption
  remains for screen readers. The order number is quiet footnote metadata.
- **StepHeader**: the step counter moved onto the phase line, so the step name wraps on words at
  AX sizes instead of showing "Inspe…" (step-1 follow-up closed).
- **Press feedback**: interactive `Card`s scale on press (M2).

Verified: tsc clean, eslint clean (one existing warning), vitest 845/845 (new: AppShell,
trip-attention, nav and header regressions). Screenshots at rest, scrolled, dark and AX1
(Chrome at 393pt).

### Step 3: The confirm moment (done 2026-10-12, staged, not committed)

Decisions: **Q9** the swipe is the signature moment · **Q8** swipe physics now, screen
transitions in step 8 · **haptics** add `@capacitor/haptics` now · **C1** deep red panic rail.

- **Spring physics** (`lib/motion/spring.ts`, hand-rolled, no animation library): Apple's
  response/damping spring, momentum projection and rubber-band. On release the thumb springs
  from where it is, carrying the finger's velocity. It can be caught mid-spring. Past the ends
  it gives up to 10px instead of hard-stopping.
- **Commit rule**: at least 90% of the track, or a deliberate flick (past halfway and projected
  past the end). A fast twitch near the start can never confirm.
- **The moment**: the track fills success green, the thumb becomes a ✓, and the label reads
  **"Confirmed"**, with a success haptic on the same frame. It holds `CONFIRM_DISPATCH_MS`
  (600ms) before handing off. A light haptic ticks when the drag crosses the commit point.
- **Honesty call (deviation from the Q9 wording)**: the track says "Confirmed", not "Recorded".
  Most steps hand off to a background submitter that can still fail or queue offline, so
  "Recorded" at swipe time would be an unproven claim. "Recorded" lives on the receipt toast,
  which appears only once submission resolves.
- **Receipt toast bug fixed**: it read "Saved . Evidence recorded…", because the save time was
  computed and never inserted. It now reads "Saved 14:32. …".
- **Panic (C1)**: the danger rail is a recessed slot cut into the red page (darkened red in
  light, deep red in dark) and is visible in both themes. The panic swipe skips the hold
  (`PANIC_DISPATCH_MS` 180ms) and uses a heavy haptic.
- **Haptics** (`lib/haptics.ts`): three named moments (threshold, confirm, panic). Each call is
  fire-and-forget and warns once if the native side is missing.

**Shared-file change: `frontend/driver-pwa/package.json` + lock** add `@capacitor/haptics@^6.0.3`.
Tell the team before merging. Haptics only fire on device after `npm run cap:sync:ios` / `cap:sync`.
Until then the wrapper no-ops with one console warning.

Verified: tsc clean, eslint clean (one existing warning), vitest 857/857 (new: spring physics,
flick and twitch, threshold tick, rubber-band, panic timing, ✓ state). A scripted real drag was
captured at rest, mid-drag, past the threshold and committed, in light and dark, plus the panic
rail in both themes. Haptics are not verifiable in a browser; check them on an iPhone after cap sync.

### Step 4: Home is the Now screen (done 2026-10-12, staged, not committed)

Decisions: **Q4** Now card, with the phase list moved to trip detail · **phase list** vertical
timeline.

- **`NowCard`** (Home): trip reference (mono) and status. The current phase is in Title 1, with
  where it happens (or "To Destination · ETA 19:30" while driving). A segmented strip and
  "Phase 4 of 7" show progress. There is one action: Start {Phase}, Continue Driving, or the
  hold notice. "View Trip ›" leads to the full plan. Home is no longer a copy of trip detail
  (H6).
- **Timeline** (`PhaseProgressBar`): dots joined by a rail that is solid where the trip has been.
  The current dot has an accent ring. Status words appear only for "Current" and "Issue"; the
  Done/Pending column and the PHASE/STATUS header strip are gone (H5).
- **Stop labels** (`lib/phase/stop-label.ts`): stops are named by position (Origin, Stop 2…,
  Destination) instead of the raw 0-based "Stop 0". An in_transit leg reads "To Destination"
  rather than the stop it departed. Names come from position because the full Trip carries
  only precinct ids, and a name lookup would print a UUID fragment on real trips.
- **One count everywhere**: Home and the timeline both count the driver's phases (trip_creation
  excluded), so "Phase 4 of 7" matches the "4" on the dot.

Verified: tsc clean, eslint clean (one existing warning), vitest 872/872 (new: NowCard,
stopLabel/phaseLocation, the card's no-"Stop 0" regression). Screenshots in light, dark and AX1.

### Step 5: In Transit hub (done 2026-10-12, staged, not committed)

Decisions: **map** keeps the original layout, taking all spare height between the header and
the action stack (Tim tried a fixed strip and an edge-to-edge map, and preferred the original) ·
**actions** are Arrive swipe, then two tiles, then full-width Panic.

- **Map overlays**: an "ETA 19:30" glass chip top-right replaces the separate "Planned arrival"
  row. An "Open in Maps" glass chip top-left hands off to the phone's map app. It sits top-left
  because Google's logo and attribution must stay visible in the bottom corners.
- **Dark map**: the basemap follows the app theme (`MAP_STYLES_DARK` in `lib/tokens.ts`, the
  file the raw-hex lint rule exempts). It restyles live when `<html>` flips theme, including the
  automatic switch at sunset. It was a bright white panel at night (H7).
- **Fallback cards** size separately from the map (`fallbackClassName`), so the no-fix and
  coordinates cards scroll inside the map's slot rather than spilling over the actions.
- **Exception card**: a tinted `error-container` card with an icon and a ↓ chevron that rotates
  on expand, replacing the 4px red left stripe (M9). The note was already expandable but gave no
  sign of it. `Card variant="exception"` dropped the stripe too.
- **Action tiles**: Checkpoint and Log Exception are icon-over-label tiles, ranked below the
  swipe. At large sizes the label stacks inside the tile instead of overflowing the row.
- **Invariant kept**: Panic is never inside a scrolling region. A test now walks Panic's
  ancestors to enforce it.

Verified: tsc clean, eslint clean (one existing warning), vitest 879/879 (new: dark basemap,
live restyle, map handoff, fallback sizing, exception affordance, Panic-not-scrollable).
Screenshots in light, dark and xxxL.

### Step 6: Evidence steps (done 2026-10-12, staged, not committed)

Decisions: **H8** a live checklist of what's needed · **footer** pinned glass footer.

- **`StepLayout`** (`components/phase/StepLayout.tsx`): one frame for all ten phase steps, with
  the StepHeader, a one-line intro, the step content, and a pinned glass footer holding the
  checklist and the swipe. Steps declare `requirements` such as `{ label: 'Seal photo', met }`.
  The footer ticks each one as it is met, with "Done:" and "Still needed:" for screen readers.
  Blocked and waiting states render no footer at all.
- **Waiting, not broken (H8)**: a disabled swipe and a disabled Button no longer fade to 40%
  (2.6:1). They use a full-strength muted look with a legible label, defined per Button variant.
- **Segmented step progress (M3)**: done steps solid, the current step tinted. A one-step phase
  is no longer shown as already complete.
- **C4**: the "Required" helper is gone from Log Exception. The same checklist (What happened ·
  Which vehicle · Description) sits beside Submit.
- **M5**: Checkpoint's 16px web checkbox is now an iOS switch row. "Optional" appears once, in
  the label, instead of three times.
- **Seal options at AX sizes**: `auto-fit, minmax(6.5rem, 1fr)`, so the three choices stack once
  "Damaged" no longer fits a third of the width.
- **Camera tile**: a tappable tile (accent camera, "Take Photo") replaces the dashed drop zone.
  The review cards (EvidenceReview, Reconciliation, Linehaul) use the grouped-card style. The
  ReceiverHandover "✓" text glyph is now a drawn icon. ConfirmDeparture's intro said "Swipe to
  Submit" above a swipe labelled "Depart"; it now names Depart.
- **Bug found and fixed: Checkpoint's swipe rendered 0px wide.** It sat in a shrink-to-fit
  wrapper inside an `items-center` column, so its `w-full` track collapsed. It was invisible,
  and a checkpoint could not be submitted from the UI. This was present in `HEAD` and found by
  measuring in a real browser, since jsdom does no layout. Checkpoint now uses the pinned footer
  and the track measures 361px. Every other swipe was measured and is full width.

Verified: tsc clean, eslint clean (one existing warning), vitest 893/893 (new: StepLayout,
segmented progress, waiting swipe/button, SealVerify checklist, Log Exception C4, Checkpoint
switch and wrapper). Screenshots in light, dark and AX1, plus a partially filled seal step.

### Step 7: Sign-in, Panic, Settings, Profile (done 2026-10-12, staged, not committed)

Decisions: **Q5** app icon + "FreightProof" + "Driver sign-in", existing palette kept ·
**support** hide the call row until `NEXT_PUBLIC_SUPPORT_PHONE` is set.

- **Login / code entry (H10)**: the real app icon (`components/brand/AppMark.tsx`, iOS 22%
  mask), the wordmark and tagline in the upper half, and the form in thumb reach. "Send OTP" is
  now "Send Code", "Enter OTP" is now "Enter the Code", and "Wrong Number? Go Back" is now "Use a
  Different Number". The phone field gets `autocomplete="tel-national"`.
- **Panic**: the same three facts in half the words, set in Title 1 and Body. "In-Transit
  Hub" / "Return to In-Transit" become "In Transit" / "Back to In Transit", matching the phase
  name on the timeline.
- **Settings (M6, M7)**: iOS inset-grouped sections (header, rows, footer). Support is a pair of
  tappable `tel:`/`mailto:` rows. The call row is hidden while `NEXT_PUBLIC_SUPPORT_PHONE` is
  unset, so the fake "+27 00 000 0000" never shows (the key is already in `.env.example`; set it
  in `.env.local`).
- **Profile (H9, M13)**: a bottom sheet with a grabber and drag-to-dismiss. The sheet follows
  the finger, and release is judged by momentum projection and handed to a spring. The scrim
  fades with the drag and on close; it used to vanish in one frame. The vehicle now comes from
  the real active trip. The "trips completed / total" stats were computed from mock fixtures
  (wrong for every real driver) and have been removed until the trips API can back them. Log
  Out is a destructive row.

Verified: tsc clean, eslint clean (one existing warning), vitest 903/903 (new: sheet
grabber/drag-dismiss/spring-back/scrim, profile data, settings support rows and groups).
Screenshots of login, code, settings, profile sheet, panic and panic sent, in light and dark.

### Step 8: Polish (done 2026-10-12, staged, not committed)

Decisions: **transitions** iOS push/pop with instant tab switches · **M10** flat buttons.

- **Screen transitions** (`app/(app)/template.tsx`, `lib/navigation/transition-direction.ts`):
  - Drilling in slides the new screen in from the trailing edge. A back control brings the
    previous screen in from the leading edge, so a screen leaves the way it came. Tab switches
    are instant.
  - The animation is 320 ms on Apple's deceleration curve, starting at 0.6 opacity so the
    screen is never invisible.
  - It animates `left` on a `relative` frame, not a transform: a transform would re-anchor
    `fixed` children such as `LoadingScreen` for the duration of the animation.
  - The frame is keyed on the full pathname. Next reuses a template whose own segment hasn't
    changed, which first froze every screen on its first direction; a regression test now
    covers that case.
- **Increase Contrast**: `--fp-outline-variant` and `--fp-surface-on-variant` are strengthened
  under `prefers-contrast: more`, so every hairline and every secondary label gains contrast at
  once. The glass material already had Reduce Transparency and Increase Contrast fallbacks
  (step 1). Reduce Motion is covered by the global CSS kill-switch, and the JS springs check it
  before animating (steps 3 and 7).
- **Flat buttons (M10)**: no drop shadows on controls. Elevation is reserved for floating
  layers (tab pill, sheets, map chips, toasts).

Verified: tsc clean, eslint clean (one existing warning), vitest 909/909. **`next build`
static export passes**, with all routes prerendered (this is what Capacitor packages).
Measured in the browser: the push and pop frames are mid-slide, and Increase Contrast resolves
the stronger tokens.

## 12. Before the demo — needs a real iPhone (after `npm run cap:sync:ios`)

The browser verified layout, theme, type scale and motion. These need the device:

1. **Haptics**: the threshold tick while swiping, success on confirm, heavy on panic (step 3).
   They only exist after `cap sync` installs the native side of `@capacitor/haptics`.
2. **Dynamic Type**: Settings › Display & Brightness › Text Size, at default, the largest
   standard size, and one AX size. The app was checked at the matching 17/23/28px roots in
   Chrome, but `-apple-system-body` only binds in WKWebView.
3. **Status bar and home indicator**: header text against the status bar in light and dark;
   the tab pill, step footers and the In Transit stack clear of the home indicator (the real
   inset is 34pt, versus 0 in the browser).
4. **Keyboard**: the login phone field and the seal number with the keyboard up; the form
   should stay visible.
5. **Sheet and swipe gestures**: drag the Profile sheet down slowly and with a flick; catch the
   swipe thumb mid-spring.
6. **Support number**: set `NEXT_PUBLIC_SUPPORT_PHONE` in `.env.local`, or Settings shows only
   the email row.

## 13. Not done, by decision or out of scope

- **Edge-swipe back**: Capacitor's iOS WebView doesn't expose the native back gesture; the
  chevron back is the path. A custom gesture would fight the system's.
- **In-app theme switch**: kept on purpose (Q6, daylight glare).
- **Trip-history stats in Profile**: removed until the trips API can back them (M13).
- **`frontend/DESIGN_SYSTEM.md`** still says "Inter, one family, mono not used". The driver app
  now diverges for iOS. That file is the whole team's; raise it rather than edit it.
- **`@capacitor/haptics` in `package.json`** is a shared-file change. Tell the team before merging.

## 11. Open design questions — to settle together before step 1

- **Q1. Typeface.** System font (SF Pro on iOS) everywhere, or keep Inter, or system for UI plus a
  brand face for display moments only?
- **Q2. Navigation.** Keep the floating pill (iOS 26-style) with labels added, or a conventional
  full-width tab bar? And does Profile stay a separate circle, become a tab, or move into Settings?
- **Q3. Voice of controls.** Title-style everywhere ("Arrive at Destination") with caps kept only
  for identifiers, or keep some caps for an "industrial" feel?
- **Q4. Home.** A "Now" screen (one hero action) with history moved to trip detail, or keep the full
  phase list on Home?
- **Q5. Brand presence.** What is the mark, and what is the accent? Today the accent is a generic
  Material blue (`#0051d5`) with black "ink". Do we keep black and blue, or pick a colour rooted
  in the product (seal tape, hi-vis, a chain/anchor teal; there is already a `chain` token)?
- **Q6. Appearance setting.** Follow HIG and drop the in-app theme switch, or keep it for the
  daylight-glare case?
- **Q7. Zoom lock.** Keep `userScalable: false` (native feel, no focus zoom) and rely on Dynamic
  Type, or unlock?
- **Q8. Ambition for motion.** Minimum (springs + haptics on confirm), or also iOS push/pop
  transitions and drag-dismiss sheets?
- **Q9. Signature moment.** Agree that the swipe-to-confirm → "Recorded / Anchored" receipt is the
  one place we spend the boldness?
