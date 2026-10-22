# Driver PWA cleanup audit

**Reviewed:** 22 October 2026. **Branch:** `dev`. **Scope:** `frontend/driver-pwa/`. The review covered all 239 non-test `.ts`/`.tsx` files and the root configs. Test files were checked for unused imports only.

**Outcome:** the code compiles and lints clean. The cleanup work is mostly comments, plus about 10 dead files or symbols. No application code was changed during this audit.

This is a dated snapshot, so recheck each line number against the current branch before editing. The line numbers were correct on `dev` on the review date.

---

## 1. How this was produced

| Check | Command (from `frontend/driver-pwa/`) | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit` | Clean |
| Unused locals and parameters | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | 11 findings (§3) |
| Lint | `npx eslint .` | 0 errors, 1 warning (`<img>` in a test file) |
| Unused files and exports | `npx knip@5` | 6 files reported; 4 confirmed dead, 2 false positives (§4) |
| Comment review | Manual read of every non-test source file, split by folder | §5 and §6 |

Every dead-code and stale-reference claim below was checked with `grep` across `frontend/driver-pwa` and `frontend/shared`. Rows marked **Confirm** are code deletions that need sign-off from the owner, not just a comment edit.

**Category key** used in the tables:

| Code | Meaning |
|---|---|
| `HIST` | Changelog or history in a comment ("previously…", "used to…", "no longer…", "was removed (date)", "moved here from…"). This belongs in git history or the PR description. |
| `REF` | Ticket or process reference: FP-83, "overhaul 3.2", "(Tim, 14 Oct)", "Fix 2", "Workstream 1", "audit H9", "decision D3". |
| `WHAT` | The comment restates the code beneath it. |
| `ESSAY` | AI-style over-explanation: 6 to 19 lines on a few lines of code, test strategy explained in production code, or citations of outside authorities (HIG, "as in Uber's app", `emil-apple-design §N`). |
| `STALE` | The comment points at a file or function that no longer exists, or contradicts the code. |
| `DEAD` | Unused code. |

---

## 2. Found during the review: not cleanup, needs an owner

These are behaviour issues the review turned up. Raise them separately from the cleanup PR.

| # | File | Finding | Suggested action |
|---|---|---|---|
| B1 | `next.config.ts:61-73` | `STATIC_ROUTES`, the service-worker precache list, is hand-maintained and out of date. It is missing `/profile`, `/evidence`, `/trips/past`, `/trips/upcoming`, `/trips/detail` and `/trips/substitution`. Those screens are not precached, so a cold offline launch cannot open them. The comment above the list says "re-derive after adding a page", which has not been happening. | Add the missing routes. Consider deriving the list from the `app/` tree. |
| B2 | `lib/hooks/useRotatingHandover.ts` | The rotation interval is built once from `rotationSecondsRef.current`. If the server changes the cadence later, the change is not picked up. **Not verified.** | Owner to check |
| B3 | `vitest.config.ts:11-13` | The comment says "No test files exist yet"; there are now 165. `passWithNoTests` would hide a broken test glob. | Delete the comment and drop `passWithNoTests` |

---

## 3. Unused imports and parameters (tsc)

| File | Line | Symbol | Action |
|---|---|---|---|
| `app/(app)/trip/in-transit/InTransitPageClient.tsx` | 45 | `import type { TripException }` | Delete the import |
| `app/(app)/trips/past/__tests__/PastTripsPage.test.tsx` | 1 | `within` | Delete it from the import |
| `components/phase/__tests__/StepLayout.test.tsx` | 11 | `const arrival` | Delete |
| `components/phase/steps/confirmation/Closed.tsx` | 25 | `tripId` prop | Remove it from the props interface and destructure, and from the test calls in `__tests__/Closed.test.tsx` (61, 118, 137) |
| `components/phase/steps/confirmation/Reconciliation.tsx` | 45 | `tripId` prop | As above; test calls at `__tests__/Reconciliation.test.tsx` (22, 31, 37, 46) |
| `components/phase/steps/unloading/VisualCount.tsx` | 28 | `tripId` prop | As above; test calls at `unloading/__tests__/VisualCount.test.tsx:63` and `steps/__tests__/visualCountBlindEntry.test.tsx` (81, 96) |

Two more unused props that tsc misses because they are never destructured:

| File | Line | Prop |
|---|---|---|
| `components/phase/steps/departure/ConfirmDeparture.tsx` | 19 | `tripId` |
| `components/phase/steps/activation/Verification.tsx` | 16, 19-20 | `tripId` and `draft` (the comment justifies `draft` only) |

These props can be removed safely. `PhaseStepPageClient.renderStep` widens the props it passes to every step, so the callers do not break.

Two minor import tidies:
- `InTransitPageClient.tsx:40-41` has two `import type` lines from `@/lib/types/location`. Merge them.
- **Outside the driver-pwa folder** (`frontend/shared/` is shared with the dispatcher, so coordinate): `frontend/shared/lib/types/phase.ts:12-16` has five unused type imports (`Driver`, `Vehicle`, `TripException`, `BlockchainReceipt`, and a whole import line). Its header also says `handshake.ts` still exists "during the refactor", but that file has been deleted.

---

## 4. Dead code

### 4.1 Files with no production importer

| File | Lines | Evidence | Action |
|---|---|---|---|
| `components/ui/Card.tsx` | 67 | Imported nowhere and has no test | Delete |
| `components/ui/IconButton.tsx` | 51 | Imported nowhere and has no test | Delete |
| `components/ui/Skeleton.tsx` | 40 | Imported nowhere and has no test | Delete |
| `components/phase/EvidenceReview.tsx` | 39 | Imported nowhere; only mentioned in a test comment | Delete |
| `lib/constants/status-meta.ts` | 1 | A re-export of `@shared/...status-meta`; every caller imports the shared path directly | Delete |
| `components/phase/SignaturePad.tsx` | 203 | Imported only by its own test; superseded by `ReceiverHandover` | Delete with `__tests__/SignaturePad.test.tsx` (**Confirm**) |
| `components/blockchain/AnchorProgress.tsx` | 121 | Imported only by its own test | Delete with its test unless use is planned (**Confirm**) |
| `components/ui/Chip.tsx` and `lib/utils/trip-status-chip.ts` | ~80 | `Chip` is used only by `trip-status-chip.ts`, which is imported only by its test | Delete the pair and their tests unless use is planned (**Confirm**) |
| `app/dev/tokens/page.tsx` | 216 | Dev-only and out of date. It references the undefined `var(--font-inter)`, labels the type as Inter, and its `TYPE_SCALE` and `RADII` disagree with `tailwind.config.ts`. | Delete or rebuild (**Confirm**). If deleted, `ROUTES.devTokens`, README line 18 and `simulateGateArrival` in `usePushNotifications` become orphans. |
| `app/(app)/settings/page.tsx` | small | A redirect-only route; nothing links to it (`ROUTES.settings` is unused) | Team call: keep it for old bookmarks or delete it. If deleted, also remove it from `nav-items.ts` and `next.config.ts`. |

knip also reported `app/sw.ts` and the `serwist` dependency as unused. Both are **false positives**: `next.config.ts` loads `app/sw.ts` as `swSrc`, and `app/sw.ts` imports `serwist`.

### 4.2 Unused functions, fields and branches

| Location | Symbol | Evidence | Action |
|---|---|---|---|
| `lib/offline/substitution-store.ts:255` | `removeCapture` | No callers | Delete |
| `lib/offline/queue-storage.ts:236` | `__resetQueueMigrationForTests` | No callers, including tests | Delete |
| `lib/context/TripContext.tsx:99-100, 564-578` | `triggerPanic`, `reset` | No consumers, including tests | Delete. tsc may then flag `useRouter`/`ROUTES` as unused. **Confirm** |
| `lib/context/TripContext.tsx:463-470` | Legacy single `supporting_artifact_id` branch in `logException` | Both callers pass `supporting_artifact_ids` | Delete the branch |
| `lib/hooks/useOfflineQueue.ts:138-152, 189, 263-266` | `droppedCount` / `dismissDropped` | Never set above 0 ("since FP-83 nothing is dropped") | Delete them and the `OfflineBanner.tsx:103-118` block that renders them. **Confirm** |
| `lib/hooks/useOfflineQueue.ts:472-475` | `dismissAttention` | Used only by a test. The comment says the banner offers it, but the banner never does. | Delete, or wire it up. **Confirm** |
| `lib/hooks/useOfflineQueue.ts:748` | `heldForOtherAccounts` in the hook's return value | Nothing reads it from this hook. (`RetainedEvidenceList` uses a different field with the same name.) | Remove from the return value |
| `lib/hooks/useOfflineQueue.ts:727` | `const flush = flushQueue` | A pointless alias | Use `flushQueue` directly |
| `lib/submission/phase-submitter.ts:220-222` | `SERVER_SNAPSHOT` | An alias of `EMPTY_STATE`; the comment says "frozen", but nothing freezes it | Use `EMPTY_STATE` |
| `components/trip/DriverSubstitutionFlow.tsx:319-321` | `const latest = context` | A pointless alias, and the comment describes a difference that does not exist | Use `context` |
| `components/settings/ThemeSelect.tsx:26-27` | `PREVIEW` | An alias of `THEME_PREVIEW_CLASSES` | Use the original |
| `components/phase/steps/confirmation/Closed.tsx:43-48` | `handleClose` | Only forwards `onComplete()` | Pass `onComplete` directly |
| `components/ui/Button.tsx:35, 39-41` | `danger` variant | No `<Button variant="danger">` anywhere. Panic uses `SwipeToConfirm`'s own `danger` variant. | Delete the variant and fix its comment |
| `lib/api/client.ts:75-77, 119` | `SIGNED_OUT_REASON_KEY` write | Written to sessionStorage, but no production code reads it (the comment says "read by the login screen") | Wire up the login message, or delete it. **Confirm** |
| `lib/context/AuthContext.tsx:32-33` | Re-export of `DemoOtpAuth` | Kept only so two tests keep their import path | Repoint the tests, then delete it |
| `lib/offline/exception-sync.ts:22` | Re-export of `DEFAULT_RATE_LIMIT_RETRY_MS` | Used only by a test | Point the test at `live-write-conflict` and delete it |
| `lib/tokens.ts:5-6` | Re-export of `ATTESTATION_CANVAS_COLOURS` | Nothing imports it through `@/lib/tokens` | Delete it and its comment |
| `lib/constants/routes.ts:50, 93` | `ROUTES.settings`, `ROUTES.devTokens` | Never used (`nav-items.ts` hard-codes `'/settings'`) | Delete, or use them |
| `app/login/page.tsx:79-99` | `DuskRoad` fallback | Unreachable, because `WELCOME_IMAGE_SRC` is a non-null constant | Team call: keep it as a deliberate toggle or delete it |

### 4.3 Duplicated code

| What | Where | Action |
|---|---|---|
| `placeOf()` | `components/trip/ActiveTripCard.tsx:12-15` and `TripRow.tsx:14` | Move it to `lib/utils/trip-display.ts` |
| `SEAL_LABEL` | `components/trip/DriverParticipationHistory.tsx:27-32` and `DriverSubstitutionFlow.tsx:46` | Move it to `lib/utils/driver-substitution.ts` |
| `(phase.blocked_on ?? null) !== null` plus a four-line comment | `Linehaul.tsx`, `VisualCount.tsx`, `Closed.tsx` | One helper with one comment |

### 4.4 Unused Tailwind config (`tailwind.config.ts`)

| Lines | What | Evidence |
|---|---|---|
| ~82 onward | Shorthand colour vocabulary (`canvas`, `surf*`, `on-surf*`, `sec`, `ok`, `err`, `warn`, `outline.v`), about 45 lines, labelled "Not yet consumed" | No class uses them in `app/`, `components/` or `lib/` |
| 204-209 | `font-headline/display/body/label` aliases | Never used |
| 261-268 | `accordion-down/up` keyframes and animations | There is no Radix accordion and no `animate-accordion` class |
| 280-283, 332-336 | `confirm-pulse` keyframe and animation | Never used |

### 4.5 Legacy-migration code: keep for now

FP-83 shipped on 19 October. The following code exists only to upgrade data written by older installs. **Do not delete it yet.** Agree a removal date once no pre-FP-83 installs remain in the field:
- the version-1 queue migration in `lib/offline/queue-storage.ts`
- `lib/offline/legacy-exception-migration.ts`
- `migrateLegacyDrafts` in `lib/offline/retained-drafts.ts`
- `quarantineUnattributedEnvelopes` in `lib/offline/exception-store.ts`
- the legacy waybill-photo path in `lib/api/phases.ts` (55-68, 331-342)

---

## 5. Comment cleanup: mechanical passes across the codebase

These six passes remove most of the noise and need no judgement on individual lines. Counts are for non-test source files. Run them as separate commits so each diff is easy to review.

| Pass | Pattern | Hits / files | Rule |
|---|---|---|---|
| P1 | File-path header (`// frontend/driver-pwa/...` on line 1) | 49 / 49 | Delete. The editor already shows the path. |
| P2 | Ticket refs: `FP-83`, `FP-83 T1/T2`, `FP-155`, `FP-237/238`, `FP-146`, `FP-280` | 75 / 45 | Delete the tag only. In almost every case the sentence stands on its own; check each one reads cleanly afterwards. |
| P3 | Plan refs: `(overhaul N.N)`, `Overhaul (Oct 2026)` | 60 / 51 | Delete the tag. The numbers do not resolve: the overhaul plan uses §0 to §5 headings. |
| P4 | Person, date and process refs: `(Tim, 14 Oct)`, `decision D1-D7`, `(D5)`, `(P6)`, `(7.1b)`, `Fix 1/2/3a/3b`, `Workstream 1`, `audit H3/H8/H9/M10`, `Stage 9`, `spec D6`, `design audit Q9` | ~40 / 25 | Delete the tag. Keep the reason. |
| P5 | `emil-apple-design §N` | 7 / 6 | Delete. No such document is in the repo, so the reference cannot be followed. |
| P6 | "handshake", `H1-H5`, `H2Linehaul`, `completeH1..H5`, `HandshakeStepPageClient` | 29 / 17 | Reword to the phase model ("phase submit", "phase step"). These names come from before the phase refactor. |

