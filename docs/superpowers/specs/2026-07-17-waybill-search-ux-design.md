# Waybill Search-and-Add UX (Design Spec)

**Date:** 2026-07-17
**Branch:** Ciaran
**Status:** Design — reviewed with Ciaran 2026-07-17; awaiting implementation plan
**Supersedes:** the wizard-time PP-lookup policy line in
`docs/superpowers/specs/2026-07-14-trip-creation-redesign-design.md` ("PP down at
wizard-time validation: inline non-blocking error on the row; dispatcher may still
submit") and the repeatable-row waybill UI currently implemented in
`frontend/dispatcher/app/(app)/trips/new/page.tsx`.

## Problem

Step 1's "Waybills (Parcel Perfect)" card is a repeatable row of
`[reference] [units] [remove]` inputs, one per waybill:

1. Lookup fires on blur, not on an explicit action — clicking away from the field is
   the only trigger, which reads as unresponsive rather than deliberate.
2. A successful pull renders as a small four-cell data grid under the row, which
   doesn't read as "this is a confirmed waybill" the way an actual waybill document does.
3. A failed pull still allows the row to be submitted with just a typed reference (the
   2026-07-14 spec's deliberate wizard-time fail-open policy). Since submit already
   re-verifies every reference against PP and fails closed on a miss (`PPSyncError` to
   422, whole transaction rolled back, no trip row), that provisional state in the UI
   can never survive to an anchored trip. It adds a UI path with no reachable outcome.

## Goals

- One explicit search action per waybill (click Pull, or Enter) instead of
  blur-triggered lookup.
- A pulled waybill renders as a distinct, waybill-styled result, not a plain data grid.
- Only a successfully pulled reference can be added to the trip. No manual or
  unverified entries.
- Multi-waybill trips stay first class: a running added list, not a single-slot form.
- The mock-only manifest bulk-fetch (Component 7 of the 2026-07-14 spec) is preserved,
  and its results are treated as already-verified pulls.
- Confined to the wizard's Step 1 waybills card. No backend or shared-file changes.

## Non-goals

- No change to the Order Number field or the empty-leg toggle (handled earlier this
  session).
- No change to `POST /trips`, `TripConsignmentInput`, or any backend contract — the
  submitted `consignments[]` shape is unchanged, only its source in local state moves.
- No change to the manifest-lookup capability flag or its mock-only status.
- No new tests added. This page has no existing test coverage to extend, consistent
  with the field-validation and unit-autofill changes made earlier this session.

## Key decisions

| Decision | Choice | Reason |
|---|---|---|
| Multi-waybill structure | Search-and-add list: one search bar plus Pull button; a successful pull renders a result card with an Add action; added items land in a running list, which is what gets submitted | Trips carry multiple PP waybills (multi-client loads, FP-112). A single-slot form can't represent that, so the search bar has to feed a list rather than replace a form field. |
| Lookup-failure handling | Add is only enabled after a successful pull. Failure shows an error message and no add path | Supersedes the 2026-07-14 wizard-time fail-open policy. Submit already fail-closes on an unverifiable reference, so a provisional wizard-only add could never produce an anchored trip. Removing it drops a dead-end UI state without weakening what can actually reach evidence. Consequence, stated plainly: if PP is unreachable, the wizard cannot add any waybill until it recovers, so no loaded trip can be created during a PP outage (empty legs are unaffected, they carry no waybills). |
| Manifest bulk-fetch | Mechanism unchanged. Its results are treated as already-verified and go straight into the added list, no per-item confirm step | It's already a batch of successful PP responses. Its entire value proposition is "key a whole truck in one number" (2026-07-14 spec, Component 7); requiring N individual confirmations afterward would defeat that. |
| Editing an added entry | Units is inline-editable directly in the list row. No separate Edit toggle | Reference is PP-sourced and shouldn't be hand-edited post-pull. Units is the only field a dispatcher legitimately adjusts, so making it always-editable removes an interaction mode without losing capability. |
| Duplicate references | Structurally prevented: pulling a reference already in the added list shows "Already added," not a fresh result card | Replaces today's per-row duplicate validator. There is nothing left to validate once add-time itself can't produce a duplicate. |

## Design

### Component 1 — Search bar

One text input plus a Pull button, replacing the current repeatable rows' inline
reference fields. Pull triggers on button click or Enter key — no blur trigger. The
button is disabled while the input is empty or while a pull is already in flight.

### Component 2 — Pull result

Renders below the search bar once a pull has been attempted. States:

- **Loading.** Pull button shows a spinner and disables re-clicking; the search input
  stays editable so the dispatcher can correct a typo before the request lands.
- **Success.** A waybill-styled card: reference, customer, destination, weight, parcel
  count (same fields the current `MiniField` grid shows, restyled to read as a waybill
  excerpt rather than a data grid). An editable Units field, pre-filled from PP's
  `parcel_count`. An Add button that appends this entry to the added list and clears
  the search bar.
- **Already added.** If the pulled reference matches an entry already in the added
  list, show "Already added to this trip" in place of a fresh card. No Add action.
- **Error.** Two cases, both terminal for this pull attempt (no Add action):
  - Not found: "Waybill not found in Parcel Perfect"
  - PP unreachable or timed out: "Lookup failed. Try again."

  The dispatcher edits the reference and pulls again; there is no manual bypass.

### Component 3 — Added list

The confirmed list for this trip. Each row shows the reference, an inline-editable
units number, and a remove control. This list is what gets serialized to
`consignments[]` on submit, replacing today's `waybills` state as the submission
source. It starts empty (not one blank row), since nothing is present until a
successful pull or a manifest fetch adds it.

### Component 4 — Manifest bulk-fetch (unchanged mechanism, new destination)

The existing "Fetch by manifest number" control, gated on `caps.manifest_lookup`
exactly as today, is untouched mechanically. What changes is where its results land:
every waybill it returns is already a successful PP response, so all of them are
appended to the added list (units pre-filled from `parcel_count`, editable via the
same inline field as any other entry) rather than populating a set of rows the
dispatcher must individually confirm. This is an append, not a replace: today's
implementation overwrites the whole `waybills` array on manifest fetch, which would
silently discard anything the dispatcher had already added by hand. Any waybill the
manifest returns that's already in the added list (same reference) is skipped rather
than duplicated, using the same match the single-pull path uses for "Already added."

## State shape

Two pieces of state replace today's single `WaybillRow[]`, which conflated
"in-progress form row" and "confirmed list entry" into one array:

- **Added list** — an array of confirmed entries (reference, units). Starts empty.
- **Search scratch state** — a single working slot, not an array, since only one pull
  is displayed at a time: the search input's text, the pull status (idle, loading,
  success, duplicate, error), the last successful summary if any, and the pending
  units value bound to that summary.

## Validation

`waybillsValid` becomes: `isEmptyLeg` is true, or the added list is non-empty and every
entry's units count is at least 1. Reference-uniqueness is no longer a validator to
run, since duplicate adds are prevented structurally at add-time rather than checked
after the fact. When `showErrors` is set and the added list is empty, an inline message
renders under the added-list area ("Add at least one waybill"), consistent with the
Order Number field-level error fix made earlier this session, rather than relying
solely on the step's bottom banner.

## Error handling

- Reference not found in PP: "Waybill not found in Parcel Perfect." No add path.
- PP unreachable or slow: "Lookup failed. Try again." No add path.
- Reference already in the added list: "Already added to this trip." No add path.
- Manifest number not found: unchanged existing toast, "Manifest not found."
- Edited units drop below 1 on an added entry: that row's units field is flagged,
  matching the inline field-error pattern used elsewhere on this page.

## Data flow

```
Dispatcher                         Wizard state                    PP (mock|real)
───────────                        ────────────                    ──────────────
type reference, click Pull ──GET /api/v1/pp/waybills/{ref}──▶ get_single_waybill()
  ◀── success: result card + editable units, add-enabled
  ◀── not found / unreachable: error message, add-disabled
click Add ──▶ appended to added list, search bar clears
[or manifest number ──GET /api/v1/pp/manifests/{n}──▶ mock-only bulk lookup]
  ◀── every returned waybill appended directly to added list
submit ──▶ consignments: addedList.map(...) ──POST /trips──▶ unchanged from today
```

No change below the wizard boundary: the backend endpoint, the submit payload shape,
and the fail-closed `PPSyncError` behavior at create-time are all exactly as specified
in the 2026-07-14 spec.

## Testing

No automated tests added — this page has none today. Before marking implementation
complete, exercise manually in the dev server: successful pull and add, not-found
pull, a simulated PP-down state if easy to trigger, pulling an already-added
reference, manifest bulk-fetch (mock mode), editing units on an added entry, removing
an entry, and submitting a trip with more than one waybill.

## Coordination flags

- **Shared files touched:** none.
- **New `.env` keys:** none.
- **Backend changes:** none.
- **Supersedes:** the wizard-time fail-open clause in the 2026-07-14 trip-creation
  spec's Error handling section ("PP down at wizard-time validation: inline
  non-blocking error on the row; dispatcher may still submit"). That spec's
  submit-time behavior (`PPSyncError` fail-closed) is unchanged and is exactly what
  makes the supersession safe — nothing that could previously reach an anchored trip
  becomes unreachable.

## Radar — deliberately deferred

- A visible indicator during a PP outage (e.g., a banner explaining why Pull is
  failing for every reference) is not designed here — the per-attempt error message
  covers it for now; a persistent outage banner is a small follow-up if it turns out
  to matter in practice.
- No change to how the manifest capability flag degrades when `PP_USE_MOCK=False`
  (still hides the control entirely, per the 2026-07-14 spec).

---

# Waybill Search-and-Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blur-triggered, repeatable-row waybill form in Step 1 of the trip
wizard with the search-and-add UX specified above: one search bar with a Pull button,
a waybill-styled result card gating an explicit Add, and a running added list that
feeds submission.

**Architecture:** Single file, `frontend/dispatcher/app/(app)/trips/new/page.tsx`.
State splits into an `addedWaybills` list (confirmed entries) and a single-slot
`pull` scratch state (the in-progress search), replacing the current `WaybillRow[]`
that conflated both. Tasks 1–7 are tightly coupled within this one file — the state
shape, the handlers, and the JSX all reference each other, so the file will not
typecheck until every task below is applied. Task 8 is the single verification pass;
there is no per-task test/commit cycle, matching this project's execution convention
(verify once at the end of a phase, not after every step) and the spec's own
non-goal of no new automated tests for this page.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, existing local UI
components (`FormCard`, `Lbl`, `MiniField`, `Ic`, `Button`) already defined in this
file or imported at its top. No new dependencies, no new files.

---

### Task 1: Replace the row type and Step 1 state

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx:137-154` (type + factory)
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx:208-213` (state hooks)

- [ ] **Step 1: Replace `WaybillRow` / `emptyWaybillRow` with `AddedWaybill` / `PullState`**

Current (lines 137-154):

```ts
// Row state for one PP waybill in the Step 1 form. unitCount is kept as the raw input
// string (not parsed) so a dispatcher can clear/retype it without fighting NaN coercion;
// it is parsed once, on submit / validation. `id` is a stable client-side identity so
// async lookup results land on the row they were requested for — matching by array
// index would misdirect an in-flight response onto whichever row shifted into that
// slot after a removal. Never sent to the backend.
interface WaybillRow {
  id: string
  reference: string
  unitCount: string
  summary: PPWaybillSummary | null
  error: string | null
  loading: boolean
}

function emptyWaybillRow(): WaybillRow {
  return { id: crypto.randomUUID(), reference: '', unitCount: '', summary: null, error: null, loading: false }
}
```

Replace with:

```ts
// A waybill confirmed onto the trip. Reference and summary are locked in once added —
// they can only get here via a successful PP pull or a manifest fetch, both of which
// supply real PP data. unitCount is the one field a dispatcher may still edit; kept as
// the raw input string (not parsed) so it can be cleared/retyped without fighting NaN
// coercion — parsed once, on submit / validation. `id` is a stable client-side identity,
// never sent to the backend.
interface AddedWaybill {
  id: string
  reference: string
  unitCount: string
  summary: PPWaybillSummary
}

// The single in-progress search/pull attempt. Only one is ever displayed at a time, so
// this is one slot, not an array. 'duplicate' fires when the pulled reference is already
// in addedWaybills. unitCount here is the pending value shown on the result card before
// Add commits it into an AddedWaybill.
type PullStatus = 'idle' | 'loading' | 'success' | 'duplicate' | 'error'

interface PullState {
  status: PullStatus
  summary: PPWaybillSummary | null
  unitCount: string
  errorMessage: string | null
}

function emptyPullState(): PullState {
  return { status: 'idle', summary: null, unitCount: '', errorMessage: null }
}
```

- [ ] **Step 2: Replace the `waybills` state hook with the new three**

Current (lines 208-213):

```ts
  // Step 1 — Order & Waybills
  const [orderNumber, setOrderNumber] = useState('')
  const [isEmptyLeg,   setIsEmptyLeg]   = useState(false)
  const [waybills,     setWaybills]     = useState<WaybillRow[]>([emptyWaybillRow()])
  const [manifestNo,   setManifestNo]   = useState('')
  const [manifestBusy, setManifestBusy] = useState(false)
```

Replace with:

```ts
  // Step 1 — Order & Waybills
  const [orderNumber,   setOrderNumber]   = useState('')
  const [isEmptyLeg,    setIsEmptyLeg]    = useState(false)
  const [addedWaybills, setAddedWaybills] = useState<AddedWaybill[]>([])
  const [searchRef,     setSearchRef]     = useState('')
  const [pull,          setPull]          = useState<PullState>(emptyPullState())
  const [manifestNo,    setManifestNo]    = useState('')
  const [manifestBusy,  setManifestBusy]  = useState(false)
```

Note `addedWaybills` starts empty (no seed row) — nothing is present until a
successful pull or manifest fetch adds it, per the spec.

---

### Task 2: Replace lookup/add/remove handlers

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx:267-290` (`lookupRow`)

- [ ] **Step 1: Replace `lookupRow` with `pullWaybill`, `addWaybill`, `removeWaybill`, `updateAddedUnits`**

Current (lines 267-290):

```ts
  // Looks up a single waybill reference against Parcel Perfect on blur. A lookup failure
  // is non-blocking — the reference is re-verified server-side on submit — so the
  // dispatcher can still proceed with just the reference and a manually entered unit count.
  // Matches by row id, not array index: if the row is removed while the request is in
  // flight, the map is a no-op instead of contaminating whichever row shifted into its slot.
  async function lookupRow(row: WaybillRow) {
    const ref = row.reference.trim()
    if (!ref) return
    setWaybills(rows => rows.map(r => r.id === row.id ? { ...r, loading: true, error: null } : r))
    try {
      const summary = await api.get<PPWaybillSummary>(`/api/v1/pp/waybills/${encodeURIComponent(ref)}`)
      // Prefill from PP's parcel count, but only into a still-empty field — never
      // clobber a count the dispatcher already typed while the lookup was in flight.
      setWaybills(rows => rows.map(r => r.id === row.id
        ? { ...r, summary, loading: false, unitCount: r.unitCount || String(summary.parcel_count) }
        : r,
      ))
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 404
        ? 'Waybill not found in Parcel Perfect'
        : 'Lookup failed — you can still submit; the reference is verified on create'
      setWaybills(rows => rows.map(r => r.id === row.id ? { ...r, summary: null, error: msg, loading: false } : r))
    }
  }
```

Replace with:

```ts
  // Pulls a single waybill reference from Parcel Perfect. Add is only ever enabled from
  // a 'success' pull — there is no manual/unverified path. This supersedes the old
  // wizard-time fail-open behavior: submit already fail-closes on an unverifiable
  // reference (PPSyncError → 422, whole trip rolled back), so a provisional add here
  // could never reach an anchored trip anyway.
  async function pullWaybill() {
    const ref = searchRef.trim()
    if (!ref) return
    if (addedWaybills.some(w => w.reference === ref)) {
      setPull({ status: 'duplicate', summary: null, unitCount: '', errorMessage: null })
      return
    }
    setPull({ status: 'loading', summary: null, unitCount: '', errorMessage: null })
    try {
      const summary = await api.get<PPWaybillSummary>(`/api/v1/pp/waybills/${encodeURIComponent(ref)}`)
      setPull({ status: 'success', summary, unitCount: String(summary.parcel_count), errorMessage: null })
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 404
        ? 'Waybill not found in Parcel Perfect'
        : 'Lookup failed. Try again.'
      setPull({ status: 'error', summary: null, unitCount: '', errorMessage: msg })
    }
  }

  // Commits the current successful pull into the added list, keyed off PP's own
  // waybill string (not the raw search text) so casing/whitespace always matches what
  // PP actually holds. Resets the search bar for the next reference.
  function addWaybill() {
    if (pull.status !== 'success' || !pull.summary) return
    const summary = pull.summary
    setAddedWaybills(rows => [...rows, {
      id: crypto.randomUUID(),
      reference: summary.waybill,
      unitCount: pull.unitCount,
      summary,
    }])
    setSearchRef('')
    setPull(emptyPullState())
  }

  function removeWaybill(id: string) {
    setAddedWaybills(rows => rows.filter(r => r.id !== id))
  }

  function updateAddedUnits(id: string, value: string) {
    setAddedWaybills(rows => rows.map(r => r.id === id ? { ...r, unitCount: value } : r))
  }
```

---

### Task 3: Rewrite manifest bulk-fetch to append and dedupe

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx:292-310` (`fetchManifest`)

- [ ] **Step 1: Replace the replace-all body with append-and-skip-existing**

Current (lines 292-310):

```ts
  // Bulk-fetch every waybill on a PP manifest. Only rendered when the backend reports
  // manifest_lookup support (mock PP client today — see usePpCapabilities).
  async function fetchManifest() {
    const n = parseInt(manifestNo, 10)
    if (isNaN(n)) return
    setManifestBusy(true)
    try {
      const summaries = await api.get<PPWaybillSummary[]>(`/api/v1/pp/manifests/${n}`)
      if (summaries.length > 0) {
        setWaybills(summaries.map(s => ({
          id: crypto.randomUUID(), reference: s.waybill, unitCount: String(s.parcel_count), summary: s, error: null, loading: false,
        })))
      }
    } catch {
      notify({ kind: 'error', title: 'Manifest not found' })
    } finally {
      setManifestBusy(false)
    }
  }
```

Replace with:

```ts
  // Bulk-fetch every waybill on a PP manifest. Only rendered when the backend reports
  // manifest_lookup support (mock PP client today — see usePpCapabilities). Every
  // returned waybill is already a successful PP response, so all of them are appended
  // straight to the added list — no per-item confirm step, that's the entire point of
  // keying a whole truck from one number. Appends rather than replaces: overwriting
  // addedWaybills here would silently discard anything the dispatcher already added
  // by hand. Anything already in the list (same reference) is skipped, not duplicated.
  async function fetchManifest() {
    const n = parseInt(manifestNo, 10)
    if (isNaN(n)) return
    setManifestBusy(true)
    try {
      const summaries = await api.get<PPWaybillSummary[]>(`/api/v1/pp/manifests/${n}`)
      if (summaries.length > 0) {
        setAddedWaybills(rows => {
          const existingRefs = new Set(rows.map(r => r.reference))
          const newRows = summaries
            .filter(s => !existingRefs.has(s.waybill))
            .map(s => ({
              id: crypto.randomUUID(),
              reference: s.waybill,
              unitCount: String(s.parcel_count),
              summary: s,
            }))
          return [...rows, ...newRows]
        })
      }
    } catch {
      notify({ kind: 'error', title: 'Manifest not found' })
    } finally {
      setManifestBusy(false)
    }
  }
```

---

### Task 4: Update validation and the submit payload

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx:246-253` (`waybillsValid`, `totalUnits`)
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx:334` (`consignments` mapping)

- [ ] **Step 1: Point validation at `addedWaybills`, drop the duplicate check**

Current (lines 246-253):

```ts
  // Waybills step is skipped entirely for an empty leg; otherwise every row needs a
  // reference and a unit count ≥ 1, and references must be unique within the trip.
  const waybillsValid = isEmptyLeg || (
    waybills.length > 0 &&
    waybills.every(r => r.reference.trim() && parseInt(r.unitCount, 10) >= 1) &&
    new Set(waybills.map(r => r.reference.trim())).size === waybills.length
  )
  const totalUnits = waybills.reduce((sum, r) => sum + (parseInt(r.unitCount, 10) || 0), 0)
```

Replace with:

```ts
  // Waybills step is skipped entirely for an empty leg; otherwise at least one waybill
  // must be added, each with a unit count ≥ 1. Reference validity and uniqueness no
  // longer need checking here — every entry in addedWaybills got there via a successful
  // PP pull or manifest fetch, and pullWaybill already refuses to re-add a duplicate.
  const waybillsValid = isEmptyLeg || (
    addedWaybills.length > 0 &&
    addedWaybills.every(r => parseInt(r.unitCount, 10) >= 1)
  )
  const totalUnits = addedWaybills.reduce((sum, r) => sum + (parseInt(r.unitCount, 10) || 0), 0)
```

- [ ] **Step 2: Point the submit payload at `addedWaybills`**

Current (line 334):

```ts
        consignments: isEmptyLeg ? [] : waybills.map(r => ({
          pp_reference: r.reference.trim(),
          unit_count_expected: parseInt(r.unitCount, 10),
        })),
```

Replace with:

```ts
        consignments: isEmptyLeg ? [] : addedWaybills.map(r => ({
          pp_reference: r.reference,
          unit_count_expected: parseInt(r.unitCount, 10),
        })),
```

(`.trim()` drops — `r.reference` now always comes from PP's own `summary.waybill`,
never from raw typed input, so it's already clean.)

---

### Task 5: Rewrite the Step 1 waybills card — search bar and pull result

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx:436-536` (the `{!isEmptyLeg && (...)}` block)

- [ ] **Step 1: Replace the manifest-fetch-through-repeatable-rows block**

Current (lines 436-536) is the full `{!isEmptyLeg && (<FormCard>...)}` block containing
the manifest fetch control and the `waybills.map(row => ...)` repeatable rows (see the
file for the exact text — it's long; the key point is everything from
`{!isEmptyLeg && (` through its matching `)}` at line 536 is replaced as one unit).

Replace the whole block with:

```tsx
              {!isEmptyLeg && (
                <FormCard>
                  <CardTitle icon="box">Waybills (Parcel Perfect)</CardTitle>

                  {caps.manifest_lookup && (
                    <div className="flex gap-2 items-end mb-4 pb-4 border-b border-outline-v/20">
                      <div className="flex-1">
                        <Lbl>Fetch by manifest number</Lbl>
                        <input
                          value={manifestNo}
                          onChange={e => setManifestNo(e.target.value)}
                          placeholder="e.g. 69"
                          className={inp}
                        />
                      </div>
                      <Button variant="secondary" onClick={fetchManifest} loading={manifestBusy}>
                        Fetch waybills
                      </Button>
                    </div>
                  )}

                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Lbl>PP waybill reference</Lbl>
                      <input
                        value={searchRef}
                        onChange={e => { setSearchRef(e.target.value); setPull(emptyPullState()) }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); pullWaybill() } }}
                        placeholder="e.g. WAY001"
                        className={inp}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      iconLeft={<Ic n="search" s={14} />}
                      onClick={pullWaybill}
                      loading={pull.status === 'loading'}
                      disabled={!searchRef.trim()}
                    >
                      Pull
                    </Button>
                  </div>

                  {pull.status === 'duplicate' && (
                    <p className="text-[11px] text-on-surf-v mt-2">Already added to this trip</p>
                  )}

                  {pull.status === 'error' && (
                    <p className="text-[11px] text-err mt-2 font-[500]">{pull.errorMessage}</p>
                  )}

                  {pull.status === 'success' && pull.summary && (
                    <div className="rounded-lg bg-surf-low border border-outline-v/20 p-4 mt-3">
                      <div className="flex items-center gap-2 mb-3">
                        <Ic n="file" s={14} className="text-sec" />
                        <span className="text-[13px] font-[700] text-on-surf tabular-nums tracking-[0.04em]">
                          {pull.summary.waybill}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-x-4 mb-3">
                        <MiniField label="Customer" value={pull.summary.customer_name} />
                        <MiniField label="Parcels"  value={String(pull.summary.parcel_count)} mono />
                        <MiniField label="Weight"   value={pull.summary.weight_kg != null ? `${pull.summary.weight_kg} kg` : null} mono />
                        <MiniField label="Dest"     value={pull.summary.dest_town} />
                      </div>
                      <div className="flex gap-3 items-end">
                        <div className="flex-1">
                          <Lbl>Expected units (pallets)</Lbl>
                          <input
                            type="number"
                            min="1"
                            value={pull.unitCount}
                            onChange={e => setPull(p => ({ ...p, unitCount: e.target.value }))}
                            className={inp}
                          />
                        </div>
                        <Button onClick={addWaybill}>+ Add</Button>
                      </div>
                    </div>
                  )}

                  {/* Added list goes here — Task 6 */}
                </FormCard>
              )}
