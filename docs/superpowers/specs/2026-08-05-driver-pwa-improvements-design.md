# Driver PWA Improvements — Design

**Date:** 2026-08-05
**Branch:** `Driver-Pwa-Improvements`
**Owner:** Tim (driver side)

Source: Tim's phase-by-phase review notes. In those notes the `Phase N:` headings are
**trailing** labels — the `From X to Y` subtitle under each heading identifies the phase
actually being described. Mapping used throughout this document:

| Note subtitle | Phase | Files |
|---|---|---|
| From Activation to loading | `activation` | `steps/activation/Verification.tsx` |
| From Loading to Departure | `loading` | `steps/loading/VisualCount.tsx` |
| From Departure to In transit | `departure` | `steps/departure/*` |
| "no step from in transit to unloading" | `in_transit` | `app/(app)/trip/in-transit/*` |
| From Unloading to Confirmation | `unloading` | `steps/unloading/*` |
| Completion | `confirmation` | `steps/confirmation/*` |

---

## Decisions taken before work started

1. **Scope reaches shared + backend, minimally.** Removing a step from the `unloading`
   recipe changes `STEP_SLUGS`, and `backend/tests/unit/test_phase_meta_contract.py`
   parses `frontend/shared/lib/constants/phase-meta.ts` and fails if the two disagree.
   Removing the guard-confirms-seal step also requires a backend change, because
   `advance_departure` writes a CRITICAL `seal_mismatch` exception whenever
   `guard_verified_seal` is `false`. No Alembic migration, no dispatcher-portal edits.