After P1 to P6, the history phrases ("previously", "used to", "no longer", "any more", "as of 2026-…": 55 hits in 34 files) need a manual edit, because the surrounding sentence usually has to be rewritten. §6 lists them file by file.

---

## 6. Comment cleanup: file by file

Only rows that need judgement are listed here. Tags covered by §5 (P1 to P6) are not repeated unless the block also needs trimming. "Trim to" gives a suggested replacement; the owner can reword it, as long as the *why* is kept.

### 6.1 `app/`

**`app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx`** has the most to clean.

| Lines | Cat | Action |
|---|---|---|
| 3-9 | HIST | Trim to: "URL keys on phase_type; the actual phase_event_id comes from the ledger, so a mismatch redirects." |
| 56 | HIST | Delete ("no longer captured here") |
| 72-79 | ESSAY | Trim to: "Re-widens the registry's ComponentType<never>; each call site still builds typed props." |
| 93-97 | HIST, STALE | Trim to: "Gate: no draft hook mounts until a real trip exists." (It refers to the deleted HandshakeStepPageClient.) |
| 102-117 | HIST, ESSAY | Trim to: "Latched at hand-off: the submitter can toggle shared isLoading, and a closed trip returns null." |
| 118-123 | HIST | Trim to: "Remember the last trip so closing it doesn't flash 'Trip not found'." |
| 129-135 | ESSAY | Trim to: "Pinned plan at swipe time, so the optimistic advance doesn't trigger the mismatch redirect." |
| 146-159 | HIST, ESSAY | Trim to: "Never mount draft hooks with an empty tripId: lazy init would read the wrong keys and overwrite saved evidence." |
| 205-212 | HIST | Trim to: "actionablePhase, not currentPhase: the driverless in_transit row stays PENDING until arrival." |
| 213-220 | ESSAY | Trim to: "Redirect when the URL's phase isn't the one the ledger says is due." |
| 263-273 | ESSAY | Trim to: "One component per phase type: usePhaseDraft can't take a union, and per-branch hooks break the Rules of Hooks." |
| 284-289 | HIST | Trim to: "Empty recipe, so unreachable; the in_transit hub submits instead. Cases kept for exhaustiveness." |
| 312-322 | HIST, ESSAY | Trim to: "Synchronous on every step; SwipeToConfirm treats a sync onConfirm as 'stay latched, navigating'." |
| 351-359 | ESSAY | Trim to: "Mirrors draft synchronously: onUpdate and onComplete run in one tick, before React re-renders." |
| 369-374 | ESSAY | Trim to: "One key per submission attempt, reused across manual retries." |
| 377-378, 643-646, 739-740 | HIST | Delete |
| 427-430, 435-440, 492-494 | HIST | Trim to the current behaviour (drop "now", "used to", "a fixed string discarded…") |
| 530-537, 611-617 | ESSAY | Trim each to one line |
| 673-676 | ESSAY | Trim to: "Exported for linehaul.test.tsx." |
| 703-707, 718-721 | HIST, WHAT | Trim to: "No carry-forward: seal comparison is server-side." (Once is enough.) |
| 757-766 | HIST, DEAD | Delete. It describes code that no longer exists and repeats 284-289. |

