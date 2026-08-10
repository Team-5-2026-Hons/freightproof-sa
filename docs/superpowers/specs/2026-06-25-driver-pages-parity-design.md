# Driver Pages → Vehicle-Detail Parity

**Date:** 2026-06-25
**Author:** Ciaran
**Branch:** Ciaran
**Status:** Approved design — ready for implementation plan

## Goal

Bring the driver detail page up to the same standard as the recently
redesigned vehicle detail page: the resizable two-column layout, the inline
edit affordance, and full client-side validation with inline error feedback.
Add the same validation to the Add Driver create modal, and give the drivers
list page light filtering parity with the vehicles list — while keeping it a
table.

## Context

The vehicle detail page (`fleet/vehicles/[id]/page.tsx`) was redesigned with:

- A resizable info column on the **left** (drag handle, 360–720px) and the
  Immutable History (`EventTimeline`) on the **right** filling remaining space.
- An inline **Edit** button in the info-section header.
- Full client-side validation via the shared `validateVehicleForm` module:
  per-field errors gated by a `touched` set, live VIN feedback, Save disabled
  while errors exist, and focus-first-invalid-field on submit.

The driver detail page (`fleet/drivers/[id]/page.tsx`) currently has:

- The **mirror-image** layout (history left, fixed 450px info right, no resize).
- Edit in the TopBar.
- **No validation** — `FormField`s carry no `error` props and nothing gates Save.

There is no shared driver validation module; vehicles have one
(`frontend/shared/lib/validation/vehicle.ts`), drivers do not.

## Decisions (from brainstorming)

- **Drivers list:** keep the `DataTable`; add search + status filter parity
  (not converted to cards).
- **Validation reuse:** one shared `validateDriverForm`, wired into **both**
  the detail edit form and the Add Driver create modal (mirrors vehicles).
- **Validation strictness:** mirror backend rules **plus** UX extras (live
  phone-format feedback, max-length hints).
- **Licence expiry is required** (client-side only — see note below).
- **Resize logic:** extract a focused `useResizablePanel` hook, used by the two
  fleet **detail** pages only. The dashboard/history table-column resize is a
  different (per-column, unclamped) shape and stays untouched.

### Note on "licence expiry required"

The backend (`DriverCreateBody` / `DriverUpdateBody` in `schemas/people.py`)
treats `license_expiry` as `Optional[date] = None`. Making it required is a
**client-side-only** rule. Consequences:

- The Add Driver modal must **gain** a licence-expiry date field (it currently
  collects none).
- Existing drivers with a null `license_expiry` will be forced to set one the
  next time their record is edited.

No backend change is needed or made.

## Components

### 1. `frontend/shared/lib/validation/driver.ts` (new)

Mirrors `vehicle.ts` in structure, built from the same `rules.ts` primitives.

- `DriverField = 'full_name' | 'id_number' | 'phone_number' | 'license_number' | 'license_expiry'`.
  `id_number` is included so the **create** modal can validate it. The detail
  **edit** form passes the stored (immutable, always-valid) id_number straight
  through and never renders an input for it.
- `DriverFormValues = Record<DriverField, string>`.
- `DRIVER_FIELD_ORDER` — display order for focus-first-invalid on submit.
- `validateDriverForm(values)` → `Record<DriverField, string | null>`:
  - `full_name` — `required`, `maxLength(NAME_MAX)`
  - `id_number` — `required`, `exactLength(SA_ID_LENGTH)`, digits-only `pattern`
    (mirrors backend `validate_id_number`)
  - `phone_number` — `required`, SA phone `pattern` (`0XXXXXXXXX` or `+27XXXXXXXXX`)
  - `license_number` — `required`, `maxLength(LICENSE_MAX)`
  - `license_expiry` — `required` + valid date
- `phoneFieldFeedback(value)` → `{ hint, error }`, same contract as
  `vinFieldFeedback`: neutral hint while mid-entry, red error when malformed,
  both null when empty or valid.
- `normalisePhone(value)` — moved here from `drivers/page.tsx` so create + edit
  share one copy (local `0…` → `+27…`).

New constants in `frontend/shared/lib/validation/constants.ts`:
`SA_ID_LENGTH` (13), SA ID digit pattern, SA phone pattern, `NAME_MAX`,
`LICENSE_MAX`.

### 2. `frontend/dispatcher/lib/hooks/useResizablePanel.ts` (new)

Encapsulates the single-panel drag-to-resize currently inline in the vehicle
detail page.

- Signature: `useResizablePanel(initialWidth: number, opts: { min: number; max: number })`
  → `{ width: number; startResize: (e: React.MouseEvent) => void }`.
- Owns the `width` state, the `resizeRef`, and the window mousemove/mouseup
  listeners with min/max clamping.
- Consumed by both fleet detail pages. The dashboard and history pages keep
  their distinct per-column resize logic.