```

Leave the `{/* Added list goes here — Task 6 */}` comment as a marker; Task 6 replaces
it with the added-list JSX in the same edit pass (do not leave the literal comment in
the final file).

---

### Task 6: Add the added-waybills list

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx` (replace the
  `{/* Added list goes here — Task 6 */}` marker placed by Task 5)

- [ ] **Step 1: Replace the marker with the added-list JSX**

```tsx
                  {addedWaybills.length > 0 && (
                    <div className="flex flex-col mt-4 pt-4 border-t border-outline-v/20">
                      {addedWaybills.map(row => {
                        const unitsInvalid = showErrors && !(parseInt(row.unitCount, 10) >= 1)
                        return (
                          <div key={row.id} className="flex items-center gap-3 py-2 border-b border-outline-v/10 last:border-0">
                            <Ic n="check" s={14} className="text-ok shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-[600] text-on-surf tabular-nums tracking-[0.03em]">
                                {row.reference}
                              </div>
                              <div className="text-[11px] text-on-surf-v truncate">
                                {row.summary.customer_name} · {row.summary.dest_town}
                              </div>
                            </div>
                            <input
                              type="number"
                              min="1"
                              value={row.unitCount}
                              onChange={e => updateAddedUnits(row.id, e.target.value)}
                              className={cn('w-20 text-center', unitsInvalid ? inpErr : inp)}
                            />
                            <button
                              type="button"
                              className="text-err text-[12px] font-[600]"
                              onClick={() => removeWaybill(row.id)}
                            >
                              Remove
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {showErrors && addedWaybills.length === 0 && (
                    <p className="text-[11px] text-err mt-3 font-[500]">Add at least one waybill</p>
                  )}
```