**`app/(app)/trip/in-transit/InTransitPageClient.tsx`**

| Lines | Cat | Action |
|---|---|---|
| 4-21 | HIST, ESSAY | Trim to: "Driving hub, not a step screen. The Arrive swipe closes the in_transit row. Panic must never sit behind a scroll." |
| 130-143 | ESSAY | Trim to: "System-detected exceptions are hidden from the driver (unreviewed, accusatory); dispatch still sees them." |
| 164-168, 337-340 | ESSAY | Drop the cross-reference to PhaseStepPageClient and keep one line of why |
| 193-203 | ESSAY | Trim to: "Not reachable today (nothing sets exception_hold); kept in step with PhaseStepPageClient." |
| 256-260, 268-281 | ESSAY | Trim each to 1-2 lines (the 268-281 block is 14 lines inside an object literal) |
| 443-447 | HIST | Trim to: "Swipe, not tap: one stray tap must not close the drive." |
| 465-467 | WHAT | Delete the first of the two stacked comments |

**Other `app/` files**

| File:lines | Cat | Action |
|---|---|---|
| `app/(app)/layout.tsx:57-62` | ESSAY | Trim to: "Location and substitution providers read the trip, so they sit inside TripProvider." |
| `app/(app)/profile/page.tsx:82-85` | HIST | Trim to: "Profile: who the driver is, plus the app's few settings." |
| `app/(app)/settings/page.tsx:10-15` | HIST | Trim to: "Redirect-only so old bookmarks land on Profile; replace() keeps Back off this hop." |
| `app/(app)/template.tsx:41-47` | ESSAY | Trim to: "A transform makes this the containing block for fixed children, so classes drop on animationend." |
| `app/(app)/trip/in-transit/checkpoint/CheckpointPageClient.tsx:29-32, 41-42, 158-159, 185-187` | HIST | Trim to the current behaviour; delete 158-159 |
| `…/CheckpointPageClient.tsx:84-85` | STALE | "handshakes use": change to "exceptions use" |
| `app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx:159-160` | STALE | Delete. Lines 161-162 supersede it. |
| `…/LogExceptionPageClient.tsx:422` | WHAT | Delete |
| `app/(app)/trip/panic/PanicPageClient.tsx:41-43, 68-74, 94-99, 141-142` | HIST, ESSAY, STALE | Trim each to one line; drop "same mechanism handshakes use" |
| `app/(app)/trips/[id]/TripDetailPageClient.tsx:24` | STALE | Delete `TODO Iter 2 backend`. This is now the demo route. |
| `app/(app)/trips/[id]/page.tsx:6` | STALE | Trim to: "Demo route: static params come from mock fixtures." |
| `app/(app)/trips/active/ActiveTripPageClient.tsx:13-16` | STALE | Claims to mirror a local `currentStepRoute` that does not exist. Trim to: "Route to the first step of the selected phase." (The same comment is in `HomeContent.tsx:20-23`.) |
| `…/ActiveTripPageClient.tsx:46-47` | HIST | Trim to: "Live trip: show only the current phase." |
| `app/(app)/trips/detail/TripDetailByIdPageClient.tsx:47-48` | ESSAY | Test-harness reasoning in production code. Trim to one line. |
| `…/TripDetailByIdPageClient.tsx:115-117, 210-213` | HIST | Trim to the current behaviour |
| `…/TripDetailByIdPageClient.tsx:174-182` | HIST, STALE | Split off the fused handover comment. The "see TripDetailViewProps.notice for the full reason" pointer leads nowhere useful. |
| `app/(app)/trips/past/page.tsx:20-23` | HIST | Trim to: "Every past trip by month; the list behind 'See all'." |
| `app/error.tsx:3-6, 14-15, 29-30`, `app/global-error.tsx:13-14` | ESSAY, WHAT, STALE | Trim the header to one line ("mid-handshake" is stale); delete the comments that explain Next.js's own signature |
| `app/login/page.tsx:12-21, 23-24, 66-68` | ESSAY | Keep the photo credit and licence; drop the "bank app" comparisons |
| `app/sw.ts:23` | STALE | "handshake state": change to "phase state" |
| `app/dev/tokens/page.tsx:66, 88, 115, 144, 164, 183` | WHAT | `── COLOURS ──`-style dividers (moot if the page is deleted) |

