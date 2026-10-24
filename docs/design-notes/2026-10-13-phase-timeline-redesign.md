# Phase timeline redesign (before Tasks 8–10 of the live evidence rail)

**Status: DECIDED and VERIFIED (2026-10-13, plan Revisions 5–6).** Revision 6 overrides this note in four places: the outcome word is "Checks passed", not "Clean" (D44); location is two checks, truck geofence and driver proximity, never one "Location verified" line (D43); the leg seal and departure come from the immediately preceding departure (D40, D41); trip-level and capped exceptions stay reachable (D42). Where this note and the plan disagree, the plan wins. Option C, with the conditions in §8. Open items O2, O3, O7 and O8 keep their defaults unless changed before Task 8b; O1, O4 and O5 are decided at Task 10. Step 6 is done: the decision is in §8 and Tasks 8, 8b (new), 9a (new), 9, 10 and a pointer on Task 11 are amended in [the plan](../superpowers/plans/2026-10-12-live-evidence-rail.md) (Revision 4). No production code was changed: the only code added is the throwaway mockups listed at the end.

**Revised after review (same day).** Three inputs changed this note: (1) the dispatcher is used on **tablet and desktop only**, so 375 px is out of scope and the options are judged at measured tablet and desktop widths; (2) an exception row on the timeline **opens the exceptions panel** instead of pointing at a separate card below (§5 issue 1 is rewritten and the branch is removed); (3) **in-transit gets its own design** (§6). Option B (tabs) was set aside. **Final choice: Option C**, plus four rules from the dispatcher owner: in-transit is always expanded while it is happening and after; anchor rows and the audit trail show only in forensic mode; the right things appear in the right phases (§7); the white exception cards are a minor open point.

**Scope.** The dispatcher trip page's phase timeline: `TripTimeline`, `PhaseTimelineItem`, `PhaseEvidence`, `PhaseExceptionGroup` (to be removed), the `components/domain/*Detail` panels and what they render, and now the `in_transit` card. `trip_creation` keeps its current card (the plan already leaves it alone).

Screenshots are in [`assets/2026-10-13-phase-timeline/`](assets/2026-10-13-phase-timeline/).

---

## 1. What I looked at, and what I could not

| What | Detail |
|---|---|
| Trips | `FP-DEMO-CLOSED-0001` (completed, single-leg, no exceptions), `FP-DEMO-ACTIVE-0001` (13-phase cross-dock, current phase Arrival 5/13). The history list also holds `FP-20261001-32FF7346` (15 exceptions), not opened. |
| Widths | Current timeline: desktop (1200 px emulated) and 375 px, before it was ruled out. For the options, **measured card content widths in the real page**: Desktop 1440 (panel docked) 772 px; Laptop 1280 (panel docked, the narrowest) 676 px; Tablet 1024 landscape (panel overlay) 772 px; Tablet 768 portrait (panel overlay) 564 px. The exceptions panel docks as a 400 px column only at ≥ 1280 px (`DetailPanel`); below that it is a modal overlay. |
| Light / dark | **The dispatcher has no dark theme.** `tailwind.config.ts` has no `darkMode`, there is no `prefers-color-scheme` rule and no `dark:` class anywhere under `app/`, `components/`, `lib/`. Emulating dark changed nothing. Only the nav rail is dark by design. So there is nothing to critique or design for in dark; the options use semantic tokens, so a future dark theme would carry over. |
| Real photos | **None rendered.** In this dev environment `GET /trips/{id}/artifacts` fails (the browser reports it as a CORS error, which is what a 5xx without CORS headers looks like). Every photo reads "Evidence lookup failed". That is itself one of the states the redesign must handle, but it means the mockups use placeholder tiles. |
| Mobile | **Out of scope: the dispatcher is not used on phones.** I had captured 375 px (the screenshots named `*-375` document the current timeline only). Its two findings, the 29 px scroller (F1) and the clipped chip row (in F5), are dropped from the priorities. |

## 2. Inventory: everything the timeline shows today, and where it goes

Zones: **Header** = collapsed-card verdict line. **Recorded** = chronological rail. **Checked** = comparisons and verdicts. **Audit** = override authorisation, receipts, verify. **Unchanged** = not touched. Nothing is dropped without a reason in the last column.