### 3. `frontend/dispatcher/app/(app)/fleet/drivers/[id]/page.tsx` (rewrite)

- **Layout** flips to match vehicles: info column **left** (via
  `useResizablePanel`, 360–720px with drag handle), `EventTimeline` **right**
  filling remaining space.
- **Edit** moves from the TopBar to inline in the "Driver Info" header.
- **Validation** wired in like the vehicle page: `touched` set, derived
  `errors`/`hasErrors`, live `phoneFieldFeedback`, Save disabled on errors,
  defensive re-validate + focus-first-invalid on submit.
- Licence-expiry field is required.
- The existing POPIA shield notes are kept.

### 4. `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx` (edit)

- **Add Driver modal:** replace raw `<input>`s with `FormField`; add the
  licence-expiry date field; wire `validateDriverForm` + `phoneFieldFeedback` +
  disabled Save + focus-first-invalid; `normalisePhone` on submit.
- **List parity polish:** add a search box (name / phone / licence) and a status
  filter (all / active / inactive) above the existing `DataTable`, echoing the
  vehicles page controls. Table is retained.

## Data flow

No change to data flow or API contracts. Validation is purely client-side and
runs before the existing `api.post('/api/v1/drivers')` /
`api.patch('/api/v1/drivers/{id}')` calls. The PATCH body still sends only
changed fields.

## Error handling

- Field-level: `validateDriverForm` returns one message per field; the page
  shows it only once that field is `touched` (phone uses live feedback like VIN).
- Submit-level: Save is disabled while `hasErrors`; a defensive re-validate on
  submit marks all fields touched and focuses the first invalid one.
- Network/save failure: existing `saveError` / `formError` string surface is
  retained unchanged.

## Testing

Frontend project has no detected unit-test runner (no jest/vitest config). The
validation module is pure and isolated:

- **If** a frontend test runner is added/exists: unit-test `validateDriverForm`
  (happy path, each field's failure, optional-vs-required boundaries) and
  `phoneFieldFeedback`.
- **Otherwise:** manual verification in the dispatcher — create with each
  invalid field, edit with each invalid field, confirm Save gating, focus
  behaviour, phone normalisation, and the new resizable layout.

CLAUDE.md's mandatory-pytest rule applies to backend features; no backend code
changes here.

## Out of scope

- Backend schema / endpoint changes (none needed).
- Converting the drivers list to cards.
- Generalising `useResizablePanel` to absorb the dashboard/history per-column
  table resize.
- Any change to the vehicle detail page beyond swapping its inline resize logic
  for the new `useResizablePanel` hook.

## Shared-file impact

- `frontend/shared/lib/validation/constants.ts` — additive constants only.
- `fleet/vehicles/[id]/page.tsx` — refactor to consume `useResizablePanel`
  (same branch / same owner as this work).

Neither is on the CLAUDE.md "coordinate before changing" list.

---

# Driver Pages Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the driver detail page to vehicle-detail parity (resizable layout, inline edit, inline validation), add the shared driver validation to the Add Driver modal, and give the drivers list search + status filters — while keeping it a table.

**Architecture:** A new pure `validation/driver.ts` module mirrors the existing `validation/vehicle.ts`. A new `useResizablePanel` hook extracts the single-panel resize logic currently inline in the vehicle detail page; both fleet detail pages consume it. The driver detail page and Add Driver modal are then wired to validation exactly as the vehicle equivalents are.

**Tech Stack:** Next.js 15 App Router, React 19 (`"use client"`), TypeScript 5.5, Tailwind, shared `@shared/*` validation primitives.

**Plan conventions (per project CLAUDE.md + team style):** no git commands in steps — each task ends with a `> **Suggested commit:**` line only. There are no per-task test runs; a single **Final Verification** section at the end covers typecheck, lint, build, and manual checks (the dispatcher frontend has no unit-test runner).

---

### Task 1: Add driver field constants

**Files:**
- Modify: `frontend/shared/lib/validation/constants.ts`

- [ ] **Step 1: Broaden the file's header comment**

Change the opening line `// Field constraints for vehicle form validation.` to `// Field constraints for vehicle and driver form validation.` (the rest of the header comment is unchanged).

- [ ] **Step 2: Append the driver constants**

Add at the end of the file. Widths mirror the DB columns in `backend/app/db/models/people.py` (`full_name` String(255), `id_number` String(13), `license_number` String(50)) and the SA ID rule in `backend/app/schemas/people.py`.

```ts
// ── Driver field constraints ──
// Mirror backend/app/db/models/people.py column widths and the SA ID rule in
// backend/app/schemas/people.py. The backend remains authoritative.
export const SA_ID_LENGTH = 13
export const SA_ID_PATTERN = /^\d{13}$/

// SA phone: local 0XXXXXXXXX (10 chars) or international +27XXXXXXXXX (12 chars).
export const SA_PHONE_PATTERN = /^(0\d{9}|\+27\d{9})$/
// Matches any prefix of a still-valid-in-progress number, for live typing
// feedback: `0`+up to 9 digits, or `+`, `+2`, `+27`, `+27`+up to 9 digits.
export const SA_PHONE_PARTIAL = /^(0\d{0,9}|\+(2(7\d{0,9})?)?)$/
export const LOCAL_PHONE_LENGTH = 10
export const INTL_PHONE_LENGTH = 12

export const NAME_MAX = 255
export const LICENSE_MAX = 50
```

> **Suggested commit:** `feat(shared): add driver field validation constants`

---

### Task 2: Create the shared driver validation module

**Files:**
- Create: `frontend/shared/lib/validation/driver.ts`

- [ ] **Step 1: Write the module**

Mirrors `validation/vehicle.ts`. `normalisePhone` moves here from `drivers/page.tsx` so create and edit share one copy.

```ts
// Driver-specific validation, built from the generic primitives in rules.ts
// and the backend-mirrored constraints in constants.ts.
//
// Consumed by the dispatcher's Add Driver modal (fleet/drivers/page.tsx) and
// the driver detail edit form (fleet/drivers/[id]/page.tsx).
//
// is_active is excluded from DriverField — it's a boolean toggle, never
// invalid. id_number IS included because the create modal collects it; the
// edit form passes the stored (immutable) id_number straight through, never
// rendering it, so its error never surfaces there.

import { required, maxLength, exactLength, pattern, type Rule } from './rules'
import {
  SA_ID_LENGTH,
  SA_ID_PATTERN,
  SA_PHONE_PATTERN,
  SA_PHONE_PARTIAL,
  LOCAL_PHONE_LENGTH,
  INTL_PHONE_LENGTH,
  NAME_MAX,
  LICENSE_MAX,
} from './constants'

export type DriverField =
  | 'full_name'
  | 'id_number'
  | 'phone_number'
  | 'license_number'
  | 'license_expiry'

// Callers supply controlled <input> string values, hence all strings here.
export type DriverFormValues = Record<DriverField, string>

// Display order — shared by the create and edit forms to focus the first
// invalid field on submit, so the two can't drift out of sync.
export const DRIVER_FIELD_ORDER: readonly DriverField[] = [
  'full_name',
  'id_number',
  'phone_number',
  'license_number',
  'license_expiry',
]

/**
 * Validates a driver form's fields, returning the first error per field (or
 * null if valid). Mirrors the constraints enforced server-side in
 * backend/app/schemas/people.py and the column widths in
 * backend/app/db/models/people.py, so the client surfaces the same problems
 * before submit instead of round-tripping a 422.
 *
 * NOTE: license_expiry is required here as a product/UX decision — the backend
 * accepts null. See this document's design section for the rationale.
 */
export function validateDriverForm(values: DriverFormValues): Record<DriverField, string | null> {
  return {
    full_name: firstError(values.full_name, [
      required(),
      maxLength(NAME_MAX),
    ]),

    id_number: firstError(values.id_number, [
      required(),
      exactLength(SA_ID_LENGTH, `ID number must be exactly ${SA_ID_LENGTH} digits`),
      pattern(SA_ID_PATTERN, 'ID number must be digits only'),
    ]),

    phone_number: firstError(values.phone_number, [
      required(),
      saPhone(),
    ]),

    license_number: firstError(values.license_number, [
      required(),
      maxLength(LICENSE_MAX),
    ]),

    license_expiry: validateRequiredDate(values.license_expiry),
  }
}

/** Runs `rules` in order against `value`, returning the first non-null error. */
function firstError(value: string, rules: ReadonlyArray<Rule>): string | null {
  for (const rule of rules) {
    const error = rule(value)
    if (error !== null) {
      return error
    }
  }
  return null
}

/**
 * SA phone rule: accepts local (0XXXXXXXXX) or international (+27XXXXXXXXX)
 * form, tolerating internal whitespace (stripped before matching). Empty is
 * skipped — pair with `required` for the mandatory check. normalisePhone
 * converts a passing value to the canonical +27 form at submit time.
 */
function saPhone(): Rule {
  return (value: string): string | null => {
    if (value.length === 0) {
      return null
    }
    const digits = value.replace(/\s+/g, '')
    if (SA_PHONE_PATTERN.test(digits)) {
      return null
    }
    return 'Enter a valid SA phone number (0XXXXXXXXX or +27XXXXXXXXX)'
  }
}

/** Required date: empty is an error, non-empty must parse to a real date. */
function validateRequiredDate(value: string): string | null {
  if (value.trim().length === 0) {
    return 'Licence expiry is required.'
  }
  if (isNaN(new Date(value).getTime())) {
    return 'Enter a valid date.'
  }
  return null
}

/** Converts a local SA number (0XXXXXXXXX) to international (+27XXXXXXXXX). */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\s+/g, '')
  if (/^0\d{9}$/.test(digits)) {
    return `+27${digits.slice(1)}`
  }
  return digits
}

/**
 * Live-typing feedback for the phone field, mirroring vinFieldFeedback: a
 * neutral `hint` (running character count) while the value is still a valid
 * prefix mid-entry, a red `error` only once it can't become valid. Both null
 * when empty or fully valid. At most one is non-null.
 */
export function phoneFieldFeedback(value: string): { hint: string | null; error: string | null } {
  const digits = value.replace(/\s+/g, '')
  if (digits.length === 0) {
    return { hint: null, error: null }
  }
  if (SA_PHONE_PATTERN.test(digits)) {
    return { hint: null, error: null }
  }
  // Still a valid prefix toward a complete number — guide, don't alarm.
  if (SA_PHONE_PARTIAL.test(digits)) {
    const target = digits.startsWith('+') ? INTL_PHONE_LENGTH : LOCAL_PHONE_LENGTH
    return { hint: `${digits.length} of ${target} characters`, error: null }
  }
  return { hint: null, error: 'Use 0XXXXXXXXX or +27XXXXXXXXX' }
}
```

> **Suggested commit:** `feat(shared): add driver form validation module`

---

### Task 3: Create the useResizablePanel hook

**Files:**
- Create: `frontend/dispatcher/lib/hooks/useResizablePanel.ts`

- [ ] **Step 1: Write the hook**

Extracts the single-panel drag-to-resize logic verbatim from the vehicle detail page, with the shared default widths exported alongside it.

```ts
'use client'

import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

// Shared defaults for the fleet detail-page side panels (vehicle + driver),
// so the two pages stay visually identical.
export const DETAIL_PANEL_DEFAULT_W = 520
export const DETAIL_PANEL_MIN_W = 360
export const DETAIL_PANEL_MAX_W = 720

interface ResizablePanel {
  width: number
  startResize: (e: ReactMouseEvent) => void
}

/**
 * Owns a single resizable panel's width and the drag interaction. The panel
 * renders `style={{ width }}` and wires `onMouseDown={startResize}` to a drag
 * handle. Width is clamped to [min, max] during the drag.
 *
 * Scoped to single-panel detail layouts. The dashboard/history tables use a
 * different per-column resize and intentionally do not use this hook.
 */
export function useResizablePanel(
  initialWidth: number,
  opts: { min: number; max: number },
): ResizablePanel {
  const [width, setWidth] = useState(initialWidth)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)

  function startResize(e: ReactMouseEvent) {
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startW: width }

    function onMove(ev: globalThis.MouseEvent) {
      const r = resizeRef.current
      if (!r) return
      const next = r.startW + (ev.clientX - r.startX)
      setWidth(Math.min(opts.max, Math.max(opts.min, next)))
    }

    function onUp() {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return { width, startResize }
}
```

> **Suggested commit:** `feat(dispatcher): extract useResizablePanel hook`

---

### Task 4: Point the vehicle detail page at the hook

**Files:**
- Modify: `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`

- [ ] **Step 1: Update the React import (line 3)**

`useRef` is no longer used in this file once the hook owns it.

```ts
import { useState } from 'react'
```

- [ ] **Step 2: Add the hook import (after the existing hook imports, near line 16)**

```ts
import {
  useResizablePanel,
  DETAIL_PANEL_DEFAULT_W,
  DETAIL_PANEL_MIN_W,
  DETAIL_PANEL_MAX_W,
} from '@/lib/hooks/useResizablePanel'
```

- [ ] **Step 3: Delete the local width constants (lines 35-37)**

Remove:

```ts
const DEFAULT_PANEL_W = 520
const MIN_PANEL_W = 360
const MAX_PANEL_W = 720
```

- [ ] **Step 4: Replace the inline state + startResize (lines 49-71) with the hook**

Remove the `panelWidth`/`setPanelWidth` `useState`, the `resizeRef`, and the entire `function startResize(e: React.MouseEvent) { … }` block, and in their place put:

```ts
  const { width: panelWidth, startResize } = useResizablePanel(
    DETAIL_PANEL_DEFAULT_W,
    { min: DETAIL_PANEL_MIN_W, max: DETAIL_PANEL_MAX_W },
  )
```

The JSX usages `style={{ width: panelWidth }}` and `onMouseDown={startResize}` are unchanged.

> **Suggested commit:** `refactor(dispatcher): use useResizablePanel in vehicle detail`

---

### Task 5: Rewrite the driver detail page to vehicle parity

**Files:**
- Modify (full replace): `frontend/dispatcher/app/(app)/fleet/drivers/[id]/page.tsx`

- [ ] **Step 1: Replace the file contents**

Layout flips to info-left (resizable) / history-right, Edit moves inline into the "Driver Info" header, and validation is wired in exactly like the vehicle page. POPIA shield notes are retained.

```tsx
'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TopBar }    from '@/components/ui/TopBar'
import { Chip }      from '@/components/ui/Chip'
import { Spinner }   from '@/components/ui/Spinner'
import { Button }    from '@/components/ui/Button'
import { Ic }        from '@/components/ui/Ic'
import { InfoRow }   from '@/components/ui/InfoRow'
import { FormField } from '@/components/ui/FormField'
import { Switch }    from '@/components/ui/Switch'
import { BlockchainBadge } from '@/components/blockchain/BlockchainBadge'
import { EventTimeline }   from '@/components/blockchain/EventTimeline'
import { ForensicOnly }    from '@/components/blockchain/ForensicOnly'
import { useDriverDetail } from '@/lib/hooks/useDriverDetail'
import {
  useResizablePanel,
  DETAIL_PANEL_DEFAULT_W,
  DETAIL_PANEL_MIN_W,
  DETAIL_PANEL_MAX_W,
} from '@/lib/hooks/useResizablePanel'
import { api } from '@/lib/api/client'
import { ROUTES } from '@/lib/constants/routes'
import {
  validateDriverForm,
  phoneFieldFeedback,
  normalisePhone,
  DRIVER_FIELD_ORDER,
  type DriverField,
  type DriverFormValues,
} from '@shared/lib/validation/driver'

type EditState = {
  full_name: string
  phone_number: string
  license_number: string
  license_expiry: string
  is_active: boolean
}

export default function DriverDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { data: driver, isLoading, error, refetch } = useDriverDetail(params.id)

  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<EditState | null>(null)
  const [touched, setTouched] = useState<Set<DriverField>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { width: panelWidth, startResize } = useResizablePanel(
    DETAIL_PANEL_DEFAULT_W,
    { min: DETAIL_PANEL_MIN_W, max: DETAIL_PANEL_MAX_W },
  )

  const backButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => router.push(ROUTES.fleetDrivers)}
      iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
    >
      Back
    </Button>
  )

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Driver" left={backButton} />
        <div className="flex items-center justify-center flex-1">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  if (error || !driver) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Driver not found" left={backButton} />
        <div className="p-6 text-[13px] text-on-surf-v">Could not load driver.</div>
      </div>
    )
  }

  const latestReceipt = driver.receipts[0] ?? null

  // Derived each render — validateDriverForm is pure and cheap. id_number is
  // immutable and never edited here, so the stored value is passed straight
  // through (always valid); its error never surfaces.
  const formValues: DriverFormValues | null = form
    ? {
        full_name: form.full_name,
        id_number: driver.id_number,
        phone_number: form.phone_number,
        license_number: form.license_number,
        license_expiry: form.license_expiry,
      }
    : null
  const errors = formValues ? validateDriverForm(formValues) : null
  const hasErrors = errors ? Object.values(errors).some((e) => e !== null) : false
  // Phone gets live feedback the moment the user types (not touched-gated), like VIN.
  const phoneFeedback = form ? phoneFieldFeedback(form.phone_number) : null

  function startEdit() {
    setForm({
      full_name: driver!.full_name,
      phone_number: driver!.phone_number,
      license_number: driver!.license_number,
      license_expiry: driver!.license_expiry ?? '',
      is_active: driver!.is_active,
    })
    setTouched(new Set())
    setSaveError(null)
    setIsEditing(true)
  }

  function handleFieldChange(name: string, value: string) {
    setForm((prev) => prev ? { ...prev, [name]: value } : prev)
    setTouched((prev) => {
      const next = new Set(prev)
      next.add(name as DriverField)
      return next
    })
  }

  async function handleSave() {
    if (!form) return

    // Defensive re-validate: the disabled Save button blocks this in the common
    // path, but guard here too (e.g. a future Enter-key submit).
    if (errors && hasErrors) {
      setTouched(new Set(DRIVER_FIELD_ORDER))
      const firstInvalidField = DRIVER_FIELD_ORDER.find((field) => errors[field] !== null)
      if (firstInvalidField) {
        document.querySelector<HTMLInputElement>(`[name="${firstInvalidField}"]`)?.focus()
      }
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const body: Record<string, unknown> = {}
      if (form.full_name !== driver!.full_name) body.full_name = form.full_name
      // Normalise before diffing so a re-typed local number that equals the
      // stored +27 form isn't sent as a spurious change.
      const normalisedPhone = normalisePhone(form.phone_number)
      if (normalisedPhone !== driver!.phone_number) body.phone_number = normalisedPhone
      if (form.license_number !== driver!.license_number) body.license_number = form.license_number
      if (form.license_expiry !== (driver!.license_expiry ?? '')) body.license_expiry = form.license_expiry || null
      if (form.is_active !== driver!.is_active) body.is_active = form.is_active

      if (Object.keys(body).length === 0) { setIsEditing(false); return }
      await api.patch(`/api/v1/drivers/${driver!.id}`, body)
      await refetch()
      setIsEditing(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title={driver.full_name}
        sub={driver.phone_number}
        left={backButton}
      >
        <Chip type={driver.is_active ? 'complete' : 'pending'} label={driver.is_active ? 'Active' : 'Inactive'} />
      </TopBar>

      <div className="flex flex-1 overflow-hidden">

        {/* LEFT — resizable driver info column, drag-to-resize */}
        <div
          style={{ width: panelWidth }}
          className="relative shrink-0 overflow-y-auto bg-surf-low border-r border-outline-v/20 p-5"
        >

          {/* Resize handle — hover to reveal, drag to resize */}
          <div
            onMouseDown={startResize}
            className="absolute top-0 right-0 -mr-2 h-full w-4 cursor-col-resize flex items-center justify-center group z-10"
          >
            <div className="w-[2px] h-10 rounded-full bg-outline-v/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* Driver info */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
              Driver Info
            </div>
            {!isEditing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                Edit
              </Button>
            )}
          </div>

          {isEditing && form ? (
            <div className="flex flex-col gap-3 mb-4">
              <FormField label="Full Name"      name="full_name"      value={form.full_name}      onChange={handleFieldChange} error={touched.has('full_name') ? errors?.full_name ?? undefined : undefined} />
              <FormField label="Phone Number"   name="phone_number"   value={form.phone_number}   onChange={handleFieldChange} helperText={phoneFeedback?.hint ?? undefined} error={phoneFeedback?.error ?? undefined} />
              <FormField label="Licence Number" name="license_number" value={form.license_number} onChange={handleFieldChange} error={touched.has('license_number') ? errors?.license_number ?? undefined : undefined} />
              <FormField label="Licence Expiry" name="license_expiry" type="date" value={form.license_expiry} onChange={handleFieldChange} error={touched.has('license_expiry') ? errors?.license_expiry ?? undefined : undefined} />

              <div className="flex items-center justify-between py-[6px]">
                <span className="text-xs font-medium text-surface-on-variant">Active</span>
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(next) => setForm((prev) => prev ? { ...prev, is_active: next } : prev)}
                  ariaLabel="Driver active"
                />
              </div>

              <div className="flex items-center gap-[5px]">
                <Ic n="shield" s={11} className="text-on-surf-v opacity-50 shrink-0" />
                <span className="text-[10px] font-[500] tracking-[0.03em] text-on-surf-v opacity-60">
                  Licence number changes are SHA-256 hashed before anchoring to Hedera (POPIA).
                </span>
              </div>

              {saveError && <p className="text-sm text-red-500">{saveError}</p>}

              <div className="flex gap-[6px]">
                <Button full loading={saving} disabled={hasErrors || saving} onClick={handleSave}>
                  Save
                </Button>
                <Button variant="secondary" onClick={() => setIsEditing(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-surf-lowest rounded-lg p-[12px_14px] mb-4 shadow-level-2">
                <InfoRow label="Full name"      value={driver.full_name} />
                <InfoRow label="Phone"          value={driver.phone_number} mono />
                <InfoRow label="ID number"      value={driver.id_number} mono />
                <InfoRow label="Licence number" value={driver.license_number} mono />
                <InfoRow label="Licence expiry" value={driver.license_expiry ?? '—'} mono={!!driver.license_expiry} />
                <InfoRow label="Status"         value={driver.is_active ? 'Active' : 'Inactive'} />
              </div>
              <div className="flex items-center gap-[5px] mb-4 px-[2px]">
                <Ic n="shield" s={11} className="text-on-surf-v opacity-50 shrink-0" />
                <span className="text-[10px] font-[500] tracking-[0.03em] text-on-surf-v opacity-60">
                  Personal info is stored in database only and never written to Hedera (POPIA).
                </span>
              </div>
            </>
          )}

          {/* Blockchain — forensic detail; hidden for non-admin / forensic-off dispatchers. */}
          <ForensicOnly>
            <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
              Blockchain
            </div>
            <div className="bg-chain-c rounded-md p-[10px_12px] mb-4 leading-relaxed">
              <div className="flex items-center gap-[5px] mb-1">
                <Ic n="hex" s={12} className="text-chain" />
                <span className="text-[11px] font-[500] tracking-[0.04em] text-chain-onc">
                  {driver.receipts.length === 0
                    ? 'Not yet anchored'
                    : `${driver.receipts.length} receipt${driver.receipts.length > 1 ? 's' : ''} anchored`
                  }
                </span>
              </div>
              {latestReceipt && (
                <div className="mb-[6px]">
                  <BlockchainBadge receipt={latestReceipt} />
                </div>
              )}
              <div className="text-[11px] text-chain-onc opacity-60">
                Licence number is SHA-256 hashed before anchoring.
              </div>
            </div>
          </ForensicOnly>

          {/* Trips */}
          {driver.trip_ids.length > 0 && (
            <>
              <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
                Trips for This Driver
              </div>
              <div className="bg-surf-lowest rounded-lg shadow-level-2 divide-y divide-outline-v/20">
                {driver.trip_ids.map((tid) => (
                  <button
                    key={tid}
                    onClick={() => router.push(`/trips/${tid}`)}
                    className="w-full flex items-center justify-between px-[14px] py-[10px] text-left hover:bg-surf-low transition-colors first:rounded-t-lg last:rounded-b-lg"
                  >
                    <span className="text-[13px] font-[500] tabular-nums tracking-[0.04em] text-sec truncate">{tid}</span>
                    <Ic n="chev" s={14} className="text-on-surf-v shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}

        </div>

        {/* RIGHT — scrollable immutable history, takes remaining space */}
        <div className="flex-1 overflow-y-auto p-6 bg-surf-lowest">
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
            Immutable History
          </div>
          <EventTimeline events={driver.events} receipts={driver.receipts} />
        </div>
      </div>
    </div>
  )
}
```

> **Suggested commit:** `feat(dispatcher): driver detail parity — resizable layout + inline validation`

---

### Task 6: Wire validation into the Add Driver modal + list filters

**Files:**
- Modify (full replace): `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`

- [ ] **Step 1: Replace the file contents**

Add the search + status filter controls above the table, swap the raw modal `<input>`s for `FormField`, add the required licence-expiry field, and wire `validateDriverForm` + `phoneFieldFeedback` + disabled Save + focus-first-invalid. `normalisePhone` is now imported from the shared module (the local copy is removed).

```tsx
'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/ui/TopBar'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Modal } from '@/components/ui/Modal'
import { FormField } from '@/components/ui/FormField'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { useToast } from '@/lib/hooks/useToast'
import { api } from '@/lib/api/client'
import type { Column } from '@/components/ui/DataTable'
import type { Driver } from '@shared/lib/types/driver'
import {
  validateDriverForm,
  phoneFieldFeedback,
  normalisePhone,
  DRIVER_FIELD_ORDER,
  type DriverField,
  type DriverFormValues,
} from '@shared/lib/validation/driver'
import { SA_ID_LENGTH } from '@shared/lib/validation/constants'

const columns: Column<Driver>[] = [
  {
    key: 'full_name',
    label: 'Name',
    sortable: true,
    render: (val) => <span className="font-bold text-surface-on">{String(val)}</span>,
  },
  {
    key: 'id_number',
    label: 'ID Number',
    render: (val) => (
      <span className="font-mono text-xs tracking-wider text-surface-on-variant">
        {/* Mask for POPIA compliance — show only last 4 digits */}
        ···· {String(val).slice(-4)}
      </span>
    ),
  },
  {
    key: 'phone_number',
    label: 'Phone',
    render: (val) => <span className="text-sm text-surface-on">{String(val)}</span>,
  },
  {
    key: 'is_active',
    label: 'Status',
    sortable: true,
    render: (val) => (
      <Chip type={val ? 'complete' : 'pending'} label={val ? 'Active' : 'Inactive'} />
    ),
  },
]

type StatusFilter = 'all' | 'active' | 'inactive'

const EMPTY_FORM: DriverFormValues = {
  full_name: '',
  id_number: '',
  phone_number: '',
  license_number: '',
  license_expiry: '',
}

export default function FleetDriversPage(): React.JSX.Element {
  const router = useRouter()
  const { drivers, isLoading, error: fetchError, refetch } = useDrivers()
  const { notify } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<DriverFormValues>(EMPTY_FORM)
  const [touched, setTouched] = useState<Set<DriverField>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // List controls — parity with the vehicles page.
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    if (fetchError) {
      notify({ kind: 'error', title: 'Failed to load drivers', body: fetchError })
    }
  }, [fetchError, notify])

  // Derived each render — pure and cheap.
  const errors = validateDriverForm(form)
  const hasErrors = Object.values(errors).some((e) => e !== null)
  const phoneFeedback = phoneFieldFeedback(form.phone_number)

  const filteredDrivers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return drivers.filter((d) => {
      if (statusFilter === 'active' && !d.is_active) return false
      if (statusFilter === 'inactive' && d.is_active) return false
      if (q.length === 0) return true
      return (
        d.full_name.toLowerCase().includes(q) ||
        d.phone_number.toLowerCase().includes(q) ||
        d.license_number.toLowerCase().includes(q)
      )
    })
  }, [drivers, search, statusFilter])

  function handleChange(field: string, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }))
    setTouched((prev) => {
      const next = new Set(prev)
      next.add(field as DriverField)
      return next
    })
  }

  function handleClose(): void {
    setModalOpen(false)
    setForm(EMPTY_FORM)
    setTouched(new Set())
    setFormError(null)
  }

  async function handleSubmit(): Promise<void> {
    // Defensive re-validate — the disabled Save button blocks the common path.
    if (hasErrors) {
      setTouched(new Set(DRIVER_FIELD_ORDER))
      const firstInvalidField = DRIVER_FIELD_ORDER.find((field) => errors[field] !== null)
      if (firstInvalidField) {
        document.querySelector<HTMLInputElement>(`[name="${firstInvalidField}"]`)?.focus()
      }
      return
    }

    setSubmitting(true)
    setFormError(null)
    try {
      await api.post('/api/v1/drivers', {
        ...form,
        phone_number: normalisePhone(form.phone_number),
        license_expiry: form.license_expiry || null,
      })
      handleClose()
      refetch()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create driver')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Drivers">
        <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
          Add Driver
        </Button>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-6">
        {/* List controls — search + status filter, parity with vehicles page */}
        <div className="flex items-center gap-3 mb-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, or licence…"
            className="flex-1 border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <DataTable<Driver>
          columns={columns}
          rows={filteredDrivers}
          isLoading={isLoading}
          error={fetchError}
          onRetry={refetch}
          onRowClick={(d) => router.push(`/fleet/drivers/${d.id}`)}
          empty={{ title: 'No drivers', body: 'No drivers match your filters.' }}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={handleClose}
        title="Add Driver"
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="sm" loading={submitting} disabled={hasErrors || submitting} onClick={handleSubmit}>
              Save Driver
            </Button>
          </>
        }
      >
        {formError && (
          <p className="mb-4 text-sm text-red-500">{formError}</p>
        )}
        <div className="flex flex-col gap-4">
          <FormField label="Full Name" name="full_name" value={form.full_name} onChange={handleChange} placeholder="e.g. Sipho Dlamini" error={touched.has('full_name') ? errors.full_name ?? undefined : undefined} />
          <FormField label="SA ID Number (13 digits)" name="id_number" value={form.id_number} onChange={handleChange} placeholder="8001015009087" maxLength={SA_ID_LENGTH} inputMode="numeric" error={touched.has('id_number') ? errors.id_number ?? undefined : undefined} />
          <FormField label="Phone Number" name="phone_number" value={form.phone_number} onChange={handleChange} placeholder="0821234567 or +27821234567" helperText={phoneFeedback.hint ?? undefined} error={phoneFeedback.error ?? undefined} />
          <FormField label="Licence Number" name="license_number" value={form.license_number} onChange={handleChange} placeholder="DRV-001" error={touched.has('license_number') ? errors.license_number ?? undefined : undefined} />
          <FormField label="Licence Expiry" name="license_expiry" type="date" value={form.license_expiry} onChange={handleChange} error={touched.has('license_expiry') ? errors.license_expiry ?? undefined : undefined} />
        </div>
      </Modal>
    </div>
  )
}
```

> **Suggested commit:** `feat(dispatcher): validate Add Driver modal + add list search/status filters`

---

## Final Verification

Run once all tasks are complete. The dispatcher frontend has no unit-test runner, so verification is typecheck + lint + build + a manual pass.

- [ ] **Typecheck** — `cd frontend/dispatcher && npx tsc --noEmit` → no errors. (Confirms the shared `@shared/*` types resolve and no `any` slipped in.)
- [ ] **Lint** — `cd frontend/dispatcher && npm run lint` → clean.
- [ ] **Build** — `cd frontend/dispatcher && npm run build` → succeeds.
- [ ] **Manual — driver detail layout:** open a driver; confirm info column is on the **left** and resizable (drag handle, clamps 360–720px), Immutable History fills the right, and the vehicle detail page still resizes identically (hook shared).
- [ ] **Manual — driver detail validation:** click Edit; clear Full Name → error on blur/touch; type a bad phone → live error, partial phone → neutral count hint; clear Licence Expiry → "required" error; confirm Save is disabled while any error shows and focuses the first invalid field if force-submitted.
- [ ] **Manual — Add Driver modal:** open it; confirm the new Licence Expiry field is present and required, SA ID rejects non-13-digit / non-numeric input, phone shows live feedback, Save is gated, and a valid submit creates the driver (phone stored as `+27…`).
- [ ] **Manual — list filters:** type in search (matches name/phone/licence), switch the status filter, confirm the table narrows and the empty state reads correctly.

---

## Self-review (plan vs spec)

- **Spec coverage:** validation module (Task 2 + constants Task 1), `useResizablePanel` (Task 3) + vehicle adoption (Task 4), driver detail parity — layout/inline edit/validation/immutable history (Task 5), Add Driver validation + required expiry (Task 6), list search/status filter (Task 6). All spec sections mapped.
- **Placeholders:** none — every code step shows complete content.
- **Type consistency:** `DriverField`, `DriverFormValues`, `DRIVER_FIELD_ORDER`, `validateDriverForm`, `phoneFieldFeedback`, `normalisePhone` are defined in Task 2 and consumed unchanged in Tasks 5–6; `useResizablePanel` + `DETAIL_PANEL_*` defined in Task 3 and consumed in Tasks 4–5.