### 6.2 Root configs

| File:lines | Cat | Action |
|---|---|---|
| `next.config.ts:49-60` | ESSAY | Trim to 2 lines, and fix the list itself (see B1) |
| `next.config.ts:75-76` | WHAT | Delete |
| `tailwind.config.ts:9-12, 21-28, 33-37, 66-82` | HIST, ESSAY | Trim each to 1-2 lines (66-82 is a 17-line block) |
| `tailwind.config.ts:141-143, 148-150, 216-217` | HIST | Delete or trim |
| `tailwind.config.ts:295-298` | STALE | The iOS push/pop note is above `anchor-slide`; move it to `push-in` |
| `eslint.config.mjs:5-10` | ESSAY | Trim to: "eslint-config-next 15 uses legacy extends; FlatCompat bridges it into ESLint 9." |
| `vitest.config.ts:11-13` | STALE | Delete (see B3) |

### 6.3 `components/phase/`

| File:lines | Cat | Action |
|---|---|---|
| `CameraCapture.tsx:40-45` | ESSAY | Trim to: "Capacitor errors carry only a message string, so classify by substring." |
| `CameraCapture.tsx:80-82, 88-89, 101-103, 143-144` | HIST | Trim to the current why ("Previously unhandled", "always used", "lifted out of") |
| `CameraCapture.tsx:213-214` | WHAT | Delete |
| `CameraCapture.tsx:234-236` | ESSAY | Trim to one line |
| `SwipeToConfirm.tsx:14-18` | REF, ESSAY | Delete (lines 12-13 already give the why) |
| `SwipeToConfirm.tsx:29-31` | ESSAY | Drop "Exported so tests advance…" |
| `SwipeToConfirm.tsx:50-53, 482-484, 550-554` | HIST | Trim; drop the old-design narration |
| `SwipeToConfirm.tsx:521` | WHAT | Delete |
| `StepHeader.tsx:18-19` | ESSAY | Trim to: "0-based index into STEP_SLUGS[phase.phase_type]." |
| `StepLayout.tsx:40-44, 80-83` | HIST | Trim to the current purpose |
| `StepLayout.tsx:56-57` | WHAT | Delete |
| `LocationCheckModal.tsx:45-52` | HIST, STALE | Trim. It mentions the removed `LocationCheckNotice`. Keep 53-55. |
| `WarehouseWaitCard.tsx:21-25` | ESSAY | Trim to one line |
| `steps/registry.ts:28, 30` | HIST | Delete |
| `steps/departure/CaptureSeal.tsx:24-34` | HIST | 11-line changelog. Trim to: "Driver capture only. Guards have no accounts, so a re-typed number proves nothing the photo doesn't." |
| `steps/departure/CaptureSeal.tsx:49-51, 61-66` | HIST, ESSAY | Trim each to one line |
| `steps/departure/ConfirmDeparture.tsx:60` | WHAT | Delete |
| `steps/loading/Linehaul.tsx:27-32` | HIST | Delete (keep 33-35, the no-per-parcel-data why) |
| `steps/loading/Linehaul.tsx:39-45, 57-67` | ESSAY, HIST | Trim; 57-67 is 11 lines with dates and "was removed" |
| `steps/arrival/SealVerify.tsx:27-31` | HIST | Trim to: "Seal as found at the gate, before anything is opened." |
| `steps/arrival/SealVerify.tsx:87-92` | STALE | Says it mirrors CaptureSeal's local field, but CaptureSeal has no local state. Reword. |
| `steps/unloading/VisualCount.tsx:21-27` | HIST | Refers to a removed `h2Count` prop. Trim to: "Blind entry: never show the driver a number to match." |
| `steps/confirmation/ReceiverHandover.tsx:1-14` | HIST | Trim to: "Shows a rotating QR; the receiver signs on their own device." |
| `steps/confirmation/ReceiverHandover.tsx:124-128` | ESSAY | Trim to one line |
| `steps/confirmation/Reconciliation.tsx:46-47` | STALE | Points at `loading/VisualCount.tsx`, which does not exist. Trim to: "Return onComplete's promise so SwipeToConfirm can show in-flight state." |
| `steps/confirmation/Reconciliation.tsx:60-62` | ESSAY | Trim to one line |
| `steps/confirmation/Closed.tsx:29-33` | HIST | Trim; drop "gating on it made…" |
| `steps/confirmation/PodPhoto.tsx:1-5` | STALE | Refers to `PodSignature.tsx`, which does not exist. Trim to: "POD photo step; the receiver's signature is captured in ReceiverHandover." |
| `steps/confirmation/PodPhoto.tsx:27-29` | HIST | Drop "as before" |