| # | Item | Where it shows now | New home | Reason / note |
|---|---|---|---|---|
| 1 | "Trip timeline" title, "Record refreshed {time}" | `TripTimeline` | Unchanged | |
| 2 | "Jump to current phase ↓" | `TripTimeline` | Unchanged | |
| 3 | Sticky "En route to {dest} · n exceptions · Show current leg" | `CurrentLegStrip` | Unchanged | in_transit only |
| 4 | Evidence-lookup banner + Retry | `TripDetailPanel` (outside the timeline) | Unchanged | Per-row "Evidence lookup failed · Retry" stays (the banner cannot say which photo) |
| 5 | "Trip record" (exceptions with no phase) | `TripTimeline` | Same compact exception row as the rail, opening the panel | Consistency: no exception renders as a full card on the timeline any more (§5 issue 1) |
| 6 | Rail node: number / ✓ / pulse | `PhaseTimelineItem` | Unchanged, **plus** amber when the outcome is "needs attention" | Today only `status = exception` is amber, so a phase with a failed parcel count and no exception shows a green tick (mockup: Confirmation) |
| 7 | Phase title | `PhaseTimelineItem` | Unchanged (type step `title`) | |
| 8 | Status chip: Exception · Unable to complete | `PhaseTimelineItem` | **Header** verdict word | Replaced by the verdict line, which says the same thing with the reason. Not dropped |
| 9 | Status chip: In progress · Current phase · Not started · Not reached | `PhaseTimelineItem` | Unchanged for unresolved phases; verdict line says "In progress" only once something is uploaded, else "Current phase · waiting for the driver" | Today "In progress" is never written by the backend; "Current phase" is the honest wording for an empty active phase |
| 10 | Completed-at time with clock | header | Unchanged | Also gains the device/recorded pair on the completion row (D16) |
| 11 | Stop line "Origin · Cape Town Depot" | header | Unchanged | |
| 12 | Summary "{n} recorded at origin · Seal X" | header | **Header** reasons ("7 of 7 parcels scanned") and **Recorded** completion row ("Seal FP-7204") | Merged: the same figure would otherwise appear in the header and in Checked |
| 13 | Location chip: "Truck within precinct tolerance" + "Driver–truck separation: 0 m" + "Recorded source separation; proximity not evaluated." | header (`LocationEvidenceSummary`) | **Header** reason ("Location verified / not verified") and one **Checked** line | Same verdict is stated again in the panel (#28); merged to one |
| 14 | Journey mini-timeline (Departed / exception markers / Arrived or En route / Awaiting) + "Only recorded journey events are shown." | `InTransitTimeline`, in_transit `persistentContent` | **Recorded** rail of the in-transit card (same events, same absence wording), plus verdict line and a Checked line | §6 "The in-transit leg" |
| 15 | "Anchor failed — receipt still owed" | header warning, visible to everyone | **Unchanged: stays visible to everyone**, as today, and is not part of the verdict | Open item O2: confirm it should stay visible outside forensic mode |
| 16 | `ChainReceiptTag` (label, Hedera seq / "Pending anchor", hash, Copy, HashScan, "Anchored {time}") | card, forensic only | **Audit trail, forensic only**, and the **Recorded** anchor row ("Anchored {time}" / "Anchoring pending"), also **forensic only** | Decision: anchoring is not shown in every phase unless forensic mode is on |
| 17 | `VerifyButton` (all states, mismatch report) | card, forensic only | **Audit trail, forensic only** | Unchanged component |
| 18 | "Record as unable to complete" | bottom of open card | Unchanged (below the zones, unresolved phases only) | It is an action, not a record |
| 19 | Exception branch: diamond, "{n} exceptions · {m} need review", worst-severity chip | `PhaseExceptionGroup` | **Removed.** The rail's exception rows carry the information; the header verdict carries the count | §5 issue 1. Its reveal/highlight machinery is re-pointed at the row |
| 20 | Exception card: type, severity, time, source, description, review state/time/outcome, "Open in exceptions panel" | `ExceptionSummary` in the timeline | **Compact rail row** (type, severity, time, source, review state, two-line description); the full card stays in the **exceptions panel**, which already renders `ExceptionSummary` | The panel is the review surface; the timeline no longer duplicates it |
| 21 | Exception footer: map button, "Supporting evidence" (position disagreement, supporting photo) | timeline card footer | Map button: already in the panel. **"Supporting evidence" must be added to the panel**: it exists only in the timeline footer today, so removing the card would drop it | Needs `artifactsById` in `TripExceptionsPanel` |
| 22 | TripCreated panel: driver (name, phone, licence, ID), horse, trailer(s), trip type/manifest/planned times, Pulsit ref, waybills, journey-lock hash/topic/sequence/time/tx | `TripCreatedDetail` | Unchanged | trip_creation is out of this round |
| 23 | Activation: Precinct, Address, Slot time, "Arrived" | `ActivationDetail` | **Checked → Location details** (precinct, address, slot time). "Arrived" **dropped** | "Arrived" repeats the header's completed-at time |
| 24 | Loading: Expected (manifest), Scanned onto truck, "All parcels scanned ✓ / n excess scanned / n not scanned ✗" | `LoadingDetail` | **Checked** parcel line (with plural fix); live count shown as "in progress" until completion | The ✓/✗ glyphs become an icon plus the words |
| 25 | Loading: Linehaul document photo | `LoadingDetail` | **Recorded** photo row | Photos move in Task 11 |
| 26 | Departure: Seal number badge, "Not captured" | `DepartureDetail` | **Recorded** completion row ("Seal FP-7204") | "Not captured" only on a resolved phase (see §4, `absent` row) |
| 27 | Departure: Seal photo | `DepartureDetail` | **Recorded** photo row | |
| 28 | Location block: driver phone fix, horse tracker fix, both capture times, separation, "Truck precinct check", "Driver proximity", Boundary, "View on map" (+ modal) | `PhaseLocationSection` / `LocationEvidencePanel` | **Checked → "Location details"** disclosure; the one-line verdict above it | Moved, not dropped. The "proximity not evaluated" sentence appears once, here |
| 29 | Arrival: Seal read at arrival, "No seal present" | `ArrivalDetail` | **Recorded** completion row; the "No seal present" claim is **dropped on unresolved phases** | On the active Arrival card today it asserts absence before the driver has recorded anything (screenshot `current-active-375`). Honesty rule D15 |
| 30 | Arrival: Condition as found, Seal at departure (this leg), findings (mismatch / compromised / unverified / "Recorded seals match ✓") | `ArrivalDetail` | **Checked** seal-number and seal-condition lines | |
| 31 | Arrival: Seal photo as found | `ArrivalDetail` | **Recorded** photo row | |
| 32 | Unloading: Scanned off truck (live), Expected at stop, verdict, "Scan in progress — this count may still change." | `UnloadingDetail` | **Checked** parcel line; the note stays while unresolved | |
| 33 | Confirmation: POD photo | `ConfirmationDetail` | **Recorded** photo row | |
| 34 | Confirmation: "POD signature (Ed25519)" | `ConfirmationDetail` | **Recorded** receiver row, relabelled | §5 issue 2 |
| 35 | Confirmation: Chain of custody (scanned out / in) and "Counts agree ✓ / n excess parcels scanned at destination / n parcel unaccounted for in transit ✗" | `ConfirmationDetail` | **Checked** counts line, pluralised | §5 issue 3 |
| 36 | Confirmation: Driver observation + "Counted blind — recorded as independent evidence…" | `ConfirmationDetail` | Count on the **Recorded** completion row; the note stays under **Checked** | The note is the reason the count is not part of the verdict |
| 37 | Override: "A dispatcher bypassed this phase's checks", Note, "Authorised by (user id)" | `PhaseOverrideSection` | **Recorded** completion row: note and "Authorised by", visible to everyone | The existing comment says an override "is never a footnote". It is a record of what happened, not audit infrastructure, so it does not move behind forensic mode. Open item O3 |
| 38 | Anchor section: Status, "Anchor failed", event hash (copy) | `PhaseAnchorSection` | Event hash: **Audit trail, forensic only**. Status: the forensic anchor row. "Anchor failed": row 15 | **The component is not rendered anywhere today** (no importers). Its Status field and warning are dropped as duplicates; the event-hash field is revived |
| 39 | Photo thumbnail (96 px) + modal; states "Loading evidence…", "Evidence lookup failed", "Recorded artifact unavailable", "Recorded, image unavailable", "Image failed to load", Retry | `EvidencePhoto` | **Recorded** photo row (thumbnail 44 px, same modal) | "Not captured" becomes the `absent` row, see §4 |
| 40 | Photo provenance: captured time, lat/lng, SHA-256 copy | `EvidencePhoto`, forensic only | **Recorded** photo row, forensic only | Unchanged gating |
| 41 | Attestation document row: file icon, mime type, captured time, "Open ↗", unavailable states | `EvidenceDocument` | **Recorded** receiver row | The Retry button there is unstyled (renders at body size); restyled |
| 42 | Pending phases: dashed card, "Not started" / "Not reached" | `PhaseTimelineItem` | Unchanged | |

## 3. Critique of the current timeline

**Overall impression.** The rail is a good skeleton: numbered nodes, a branch for exceptions, honest named absences ("Tracker reading time not recorded", "Only recorded journey events are shown"). The problem is the cards. A resolved phase's collapsed header says almost nothing, and the opened card is a long form in which the least decision-relevant part (coordinates) takes the most room.

| Finding | Severity | Recommendation |
|---|---|---|
| **F1.** At 375 px the timeline is unusable: the header block plus the evidence banner fill 771 px of 812, leaving a 29 px scroller (measured). | ⚪ | **Dropped: the dispatcher is not used on phones.** Kept only as a record. At 768 px portrait the scroller is 564 px tall (measured), which is workable |
| **F2.** Every completed phase's header looks the same: green tick, time, and a location chip. "Seals match", "counts agree", "1 exception" are all inside, so you must open every card to learn whether the phase went cleanly (`current-completed-collapsed-desktop`). | 🔴 | Header verdict line (§4) |
| **F3.** A phase can fail a check without raising an exception (parcel count 7 vs 6) and still gets a green tick. | 🔴 | Node follows the outcome; the verdict names the failed check |
| **F4.** The active Arrival card says "No seal present" and "Condition as found —" before anything is recorded. That reads as a finding. | 🔴 | Checked is empty until completion (rule in §4) |
| **F5.** The location verdict is stated twice per phase (chip line and panel), and "Recorded source separation; proximity not evaluated." repeats verbatim eight times down one trip. | 🟡 | One Checked line; raw fixes behind "Location details" |
| **F6.** Open card hierarchy is flat: section titles are 13 px uppercase bold, labels 10 px, values 12 px. Eight sections, location alone about 60% of the height. | 🟡 | Three zones, location collapsed |
| **F7.** Type sizes are literals: about 357 uses of `text-[9px]`…`[15px]` (9 px ×7, 10 px ×58, 11 px ×114, 12 px ×84, 13 px ×71, 14 px ×12, 15 px ×11) with no scale. Labels at 9–10 px are below a legible floor. | 🟡 | Four-step scale (§5, issue 4) |
| **F8.** Failure states are loud and repeated: a full-width amber banner plus an inline "Evidence lookup failed" in every card; `EvidenceDocument`'s Retry is an unstyled button at body size. | 🟡 | Keep per-row recovery, style it once |
| **F9.** The dispatcher has no dark theme (see §1). | 🟢 | Informational |

**Contrast** (computed from the tokens): `on-surf-v` on `surf-low` 8.5:1; on `sec-c` 7.2:1; `sec` timestamp on `sec-c` 5.2:1; `ok` and `warn` text on `surf-low` 5.9:1; `outline` `#777680` on `surf-low` 4.1:1 (fails 4.5:1 for text; fine for borders, so no text may use it). Touch targets: the phase toggle spans the card, but the exception "Open in exceptions panel", the copy buttons (9 px) and the retry links are below 44 px.

**What works.** The rail and node vocabulary. The exception diamond branch. Named absences. Forensic gating. The persistent journey for in-transit. The dashed pending card.

## 4. The model the options share

### Three kinds of information

| Kind | Question it answers | Contents | Where |
|---|---|---|---|
| **Recorded** | What happened, in order? | Photos (with their state), the receiver's confirmation, the driver's completion (with the recorded values: seal number, scanned count, driver's blind count, seal condition, any override note), exception rows, and (forensic mode only) the anchor | Chronological rail, inside the card |
| **Checked** | Was it right? | Comparisons and verdicts: seal number vs departure, seal condition, parcel counts, location verdict (raw fixes behind a disclosure) | Zone inside the card; empty until the phase completes |
| **Audit trail** | Can it be proved? | Receipt (hash, sequence, HashScan), event hash, verify | **Forensic mode only** (admin dispatcher with the toggle on, via `ForensicOnly`). Not rendered at all otherwise, so a card has two zones. Overrides are not here: they are in Recorded |

### The header answers "did this phase go cleanly?"

A resolved phase's collapsed header carries one **outcome** (icon + word + reasons, never colour alone). Derived by one pure function from the checks, the exceptions, the override and the anchor:

| Outcome | Rule | Header reads (examples) |
|---|---|---|
| `overridden` | `status = overridden` | "Closed by dispatcher override · parcel and location checks did not run" |
| `attention` | any exception needing review, **or** any flagged check; applies to **unresolved phases too** | "Needs attention · 1 exception to review · Seal found damaged"; "Needs attention · 1 parcel unaccounted for · No exception raised"; active leg: "Needs attention · 2 exceptions en route, 1 needs review · Departed 09:00 · 3 h 12 m on the road" |
| `reviewed` | exceptions exist, all reviewed, no flagged check | "Exception reviewed · Route deviation (warning) · 55 min on the road" |
| `unverified` | no exception, no flagged check, but at least one check could not run | "Not fully verified · 7 of 7 parcels scanned · Location not verified" |
| `clean` | no exception, no flagged check, nothing unrun, at least one check passed. **Never awarded to `in_transit`** (it has no check that passes) | "Clean · No exceptions · Location verified" |
| `in_progress` | unresolved, trip running, nothing needing attention | "In progress · 2 photos uploaded · Waiting for the driver to confirm departure"; with no uploads: "Current phase · waiting for the driver" |

Precedence is the table order, so an unreviewed critical exception on a phase that is still running outranks "In progress" (a change from the first draft, driven by in-transit). An unresolved phase on a cancelled trip gets no verdict (it keeps "Not reached"). The anchor state (pending, failed, anchored) is **not an input to the verdict**: anchoring is forensic detail, and today's separate "Anchor failed — receipt still owed" warning is unchanged (row 15). `not_required` produces no anchor row. "Clean" is deliberately hard to earn: a dark tracker makes a phase `unverified`, not `clean` (honesty rule, Review Focus 1).

### Which checks exist (source: today's logic, moved into one pure module)

| Phase | Checks | Notes |
|---|---|---|
| activation | location | |
| loading | parcels (manifest expected vs scanned), location | null baseline is "not checked", not zero |
| departure | location | The seal number is a recorded value, not a check |
| arrival | seal number vs this leg's departure, seal condition, location | New: two different seal numbers with no exception now flag (today nothing shows). Both are recorded values, so the comparison is honest. Confirm, see "Defaults" |
| unloading | parcels (scanned off vs expected at stop), location | live until completion |
| confirmation | counts (origin scanned out vs destination scanned in), location | the driver's blind count stays outside the verdict, with its note |
| in_transit | none that can pass. One standing line, "Seal not inspected yet / in transit" (not a result: the seal is first inspected at **Arrival**), and the named absence "Only recorded journey events are shown. A tracker check appears here only when it raises an exception." | No record says which on-road checks ran, so no exception is not "passed". The verdict comes from the exceptions alone (see §6) |
| trip_creation | none (no verdict line this round) | |

Checks run only after completion. Before it, Checked shows "Checks appear when the driver confirms {phase}", except the system-observed live scan counts, which show as "in progress", never as a pass or a fail.

### PhaseAct shape (changes proposed for Task 8)

Today's `PhaseAct` is `evidence | completion | exception | expected`. Proposed:

| Change | Why |
|---|---|
| Add `{ kind: 'anchor'; key; status: 'pending' \| 'anchored' \| 'failed'; consensusAt: string \| null }`; builder input gains `receipt`. **The component renders it only inside `ForensicOnly`**; the builder stays pure | The anchor is a recorded fact and the matrix already lists an anchor row, but the type has no act for it; `not_required` produces none |
| `completion` gains `values` (seal number, scanned count, driver's blind count, seal condition) and `overrideNote` | The recorded values need a home now that the panels stop being the only place they show |
| Add `{ kind: 'absent'; key; role }`, produced only for a **resolved** phase whose role column is null and that has no attributed upload for the role | Today's "Not captured" would otherwise vanish silently. Resolved-phase absence is a recorded fact ("No seal photo submitted at completion"); it is never produced for an active phase (D15 stays) |
| `exception` act unchanged in shape (`exceptionId`, `at`); rendered as a **row that opens the exceptions panel**, with type, severity, source, review state and description read from `exceptionsById` | §5 issue 1 |
| Add `{ kind: 'milestone'; key; event: 'departed'; at; sealNumber }` for the in-transit leg's departure (from the leg's own departure phase, `legDepartureAt` / `departureSealForLeg`). "Arrived {destination}" is the leg's ordinary `completion` act; `expected` gains reason `en_route` ("En route to {destination} · expected {planned arrival}"). The builder takes `allPhases` | §6 "The in-transit leg" |
| `PhaseActSummary` is replaced by a `PhaseOutcome` from a new pure module (checks + outcome), so Task 8 splits into 8 (acts) and 8b (checks and outcome) | The verdict needs checks, which acts do not hold |

## 5. The four issues you listed

**1. Exceptions: the exceptions panel is the one place an exception is read and handled (revised; the first draft kept a card below the phase).** The timeline renders each exception as **one compact row in the phase's rail**, in time order between the photo and the completion where it happened: type, severity chip, time, source, review state, and a two-line description. **The whole row is a button that opens the exceptions panel on that exception**: docked on the right at ≥ 1280 px, as the existing overlay below that. `PhaseExceptionGroup` (the branch off the rail, its diamond, and the full cards with their footers) is **removed from the timeline**. The panel already renders every exception as an `ExceptionSummary` with the map button and a "Show in timeline" return link, so nothing is lost by dropping the duplicate, with three things to build:

| Consequence | What it needs |
|---|---|
| **Select one record.** Today `?panel=exceptions&phase=<id>` filters the panel to a phase, not to one exception | A new `exception=<id>` URL param: the panel opens on that record, scrolls to it and marks it selected; the row shows the same selected state (mockup: blue border) |
| **"Supporting evidence" would be lost.** The position-disagreement view and the supporting photo exist only in the timeline card's footer; the panel's footer has just the map button and "Show in timeline" | Add the same disclosure to `TripExceptionsPanel` (it needs `artifactsById`) |
| **"Show in timeline"** (panel to timeline) revealed the exception *group* via `revealRequest` | Re-point it at the row: open the phase card, scroll to the row, highlight it for the same 1.4 s |

On tablet (< 1280 px) there is no right-hand column: the same click raises the panel as a modal (`DetailPanel` already does this), and "Close" returns focus to the row (mockup: "Tablet 768 · panel overlay"). **Exceptions never hide behind a closed card** (today the branch guarantees that, so removing it must not lose it): a collapsed phase shows its exception rows directly under the header verdict; opened, the same rows move into the rail in time order. They render once either way, and the header verdict ("Needs attention · 1 exception to review") still states the count. **Cap:** a phase with more than 3 exceptions shows the 3 that most need attention (unreviewed first, then critical, then newest) and a "+n more · Open in exceptions panel" row, which opens the panel filtered to that phase (the existing `phase=` filter). History has a trip with 15 exceptions, so this is a real case, not a hypothetical (`option-a-collapsed-tablet-1024` shows the uncapped 1–2 case). The trip-level "Trip record" list uses the same row. `ExceptionSummary`'s `onOpenPanel` prop and the timeline-side tests for the group (`PhaseExceptionGroup.test.tsx` and the exception cases in `TripTimeline.test.tsx`) are retired or rewritten for the row. Task 9 builds rows that open the panel, not cards.

**2. "POD signature (Ed25519)".** The label is wrong twice. The artifact is the receiver's *attestation image* (typed name and ID, time, position, rendered in the receiver's browser, hashed with SHA-256), not a hand-drawn signature, and nothing signs it with Ed25519: the string "Ed25519" appears nowhere in `backend/app`, and in the dispatcher only in this label and its test. New wording: row **"Receiver confirmed delivery"** with state **"Attestation image"** only when the artifact is attributed `pod_signature` for that phase (D8); anything else submitted in that field keeps D8's neutral "Submitted as receiver confirmation". The internal field name `pod_signature` is frozen and unchanged.

**3. Plural.** "{n} parcel unaccounted for in transit ✗" becomes "1 parcel unaccounted for" / "n parcels unaccounted for". The same defect sits in "{n} excess parcels scanned", "{n} excess scanned" and "{n} not scanned". There is no plural helper in the dispatcher (one inline ternary in `CurrentLegStrip`). Add a small dispatcher-only `countLabel(n, 'parcel')` in `lib/format/` (not `frontend/shared`, so no shared-file change) and use it in every one of those strings. "in transit" is dropped from the sentence: the count comparison cannot say where a parcel was lost.

**4. Type scale.** Four semantic steps, in `rem` so browser zoom scales them, replacing 357 literal sizes:

| Token | Size / line | Use | Replaces |
|---|---|---|---|
| `text-label` | 11 / 16, semibold, +0.04em | eyebrows, field labels only | `[9px]`, `[10px]`, `[11px]` |
| `text-meta` | 12 / 16 | timestamps, secondary lines | `[12px]` |
| `text-body` | 13 / 18 | card body, verdicts, row labels | `[13px]`, `[14px]` |
| `text-title` | 15 / 20, bold | phase and exception titles | `[15px]` |

Rule: anything that carries a value is never below `meta`. Sizes of 16 px and up (page headings, stat cards) are outside this scale and untouched. New and rewritten components use only these tokens; the remaining files migrate later with a codemod (follow-on, not in the plan). Tokens go in the dispatcher's `tailwind.config.ts` (`theme.extend.fontSize`); the mockups use the same values as classes.

## 6. Option A or C, and the in-transit leg

**See them at `http://localhost:3000/dev/design`** (scroll to "Phase timeline — options A and C"). Pick a viewport (Desktop 1440, Laptop 1280, Tablet 1024, Tablet 768), toggle all open / all collapsed, and click any exception row: it opens the exceptions panel docked on the right (1440, 1280) or as an overlay (tablets). Eight scenarios per option, in-transit first. Option B (tabs) was set aside.

Both options share the three zones, the verdict rules, the exception rows and the copy fixes. They differ only in the open card's body: **A** stacks Recorded, Checked, Audit trail; **C** puts Recorded and Checked side by side when the card is wide enough.

### Measured card widths decide it

| Viewport | Exceptions panel | Card content width | A | C |
|---|---|---|---|---|
| Desktop 1440 | docked, 400 px | 772 px | Fine | Splits, fits |
| Laptop 1280 | docked, 400 px | **676 px** (the narrowest) | Fine | Cramped (columns ≈ 350 / 280), so it falls back to A |
| Tablet 1024 landscape | overlay | 772 px | Fine | Splits, fits |
| Tablet 768 portrait | overlay | **564 px** | Fine | Too narrow (≈ 290 / 230), so it falls back to A |

C works at two of the four sizes the dispatcher actually runs at, and the common laptop size (1280, panel docked) is not one of them, so C means building and testing both layouts and still showing A half the time. A has one layout that holds from 564 px up.

There is a second reason, specific to in-transit: its Checked column has one line in it (the seal is not inspected until Arrival) while its Recorded rail is the whole story, so C leaves half the card empty on the phase that matters most (`option-c-in-transit-tablet-1024`).

**My recommendation was A; the decision is C** (§8). C is built as **A's stacked layout plus a split that applies only where it helps**: the card is at least 740 px wide (Desktop 1440, Tablet 1024), the phase has at least one check to show, and it is not an in-transit card. Everywhere else, including Laptop 1280 with the panel docked, Tablet 768, any phase with no checks yet, and every in-transit card, it renders as A. So both layouts are built and tested, and the stacked one is the fallback that is shown most.

### The in-transit leg

In-transit is where the theft signals arrive (trailer separated, route deviation, tracker silent, seal broken, panic), but it is also the phase with the least *verifiable* data: there are no scans, no geofence verdict (its stop is the one it departed from), no photos, and the seal is only inspected at **Arrival**. Pulsit is mock-only today and driver checkpoints are parked (the 23 Sep note: no GET endpoint, never shown to the dispatcher), so the card shows only what is recorded and says so. What it looks like (mockups `option-a-in-transit-active-tablet`, `option-a-in-transit-docked-1280`):

**Active leg** (always open, no toggle):

| Part | Content |
|---|---|
| Header | "In Transit", the leg ("Cape Town Depot (Epping) → Johannesburg Depot (Linbro)") and the verdict. Exceptions drive it, so an unreviewed one makes it **"Needs attention · 2 exceptions en route, 1 needs review · Departed 09:00 · 3 h 12 m on the road"**; with none: "In progress · Departed 09:00 · 3 h 12 m on the road". "Time on the road" is a live figure from the leg's departure time (a labelled clock, D16) |
| Recorded | A rail of what happened, in time order: **Departed {origin}** with "Sealed FP-6390 at departure" (the seal to watch, taken from the departure phase); then **each exception as a row** (type, severity, time, source, review state, two lines of description, "Open in exceptions panel"); then dashed expected rows: "En route to {destination} · expected {planned arrival}" and "Waiting for the driver to confirm arrival" (D15: an expectation, never a claim) |
| Checked | One standing line: "Seal not inspected yet. Sealed FP-6390 at departure; the seal is first inspected at Arrival." plus the named absence "Only recorded journey events are shown. A tracker check appears here only when it raises an exception." |
| Audit trail | Forensic mode only, and only once the leg is complete |

**Completed leg** (also always open: the in-transit card never collapses once the leg has started, whether it is happening or finished; only a leg not yet started is a collapsed "Not started" card): the header reads "Arrived Johannesburg Depot (Linbro)" with the outcome. With no exceptions it is **`unverified`, not "Clean"**: "No exceptions recorded · 40 min on the road". "Clean" would claim the route was safe, and no record says which on-road checks ran, so an empty list is absence of reports, not a pass. With exceptions all reviewed: "Exception reviewed · Route deviation (warning) · 55 min on the road". Body: Departed, exception rows, Arrived; in forensic mode also the anchor row ("Anchored 09:40:22") and the Audit trail with the arrival-attestation receipt (IDs only, as today).

**Exception rows on a collapsible card** (every other phase) sit under the verdict while it is collapsed (§5 issue 1); the in-transit card never collapses, so its rows are always in the rail. **Critical rows** carry a red border (not colour alone: the Critical chip and "Needs review" are also in the row).

**What stays out until it exists:** weighbridges, driver and vehicle substitutions, checkpoints and a route map. `InTransitTimeline`'s own comment says the node list is built to extend; the rail does too, because every event is just another row. The "Show current leg" strip (`CurrentLegStrip`) is unchanged.

**Two judgement calls for you:** (a) the verdict word for a leg with no exceptions ("No exceptions recorded", neutral) is deliberately less reassuring than the other phases' "Clean"; (b) whether "time on the road" should compare to a planned duration. There is no per-leg planned duration in the data (only the trip's planned arrival), so the mockup shows the elapsed time and the expected arrival and does not judge them.