2. **Map: Google Maps JS API.** Requires `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Built
   key-ready: with no key present the map degrades to a coordinates card rather than
   blocking the build or the driver.
3. **Recipient ID number: stamped into the signed attestation**, not a new DB column.
   No migration, no dispatcher work; the ID travels inside the signature artifact that
   the dispatcher already renders.

## Standing constraints

- **POPIA.** The recipient's ID number is personal data. It lives inside the attestation
  PNG in Supabase Storage (`af-south-1`). Only the SHA-256 hash of that artifact ever
  reaches Hedera. Nothing in this work may put an ID number, a name, or a coordinate
  into a Hedera payload.
- **F1 blind visual count.** Neither `loading/VisualCount.tsx` nor
  `unloading/VisualCount.tsx` may display an expected count, a Parcel Perfect figure, or
  a mismatch banner. Tim's note about comparing against the waybill count is
  **explicitly deferred** pending the Parcel Perfect integration — no work on it here.
- **Evidence, not operations.** The in-transit map shows the driver where they are. It
  does not route, reroute, or navigate.
- **Guards and warehouse staff have no accounts** (CLAUDE.md domain rules). This is the
  standing justification for deleting the guard-confirms-seal step.

---

## Workstream 1 — Responsive submit + always return home

**The complaint:** "Once swiped it must go straight to home and upload the hedera and to
the db in the background so the driver does not have to sit and wait for hours."

**Today:** `usePhaseStepController.submitAndAdvance` in `PhaseStepPageClient.tsx` awaits
`capturePosition()`, then awaits `submitPhase()` (which uploads photos, then POSTs, then
waits on the Hedera anchor server-side), and only then navigates. The driver watches a
"Submitting…" track for the whole round trip.

**Design.** A background submitter that survives navigation, living outside the step
component's lifecycle.

1. On swipe, capture the position with a short timeout and a last-known-fix fallback, so
   a cold GPS can never be the thing that blocks the transition.
2. Hand the submission to a module-scope submitter (`lib/submission/phase-submitter.ts`).
   It runs in memory, keyed by `phase_event_id`, and is not tied to any mounted component.
3. Apply an **optimistic local advance** in `TripContext`: mark the addressed phase
   resolved with a `syncing` flag so Home does not immediately re-offer the step the
   driver just finished.
4. Navigate to `ROUTES.home` immediately.
5. When the real response lands, `adoptTrip(result.trip)` reconciles the optimistic state
   and the anchor toast fires from wherever the driver now is.

**Why in-memory and not the existing localStorage queue.** Photo evidence is carried as
data URLs. Routing every submit through `useOfflineQueue` would write megabytes into
localStorage on every phase and blow the ~5MB quota within one trip. The localStorage
queue stays exactly what it is today: the **failure** path.

**Failure handling — the part that must not lose evidence.**

- The draft is **not cleared on enqueue**. It clears only once the server confirms.
- Queueable failure (network, 5xx, timeout): fall through to `enqueuePhase` as today.
- Terminal failure (4xx that is not a 409, or a local validation throw): roll the
  optimistic advance back, restore the phase as unresolved, and raise a persistent error
  notice so the driver can re-enter the step with their draft intact. Silence here would
  mean a driver believing evidence was recorded when it was not — the exact failure this
  platform exists to prevent.
- Duplicate protection: the existing per-attempt idempotency key still applies, and the
  optimistic advance prevents the step being re-entered while a submit is in flight.

**Always return home.** `advance()` currently pushes `nextStepRoute(...)` for every step.
Change: mid-phase steps still walk to the next step in the same recipe; the **final step
of a phase** routes to `ROUTES.home`. This is what Tim asked for on activation, loading,
unloading and confirmation, and it is what makes the in-transit hub reachable (below).

**Files:** `app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx`,
`lib/context/TripContext.tsx`, new `lib/submission/phase-submitter.ts`,
`components/layout/OfflineBanner.tsx`, tests.

---

## Workstream 2 — The missing in-transit driving step, with a map

**The complaint:** "There currently no step from in transit to unloading this is an
error." Correct, and the cause is precise: `in_transit` has an empty step recipe and
`_auto_complete_in_transit` (in `phase_service.py`) closes it the moment `departure`
advances. So `currentPhase()` is already `unloading` by the time the driver looks, the
`current?.phase_type === 'in_transit'` check in `HomeContent.tsx` and `TripDetailView.tsx`
never fires, and the in-transit hub at `/trip/in-transit` — which already exists, with
panic, log-exception and checkpoint — is unreachable in a real trip.

**Design — frontend only.** Do not give `in_transit` a driver step and do not remove the
server-side auto-complete. Both would change the phase contract for a screen that is a
hub, not an evidence capture. Instead derive the driving state client-side:

```
isDriving(phases) — the current unresolved phase is `unloading`, and the phase
immediately preceding it by sequence_number is a RESOLVED `in_transit`.
```

Keyed on `sequence_number`, never on `phase_type` alone, so a cross-dock plan with
several `in_transit` legs works leg by leg.

**Wiring.** `departure` completes → home (Workstream 1). Home sees `isDriving` and shows
the driving screen as the primary action instead of the unloading card. The driving
screen's "Arrive at destination" walks to `unloading`'s first step.

**The driving screen** (`/trip/in-transit`), rebuilt around what a driver needs while
actually moving:

- **Map**, the largest element. Google Maps JS API loaded client-side (`output: 'export'`
  forbids anything else), centred on the phone's own fix, following the driver.
- **Panic**, always visible, never behind a scroll.
- **Log exception**, opening the existing exception screen with its type list.
- **Log checkpoint**, kept.
- **Arrive at destination**, the way out.
- Open exceptions list, kept.

**Map degradation, in order:** no API key configured → coordinates card with accuracy and
an "Open in Maps" handoff; key present but tiles unreachable (offline, dead zone) → same
card, with the last known fix; no GPS fix at all → an honest "position unavailable"
state. The map must never render a plausible-looking wrong position.

**Capacitor note to flag:** HTTP-referrer restrictions on a Google Maps key do not work
from the `capacitor://localhost` origin used by the Android/iOS builds. The key needs an
Android app restriction (package name + SHA-1) or must stay unrestricted for the APK.

**Files:** `lib/phase/derive.ts`, `lib/phase/index.ts`, `components/home/HomeContent.tsx`,
`components/trip/TripDetailView.tsx`,
`app/(app)/trip/in-transit/InTransitPageClient.tsx`, new `components/map/DriverMap.tsx`,
`lib/constants/env.ts`, `.env.example`, `frontend/driver-pwa/package.json`, tests.

---

## Workstream 3 — Step surgery and the backend contract

### 3a. Departure: delete the guard-confirms-seal step

Tim: "Seal Number + photo for Driver is perfect… However remove the step of the guard
confirms seal number that is not needed and redundant."

The guard has no account and never will (CLAUDE.md). Handing a driver's phone to a gate
guard to re-type a number the driver just photographed proves nothing the photograph does
not already prove.

- `steps/departure/CaptureSeal.tsx`: remove the confirm `Input`, the three match/mismatch
  cards, the `sealsMatch` import and the format hint for the confirm field. What stays:
  seal number, seal photo, format validation.
- `lib/types/evidence-draft.ts`: drop `sealNumberConfirmed` and `sealVerifiedMatch` from
  `DepartureEvidence`.