The "upload starts at capture" explanation is repeated in CaptureSeal, SealVerify, Linehaul and PodPhoto. Document it once in `useArtifactUpload` and cut the copies to one line.

### 6.4 Other `components/`

| File:lines | Cat | Action |
|---|---|---|
| `auth/AuthFrame.tsx:17-24` | ESSAY | Trim to one line |
| `blockchain/AnchorProgress.tsx:3-7, 26-29, 35-42, 51-54` | ESSAY, STALE | Trim; 35-42 cites `completeH2/H5`, which do not exist (moot if the file is deleted) |
| `brand/LogoMark.tsx:3-13` | ESSAY | 11-line design narrative. Trim to 2 lines. |
| `home/DriverRecord.tsx:10-14` | HIST | Trim to: "Three tiles summarising the driver's own trips. On time = arrived by planned time." |
| `home/HomeContent.tsx:20-23` | STALE | Same false "local currentStepRoute" claim as ActiveTripPageClient |
| `home/HomeContent.tsx:39-41` | HIST | Trim to one line |
| `home/NowCard.tsx:37-38` | HIST | Drop "now also" |
| `layout/AppShell.tsx:23-27, 54-61, 74-79, 83-92` | ESSAY | Trim each to one line (HIG citations, "used to hover") |
| `layout/BottomNav.tsx:17-27` | HIST, ESSAY | Trim to: "Floating glass tab bar; sizes in px because iOS tab bars ignore Dynamic Type." |
| `layout/OfflineBanner.tsx:25-31, 33-36, 53-56, 66-69, 77-81, 103-107, 125-128` | ESSAY, REF | Trim each; drop "Workstream 1" and "Fix 3a/3b" |
| `layout/SubpageHeader.tsx:60-64, 98-101` | HIST, ESSAY | Trim |
| `layout/TabSubpage.tsx:24-28` | ESSAY | Drop the HIG quote |
| `offline/RetainedEvidenceList.tsx:60-62` | STALE | "same pattern as OfflineBanner" is wrong: the banner has no discard confirm |
| `profile/AppearanceSheet.tsx:12-18`, `profile/SignOutSheet.tsx:14-18` | REF, ESSAY | Trim to one line each |
| `settings/ThemeSelect.tsx:40-46` | ESSAY | Trim to one line |
| `theme/TextSizeCap.tsx:6-12` | REF, ESSAY | Trim to: "iOS AX1 body size; layouts break above it." |
| `trip/DriverSubstitutionFlow.tsx:290-296` | ESSAY | Trim to one line |
| `trip/DriverSubstitutionPanel.tsx:92` | ESSAY | Test-harness reasoning in production code. Trim. |
| `trip/HoldNotice.tsx:5-11` | HIST, STALE | Trim; "handshake" and "H4" are stale |
| `trip/PhaseList.tsx:60-64` | ESSAY | Trim to one line |
| `ui/Button.tsx:9-11, 16-18, 28-33, 36-37, 45-48, 52-54, 56-57` | HIST | Narration of the old design throughout. Line 16 also names `RequirementChecklist` (the component is `RequirementChips`). |
| `ui/Chip.tsx:19-23, 35-37, 40-45` | ESSAY, WHAT, STALE | Trim; 40-45 cites `GpsCapture`, which does not exist (moot if deleted) |
| `ui/CountryCodeSelect.tsx:14-16` | ESSAY | Drop the Google/WhatsApp name-drops |
| `ui/CountryCodeSelect.tsx:91` | STALE | Points at `Input.tsx` for a "text-base" reason, but Input uses `text-body`. Reword to: "16px+ so iOS doesn't zoom." |
| `ui/Drawer.tsx:42-51, 53-56, 78-81, 190-193, 227-231` | ESSAY, HIST | Trim each to one line |
| `ui/Input.tsx:32-35`, `ui/TextArea.tsx:33-34` | HIST, STALE | Trim; the TextArea comment contradicts the code (`text-body`, not `text-base`) |
| `ui/ListSection.tsx:19-22`, `ui/SectionHeading.tsx:13-17`, `ui/RouteRail.tsx:19-24` | HIST, ESSAY | Trim; drop the "Uber" and "old card" narration |
| `ui/Modal.tsx:19-25, 29-33, 48-51` | HIST, ESSAY | Trim. "its one caller" is wrong: there are five uses. |
| `ui/OtpInput.tsx:14-18, 26-30, 64-65, 95-99, 109-111` | HIST, ESSAY | Trim; drop "Shopify-style" and the bug history |
| `ui/Switch.tsx:36-38` | HIST | Trim; it refers to a Settings card that no longer exists |
| `ui/Toast.tsx:65-67, 102-105, 143-147` | ESSAY, HIST | Trim each to one line |