This sits directly above the `</FormCard>` that closes the waybills card (the same
`</FormCard>` already present at the end of the Task 5 block).

---

### Task 7: Update the Review step and Trip Summary panel

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx:797-814` (Review section body)
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx:855` (Trip Summary "Cargo" row)

- [ ] **Step 1: Simplify the Review list — every added entry always has a summary now**

Current (lines 797-814):

```tsx
                  ) : (
                    <div className="flex flex-col pt-1">
                      {waybills.map(row => (
                        <div key={row.id} className="py-2 border-b border-outline-v/10 last:border-0">
                          <div className="text-[13px] font-[600] text-on-surf">
                            {row.summary
                              ? `${row.reference} · ${row.summary.customer_name} · ${row.summary.parcel_count} parcels`
                                + (row.summary.weight_kg != null ? ` · ${row.summary.weight_kg} kg` : '')
                                + ` → ${row.summary.dest_town} · ${row.unitCount || '0'} units`
                              : `${row.reference || '—'} · ${row.unitCount || '0'} units`}
                          </div>
                          {row.summary && (
                            <div className="text-[10px] text-on-surf-v mt-[2px]">from Parcel Perfect</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
```

Replace with:

```tsx
                  ) : (
                    <div className="flex flex-col pt-1">
                      {addedWaybills.map(row => (
                        <div key={row.id} className="py-2 border-b border-outline-v/10 last:border-0">
                          <div className="text-[13px] font-[600] text-on-surf">
                            {row.reference} · {row.summary.customer_name} · {row.summary.parcel_count} parcels
                            {row.summary.weight_kg != null ? ` · ${row.summary.weight_kg} kg` : ''}
                            {` → ${row.summary.dest_town} · ${row.unitCount || '0'} units`}
                          </div>
                          <div className="text-[10px] text-on-surf-v mt-[2px]">from Parcel Perfect</div>
                        </div>
                      ))}
                    </div>
                  )}
```