- `lib/api/phases.ts`: stop sending `seal_number_confirmed` and `guard_verified_seal`.
- `steps/departure/ConfirmDeparture.tsx`: the readiness gate currently requires
  `sealNumberConfirmed !== null` — re-gate on `sealNumber` and `sealPhotoDataUrl`, and
  drop the "Seal confirmed" review row.
- **Backend:** `DepartureCompleteRequest.guard_verified_seal` becomes
  `Optional[bool] = None`. In `advance_departure`, only an explicit `False` — or a real
  `seal_number_confirmed` that fails to match — writes a `seal_mismatch` exception. A
  `None` is "no independent confirmation was collected", which is not an anomaly.
  Backend tests updated to cover all three states.

### 3b. Departure: linehaul document, not waybill

"Photograph the linehaul document not the waybill. Document will be received from a
warehouse staff member." Copy and display-name change only.

- `STEP_NAMES.departure[1]`: `'Photograph Waybill'` → `'Photograph Linehaul Document'`
  (`frontend/shared/lib/constants/phase-meta.ts` — shared file, flag it).
- **The slug `3-waybill` does not change.** It is in `STEP_SLUGS`, mirrored in the backend,
  contract-tested, embedded in every stored draft key and deep link. Renaming it buys a
  tidier URL and costs a broken contract.
- The wire field `waybill_photo_artifact_id` does not change either.
- `steps/departure/Waybill.tsx`: `CameraCapture` label and instruction copy describe the
  linehaul document and say it comes from warehouse staff.

### 3c. Unloading: remove the broken-seal step

"Intact seal photo is good. Broken seal photo can be removed."

The intact photo is the evidence — it proves the trailer was not opened in transit. The
broken-seal photo is captured after the fact and proves nothing; it is also never sent
(`lib/api/phases.ts` sends only the intact photo as `gate_photo_artifact_id`).

- Delete `steps/unloading/SealBreakInspection.tsx` and its entry in
  `steps/registry.ts`.
- Remove `'3-seal-break-inspection'` from `STEP_SLUGS.unloading` and
  `'Wait for Inspection'` from `STEP_NAMES.unloading`
  (`frontend/shared/lib/constants/phase-meta.ts`).
- Mirror in `backend/app/core/phase_meta.py` — **required**, or
  `test_phase_meta_contract.py` fails.
- Drop `sealBrokenPhotoDataUrl` from `UnloadingEvidence`.
- Surviving slugs keep their numbers (`1-hand-waybill`, `2-seal-verify`, `4-visual-count`).
  The prefix orders the list, it is not an index; renumbering breaks stored drafts and
  deep links for no gain. This matches the precedent already set when the GPS steps were
  removed on 2026-08-05.

### 3d. Unloading: blind the seal verification

"It must not show the driver the seal at departure he should already know this take it
away. If seal number is different do not show driver that there is an exception silently
log it nor must it say the seal matches."

This is the same principle as the blind visual count, applied to the seal: a driver shown
the expected number before typing has not independently verified anything.

In `steps/unloading/SealVerify.tsx`, remove: the "Seal set at departure" reference card,
the match card, the mismatch card, the null-reference note, the `Swipe to flag` label and
the `danger` variant. The swipe label is always "Swipe to submit". What stays: the seal
number input, format validation, the intact seal photo.

**The mismatch is still recorded, and this is verified, not assumed.** `advance_unloading`
compares `seal_number_at_destination` against the leg's own departure event server-side
and writes a CRITICAL `seal_mismatch` `TripException` itself
(`phase_service.py`). No client-side comparison is required for the exception to fire.
The `useSealReference` carry-forward and the `referenceSealNumber` prop become dead and
are removed.

### 3e. Unloading: home, not next step

Covered by Workstream 1 — `4-visual-count` is the final step, so it routes home.

**Files:** `steps/departure/*`, `steps/unloading/*`, `steps/registry.ts`,
`frontend/shared/lib/constants/phase-meta.ts`, `lib/api/phases.ts`,
`lib/types/evidence-draft.ts`, `lib/hooks/useSealReference.ts`,
`backend/app/core/phase_meta.py`, `backend/app/schemas/phases.py`,
`backend/app/orchestration/phase_service.py`, plus tests on both sides.

---

## Workstream 4 — Recipient identity on the POD signature

"Digital signature is good… can you also add more details to the capture of this mainly
the recipients ID NUMBER as a field."

- `steps/confirmation/PodSignature.tsx`: two fields above the signature —
  **Recipient full name** and **Recipient ID number** — both required before the swipe
  arms. A signature with no identifiable signer is the weakest possible POD.
