# Input Validation & Error Feedback — Design + Implementation Plan

**Date:** 2026-06-25
**Author:** Ciaran
**Status:** Approved design — ready to implement
**Scope tier:** Foundation + vehicle forms (first application). Other forms are explicit follow-ups.

> This document combines the design (what & why) and the implementation plan (how) in one file by request.

---

## 1. Context & Problem

Editing a vehicle with an over-length VIN (e.g. a 23-character string) produces a **500 Internal Server Error**:

```
asyncpg.exceptions.StringDataRightTruncationError: value too long for type character varying(17)
```

Root cause: the `vehicles.vin_number` column is `VARCHAR(17)` (correct — VINs are 17 chars), but **neither the frontend nor the Pydantic schema validates length**, so invalid input reaches Postgres and is rejected as an unhandled 500 instead of a clean, field-level error. The same latent defect exists for every other unvalidated string field (`registration` → 50, `pulsit_device_id` → 100, `make`/`model` → 100).

There is also **no client-side feedback at all**: the user only learns a value is invalid after a failed save. The dispatcher vehicle form uses the bare `FormField` component, which has no error-display support.

## 2. Goals

- Invalid input produces **informative, field-level feedback**, not a 500.
- **Live feedback** on format-constrained fields — the VIN field tells the user as they type how many of the 17 characters they have and whether the value is valid.
- A **reusable foundation** so this is built once and applied to other forms later, not re-invented per form.
- All rules **defensible at examination** — no opaque library magic.

## 3. Non-Goals (explicit out of scope)

- Validation for other forms (trips/new, login, drivers, OTP, client-portal) — each is a separate follow-up rollout spec.
- Consolidating the duplicate `FormField` / `Input` components into one.
- Changing the API client's 422-message flattening.
- Setting up a frontend JS test runner (see §9).

## 4. Design

### 4.1 Three layers, one source of truth

| Layer | Role |
|---|---|
| **Client validation** | UX. Live, inline, mirrors backend rules. Guides the user *before* submit. |
| **Backend (Pydantic)** | Integrity backstop & **authoritative rule**. Bad input → clean **422** with field `loc`, never a 500. |
| **Server-error fallback** | If a 422 reaches the client, show it as a form-level banner. With the mirror in place this should essentially never fire — defense in depth. |

**Drift risk & mitigation:** the frontend constants are a deliberate *mirror* of the backend model constraints. The backend remains authoritative; the shared constants file carries a comment pointing at `backend/app/db/models/vehicles.py` so future changes update both.

### 4.2 Shared validation foundation — `frontend/shared/lib/validation/`

Hand-rolled, **no new dependency**. Three files:

- **`rules.ts`** — pure rule primitives, each typed `(value: string) => string | null` (returns an error message or `null`):
  `required`, `maxLength(n)`, `exactLength(n)`, `pattern(re, message)`, `intInRange(min, max)`. Composable and trivially testable.
- **`constants.ts`** — field constraints mirroring the backend model, with a source-of-truth comment:
  `VIN_LENGTH = 17`, `VIN_PATTERN = /^[A-Za-z0-9]{17}$/`, `REGISTRATION_MAX = 50`, `PULSIT_MAX = 100`, `MAKE_MODEL_MAX = 100`, `YEAR_MIN = 1900`.
- **`vehicle.ts`** —
  - `validateVehicleForm(values): Record<VehicleField, string | null>` — runs the rule set for each field, returns first error per field (or `null`).
  - `vinProgress(value): string | null` — the live helper: `"7 of 17 characters"` while under length; `"VIN must be letters and numbers only"` if 17 chars but non-alphanumeric; `null` when valid or empty.

The form wiring (touched-state tracking, Save-gating) lives in the vehicle page component for this first application. Once 2–3 forms use the foundation in rollout, extract a `useValidatedForm` hook — not before (YAGNI).

### 4.3 Vehicle field rules

| Field | Rule |
|---|---|
| `registration` | required, ≤ 50 |
| `pulsit_device_id` | required, ≤ 100 |
| `vin_number` | optional; if filled → **exactly 17 alphanumeric** characters (`[A-Za-z0-9]`) |
| `licence_disc_expiry` | optional; valid date (native date input) |
| `make` / `model` | optional, ≤ 100 |
| `year` | optional; integer 1900 – (current year + 1) |
| `gross_vehicle_mass_kg` | optional; positive integer |
| `length_m` | trailer-only; already a 6 / 12 / 18 `<select>` |
| `is_active` | boolean toggle; no validation |

**VIN decision:** any 17 alphanumeric characters (no ISO I/O/Q restriction), per the developer's call.

### 4.4 Error UX behaviour

- Validation runs on **every change**.
- A field's error message appears once the field is **touched or edited** — so a freshly opened edit form (prefilled with valid data) is not pre-littered with errors, and an empty create form does not shout "required" before the user types.
- **Save button disabled** while any field is invalid.
- On Save: re-validate all fields, focus the first invalid one. A server 422 (backstop) is shown via the existing form-level `saveError` banner.

### 4.5 Component change — `dispatcher/components/ui/FormField.tsx`