Screenshots (A-layout views; C renders in-transit stacked the same way): `option-a-collapsed-tablet-1024`, `option-a-in-transit-active-tablet`, `option-a-in-transit-docked-1280`, `option-a-exception-overlay-tablet`, `option-c-in-transit-tablet-1024`.

### Defaults (stand unless changed during verification)

1. Outcome words as in §4 ("Clean", "Needs attention", "Not fully verified", "Exception reviewed", "Closed by dispatcher override").
2. The rail node turns amber for every `attention` outcome, not only `status = exception`.
3. Two differing seal numbers with no exception flag the check.
4. `trip_creation` gets no verdict line this round; `in_transit` does (§6), and never "Clean".
5. **Revised:** the anchor state is not an input to the verdict; today's "Anchor failed — receipt still owed" line is unchanged.
6. An unreviewed exception outranks "In progress" on a running phase.
7. Exception rows stay visible under a collapsed card's header and move into the rail when it opens (§5 issue 1); cap of 3 rows plus "+n more".
8. C's split applies only at ≥ 740 px of card, with at least one check, and never to an in-transit card (§6).
9. The in-transit card never collapses once the leg is happening or has happened (§7.4).
10. Anchor rows and the audit trail render only in forensic mode (§7.3).

## 7. What shows in which phase (the contract Task 9 renders)