- `lib/utils/render-attestation.ts`: draw the name and ID number into the attestation PNG
  alongside the existing timestamp and position, so the identity is part of the hashed
  artifact rather than metadata beside it.
- `lib/types/evidence-draft.ts`: `recipientName` and `recipientIdNumber` on
  `ConfirmationEvidence`, persisted in the draft so a back-navigation does not lose them.
- SA ID validation: 13 digits. Validate the length and digits, but **do not block** on a
  failed Luhn check — a foreign passport number or a mistyped digit is itself evidence and
  must be recordable, matching the precedent set by the deliberately free-form
  `seal_number_confirmed` field in the backend schema.
- No backend change, no migration, no dispatcher change.

**Follow-up to raise with the team (not built here):** a structured
`recipient_id_number` column on `PhaseEvent` would make this queryable and reportable.
That needs an Alembic migration and a dispatcher-portal change, so it belongs in a
coordinated ticket rather than this branch.

---

## Workstream 5 — Typography and copy

"All text sizes need to be increased in the flow." A driver reads this in daylight, in a
cab, possibly in gloves. One consistent step up across every phase screen — not
per-screen guesses:

| Role | From | To |
|---|---|---|
| Step instruction paragraph | `text-sm` | `text-lg leading-relaxed` |
| Secondary / helper text | `text-sm` | `text-base` |
| Card heading ("Action required") | `text-sm font-semibold` | `text-lg font-semibold` |
| Validation / error hints | `text-sm` | `text-base` |
| `SwipeToConfirm` label | `text-sm` | `text-base` |
| `SwipeToConfirm` track height | `h-14` | `h-16` (thumb `48px` → `56px`) |
| `StepHeader` step name | `text-base` | `text-lg` |
| `StepHeader` phase name / counter | `text-xs` | `text-sm` |
| Input labels and values | — | `text-base` minimum |
| `EvidenceReview` rows | `text-sm` | `text-base` |

Applies to every screen in the phase flow, the in-transit hub, panic, exception and
checkpoint screens. Not to the trips list or settings, which are not walked mid-trip.

**Em dashes** out of driver-facing copy — named explicitly for
`activation/Verification.tsx` ("Swipe to start this trip…") and
`departure/ConfirmDeparture.tsx` ("You are about to depart…"), and swept across the rest
of the driver-visible strings including the phase-recorded toast bodies in
`PhaseStepPageClient.tsx`. Code comments keep theirs.

---

## Explicitly deferred

- **Visual count vs waybill/expected count** (both `loading` and `unloading`). Tim:
  "wait on this change as it most likely will be done and information pulled from parcel
  perfect but we waiting to finish this integration first." No work. The F1 blind-entry
  fence stays up.
- **Structured `recipient_id_number` DB column** and its dispatcher display — see
  Workstream 4.
- **Dispatcher-portal signature rendering.** Tim's note mentions a dispatcher change; the
  dispatcher portal is another dev's area and the stamped attestation needs no change
  there.

## Sequencing

Waves exist to keep concurrent agents off each other's files; there is one working tree.

| Wave | Work | File ownership |
|---|---|---|
| 1 | WS1 responsive submit ‖ WS2 in-transit + map | disjoint |
| 2 | WS3 step surgery + backend contract | owns `evidence-draft.ts`, `phases.ts`, `registry.ts`, shared `phase-meta.ts`, backend |
| 3 | WS4 recipient identity | owns `evidence-draft.ts`, `phases.ts` after WS3 lands |
| 4 | WS5 typography + copy sweep | touches every step file, so it runs last against final content |

## Verification

- `cd frontend/driver-pwa && npm run test && npm run type-check && npm run lint`
- `cd backend && pytest` — `tests/unit/test_phase_meta_contract.py` and
  `tests/unit/test_phase_service.py` are the ones that must go green for WS3.
- Manual: full walk on a reseeded dev trip — activation → home, loading → home,
  departure → home → driving screen with map → arrive → unloading → home →
  confirmation → closed.

## Shared files touched — flag in every TASK COMPLETE

- `frontend/shared/lib/constants/phase-meta.ts` (WS3)
- `backend/app/core/phase_meta.py` (WS3)
- `backend/app/schemas/phases.py` (WS3)
- `backend/app/orchestration/phase_service.py` (WS3)
- `frontend/driver-pwa/package.json` (WS2)

## New `.env` keys

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Google Maps JS API key for the in-transit driving
  map. Absent is a supported state: the map degrades to a coordinates card.