### 6.5 `lib/hooks/` and `lib/context/`

| File:lines | Cat | Action |
|---|---|---|
| `hooks/useOfflineQueue.ts:292-296` | STALE | The comment describes `migrateLegacyExceptions` but sits above `migrateForCustody`. Move it. |
| `hooks/useOfflineQueue.ts:412-414` | HIST | Trim to: "Every other refusal, 409 included, is kept: a 409 can mean the trip was handed over." |
| `hooks/useSubstitutionCapture.ts:3-9` | ESSAY | Trim to one line |
| `hooks/useLocation.ts:34-42, 61-67, 144-147` | ESSAY | Trim each to one line |
| `hooks/useLocation.ts:47-49` | STALE | Says the codes are reused for native rejections; they are not. Trim to: "W3C GeolocationPositionError codes." |
| `hooks/useLocation.ts:160-161` | STALE | `GpsCapture` does not exist. Delete. |
| `hooks/useDriverSubstitutions.ts:20-24`, `hooks/useOptionalTrip.ts:8-10` | ESSAY | Test-harness reasoning in production code. Trim. |
| `hooks/useVisualCountCarry.ts:8-21` | HIST, ESSAY | 14 lines about the deleted `useSealReference`. Trim to one line. |
| `hooks/useMyTrips.ts:5` | HIST | Delete ("Moved here unchanged") |
| `hooks/usePermissionStatus.ts:37-38` | DEAD | `console.info` fires on the expected unsupported-API path. Delete it, or log only unexpected errors. |
| `hooks/usePushNotifications.ts:12-17, 26-35` | HIST | Trim to the current rule |
| `hooks/usePushNotifications.ts:21-22` | STALE | `/_dev/tokens` should be `/dev/tokens` |
| `hooks/useArtifactUpload.ts:3-13` | HIST, ESSAY | Trim to: "Uploads at capture; on failure the data URL stays and uploads at submit." |
| `hooks/useRotatingHandover.ts:3-12` | ESSAY | Trim to: "Two clocks: server-owned QR rotation and a faster confirmation poll. Don't couple them." |
| `hooks/useTripAutoRefresh.ts:47-50, 57-62, 72-75, 86-92` | ESSAY | Trim each to one line |
| `hooks/useIdleTimeout.ts:21-27` | ESSAY | Trim to: "Only real user input resets the clock; background traffic doesn't." |
| `context/TripContext.tsx:24-26, 35-38` | STALE | Cites `trip_service` and `exception_service`; these are now `orchestration/trips/queries.py` and `orchestration/exceptions/creation.py` |
| `context/TripContext.tsx:29-33, 109-113, 390-397, 439-441` | HIST | Trim to the current why |
| `context/TripContext.tsx:59-63` | REF | "is not this task's to change" is process narration. Reword. |
| `context/TripContext.tsx:102-107, 192-198, 244-247, 316-320, 346-349, 377-379, 412-415, 423-426, 451-452, 504-513` | ESSAY | Trim each to one line. 377-379 says "match its style", which is an instruction to the author, not a comment. |
| `context/TripContext.tsx:342-343, 522-526` | WHAT | Delete; 522-526 has two near-duplicate comments |
| `context/LocationContext.tsx:5-10` | HIST | Delete (keep the POPIA bullets at 12-19) |
| `context/DriverSubstitutionContext.tsx:3-11, 59-60` | ESSAY | Trim |
| `context/ToastContext.tsx:22-25, 38-39` | HIST | Trim |
| `context/AuthContext.tsx:56-58` | STALE | Describes tracking that lives elsewhere (`loadedSubject`). Delete. |
| `context/AuthContext.tsx:134-135` | ESSAY | Drop the cross-reference to the dispatcher app |