"Everything" is not shown everywhere. A phase shows only the zones and rows its type can produce, in the state it is in. This section is the single reference; the plan's Tasks 8, 8b and 9 implement it and Task 10 previews every cell.

### 7.1 By phase state (every phase type except trip_creation)

| State | Header | Recorded | Checked | Audit trail (forensic) |
|---|---|---|---|---|
| **Not started** (a future phase; Activation on a trip still `created`) | Dashed card, "Not started" chip, stop line. Nothing else | none | none | none |
| **Current phase, nothing yet** | "Current phase · waiting for the driver" | dashed expected rows only: "Expected: seal photo", "Waiting for the driver to confirm {phase}", or "Waiting for the warehouse scan to finish" (D15: an expectation, never "missing") | "Checks appear when the driver confirms {phase}"; Loading and Unloading also show the live scan count labelled "in progress", never as pass/fail | none |
| **In progress** (uploads exist) | "In progress · 2 photos uploaded · Waiting for the driver to confirm departure". An unreviewed exception outranks it: "Needs attention · …" | uploaded rows (D24 wording: "Uploaded", "{n} photos uploaded"), exception rows, expected rows | as above | none |
| **Resolved: completed or exception** | The outcome (§4): Clean, Reviewed, Not fully verified, Needs attention | submitted / not submitted / received after the phase closed rows, receiver row, `absent` rows, the completion row with recorded values, exception rows | every check for the phase type (§7.2) | anchor row and receipt/event hash/verify |
| **Resolved: overridden** | "Closed by dispatcher override · {reasons}" | the completion row carries the override note and "Authorised by"; late uploads as "Received after the phase closed" | one line: "Checks bypassed" | anchor row (override receipt) and receipt/verify |
| **Unresolved on a cancelled trip** | no verdict; the "Not reached" chip stays | rows **only if** the phase has attributed uploads or exceptions (`trip_cancelled` state, D23); no expected rows, no highlight | none | none |

