# Dispatcher Portal — Handoff: Driver PWA changes, 2026-08-06

**From:** Tim (driver side) · branch `Driver-Pwa-Improvements`
**To:** whoever owns `frontend/dispatcher/`
**Design doc:** `docs/superpowers/specs/2026-08-05-driver-pwa-improvements-design.md`

---

## TL;DR — nothing breaks

**There are no breaking changes for the dispatcher portal.** It compiles, type-checks and
runs unchanged against this branch. I verified this rather than assuming it:

- The dispatcher imports exactly one thing from the shared phase constants — `PHASE_NAMES`
  — in three places (`app/(app)/trips/[id]/page.tsx:22`,
  `components/domain/ChecklistRow.tsx:9`, `lib/phase/derive.ts:16`). `PHASE_NAMES` is
  unchanged.
- `step_recipe` is **not consumed anywhere** in `frontend/dispatcher/` (only declared in
  `frontend/shared/lib/types/phase.ts` and populated in mocks), so removing a step from the
  `unloading` recipe changes nothing you render.
- `STEP_NAMES` in `frontend/dispatcher/app/(app)/trips/new/page.tsx:25` is your **own local
  trip-wizard constant** and is unrelated to the shared one. It was not touched.
- No field was removed from `PhaseEventRead`. The wire payload you consume only ever gains
  or keeps fields.

Everything in sections 3 and 4 is **accuracy and enhancement**, not repair. Section 2 is
the one thing you should read before you next triage exceptions.

---

## 1. Contract changes already merged (awareness only, no action)

These are done and on the branch. Listed so you know what moved under you.

| File | Change |
|---|---|
| `frontend/shared/lib/constants/phase-meta.ts` | `STEP_SLUGS.unloading` lost `'3-seal-break-inspection'` (now 3 steps). `STEP_NAMES.unloading` lost `'Wait for Inspection'`. `STEP_NAMES.departure[1]` is now `'Photograph Linehaul Document'`. |
| `backend/app/core/phase_meta.py` | Mirrors the above. Required — `backend/tests/unit/test_phase_meta_contract.py` parses the TS file and fails if the two disagree. |
| `backend/app/schemas/phases.py` | `DepartureCompleteRequest.guard_verified_seal` is now `Optional[bool] = None` (was a required `bool`). |
| `backend/app/orchestration/phase_service.py` | `advance_departure`: only an explicit `False`, or a `seal_number_confirmed` that fails to match, writes a `seal_mismatch` exception. `None` no longer does. |

Surviving unloading slugs deliberately keep their original numbers (`1-hand-waybill`,
`2-seal-verify`, `4-visual-count`). The prefix orders the list, it is not an index —
renumbering would break stored drafts and deep links for nothing.

**Note for your local environment:** the `unloading` recipe changed, so any trip seeded
before this branch has a stale plan. Reset and reseed your dev DB.

---

## 2. Behavioural change you WILL see — read this one

**Departure `seal_mismatch` exceptions will largely disappear, and that is correct.**

Previously the driver app asked the gate guard to re-type the seal number on the driver's
phone. That step is gone: guards have no accounts and never will (`CLAUDE.md` domain
rules), and having a guard retype a number the driver just photographed proved nothing the
photograph did not already prove.

The problem was the wire. The app sent `guard_verified_seal: e.sealVerifiedMatch === true`,
which was `false` whenever the device-local seal reference was missing — a reinstall,
cleared storage, a fresh device. The backend treated falsy as "the guard could not verify"
and wrote a **CRITICAL** `seal_mismatch` `TripException`, setting the departure phase row to
`exception`. Shipping the UI removal without the schema change would have flagged *every
trip on the platform*.

So: departure rows that used to arrive as `exception` will now arrive as `completed`.

**Destination seal mismatches are completely unaffected.** `advance_unloading` still
compares `seal_number_at_destination` against that leg's own departure event server-side
and still raises a CRITICAL `seal_mismatch`. That is the mismatch that actually indicates
tampering, and it is untouched. Your `UnloadingDetail` verdict logic — which reads
`phase.status` rather than re-deriving from the two seal strings — remains correct and
should stay that way.

Second, smaller change: the driver app no longer displays the departure seal at unloading,
and no longer shows the driver a match/mismatch banner. The driver now types what they see,
blind. This makes the destination comparison genuinely independent, so a mismatch reaching
you is stronger evidence than it was last week.