### 6.6 `lib/offline/` and `lib/api/`

| File:lines | Cat | Action |
|---|---|---|
| `offline/live-write-conflict.ts:1-7` | HIST, ESSAY | Trim to: "Classify a failed queued send by server error code, never HTTP status alone." |
| `offline/live-write-conflict.ts:45-46` | STALE | "the queue re-exports this", but it does not |
| `offline/queue-storage.ts:2-5, 95-98` | HIST | Trim ("Split out of useOfflineQueue…") |
| `offline/substitution-store.ts:1-9`, `offline/late-evidence-sync.ts:2-10`, `offline/retained-drafts.ts:1-7`, `offline/retained-evidence.ts:1-6` | ESSAY | Headers of 6 to 10 lines. Trim each to 1-2 lines. |
| `offline/testing/fake-indexeddb.ts:3-4` | STALE | Says only `exception-store` uses it; `substitution-store` tests do too |
| `api/client.ts:11-16, 145-151, 219-228, 243-248` | ESSAY, HIST | Trim each to one line |
| `api/client.ts:88-91, 207-209` | HIST | Drop "is new" and "previously let" |
| `api/client.ts:130-131` | WHAT | Delete (it duplicates 11-16) |
| `api/phases.ts:90-93, 265-269` | HIST | Trim |
| `api/phases.ts:396-397` | HIST | Delete (it repeats 90-93) |
| `api/phases.ts:453-461` | WHAT | 9-line header that restates the parameters. Trim to 1-2 lines. |
| `api/checkpoints.ts:12-16, 75-77` | ESSAY | The same cross-reference appears twice. Keep one line. |
| `api/checkpoints.ts:31-33, 90-92, 96-104` | STALE | `H1-H5`, `completeH1..H5`, `handshakes.ts`: none exist. Delete or trim. |
| `api/checkpoints.ts:35-38, 41-43` | HIST | Trim |
| `api/manifest.ts:6-18` | STALE, ESSAY | 13 lines citing the missing `handshakes.ts` and `H2Linehaul.tsx`. Trim to: "Returns null on 404 (no Linehaul document yet), which is normal." |
| `api/driver-substitutions.ts:1-7, 48-49, 57, 96` | REF | "C6", "T2" and "T3" do not appear in the contract doc. Remove them and trim the header. |
| `api/handover.ts:1-11` | ESSAY | Trim to: "Not queued offline: a handover token is only useful while the receiver is present." |
| `api/artifacts.ts:11-12` | WHAT | Delete |
| `api/artifacts.ts:55-59` | HIST | Trim |
| `api/artifacts.ts:62-67` | STALE | Cites `orchestration/artifact_service.py`; the real file is `orchestration/evidence/artifacts.py` |
| `api/geocode.ts:1-5, 17, 21-22, 40-41` | STALE, WHAT, ESSAY | Trim; "handshake submission" and "no key yet" are stale |
| `api/locations.ts:3-5` | HIST | Trim ("Replaces the three manual…") |
| `api/exceptions.ts:16-21` | ESSAY | Trim to one line |
| `api/exceptions.ts:30-37` | STALE | Cites `sendException`, which does not exist (the function is `sendExceptionReport`) |

### 6.7 The rest of `lib/`