(No more `row.summary ? ... : ...` fallback branch — every `AddedWaybill` carries a
non-null `summary` by construction now, and "from Parcel Perfect" is no longer
conditional for the same reason.)

- [ ] **Step 2: Point the Trip Summary "Cargo" row at `addedWaybills`**

Current (line 855, inside the summary array):

```ts
                                  : `${waybills.length} waybill(s) · ${totalUnits} units`, false],
```

Replace with:

```ts
                                  : `${addedWaybills.length} waybill(s) · ${totalUnits} units`, false],
```

---

### Task 8: Verify

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `cd frontend/dispatcher && npx tsc --noEmit -p .`
Expected: no errors. If any reference to `WaybillRow`, `emptyWaybillRow`, `waybills`,
`setWaybills`, or `lookupRow` remains, the typecheck will fail on it — grep the file
for those names to confirm zero remaining hits before moving on.

- [ ] **Step 2: Manual QA in the dev server**

Start the dispatcher dev server and walk through, on the trip creation wizard's Step 1
(mock PP fixtures: `WAY001`–`WAY005` on manifest `69`/`70`, `WAYPOD1`, `WAYFAIL1`,
`MOCKWAY001`; any other string is a clean not-found case):

1. Pull `WAY001` → result card shows customer/parcels/weight/dest, units pre-filled
   with the parcel count. Click Add → appears in the added list, search bar clears.
2. Pull a nonexistent reference (e.g. `DOESNOTEXIST`) → "Waybill not found in Parcel
   Perfect", no Add action available.
3. Pull `WAY001` again (already added) → "Already added to this trip", no Add action.
4. Edit the units number directly on the added-list row → value updates in place.
5. Remove an added entry → disappears from the list.
6. Fetch by manifest number `69` (if `caps.manifest_lookup` is on, i.e. mock mode) →
   `WAY001`–`WAY003` appended; re-fetching the same manifest doesn't duplicate any
   already-added entries.
7. Leave the added list empty and click Next → inline "Add at least one waybill"
   message appears under the list (not only the bottom banner).
8. Add two or more waybills, proceed through Steps 2–4, confirm the Review section and
   the Trip Summary panel both list every added waybill and the correct total units,
   then submit and confirm the created trip's consignments match what was added.

Expected: all eight behave as described, no console errors.

- [ ] **Step 3: Report**

Summarize what was verified against the QA list above; note anything that didn't
match expectations before considering the task done.

**Suggested commit:** `feat(dispatcher): search-and-add waybill UX in trip creation wizard`