---

## 3. Dispatcher frontend — recommended edits

All four are copy or presentation. None are load-bearing.

### 3a. `components/domain/ConfirmationDetail.tsx` — POD signature now carries identity

The POD signature artifact is a rendered attestation PNG. It now contains the **receiver's
full name and ID number**, drawn into the image alongside the timestamp and GPS fix, above
a `SIGNED BY` / `ID NUMBER` pair of rows.

Your existing `<EvidenceDocument label="POD signature" …>` renders it correctly with **zero
changes** — the identity is inside the image you already display. The only suggestion is
the label, which currently undersells what a reviewer is looking at:

```tsx
<EvidenceDocument
  label="POD signature & receiver identity"
  artifact={phase.pod_signature_artifact_id ? artifactsById.get(phase.pod_signature_artifact_id) : undefined}
/>
```

**Why the identity is in the image rather than a column:** it is then covered by the
artifact hash that gets anchored to Hedera, instead of sitting beside it as mutable
metadata. See section 4 if you want it queryable as well.

**POPIA:** that ID number is personal data. It lives in the PNG in Supabase Storage
(`af-south-1`) and nowhere else — it is deliberately **not** on `PhaseEvent`, not in any
canonical payload, and never anchored. If you export, cache, or log evidence artifacts
anywhere in the dispatcher, that export now carries ID numbers. Worth a look at your
artifact-download path.

### 3b. `components/domain/UnloadingDetail.tsx` — seal photo label

`gate_photo_artifact_id` on an unloading row is the seal photographed **as found, intact,
before the warehouse breaks it**. It is now the only seal photo unloading captures — the
broken-seal step is gone, because a photo taken after the seal is cut proves nothing about
whether the trailer was opened in transit.

The current label, `"Seal photo at destination"`, does not carry the "intact, before
breaking" meaning that gives the photo its evidential weight:

```tsx
<EvidencePhoto
  label="Seal as found at destination (intact, before breaking)"
  artifact={phase.gate_photo_artifact_id ? artifactsById.get(phase.gate_photo_artifact_id) : undefined}
/>
```

Also worth knowing: the two verdict strings at
`components/domain/UnloadingDetail.tsx:55-56` still use em dashes. We stripped em dashes
from driver-facing copy; the dispatcher is a desktop review tool read by office staff, so
this is your call, not a consistency requirement.

### 3c. `components/domain/ActivationDetail.tsx:47-50` — a photo that can never exist

This renders `<EvidencePhoto label="Gate photo" …>` from
`phase.gate_photo_artifact_id`. **Activation no longer captures a gate photo** — that
capture was removed on 2026-07-15 — and `gate_photo_artifact_id` has since been reused by
`unloading` for the intact seal photo. On an activation row the field is now always null,
so this renders a permanently empty slot.

This predates my changes; I am flagging it because the field is now dual-purpose and that
makes the dead slot easy to misread as "the driver skipped a photo". Suggest deleting the
`EvidencePhoto` block from the `Verification` section.

### 3d. `components/domain/PhaseAnchorSection.tsx` — `pending` needs its own copy

`anchor_status` is one of `not_required | pending | anchored | failed`. You render `failed`
with an explicit warning, correctly. `pending` currently falls through to
`<Field label="Status" value={phase.anchor_status} />` — the raw enum string.

That matters more now. Hedera anchoring was moved onto a Celery worker rather than being
awaited inside the request (`phase_service.py` header, 2026-08-05), and as of this branch
the driver app hands submissions to a background submitter and returns to Home immediately.
Both mean `pending` is a normal transient state that a dispatcher will now see regularly,
sometimes for a few seconds after a phase lands.

A dispatcher seeing raw `pending` cannot tell whether to act. Suggest matching the `failed`
treatment with honest copy — something like "Anchoring in progress, receipt not yet
issued" — so `pending` reads as *not yet* rather than as *something is wrong*. The driver
app makes the same distinction (`AnchorProgress`), and the two surfaces disagreeing about
what `pending` means is worse than either being terse.

---

## 4. Optional backend follow-up — structured `recipient_id_number`