| File:lines | Cat | Action |
|---|---|---|
| `auth/ApiDriverProfileSource.ts:15-24` | ESSAY | Trim to: "Interpolated into the message: the iOS bridge stringifies Error args to {}." |
| `constants/app.ts:4-7, 9` | HIST | Trim and delete |
| `constants/country-codes.ts:1-5` | WHAT | Trim to one line |
| `constants/env.ts:1` | STALE | Demo mode is now the `DemoOtpAuth`/`DemoDriverProfileSource` adapters. Reword. |
| `constants/routes.ts:47` | HIST | Drop "(Oct 2026)" |
| `constants/type-scale.ts:1-14` | ESSAY, STALE | A 13-line header; the JSDoc is attached to nothing. Trim and fix the placement. |
| `haptics.ts:1-8`, `motion/spring.ts:1-9` | ESSAY | Trim to one line each |
| `navigation/back-stack.ts:1-15, 45-47` | HIST, ESSAY | Keep the three rules and drop the history |
| `navigation/nav-items.ts:1-5, 17-25, 29-31` | HIST, ESSAY | Delete 1-5 (it names the removed NavDrawer and handshake-flow.ts); trim the rest |
| `navigation/useEdgeSwipeBack.ts:3-12` | ESSAY | Trim |
| `phase/derive.ts:48-57, 95-102` | ESSAY, HIST | A 10-line JSDoc on a 2-line function. Trim both. |
| `phase/routes.ts:15-16` | STALE | An orphaned JSDoc that belongs on `phaseStepRoute`. Move it. |
| `phase/routes.ts:23-26, 32, 49, 74` | ESSAY, WHAT | Trim and delete |
| `phase/stop-label.ts:8-11` | HIST | Trim |
| `route/eta.ts:7-13` | WHAT | Steps 1-4 restate the code. Trim to one line. |
| `session/custody-context.ts:3-5, 101-102` | ESSAY | Trim; 101-102 repeats 92-94 |
| `submission/phase-submitter.ts:5-16` | HIST | Trim ("Before this module…") |
| `submission/phase-submitter.ts:30, 97, 192, 288` | WHAT | Delete the `// ─── Section ───` banners |
| `submission/phase-submitter.ts:39-46, 155-169, 277-282` | ESSAY | Trim; 39-46 says "single worst defect this platform can ship", which is hyperbole |
| `submission/phase-submitter.ts:54-55` | WHAT | Delete |
| `submission/phase-submitter.ts:359-362, 384-386` | HIST | Trim |
| `theme.ts:6-13, 69-72, 99-117` | ESSAY, HIST | Trim; 99-117 is a 19-line JSDoc |
| `tokens.ts:29-39` | HIST | Trim to: "Dark Google Maps style; raw hex exempt here." |
| `types/driver-trip.ts:6-7, 31-32` | HIST, REF | Delete and trim |
| `types/driver-trip.ts:34-39` | STALE | "until the backend sends them": the backend schemas now carry these fields. Check and reword. |
| `types/evidence-draft.ts:29-31, 48-51` | HIST | Trim and delete |
| `types/evidence-draft.ts:89-91` | STALE | `lib/utils/render-attestation.ts` is in `shared/`, not driver-pwa |
| `types/user.ts:1-3` | WHAT | Delete |
| `types/user.ts:7-8` | STALE | "handshake screens" |
| `utils.ts:17-19` | WHAT | Delete |
| `utils/activation-gate.ts:1-9, 85, 113` | ESSAY, WHAT | Trim and delete |
| `utils/bounded-capture.ts:10-18` | WHAT | A 9-line JSDoc that restates `Promise.race`. Trim. |
| `utils/image.ts:2-3, 57-60` | HIST | Trim |
| `utils/precinct-name.ts:7-9` | STALE | "Mock-backed until Iter 2": the server names are now used first. Trim to: "Fallback for demo rows and unresolved precincts." |
| `utils/trip-filters.ts:1-7, 71-79` | HIST, ESSAY | Trim |
| `utils/trip-status-chip.ts:6-19` | ESSAY | A 14-line essay (moot if the file is deleted, see §4.1) |

---

## 7. Suggested execution plan

The cleanup touches about 150 files across every folder in driver-pwa, so split it to avoid conflicts with the other devs' branches.

| PR | Contents | Risk | Verify with |
|---|---|---|---|
| 1. Dead code | §3 unused imports and props, §4.1 to §4.4. Rows marked **Confirm** only after the owner agrees. | Low to medium (deletions) | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`, `npx eslint .`, `npx vitest run`, `npm run build` |
| 2. Mechanical comment passes | §5 P1 to P6 | Very low (comments only) | `npx tsc --noEmit`, plus a read of the diff |
| 3. File-by-file trims | §6, split by folder (app, components, lib) so each owner reviews their own area | Very low | The same as PR 2 |
| Separate | §2 B1 to B3 | Behaviour change | The owner's own tests |

Once PR 1 lands, add `"noUnusedLocals": true` and `"noUnusedParameters": true` to `tsconfig.json`, so unused imports fail the type-check instead of piling up again.

To stop the comment patterns coming back, add a short rule to the team's review checklist: **comments state the current *why*. Ticket numbers, dates, names and "previously…" narration go in the commit message or PR description.**

---

## 8. Out of scope

- **Test files:** checked for unused imports only. Several test files carry the same changelog-style comments; leave them for a separate pass.
- **`frontend/shared/`:** shared with the dispatcher. The one finding (`shared/lib/types/phase.ts`) is noted in §3 for coordination.
- **`android/`, `ios/`, `public/sw.js`:** generated output.