Enhance `FormField` to accept `error?`, `helperText?`, `required?`, and pass through `maxLength` / `inputMode`, while keeping its existing `onChange(name, value)` signature so the vehicle form rewiring is minimal. Error renders inline below the input in the error colour (matching the richer `Input` component's pattern).

### 4.6 Backend — `backend/app/schemas/vehicles.py`

Add Pydantic v2 constraints to the **input** schemas `VehicleCreateBody` and `VehicleUpdateBody` **only**. Do **not** put constraints on `VehicleBase` / `VehicleRead` / `VehicleDetailResponse`: the read schemas must faithfully echo whatever is already stored, including legacy rows that predate the rules (e.g. a sub-17-char VIN). Constraining the read model makes `GET /vehicles` 500 on existing data.

- `registration`: `StringConstraints(min_length=1, max_length=50)`
- `pulsit_device_id`: `StringConstraints(min_length=1, max_length=100)`
- `vin_number`: optional; `StringConstraints(pattern=r"^[A-Za-z0-9]{17}$")`
- `make` / `model`: `StringConstraints(max_length=100)`
- `year`: `@field_validator` enforcing 1900 ≤ year ≤ current year + 1 (dynamic ceiling)
- `gross_vehicle_mass_kg`: `Field(gt=0)`

Result: over-length / invalid input → **422 with field `loc`**, never a 500. `schemas/vehicles.py` is vehicle-scoped (not a shared file).

## 5. Architecture compliance

- Endpoints stay thin; validation is declarative in the Pydantic layer. ✔
- No new dependencies. ✔
- `frontend/shared/` consumed via the `@shared/*` alias by both surfaces (foundation is surface-agnostic). ✔
- No PII, blockchain, or orchestration changes. ✔

---

## 6. Implementation Plan

Ordered steps. No per-step commits or verification — see §8 for the single verification pass.

### Phase A — Backend (clean 422s; the integrity backstop)

1. Add the Pydantic v2 constraints from §4.6 to `VehicleCreateBody`, `VehicleUpdateBody`, and `VehicleBase` in `backend/app/schemas/vehicles.py`, using `Annotated[...]` + `StringConstraints` and a `@field_validator` for `year`.
2. Add integration tests in `backend/tests/integration/` for vehicle create + update:
   - over-length VIN → **422** (not 500)
   - non-alphanumeric / wrong-length VIN → **422**
   - over-length `registration` → **422**
   - valid payload → **200/201**, and assert DB state is **unchanged** after a 422.

### Phase B — Shared validation foundation

3. Create `frontend/shared/lib/validation/rules.ts` (rule primitives).
4. Create `frontend/shared/lib/validation/constants.ts` (constraints mirroring the backend model, with the source-of-truth comment).
5. Create `frontend/shared/lib/validation/vehicle.ts` (`validateVehicleForm`, `vinProgress`).

### Phase C — Component support

6. Enhance `dispatcher/components/ui/FormField.tsx` with `error` / `helperText` / `required` props and inline error rendering, preserving the `onChange(name, value)` signature.

### Phase D — Apply to the vehicle form

7. In `dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`:
   - compute `errors = validateVehicleForm(form)` and track a `touched` set
   - pass per-field `error` (shown when touched/edited) into each `FormField`
   - wire the VIN field to `vinProgress` for live count/feedback (auto-shown as the user types)
   - disable **Save** while any error is present; on Save, mark all touched and focus the first invalid field
   - keep the existing server-error banner as the 422 fallback
8. Apply the same `validateVehicleForm` wiring to the **create-vehicle** form (in `fleet/vehicles/page.tsx`) so creation is validated identically.

## 7. Files

**Create:**
- `frontend/shared/lib/validation/rules.ts`
- `frontend/shared/lib/validation/constants.ts`
- `frontend/shared/lib/validation/vehicle.ts`
- `backend/tests/integration/test_vehicles_validation.py` (or extend the existing vehicle integration test file if present)

**Modify:**
- `backend/app/schemas/vehicles.py`
- `frontend/dispatcher/components/ui/FormField.tsx`
- `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`
- `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`

**Out of scope / excluded:** all other forms; `FormField`/`Input` consolidation; API-client 422 handling.

## 8. Verification (single pass, at the end)

- **Backend:** `cd backend && pytest` — all green, including the new 422/200 vehicle validation tests.
- **Frontend (manual, in-app):** run the dispatcher, open a vehicle, and confirm:
  - typing < 17 VIN chars shows the live "N of 17 characters" message and Save is disabled
  - a valid 17-char alphanumeric VIN clears the message and enables Save
  - over-length `registration` shows an inline error
  - a previously-failing multi-field edit (VIN + other fields) now saves cleanly with valid input
  - submitting somehow-invalid data shows a clear message, **not** a 500.

## 9. Testing note — frontend test runner

The backend uses `pytest`. The **frontend has no JS test runner installed**. The shared validators are pure functions and easy to unit-test, but adding a runner (Vitest) is a new dev dependency touching `package.json` and needs team agreement. **Decision: verify in-app for now; "set up Vitest + unit-test the validators" is a separate follow-up task.**

## 10. Follow-ups (separate specs)

- Roll the foundation out to: trips/new, login, drivers, OTP, client-portal.
- Extract a `useValidatedForm` hook once 2–3 forms share the pattern.
- Set up Vitest and add unit tests for the shared validators.
- Optional: consolidate `FormField` and `Input` into one input component.

---

> **Suggested commit (docs):** `docs: spec input validation & error feedback (foundation + vehicle forms)`