**Not built.** It needs an Alembic migration and a dispatcher change, which is a
coordinated ticket rather than something to slip into a driver branch. Raising it here so
the team can decide.

Today the receiver's name and ID are inside the attestation PNG: human-readable, hash-
covered, not queryable. If you want to search or report on them — "find every delivery
signed by ID X", "export a POD register" — they need to be columns.

Full recipe, in order:

1. **Migration** — `backend/alembic/`. Two nullable columns on `phase_events`:
   `recipient_name` (`String`), `recipient_id_number` (`String`). Nullable is not optional:
   every historical row has neither. Name the file with your name per `CLAUDE.md`, and
   `git fetch` first to check for unmerged migrations on `dev`.
2. **Model** — `backend/app/db/models/phases.py`, SQLAlchemy 2.0 `Mapped`/`mapped_column`.
3. **Request schema** — `backend/app/schemas/phases.py`, add both to
   `ConfirmationCompleteRequest`. **Keep them free-form `Optional[str]`.** Do not add SA-ID
   checksum validation: a receiver may present a passport or a company registration number,
   and a mistyped digit is itself evidence of what was produced at the door. This mirrors
   `seal_number_confirmed`, which is deliberately free-form for the same reason. A 422 here
   destroys the record instead of capturing it.
4. **Service** — `advance_confirmation` in `phase_service.py`, persist both.
5. **Read schema** — add both to `PhaseEventRead`, and to
   `frontend/shared/lib/types/phase.ts` `PhaseDescriptor`.
6. **Driver app** — `lib/api/phases.ts` confirmation branch sends them. The values are
   already captured and already in the draft (`ConfirmationEvidence.recipientName`,
   `.recipientIdNumber`), so this is one addition to the request body. **Ping me, don't do
   it yourself** — there is a test asserting the confirmation body contains no recipient
   data (`lib/api/__tests__/phases.test.ts`, "never sends the receiver name or ID number to
   the backend") that must be deliberately retired with the POPIA reasoning re-examined,
   not deleted to make a build pass.
7. **Dispatcher** — render as `Field`s in `ConfirmationDetail`.

**POPIA is the reason step 6 has a tripwire.** Personal data must stay in PostgreSQL in
`af-south-1` and only SHA-256 hashes may reach Hedera. Adding these columns is fine —
adding them to a canonical payload or an anchor is not. Check
`compute_confirmation_canonical_payload` stays clean if you do this.

---

## 5. What explicitly does NOT change

- `PHASE_NAMES` — untouched.
- Your local trip-wizard `STEP_NAMES` — unrelated constant, untouched.
- `PhaseEventRead` / `PhaseDescriptor` field set — nothing removed.
- `waybill_photo_artifact_id` — the driver now photographs the **linehaul document** rather
  than the waybill, but the wire field and the `3-waybill` slug are unchanged on purpose
  (both are contract-tested and embedded in stored drafts and deep links). Only the
  driver-facing display name moved. If you label this field anywhere, "Linehaul document"
  is now the accurate word.
- Anchoring policy — departure and confirmation, fail-open, unchanged.
- Exception types, severities and sources — unchanged.
- Trip status values — unchanged.

---

## 6. How to verify on your side

```bash
cd frontend/dispatcher && npm run type-check && npm run lint && npm run test && npm run build
cd backend && pytest
```

`backend/pytest` **silently skips every DB-backed test unless `TEST_DATABASE_URL` is set** —
a green run that skipped 250 tests proves nothing, so check the skip count. With a local
test DB:

```bash
TEST_DATABASE_URL="postgresql+asyncpg://$USER@localhost:5432/freightproof_test" pytest
```

The two that must pass for these contract changes:
`tests/unit/test_phase_meta_contract.py` and `tests/unit/test_phase_service.py` (62 passed
against a real DB as of this handoff). There are ~37 pre-existing Parcel Perfect failures
that are environmental — they fail identically before and after, all from
`Parcel Perfect error 1: Waybill not found` at trip creation, before any phase logic runs.

Manual check worth doing: open a completed trip's confirmation phase and look at the POD
signature artifact. You should see `SIGNED BY` and `ID NUMBER` rows in the image.

---

## Questions

Ping me on anything in section 2 or 4 — those are the two with real decisions in them.
Section 4 in particular should not be started without agreeing who owns the migration,
given four of us are on separate branches.