### 7.2 By phase type (resolved shape; the active shape is the same minus checks)

| Phase | Recorded rows, in time order | Checked | Header reasons | Photos? |
|---|---|---|---|---|
| **trip_creation** | unchanged card (`TripCreatedDetail`) | none | no verdict line this round | no |
| **activation** | completion ("Driver confirmed arrival at {stop}") · exceptions | location (expected precinct, address, slot time live in its "Location details") | location | no |
| **loading** | linehaul photo · completion with "{n} parcels scanned onto truck" · exceptions | parcels (manifest expected vs scanned; no baseline = not checked, not zero) · location | parcels, location | linehaul only |
| **departure** | seal photo · completion with the seal number · exceptions | location. The seal number is a recorded value here, not a check | location | seal only |
| **in_transit** | **Departed {origin}** with "Sealed {seal} at departure" · exceptions as they were raised · **Arrived {destination}** once complete; while active, dashed "En route to {destination} · expected {planned arrival}" and "Waiting for the driver to confirm arrival" | no check can pass. A standing line "Seal not inspected {yet / in transit}. First inspected at Arrival", the named absence "Only recorded journey events are shown", and "No location verdict is recorded for transit legs" with the recorded arrival fix behind "Location details" (today's `InTransitArrivalLocation`) | exceptions en route, time on the road | **none** |
| **arrival** | seal photo (as found) · completion with seal read and condition · exceptions | seal number vs this leg's departure · seal condition · location | seal findings, exceptions | seal only |
| **unloading** | completion · exceptions | parcels (scanned off truck vs expected at this stop) · location | parcels | **none** |
| **confirmation** | POD photo · receiver confirmation (attestation image, D8) · completion with the driver's blind count · exceptions | counts (origin scanned out vs destination scanned in) with the blind-count note · location | counts | POD photo and attestation |

Never produced: a photo row or an "Expected: photo" row for activation, in_transit or unloading (they have no evidence role); an `absent` row for an active phase; a check result for an unresolved phase.

### 7.3 Who sees what

| Visible to everyone | Forensic mode only (admin dispatcher with the toggle on, `ForensicOnly`) |
|---|---|
| header verdict, Recorded rows (photos and thumbnails, receiver row, completion, exception rows, expected rows, override note and "Authorised by"), Checked, "Anchor failed — receipt still owed" (today's behaviour) | the **anchor row** ("Anchored {time}", "Anchoring pending"), the **Audit trail** zone (receipt tag with hash, sequence and HashScan, event hash, Verify), photo provenance (capture coordinates, SHA-256), the journey-lock block on trip_creation (already gated) |

With forensic mode off a card has two zones, and nothing about anchoring appears on any phase unless it has failed. The builder (`buildPhaseActs`) still produces the anchor act; the component gates it.

### 7.4 Collapsing

| Card | Rule |
|---|---|
| trip_creation | as today (collapsible) |
| **in_transit** | **no toggle, no chevron, always open while the leg is happening and after it has finished** (`active` or resolved, including exception and overridden). A leg not yet started, or not reached on a cancelled trip, is a collapsed "Not started" card. Today only the active leg is always open and a finished leg is collapsed behind its persistent journey |
| every other phase | collapsible; open by default only for the current phase; a collapsed card shows its exception rows (max 3, then "+n more") under the verdict |

### 7.5 Wording for the Recorded rows (proposed for verification, O4)

| Row | Text |
|---|---|
| completion | activation "Driver confirmed arrival at {stop}" · loading "Driver confirmed loading" · departure "Driver confirmed departure" · in_transit "Arrived {destination}" · arrival "Driver confirmed arrival" · unloading "Driver confirmed unloading" · confirmation "Driver confirmed delivery"; exception variant "{text} — exception recorded"; override "Closed by dispatcher override" |
| photos | loading "Linehaul sheet photographed" · departure "Seal photographed" · arrival "Seal photographed on arrival" · confirmation "Proof-of-delivery photo taken" |
| receiver | "Receiver confirmed delivery · Attestation image" (only when attributed `pod_signature` to this phase); otherwise "Submitted as receiver confirmation" |

This replaces the plan's "Driver confirmed {phase}", which reads "Driver confirmed Confirmation".

## 8. Decision

**Option C**, decided by the dispatcher owner on 2026-10-13 after seeing the A and C mockups at measured widths. Recorded here and in the plan (Revision 4) so it can be verified in a separate session before the build starts. Nothing is implemented.

| # | Decision | Where it is specified |
|---|---|---|
| 1 | Layout is C: Recorded and Checked side by side where the card is at least 740 px wide, has at least one check and is not in-transit; stacked (A) otherwise | §6, plan D30 |
| 2 | Tablet and desktop only; no mobile layout | §1 |
| 3 | An exception row on the timeline opens that exception in the exceptions panel (docked ≥ 1280 px, overlay below). `PhaseExceptionGroup` and the exception cards are removed from the timeline | §5 issue 1, plan Tasks 9a and 9, D33 |
| 4 | **In-transit is always expanded while it is happening and after it has happened** | §7.4, plan D31 |
| 5 | **Anchoring is shown only in forensic mode**, on every phase; so is the audit trail. Today's "Anchor failed" line is unchanged | §7.3, plan D32 |
| 6 | The right content in the right phases: the contract in §7 | §7, plan Tasks 8, 8b, 9, 10 |
| 7 | The white cards around exception rows are not settled (minor) | O1 |
| 8 | Header verdict, three zones, copy fixes (attestation label, plural helper, verb table) and the four-step type scale, as in §4 and §5 | §4, §5, plan D28–D29, D34–D37 |

The five original defaults stand, with default 5 revised and defaults 8–10 added (§6).

## 9. Open items to verify

| # | Item | Default in this note | Who decides |
|---|---|---|---|
| O1 | The white bordered cards around exception rows (the mockups use `surf-lowest` with a border on the grey phase card) | Keep until the Task 10 preview. Alternatives: no card with a left severity bar; or a light severity tint. Build the row as one component so the treatment changes in one place | Owner, minor |
| O2 | "Anchor failed — receipt still owed": visible to everyone (today) or forensic only | Visible to everyone, outside the verdict | Owner |
| O3 | Override "Authorised by (user id)": visible to everyone (today) or forensic only | Visible, inside the completion row | Owner |
| O4 | The completion verbs in §7.5 | As written | Owner |
| O5 | Exception cap: 3 rows then "+n more" on a collapsible card; whether the in-transit rail (never collapses, most exceptions) should cap higher | 3 everywhere; revisit in the Task 10 preview with the 15-exception trip | Owner |
| O6 | The in-transit mockup omits the "No location verdict for transit legs" line and its details (§7.2) | The contract in §7.2 wins | Verify in Task 10 |
| O7 | A leg with no exceptions reads "No exceptions recorded" (neutral), not "Clean" | As written | Owner |
| O8 | Two differing seal numbers with no exception flag the check (new behaviour) | On | Owner |
| O9 | The `exception=<id>` URL parameter name and the "+n more" row opening the panel filtered by `phase=` | As written | Implementer |

## 10. Found along the way, not in scope

- The 375 px scroller bug in `TripDetailPanel` (29 px tall): irrelevant now that phones are out of scope.
- The artifacts endpoint fails in this dev environment (no photos can render).
- `shared/lib/utils/render-attestation.ts:44` bakes "Swipe attestation taken on the driver's device" into the image the receiver's browser renders and the anchor hashes. Per the plan the receiver, not the driver, takes it. The text may be stale; it is part of hashed evidence, so it needs Tim's decision, not a quiet edit.
- "Driver confirmed Confirmation" / "Waiting for the driver to confirm Confirmation" (the plan's own wording) reads badly because the phase is named "Confirmation"; a per-phase verb table ("confirmed delivery") fixes it: now specified in §7.5 (open item O4).
- `PhaseAnchorSection` has no importers.

## Throwaway files (delete in Task 10, once the real `TripTimeline` scenarios exist)

- `frontend/dispatcher/app/dev/design/_timeline-options/` (`mock.ts`, `parts.tsx`, `options.tsx`, `TimelineOptions.tsx`). The mockups follow the decisions (C layout rule, in-transit always open, forensic toggle off by default) except O6
- one import and one `<TimelineOptions />` line in `frontend/dispatcher/app/dev/design/page.tsx`
