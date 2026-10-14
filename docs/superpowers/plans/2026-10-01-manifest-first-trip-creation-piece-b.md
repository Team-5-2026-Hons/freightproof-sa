# Manifest-First Trip Creation — Piece B (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatcher creates a loaded trip by typing a Parcel Perfect manifest number on one screen, or an empty leg with no manifest. The order number is gone from every dispatcher and driver display. The manifest panel shows the manifest as it was locked at creation.

**Architecture:** `trips/new` becomes one client page made of small presentational sections, driven by pure rule modules (`lib/trips/*`) and one hook (`useManifestPreview`). All HTTP goes through typed helpers in `lib/api/client.ts`. `ApiError` now keeps the response's `detail`, so the structured 409 and 422 bodies from piece A reach the screen intact. Trip lists and headers label a trip by `pp_manifest.display` (or "Empty leg" / "No manifest"). The driver PWA keeps only `trip_reference`. On the backend, the wizard-era manifest readers are deleted once nothing calls them.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.5 strict, Tailwind 3.4 tokens from `DESIGN_SYSTEM.md`, Vitest 3 with Testing Library and jsdom. On the backend: Python 3.13, FastAPI, pytest.

**Spec:** [`docs/superpowers/specs/2026-09-30-manifest-first-trip-creation-design.md`](../specs/2026-09-30-manifest-first-trip-creation-design.md) (§11, §12, §16 frontend, §17 piece B). Read §4–§6, §10.1, §10.2, §10.4, §10.7, §11 and §12 before Task 1. This plan cites spec sections as §N.

**Built against piece A as committed** (`274117c`), not against the piece A plan's snippets:

| Piece A shape | Where | What B relies on |
|---|---|---|
| Preview `GET /api/v1/trips/pp-manifest-preview?manifest_number=N` → `PPManifestPreviewResponse` | `backend/app/schemas/pp_manifest.py` | `pp_manifest {issuer_account, origin_hub, number, display}`, `snapshot_sha256`, `client_organization_id` (null if unlinked), `client_name`, `origin`/`destination {hub_code, precinct_id, precinct_name}`, `planned_departure_at`, `expected_arrival_at`, `is_closed`, `client_reference`, `notes[]`, `totals`, `waybills[]`, `warnings[]`, `can_create` |
| Warning `{code, message, blocking, trip_id, trip_reference, waybills[]}` | same | A holder from another organisation comes back as `trip_id: null, trip_reference: null`, and its message says "another trip" (`pp_manifest_service._waybills_held_elsewhere`) |
| Create `POST /api/v1/trips/from-pp-manifest` | `TripFromPPManifestRequest` | Times must carry a zone (`AwareDatetime`). A null time means "use the manifest's". A precinct is used only for an unlinked hub |
| 409 `{code: "MANIFEST_ALREADY_ON_TRIP", message, trip_id, trip_reference}` | `trips.py::_trip_http_error` | Both ids are null when a lost race's winner rolled back |
| 409 `{code: "MANIFEST_CHANGED", message, preview}` | same | `preview` is the fresh preview, already JSON |
| 409 plain string | same (`ConsignmentAlreadyAssignedError`, `ConsignmentScannedOnCancelledTripError`) | Shown as is |
| 422 `{code, message}` | same (`PPManifestUnusableError`) | `PRECINCT_REQUIRED`, `PRECINCT_NOT_AVAILABLE`, `SAME_PRECINCT`, `NO_PLANNED_DEPARTURE`, `SCHEDULE_INVALID`, or a blocking warning code |
| 404 / 501 / 502 / 504 string details | same | 501 text: "Manifest lookup is not available on the live Parcel Perfect API." |
| Retry lookup `GET /api/v1/trips?pp_manifest_number=N` | `trips.py::list_trips_endpoint` | Exact match. Returns every status, so the caller drops cancelled rows |
| Dispatcher `GET /trips/{id}/manifest` → `pp_manifest_snapshot` | `manifest_service.get_manifest_for_dispatcher` | A cancelled trip whose waybills moved returns `consignments: []` and the snapshot instead of a 404 |
| Dev trigger `POST /api/v1/dev/pp/manifest {manifest_number, closed?, planned_departure_at?, expected_arrival_at?}` | `dev_triggers.py` | Changes the snapshot hash, so a preview made before it is stale (used in Task 11's walkthrough) |

## Before you start (Ciaran, not the agent)

1. Work on branch `Ciaran`. Piece A is committed there (`274117c`). `git status` should show only the untracked `.agents/` and `.codex/`.
2. Settle the **Questions** below with Tom and Tim before Task 6 (Tom) and Task 7 (Tim) start.
3. Task 11's browser walkthrough needs a backend whose database has piece A's migration (`2026_10_01_ciaran_pp_manifest_trips`) applied, with `scripts/seed_demo.py` re-run afterwards so the demo precincts get their hub codes. Apply it to a **local** database. CLAUDE.md forbids applying it to the shared dev database from a feature branch, and the agent never runs Alembic. If no such database is available, Task 11 Step 6 waits until A and B are on `dev`.
4. **A and B merge to `dev` together, in one PR from `Ciaran`.** A removed `order_number` from API responses, and the current dashboard search throws on `t.order_number.toLowerCase()` as soon as anyone types in it.

## Questions (answer before the named task)

1. **Tom — FP-142 overlap (before Task 6).** Task 6 replaces `frontend/dispatcher/app/(app)/trips/new/page.tsx` completely. `origin/Tom` has one unmerged commit on that file (`23dcee4`, 5 Aug, "update trip summary styles"). It will conflict, and its styles are superseded. Spec §11 puts Tom's FP-142 clash message in the crew step. In this plan that is `components/trips/new/CrewFields.tsx`. Proposal: Tom rebases FP-142 onto `dev` after A+B merge and adds the clash message inside `CrewFields`, with no changes to the page. Has Tom started FP-142 (or FP-139/FP-260 work on this screen) locally? If he has, agree the order first.
2. **Tim — driver PWA (before Task 7).** Task 7 edits `driver-pwa/lib/types/driver-trip.ts`, `app/(app)/trips/page.tsx`, `components/home/HomeContent.tsx`, `components/trip/TripTable.tsx` and `components/trip/TripDetailView.tsx`, plus nine test fixtures. Every change deletes the order-number line or badge. No pushed branch touches these files (checked `origin/*` against `origin/dev`), and `origin/Tim` dates from May. Can Tim confirm he has no local work on them?
3. **Label for a trip with no manifest (Task 7).** Spec §12 says "Empty leg". But a loaded trip can also lack a manifest: trips made on the dev database before piece A, and anything created through `POST /trips` with consignments. Default in this plan: show the manifest display. Without one, show "Empty leg" only when `trip_type` proves it, otherwise "No manifest". History rows carry no `trip_type` (`TripHistoryListItemResponse`), so they show "No manifest". The alternative is to add `trip_type` to the history response, which is a backend change and not in B.
4. **Expected arrival is optional in both modes (Task 2).** The old wizard required it, but the API does not (`validate_declared_schedule`). Default: optional. Say if empty legs should still require it.
5. **Endpoints left with no caller after B.** `GET /api/v1/pp/waybills/{ref}`, `GET /api/v1/pp/capabilities`, `supports_manifest_lookup`, `frontend/dispatcher/lib/hooks/usePpCapabilities.ts` and `frontend/shared/lib/types/pp.ts`. They were not on the removal list, so this plan leaves them in place and lists them in TASK COMPLETE. Remove them in piece C, or here?

## Decisions this plan makes

- **D1 — The manifest panel shows the H0 snapshot.** A cancelled trip whose waybills moved to its replacement has no cargo record except H0, and today the panel would tell the dispatcher "This manifest contains no consignments", which is false. So:
  - **No consignments but a snapshot:** the snapshot is the panel's content, framed as the only record.
  - **Live consignments:** the snapshot appears below them as a collapsed "Manifest at creation" block. It sits beside the live list, so creation-time and current cargo can be compared (§10.6).

  **The refetch cost is accepted, not engineered away.** `useTripResource` refetches `GET /trips/{id}/manifest` on every live event for that trip. But it only runs while `ManifestContent` is mounted (the Manifest tab of `TripDetailPanel`), it is debounced to one request per 200 ms burst, and the snapshot is smaller per parcel than the parcel list the same response already carries: three fields per track, against about ten per parcel row. If it ever matters, the fix is a separate immutable endpoint (`GET /trips/{id}/pp-manifest-snapshot`, cacheable forever because H0 never changes). That endpoint is not built here.
- **D2 — Untouched manifest times are never sent back.** The form holds an override per time (`null` = follow the manifest). An untouched or reset field sends `null`, and the server uses the manifest's own value exactly. Sending the value back would record the manifest's time as the dispatcher's override, after a round trip through a minute-precision local-time input.
- **D3 — No capabilities pre-check.** The screen does not call `GET /pp/capabilities`. A live-PP 501 from the preview is the single signal (§13, scenario 7), and that error offers "Create an empty leg instead".
- **D4 — An empty-leg timeout is not reconciled automatically.** An empty leg has no key to look up (§10.3, §13), so the screen says the outcome is unknown and links to Active trips. A manifest timeout is reconciled through the exact retry lookup (§10.4), and retrying after it is safe because a manifest can only be on one trip.
- **D5 — The driver PWA drops the order-number line rather than repeating `trip_reference`.** `trip_reference` is already the title on every driver screen that showed the order number, so "show `trip_reference` where it showed `order_number`" (§12) means one identifier, not the same one twice.

## Global Constraints

- Node 22 LTS. Next.js 15 App Router only. React 19 (`ref` is an ordinary prop, so no `forwardRef`). TypeScript 5.5 `strict`. **Never `any`**: JSON from the server is `unknown` until a type guard narrows it.
- `trips/new` is a client page (`'use client'`), as today. Every driver-PWA page stays `'use client'` (`output: 'export'`).
- HTTP only through `lib/api/client.ts` (`api.*` or a typed helper exported from it). Never raw `fetch()` in components or hooks.
- Design system (`frontend/DESIGN_SYSTEM.md`): Tailwind tokens only (ESLint rejects raw hex), Inter only, tabular figures for every identifier, count and time, `Ic` stroke icons, no emoji. One gradient CTA per view. Mismatch and blocking states use the error container (`bg-err-c text-err-onc`), never solid red. Status colour comes from chips, not rows.
- Accessibility: every input has a `<label htmlFor>`. Errors sit under their field with `role="alert"`. Icons are `aria-hidden` (as `Ic` already is). Keyboard order follows visual order. Text on the dark summary panel is at least `text-white/60` (4.5:1).
- UI copy: "Parcel Perfect manifest", "waybill(s)", "Empty leg". The mock manifest is labelled as an assumed data contract (§8).
- POPIA: `pp_manifest_snapshot` is dispatcher-only (§7.3). Never add it, or `pp_manifest`, to a driver-PWA type or screen.
- No new dependencies. No `package.json` or `requirements.txt` changes. No migration in B. `trips.order_number` stays in the database until piece C.
- The agent never runs `git commit`, `push`, `merge`, `rebase`, `checkout`, `stash`, `reset` or `restore`. "Stage" steps mean `git add <named files>`; Ciaran commits, using the suggested message.
- The agent never runs Alembic or any database command. Backend pytest runs **in the foreground only** (`cd backend && pytest …`), because a backgrounded run races the stop hook and wipes the test database.
- Shared files touched, flagged for review: `frontend/shared/lib/types/{trip,manifest,pp-manifest}.ts`, `frontend/shared/lib/mocks/{trips,manifests}.ts`. The receiver app also compiles `../shared`, so Task 11 type-checks it.

## Review Focus

These failure modes follow from the spec but are easy to miss. Each line names the task whose tests now pin it.

1. **A structured error must not reach the screen as "[object Object]".** Today `client.ts` returns a non-string, non-array `detail` as the message, so every piece A 409 and 422 would render as `[object Object]` and lose its `code`. Task 1 keeps the detail on `ApiError` and surfaces `detail.message`.
2. **Manifest times survive the round trip.** An untouched time sends `null` (D2). Clearing a manifest-supplied arrival is refused, because `null` would quietly lock the manifest's arrival while the field showed none. After `MANIFEST_CHANGED`, untouched times follow the new manifest and edited ones stay. Pinned in Tasks 2 and 6.
3. **The summary always describes the number in the box.** A slow answer for an earlier number must not replace a newer one, and editing the number after a lookup clears the summary. Otherwise the dispatcher could create a trip from a manifest they are no longer looking at. Pinned in Tasks 3 and 6.
4. **A timed-out create gets a definite answer.** The retry lookup matches the full key (issuer, hub, number) and ignores cancelled trips. A failed lookup says so, rather than claiming "not created". Pinned in Tasks 1 and 6.
5. **A cancelled trip whose waybills moved still shows its cargo.** The panel renders the H0 snapshot, not "This manifest contains no consignments". Pinned in Task 8.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `frontend/shared/lib/types/pp-manifest.ts` (create) | Mirrors `schemas/pp_manifest.py`: ref, preview, warnings, create payload; H0 snapshot shape | 1, 8 |
| `frontend/dispatcher/lib/api/json.ts` (create) | `isRecord` type guard for `unknown` JSON | 1 |
| `frontend/dispatcher/lib/api/client.ts` (modify) | `ApiError.detail`, `detailMessage`, manifest trip helpers | 1 |
| `frontend/dispatcher/lib/trips/trip-api-errors.ts` (create) | What a failed lookup or create means for the screen | 1 |
| `frontend/dispatcher/lib/trips/__fixtures__/preview.ts`, `snapshot.ts` (create) | Test-only builders (no `.test` suffix, so never collected) | 1, 8 |
| `frontend/dispatcher/lib/trips/manifest-form.ts` (create) | Pure form rules: gaps, validation, request builders, time conversion | 2 |
| `frontend/dispatcher/lib/trips/trailer-combo.ts` (create) | Trailer combination rule, moved out of the old page | 2 |
| `frontend/shared/lib/types/trip.ts` (modify) | `TripCreatePayload` loses `order_number` (2); read types swap `order_number` for `pp_manifest` (7) | 2, 7 |
| `frontend/dispatcher/lib/hooks/useManifestPreview.ts` (create) | Lookup state with a stale-answer guard | 3 |
| `frontend/dispatcher/components/trips/new/form-parts.tsx` (create) | Card, title, label, field-error, underline-field class | 4 |
| `frontend/dispatcher/components/trips/new/ManifestLookup.tsx` (create) | Number input, Look up, lookup failures | 4 |
| `frontend/dispatcher/components/trips/new/ManifestSummary.tsx` (create) | What PP says: client, route, totals, waybill lines, notes | 4 |
| `frontend/dispatcher/components/trips/new/ManifestWarnings.tsx` (create) | Blocking warnings vs prompts | 4 |
| `frontend/dispatcher/components/trips/new/CrewFields.tsx` (create) | Driver, horse, trailers (ported from the old page) | 5 |
| `frontend/dispatcher/components/trips/new/RouteFields.tsx` (create) | Fixed manifest precinct or a picker | 5 |
| `frontend/dispatcher/components/trips/new/ScheduleFields.tsx` (create) | Times with "From manifest" and reset | 5 |
| `frontend/dispatcher/components/trips/new/CreateTripSummary.tsx` (create) | Dark summary panel and the one CTA | 5 |
| `frontend/dispatcher/app/(app)/trips/new/page.tsx` (rewrite) | The one-screen flow | 2, 6 |
| `frontend/dispatcher/lib/format/manifest.ts` (create) | `manifestLabel` | 7 |
| `frontend/dispatcher/lib/trips/search.ts` (create) | Dashboard search predicate | 7 |
| Dispatcher displays (modify): `app/(app)/page.tsx`, `app/(app)/history/page.tsx`, `components/domain/ChecklistRow.tsx`, `app/(app)/trips/[id]/TripHeaderSummary.tsx`, `components/trips/TripSummary.tsx`, `lib/phase/trip-detail.ts` | Manifest label replaces order number | 7 |
| Driver PWA (modify): `lib/types/driver-trip.ts`, `app/(app)/trips/page.tsx`, `components/home/HomeContent.tsx`, `components/trip/TripTable.tsx`, `components/trip/TripDetailView.tsx` | Order number removed | 7 |
| `frontend/shared/lib/mocks/trips.ts`, `manifests.ts` (modify) | Mocks match the types | 7, 8 |
| `frontend/shared/lib/types/manifest.ts` (modify) | `Manifest.pp_manifest_snapshot` | 8 |
| `frontend/dispatcher/lib/trips/manifest-snapshot.ts` (create), `components/domain/ManifestSnapshot.tsx` (create), `components/domain/ManifestContent.tsx` (modify) | H0 snapshot in the panel | 8 |
| `backend/app/integrations/parcel_perfect.py`, `orchestration/pp_lookup_service.py`, `api/v1/endpoints/pp.py` (modify) | Wizard-era manifest readers removed | 9 |
| `docs/FreightProof_Full_Picture_v7.md`, `docs/db-models.md`, `docs/glossary.md`, `backend/docs/api_contract_dispatcher_driver.md`, `docs/demo-script.md` (modify) | Docs follow the code | 10 |

Commands used throughout, from the repository root:

- Dispatcher: `cd frontend/dispatcher && npx vitest run <path>`, `npm run type-check`, `npm run lint`
- Driver PWA: `cd frontend/driver-pwa && npx vitest run <path>`, `npx tsc --noEmit`, `npm run lint`
- Backend: `cd backend && pytest <path> -v` (foreground)

---

### Task 1: Manifest API layer — types, structured errors, typed helpers

**Files:**
- Create: `frontend/shared/lib/types/pp-manifest.ts`
- Create: `frontend/dispatcher/lib/api/json.ts`
- Modify: `frontend/dispatcher/lib/api/client.ts`
- Create: `frontend/dispatcher/lib/trips/trip-api-errors.ts`
- Create: `frontend/dispatcher/lib/trips/__fixtures__/preview.ts`
- Test: `frontend/dispatcher/lib/api/client.test.ts` (extend), `frontend/dispatcher/lib/trips/trip-api-errors.test.ts` (create)

**Interfaces:**
- Produces (`@shared/lib/types/pp-manifest`): `PPManifestRef {issuer_account, origin_hub, number, display}`, `PPManifestWarningCode`, `PPManifestErrorCode`, `PPManifestWarning`, `PPManifestHub`, `PPManifestNote`, `PPManifestWaybillLine`, `PPManifestTotals`, `PPManifestPreview`, `TripFromPPManifestPayload`.
- Produces (`@/lib/api/json`): `isRecord(value: unknown): value is Record<string, unknown>`.
- Produces (`@/lib/api/client`): `ApiError` gains `readonly detail: unknown` (third constructor argument, default `null`); `TRIP_CREATE_TIMEOUT_MS = 30_000`; `previewPPManifest(manifestNumber: number): Promise<PPManifestPreview>`; `createTripFromPPManifest(payload: TripFromPPManifestPayload): Promise<Trip>`; `createTrip(payload: TripCreatePayload): Promise<Trip>`; `findLiveTripForManifest(key: PPManifestRef): Promise<{ id: string } | null>` (throws `ApiError` if the lookup itself fails).
- Produces (`@/lib/trips/trip-api-errors`): `LookupFailure` (`not_found | unsupported | retryable | rejected`, each `{kind, message}`), `classifyLookupError(err: unknown, manifestNumber: number): LookupFailure`; `CreateFailure` (`{kind:'no_response'} | {kind:'manifest_changed', message, preview} | {kind:'already_on_trip', message, tripId: string | null, tripReference: string | null} | {kind:'rejected', message}`), `classifyCreateError(err: unknown): CreateFailure`; `isPreview(value: unknown): value is PPManifestPreview`.
- Produces (test-only, `@/lib/trips/__fixtures__/preview`): `makePreview(overrides?)`, `makeWarning(code, overrides?)`, `CLIENT_ID`, `ORIGIN_ID`, `DESTINATION_ID`.

- [ ] **Step 1: Create the shared PP manifest types**

Create `frontend/shared/lib/types/pp-manifest.ts`:

```ts
// Parcel Perfect manifest types (FP-281) — mirror backend/app/schemas/pp_manifest.py.
// A "PP manifest" is the client's Parcel Perfect manifest. It is not the trip's cargo
// listing in ./manifest.ts; spec §4 keeps the two names apart.

/** A trip's PP manifest key plus a display label. Null on trips without one. */
export interface PPManifestRef {
  issuer_account: string
  origin_hub: string
  number: number
  /** "CGY Logistics · JNB 69": the client, then the manifest as PP staff say it. */
  display: string
}

export type PPManifestWarningCode =
  | 'MANIFEST_ALREADY_ON_TRIP'
  | 'CLIENT_NOT_LINKED'
  | 'WAYBILL_CLIENT_MISMATCH'
  | 'WAYBILL_ON_OTHER_TRIP'
  | 'NO_WAYBILLS'
  | 'ORIGIN_HUB_UNLINKED'
  | 'DESTINATION_HUB_UNLINKED'
  | 'NO_PLANNED_TIMES'
  | 'MANIFEST_NOT_CLOSED'

/** Codes on create's 409/422 bodies that are not preview warnings. */
export type PPManifestErrorCode =
  | 'MANIFEST_CHANGED'
  | 'PRECINCT_REQUIRED'
  | 'PRECINCT_NOT_AVAILABLE'
  | 'SAME_PRECINCT'
  | 'NO_PLANNED_DEPARTURE'
  | 'SCHEDULE_INVALID'

export interface PPManifestWarning {
  code: PPManifestWarningCode
  message: string
  /** True for the five codes that refuse creation (spec §10.1). */
  blocking: boolean
  /** The trip holding the manifest or its waybills. Null when that trip belongs to
   *  another organisation: the conflict still blocks, but its identity is private. */
  trip_id: string | null
  trip_reference: string | null
  /** WAYBILL_CLIENT_MISMATCH and WAYBILL_ON_OTHER_TRIP name their waybills. */
  waybills: string[]
}

export interface PPManifestHub {
  hub_code: string
  /** Null when no precinct of the issuing client, visible to this dispatcher, has this hub code. */
  precinct_id: string | null
  precinct_name: string | null
}

export interface PPManifestNote {
  noted_at: string
  operator: string
  text: string
}

export interface PPManifestWaybillLine {
  waybill: string
  destination_town: string
  parcel_count: number
  weight_kg: number | null
}

export interface PPManifestTotals {
  waybills: number
  parcels: number
  weight_kg: number
}

/** GET /api/v1/trips/pp-manifest-preview. Read-only. snapshot_sha256 goes back with the
 *  create request, so what the dispatcher reviewed is what gets locked (spec §10.2). */
export interface PPManifestPreview {
  pp_manifest: PPManifestRef
  snapshot_sha256: string
  client_organization_id: string | null
  /** The linked organisation's name, else PP's issuer name. */
  client_name: string
  origin: PPManifestHub
  destination: PPManifestHub
  planned_departure_at: string | null
  expected_arrival_at: string | null
  is_closed: boolean
  client_reference: string | null
  notes: PPManifestNote[]
  totals: PPManifestTotals
  waybills: PPManifestWaybillLine[]
  warnings: PPManifestWarning[]
  can_create: boolean
}

/** POST /api/v1/trips/from-pp-manifest. Cargo is never sent: the server pulls it.
 *  A null time means "use the manifest's". Times must carry a zone. A precinct is read
 *  only for a hub the manifest could not link. */
export interface TripFromPPManifestPayload {
  manifest_number: number
  expected_snapshot_sha256: string
  driver_id: string
  horse_id: string
  trailer_ids: string[]
  planned_departure_at: string | null
  planned_arrival_at: string | null
  origin_precinct_id: string | null
  destination_precinct_id: string | null
}
```

- [ ] **Step 2: Create the JSON guard**

Create `frontend/dispatcher/lib/api/json.ts`:

```ts
/** A plain JSON object: narrows `unknown` response data without `any` or a cast. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 3: Create the test fixture**

Create `frontend/dispatcher/lib/trips/__fixtures__/preview.ts`:

```ts
// Test-only builders for PP manifest previews (FP-281). No .test suffix, so Vitest never
// collects this file. The client and precincts are the shared mocks' Courier Guy ones, so
// a page test's precinct list contains the client's depots.

import { CGY_ORG_ID } from '@shared/lib/mocks/principals'
import { PRECINCT_CGY_CT_ID, PRECINCT_CGY_JHB_ID } from '@shared/lib/mocks/precincts'
import type {
  PPManifestPreview, PPManifestWarning, PPManifestWarningCode,
} from '@shared/lib/types/pp-manifest'

const BLOCKING_CODES: readonly PPManifestWarningCode[] = [
  'MANIFEST_ALREADY_ON_TRIP', 'CLIENT_NOT_LINKED', 'WAYBILL_CLIENT_MISMATCH',
  'WAYBILL_ON_OTHER_TRIP', 'NO_WAYBILLS',
]

export const CLIENT_ID: string = CGY_ORG_ID
export const ORIGIN_ID: string = PRECINCT_CGY_CT_ID
export const DESTINATION_ID: string = PRECINCT_CGY_JHB_ID

export function makeWarning(
  code: PPManifestWarningCode,
  overrides: Partial<PPManifestWarning> = {},
): PPManifestWarning {
  return {
    code,
    message: `${code} message`,
    blocking: BLOCKING_CODES.includes(code),
    trip_id: null,
    trip_reference: null,
    waybills: [],
    ...overrides,
  }
}

export function makePreview(overrides: Partial<PPManifestPreview> = {}): PPManifestPreview {
  return {
    pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'CPT', number: 81, display: 'The Courier Guy · CPT 81' },
    snapshot_sha256: 'a'.repeat(64),
    client_organization_id: CLIENT_ID,
    client_name: 'The Courier Guy',
    origin: { hub_code: 'CPT', precinct_id: ORIGIN_ID, precinct_name: 'Courier Guy CT — Montague Gardens' },
    destination: { hub_code: 'JNB', precinct_id: DESTINATION_ID, precinct_name: 'Courier Guy JHB — Linbro Park' },
    planned_departure_at: '2026-10-02T16:00:00Z',
    expected_arrival_at: '2026-10-03T04:00:00Z',
    is_closed: true,
    client_reference: 'PO-CGY-0081',
    notes: [{ noted_at: '2026-10-02T14:25:00Z', operator: 'CGY Dispatch', text: 'Two pallets shrink-wrapped together' }],
    totals: { waybills: 2, parcels: 5, weight_kg: 180.5 },
    waybills: [
      { waybill: 'MFTWB8101', destination_town: 'Johannesburg', parcel_count: 3, weight_kg: 120 },
      { waybill: 'MFTWB8102', destination_town: 'Midrand', parcel_count: 2, weight_kg: 60.5 },
    ],
    warnings: [],
    can_create: true,
    ...overrides,
  }
}
```

- [ ] **Step 4: Write the failing client tests**

In `frontend/dispatcher/lib/api/client.test.ts`:
- Change the import to `import { api, ApiError, cancelTrip, overridePhase, createTripFromPPManifest, findLiveTripForManifest, previewPPManifest } from './client'`.
- In `throws ApiError with the first validation message on a 422`, replace both `'order_number is required'` strings with `'driver_id is required'`. The order number no longer exists, and the sweep in Task 11 must find no stale mentions.
- In `does not retry a POST when the connection drops`, replace `{ order_number: 'X' }` with `{ driver_id: 'X' }`.
- Append:

```ts
describe('structured error detail (FP-281)', () => {
  it('surfaces the message of an object detail and keeps the detail itself', async () => {
    const detail = {
      code: 'MANIFEST_ALREADY_ON_TRIP',
      message: 'This PP manifest is already on trip FP-1. Cancel that trip before creating a new one.',
      trip_id: 'trip-1',
      trip_reference: 'FP-1',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { detail })))

    await expect(api.post('/api/v1/trips/from-pp-manifest', {})).rejects.toMatchObject({
      status: 409,
      message: detail.message,
      detail,
    })
  })

  it('keeps a plain string detail as the message', async () => {
    const detail = "Waybill 'WAY001' is already assigned to another trip."
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { detail })))

    await expect(api.get('/x')).rejects.toMatchObject({ status: 409, message: detail, detail })
  })

  it('falls back to the status text when the detail carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, { detail: { code: 'X' } })))

    await expect(api.get('/x')).rejects.toMatchObject({ status: 422, message: 'HTTP 422' })
  })
})

describe('manifest trip helpers', () => {
  const key = { issuer_account: 'MOCK01', origin_hub: 'CPT', number: 81, display: 'The Courier Guy · CPT 81' }

  it('previewPPManifest asks for the typed number', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { can_create: true }))
    vi.stubGlobal('fetch', fetchMock)

    await previewPPManifest(81)

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/api/v1/trips/pp-manifest-preview?manifest_number=81')
  })

  it('createTripFromPPManifest posts the payload to the manifest endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: 'trip-1' }))
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      manifest_number: 81, expected_snapshot_sha256: 'a'.repeat(64), driver_id: 'd', horse_id: 'h',
      trailer_ids: [], planned_departure_at: null, planned_arrival_at: null,
      origin_precinct_id: null, destination_precinct_id: null,
    }

    await createTripFromPPManifest(payload)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/v1/trips/from-pp-manifest')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(payload)
  })

  it('findLiveTripForManifest ignores cancelled trips and other issuers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [
      { id: 'cancelled', status: 'cancelled', pp_manifest: key },
      { id: 'other-issuer', status: 'created', pp_manifest: { ...key, issuer_account: 'RTT001' } },
      { id: 'live', status: 'created', pp_manifest: key },
    ])))

    await expect(findLiveTripForManifest(key)).resolves.toEqual({ id: 'live' })
  })

  it('findLiveTripForManifest returns null when no live trip carries the manifest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [
      { id: 'cancelled', status: 'cancelled', pp_manifest: key },
    ])))

    await expect(findLiveTripForManifest(key)).resolves.toBeNull()
  })
})
```

- [ ] **Step 5: Write the failing classifier tests**

Create `frontend/dispatcher/lib/trips/trip-api-errors.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn() } },
  getAccessToken: vi.fn(),
}))

import { ApiError } from '@/lib/api/client'
import { classifyCreateError, classifyLookupError, isPreview } from './trip-api-errors'
import { makePreview } from './__fixtures__/preview'

describe('classifyLookupError', () => {
  it('names the number when Parcel Perfect has no such manifest', () => {
    const failure = classifyLookupError(new ApiError(404, 'PP manifest 999 not found'), 999)

    expect(failure.kind).toBe('not_found')
    expect(failure.message).toContain('999')
  })

  it('passes the 501 text through as unsupported', () => {
    const message = 'Manifest lookup is not available on the live Parcel Perfect API.'

    expect(classifyLookupError(new ApiError(501, message), 81)).toEqual({ kind: 'unsupported', message })
  })

  it('treats an unreachable Parcel Perfect and no response as retryable', () => {
    expect(classifyLookupError(new ApiError(502, 'Parcel Perfect is unreachable — try again shortly.'), 81).kind).toBe('retryable')
    expect(classifyLookupError(new ApiError(0, 'timed out'), 81).kind).toBe('retryable')
  })

  it('never shows a raw exception', () => {
    expect(classifyLookupError(new TypeError('boom'), 81)).toEqual({
      kind: 'rejected', message: 'Something went wrong. Please try again.',
    })
  })
})

describe('classifyCreateError', () => {
  it('reports no response for a client-side timeout', () => {
    expect(classifyCreateError(new ApiError(0, 'timed out'))).toEqual({ kind: 'no_response' })
  })

  it('carries the fresh preview of a changed manifest', () => {
    const fresh = makePreview({ snapshot_sha256: 'b'.repeat(64) })
    const err = new ApiError(409, 'PP manifest 81 changed since it was previewed — review it again.', {
      code: 'MANIFEST_CHANGED', message: 'PP manifest 81 changed since it was previewed — review it again.', preview: fresh,
    })

    expect(classifyCreateError(err)).toEqual({ kind: 'manifest_changed', message: err.message, preview: fresh })
  })

  it('does not trust a malformed changed-manifest preview', () => {
    const err = new ApiError(409, 'changed', { code: 'MANIFEST_CHANGED', message: 'changed', preview: { nope: true } })

    expect(classifyCreateError(err)).toEqual({ kind: 'rejected', message: 'changed' })
  })

  it('names the trip already holding the manifest', () => {
    const err = new ApiError(409, 'This PP manifest is already on trip FP-1.', {
      code: 'MANIFEST_ALREADY_ON_TRIP', message: 'This PP manifest is already on trip FP-1.', trip_id: 'trip-1', trip_reference: 'FP-1',
    })

    expect(classifyCreateError(err)).toEqual({
      kind: 'already_on_trip', message: err.message, tripId: 'trip-1', tripReference: 'FP-1',
    })
  })

  it('keeps a lost race whose winner rolled back as already_on_trip with no trip', () => {
    const err = new ApiError(409, 'This PP manifest is already on trip.', {
      code: 'MANIFEST_ALREADY_ON_TRIP', message: 'This PP manifest is already on trip.', trip_id: null, trip_reference: null,
    })

    expect(classifyCreateError(err)).toMatchObject({ kind: 'already_on_trip', tripId: null, tripReference: null })
  })

  it('shows the backend text for a held waybill and a 422', () => {
    const held = new ApiError(409, "Waybill 'WAY001' was scanned on another cancelled trip.", "Waybill 'WAY001' was scanned on another cancelled trip.")
    const unusable = new ApiError(422, 'Origin and destination must be different precincts.', {
      code: 'SAME_PRECINCT', message: 'Origin and destination must be different precincts.',
    })

    expect(classifyCreateError(held)).toEqual({ kind: 'rejected', message: held.message })
    expect(classifyCreateError(unusable)).toEqual({ kind: 'rejected', message: unusable.message })
  })
})

describe('isPreview', () => {
  it('accepts a preview and rejects other shapes', () => {
    expect(isPreview(makePreview())).toBe(true)
    expect(isPreview({ ...makePreview(), can_create: 'yes' })).toBe(false)
    expect(isPreview(null)).toBe(false)
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run lib/api/client.test.ts lib/trips/trip-api-errors.test.ts`
Expected: FAIL. `previewPPManifest` is not exported, and `./trip-api-errors` cannot be resolved.

- [ ] **Step 7: Keep the detail on `ApiError`**

In `frontend/dispatcher/lib/api/client.ts`:

Add to the imports:

```ts
import { isRecord } from '@/lib/api/json'
import type { Trip, TripCreatePayload, TripStatus } from '@shared/lib/types/trip'
import type { PPManifestPreview, PPManifestRef, TripFromPPManifestPayload } from '@shared/lib/types/pp-manifest'
```

(This replaces the existing `import type { Trip } from '@shared/lib/types/trip'` line.)

Replace the `ApiError` class with:

```ts
export class ApiError extends Error {
  // status 0 = client-side failure, no HTTP response received (request/session timeout).
  constructor(
    public readonly status: number,
    message: string,
    // The response body's `detail`, as sent: a string, a validation list, or an object
    // such as FP-281's {code, message, ...}. Callers that act on a code read it here.
    // null when no response was received.
    public readonly detail: unknown = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
```

Add above `async function request<T>(`:

```ts
// FastAPI sends `detail` as a string, a validation list, or (for the manifest endpoints)
// an object carrying its own `message`. Turning that object into a string by accident is
// how a 409 ends up on screen as "[object Object]".
function detailMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    const first: unknown = raw[0]
    return isRecord(first) && typeof first.msg === 'string' ? first.msg : fallback
  }
  if (isRecord(raw) && typeof raw.message === 'string') return raw.message
  return fallback
}
```

Replace the `if (!res.ok) { … }` block inside `request` with:

```ts
    if (!res.ok) {
      // Bounded by the still-armed window, so a stalled error body falls through to
      // statusText instead of hanging.
      const body: unknown = await res.json().catch(() => ({ detail: res.statusText }))
      const raw = isRecord(body) ? body.detail : undefined
      throw new ApiError(res.status, detailMessage(raw, res.statusText), raw ?? null)
    }
```

- [ ] **Step 8: Add the manifest trip helpers**

Append to `frontend/dispatcher/lib/api/client.ts`:

```ts
// ── Trip creation (FP-281) ───────────────────────────────────────────────────

/** GET /trips/pp-manifest-preview: read-only. The warnings say what blocks creation and
 *  what the dispatcher must supply (spec §10.1). */
export function previewPPManifest(manifestNumber: number): Promise<PPManifestPreview> {
  return api.get<PPManifestPreview>(`/api/v1/trips/pp-manifest-preview?manifest_number=${manifestNumber}`)
}

// Both creation endpoints wait synchronously on the Hedera anchor (the backend's own
// fail-closed budget runs to ~15-20s), so they can outlive REQUEST_TIMEOUT_MS. If a call
// still times out, the backend is genuinely unreachable and the caller must reconcile
// before telling the dispatcher anything.
export const TRIP_CREATE_TIMEOUT_MS = 30_000

/** POST /trips/from-pp-manifest: a loaded trip from a PP manifest (spec §10.2). */
export function createTripFromPPManifest(payload: TripFromPPManifestPayload): Promise<Trip> {
  return api.post<Trip>('/api/v1/trips/from-pp-manifest', payload, { timeoutMs: TRIP_CREATE_TIMEOUT_MS })
}

/** POST /trips: the explicit path, which the screen uses for empty legs (spec §10.3). */
export function createTrip(payload: TripCreatePayload): Promise<Trip> {
  return api.post<Trip>('/api/v1/trips', payload, { timeoutMs: TRIP_CREATE_TIMEOUT_MS })
}

// Only what the retry lookup reads; the full row is TripSummary.
interface TripManifestRow {
  id: string
  status: TripStatus
  pp_manifest: PPManifestRef | null
}

/** The non-cancelled trip carrying this manifest, or null (spec §10.4). The filter on the
 *  number is exact. The full key is then compared, because the number alone is unique
 *  only in the mock. Throws ApiError when the lookup itself fails. */
export async function findLiveTripForManifest(key: PPManifestRef): Promise<{ id: string } | null> {
  const rows = await api.get<TripManifestRow[]>(`/api/v1/trips?pp_manifest_number=${key.number}`)
  const live = rows.find(row =>
    row.status !== 'cancelled'
    && row.pp_manifest?.issuer_account === key.issuer_account
    && row.pp_manifest.origin_hub === key.origin_hub,
  )
  return live ? { id: live.id } : null
}
```

- [ ] **Step 9: Create the error classifier**

Create `frontend/dispatcher/lib/trips/trip-api-errors.ts`:

```ts
// What a failed manifest lookup or trip creation means for the screen (FP-281 §10.7).
// The backend's detail text is written for dispatchers, so most failures show it as is.
// Only the cases the screen must act on get their own kind: a changed manifest, a
// manifest already on a trip, and no response at all.

import { ApiError } from '@/lib/api/client'
import { isRecord } from '@/lib/api/json'
import type { PPManifestPreview } from '@shared/lib/types/pp-manifest'

// ApiError status 0: the client gave up and no HTTP response arrived (client.ts).
const NO_RESPONSE = 0
const HTTP_NOT_FOUND = 404
const HTTP_CONFLICT = 409
const HTTP_NOT_IMPLEMENTED = 501
const HTTP_BAD_GATEWAY = 502
const HTTP_GATEWAY_TIMEOUT = 504

const CODE_MANIFEST_CHANGED = 'MANIFEST_CHANGED'
const CODE_MANIFEST_ALREADY_ON_TRIP = 'MANIFEST_ALREADY_ON_TRIP'

const UNEXPECTED = 'Something went wrong. Please try again.'
const LOOKUP_NO_RESPONSE = 'Parcel Perfect did not answer in time. Try again.'

export type LookupFailure =
  | { kind: 'not_found'; message: string }
  | { kind: 'unsupported'; message: string }   // live PP has no manifest lookup (501)
  | { kind: 'retryable'; message: string }     // PP unreachable, or no response
  | { kind: 'rejected'; message: string }

export function classifyLookupError(err: unknown, manifestNumber: number): LookupFailure {
  if (!(err instanceof ApiError)) return { kind: 'rejected', message: UNEXPECTED }
  switch (err.status) {
    case HTTP_NOT_FOUND:
      return {
        kind: 'not_found',
        message: `Parcel Perfect has no manifest ${manifestNumber}. Check the number on the client's manifest.`,
      }
    case HTTP_NOT_IMPLEMENTED:
      return { kind: 'unsupported', message: err.message }
    case NO_RESPONSE:
      return { kind: 'retryable', message: LOOKUP_NO_RESPONSE }
    case HTTP_BAD_GATEWAY:
    case HTTP_GATEWAY_TIMEOUT:
      return { kind: 'retryable', message: err.message }
    default:
      return { kind: 'rejected', message: err.message }
  }
}

export type CreateFailure =
  | { kind: 'no_response' }
  | { kind: 'manifest_changed'; message: string; preview: PPManifestPreview }
  | { kind: 'already_on_trip'; message: string; tripId: string | null; tripReference: string | null }
  | { kind: 'rejected'; message: string }

export function classifyCreateError(err: unknown): CreateFailure {
  if (!(err instanceof ApiError)) return { kind: 'rejected', message: UNEXPECTED }
  if (err.status === NO_RESPONSE) return { kind: 'no_response' }

  const detail = isRecord(err.detail) ? err.detail : null
  const preview = detail?.preview
  if (err.status === HTTP_CONFLICT && detail?.code === CODE_MANIFEST_CHANGED && isPreview(preview)) {
    return { kind: 'manifest_changed', message: err.message, preview }
  }
  if (err.status === HTTP_CONFLICT && detail?.code === CODE_MANIFEST_ALREADY_ON_TRIP) {
    return {
      kind: 'already_on_trip',
      message: err.message,
      tripId: stringOrNull(detail.trip_id),
      tripReference: stringOrNull(detail.trip_reference),
    }
  }
  return { kind: 'rejected', message: err.message }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Checks the fields the screen reads from a 409's fresh preview. A body that fails is
 *  shown as a plain error rather than trusted as a summary. */
export function isPreview(value: unknown): value is PPManifestPreview {
  return isRecord(value)
    && typeof value.snapshot_sha256 === 'string'
    && isRecord(value.pp_manifest) && typeof value.pp_manifest.number === 'number'
    && isRecord(value.origin) && isRecord(value.destination) && isRecord(value.totals)
    && Array.isArray(value.waybills) && Array.isArray(value.warnings) && Array.isArray(value.notes)
    && typeof value.can_create === 'boolean'
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run lib/api/client.test.ts lib/trips/trip-api-errors.test.ts`
Expected: all pass, including every existing client test (401 recovery, retry, timeout).

Run: `cd frontend/dispatcher && npm run type-check && npm run lint`
Expected: no errors.

- [ ] **Step 11: Stage**

```bash
git add frontend/shared/lib/types/pp-manifest.ts frontend/dispatcher/lib/api/json.ts frontend/dispatcher/lib/api/client.ts frontend/dispatcher/lib/api/client.test.ts frontend/dispatcher/lib/trips/trip-api-errors.ts frontend/dispatcher/lib/trips/trip-api-errors.test.ts frontend/dispatcher/lib/trips/__fixtures__/preview.ts
```
Suggested commit: `feat(dispatcher): typed manifest preview and create calls with structured errors (FP-281)`

---

### Task 2: Form rules — gaps, validation, request builders, trailer combination

**Files:**
- Create: `frontend/dispatcher/lib/trips/manifest-form.ts`
- Create: `frontend/dispatcher/lib/trips/trailer-combo.ts`
- Modify: `frontend/shared/lib/types/trip.ts` (`TripCreatePayload` loses `order_number`)
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx` (one line, so the old page still compiles until Task 6 replaces it)
- Test: `frontend/dispatcher/lib/trips/manifest-form.test.ts`, `frontend/dispatcher/lib/trips/trailer-combo.test.ts`

**Interfaces:**
- Consumes: Task 1 `PPManifestPreview`, `TripFromPPManifestPayload`; `TripCreatePayload` from `@shared/lib/types/trip`.
- Produces (`@/lib/trips/manifest-form`): types `CrewValues {driverId, horseId, trailerIds}`, `ScheduleOverrides {departure: string | null, arrival: string | null}`, `RoutePicks {originId, destinationId}`, `TimeInputs {departure: string, arrival: string}`, `FormField`, `FieldErrors = Partial<Record<FormField, string>>`, `ManifestGaps {origin: boolean, destination: boolean}`. Constants `EMPTY_CREW`, `NO_OVERRIDES`, `NO_PICKS`, `NO_TIMES`. Functions `parseManifestNumber(input: string): number | null`, `isoToLocalInput(iso: string): string`, `localInputToIso(value: string): string`, `manifestTimes(preview): TimeInputs`, `shownTimes(overrides, source: TimeInputs): TimeInputs`, `manifestGaps(preview): ManifestGaps`, `validateCrew(crew, trailersValid: boolean): FieldErrors`, `validateSchedule(shown: TimeInputs, source: TimeInputs): FieldErrors`, `validateManifestRoute(preview, picks): FieldErrors`, `validateEmptyLegRoute(picks): FieldErrors`, `buildFromManifestPayload(preview, crew, overrides, picks): TripFromPPManifestPayload`, `buildEmptyLegPayload(crew, overrides, picks): TripCreatePayload`.
- Produces (`@/lib/trips/trailer-combo`): `MAX_TRAILERS = 2`, `TrailerCombo {valid, message}`, `trailerCombo(selected: readonly Vehicle[]): TrailerCombo`.

- [ ] **Step 1: Write the failing trailer-combination tests**

Create `frontend/dispatcher/lib/trips/trailer-combo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mockTrailers } from '@shared/lib/mocks/vehicles'
import type { Vehicle } from '@shared/lib/types/vehicle'
import { trailerCombo } from './trailer-combo'

function trailer(registration: string, length_m: number | null): Vehicle {
  return { ...mockTrailers[0], id: registration as Vehicle['id'], registration, length_m }
}

describe('trailerCombo', () => {
  it('allows a single unit and any one trailer', () => {
    expect(trailerCombo([]).valid).toBe(true)
    expect(trailerCombo([trailer('T-9', 9)])).toEqual({ valid: true, message: 'T-9 — 9 m' })
    expect(trailerCombo([trailer('T-X', null)]).message).toBe('T-X — unknown length')
  })

  it('allows two trailers only as 6 m + 12 m, in either order', () => {
    expect(trailerCombo([trailer('T-12', 12), trailer('T-6', 6)]).valid).toBe(true)
    expect(trailerCombo([trailer('T-12', 12), trailer('T-12b', 12)])).toEqual({
      valid: false, message: '12 m + 12 m — exceeds 18 m limit',
    })
  })

  it('refuses a third trailer', () => {
    expect(trailerCombo([trailer('A', 6), trailer('B', 12), trailer('C', 6)])).toEqual({
      valid: false, message: 'Maximum 2 trailers allowed',
    })
  })
})
```

- [ ] **Step 2: Write the failing form-rule tests**

Create `frontend/dispatcher/lib/trips/manifest-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  EMPTY_CREW, NO_OVERRIDES, NO_PICKS, NO_TIMES,
  buildEmptyLegPayload, buildFromManifestPayload, isoToLocalInput, localInputToIso,
  manifestGaps, manifestTimes, parseManifestNumber, shownTimes, validateCrew,
  validateEmptyLegRoute, validateManifestRoute, validateSchedule,
} from './manifest-form'
import { DESTINATION_ID, ORIGIN_ID, makePreview } from './__fixtures__/preview'

const CREW = { driverId: 'driver-1', horseId: 'horse-1', trailerIds: ['trailer-1'] }
const UNLINKED_DESTINATION = { hub_code: 'DUR', precinct_id: null, precinct_name: null }

describe('parseManifestNumber', () => {
  it('accepts a positive whole number, trimmed', () => {
    expect(parseManifestNumber(' 81 ')).toBe(81)
  })

  it('refuses anything else', () => {
    for (const input of ['', '0', '-3', '8.1', 'JNB 69', '1234567890']) {
      expect(parseManifestNumber(input)).toBeNull()
    }
  })
})

describe('local datetime inputs', () => {
  it('renders an instant as a datetime-local value', () => {
    expect(isoToLocalInput('2026-10-02T16:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('round-trips an on-the-minute instant in any browser zone', () => {
    expect(localInputToIso(isoToLocalInput('2026-10-02T16:00:00Z'))).toBe('2026-10-02T16:00:00.000Z')
  })
})

describe('manifestTimes and shownTimes', () => {
  it("uses the manifest's times, and '' where it has none", () => {
    expect(manifestTimes(makePreview()).departure).toBe(isoToLocalInput('2026-10-02T16:00:00Z'))
    expect(manifestTimes(makePreview({ planned_departure_at: null, expected_arrival_at: null }))).toEqual(NO_TIMES)
  })

  it("shows the dispatcher's override over the source, including an emptied field", () => {
    const source = { departure: '2026-10-02T18:00', arrival: '2026-10-03T06:00' }

    expect(shownTimes(NO_OVERRIDES, source)).toEqual(source)
    expect(shownTimes({ departure: '2026-10-02T19:00', arrival: '' }, source)).toEqual({ departure: '2026-10-02T19:00', arrival: '' })
  })
})

describe('manifestGaps', () => {
  it('asks only for hubs PP could not link', () => {
    expect(manifestGaps(makePreview())).toEqual({ origin: false, destination: false })
    expect(manifestGaps(makePreview({ destination: UNLINKED_DESTINATION }))).toEqual({ origin: false, destination: true })
  })
})

describe('validation', () => {
  it('needs a driver, a horse and a legal trailer set', () => {
    expect(validateCrew(EMPTY_CREW, false)).toEqual({
      driver: 'Select a driver.', horse: 'Select a horse.', trailers: 'Fix the trailer combination.',
    })
    expect(validateCrew(CREW, true)).toEqual({})
  })

  it('always needs a planned departure', () => {
    expect(validateSchedule(NO_TIMES, NO_TIMES)).toEqual({ departure: 'Enter a planned departure.' })
  })

  it('refuses to drop an arrival the manifest supplies', () => {
    const source = { departure: '2026-10-02T18:00', arrival: '2026-10-03T06:00' }

    expect(validateSchedule({ departure: source.departure, arrival: '' }, source).arrival)
      .toMatch(/cannot be removed/)
  })

  it('needs the arrival after the departure', () => {
    expect(validateSchedule({ departure: '2026-10-02T18:00', arrival: '2026-10-02T17:00' }, NO_TIMES))
      .toEqual({ arrival: 'Must be after departure.' })
  })

  it('needs a precinct for each unlinked hub, and two different precincts', () => {
    const preview = makePreview({ destination: UNLINKED_DESTINATION })

    expect(validateManifestRoute(preview, NO_PICKS)).toEqual({ destination: 'Choose the precinct for hub DUR.' })
    expect(validateManifestRoute(preview, { originId: '', destinationId: ORIGIN_ID })).toEqual({
      destination: 'Origin and destination must be different precincts.',
    })
    expect(validateManifestRoute(preview, { originId: '', destinationId: DESTINATION_ID })).toEqual({})
  })

  it('needs both ends of an empty leg, and different ones', () => {
    expect(validateEmptyLegRoute(NO_PICKS)).toEqual({
      origin: 'Select an origin precinct.', destination: 'Select a destination precinct.',
    })
    expect(validateEmptyLegRoute({ originId: 'p1', destinationId: 'p1' })).toEqual({ destination: 'Must differ from origin.' })
  })
})

describe('buildFromManifestPayload', () => {
  it("sends null for untouched times so the server keeps the manifest's own", () => {
    const payload = buildFromManifestPayload(makePreview(), CREW, NO_OVERRIDES, NO_PICKS)

    expect(payload).toEqual({
      manifest_number: 81,
      expected_snapshot_sha256: 'a'.repeat(64),
      driver_id: 'driver-1',
      horse_id: 'horse-1',
      trailer_ids: ['trailer-1'],
      planned_departure_at: null,
      planned_arrival_at: null,
      origin_precinct_id: null,
      destination_precinct_id: null,
    })
  })

  it('treats an override equal to the manifest value as untouched', () => {
    const preview = makePreview()
    const same = { departure: manifestTimes(preview).departure, arrival: null }

    expect(buildFromManifestPayload(preview, CREW, same, NO_PICKS).planned_departure_at).toBeNull()
  })

  it('sends an edited time as a UTC instant, and a pick only for an unlinked hub', () => {
    const preview = makePreview({ destination: UNLINKED_DESTINATION })
    const payload = buildFromManifestPayload(
      preview, CREW,
      { departure: '2026-10-02T19:30', arrival: null },
      { originId: 'ignored-origin', destinationId: DESTINATION_ID },
    )

    expect(payload.planned_departure_at).toBe(new Date('2026-10-02T19:30').toISOString())
    expect(payload.origin_precinct_id).toBeNull()
    expect(payload.destination_precinct_id).toBe(DESTINATION_ID)
  })
})

describe('buildEmptyLegPayload', () => {
  it('posts an empty leg with no cargo and no order number', () => {
    const payload = buildEmptyLegPayload(
      CREW,
      { departure: '2026-10-02T19:30', arrival: null },
      { originId: 'p1', destinationId: 'p2' },
    )

    expect(payload).toEqual({
      trip_type: 'empty_leg',
      driver_id: 'driver-1',
      horse_id: 'horse-1',
      trailer_ids: ['trailer-1'],
      origin_precinct_id: 'p1',
      destination_precinct_id: 'p2',
      consignments: [],
      planned_departure_at: new Date('2026-10-02T19:30').toISOString(),
      planned_arrival_at: null,
    })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run lib/trips/manifest-form.test.ts lib/trips/trailer-combo.test.ts`
Expected: FAIL. `./manifest-form` and `./trailer-combo` cannot be resolved.

- [ ] **Step 4: Drop `order_number` from the create payload**

In `frontend/shared/lib/types/trip.ts`, delete the line `  order_number: string` from `interface TripCreatePayload` only. Leave the read types alone: they change in Task 7.

In `frontend/dispatcher/app/(app)/trips/new/page.tsx` (the old wizard), delete the line `        order_number: orderNumber,` from the `api.post` body in `handleSubmit`. Piece A's backend already ignores the field, and Task 6 replaces this page, so this deletion only keeps the old page compiling until then.

- [ ] **Step 5: Create the trailer rule**

Create `frontend/dispatcher/lib/trips/trailer-combo.ts`. The logic is moved verbatim from the old page so `CrewFields` (Task 5) and the page share one copy:

```ts
import type { Vehicle } from '@shared/lib/types/vehicle'

// South African combination rules: no trailer (a single unit), one trailer of any length,
// or exactly a 6 m + 12 m pair (18 m combined). Anything else is refused before submit.
const SHORT_TRAILER_M = 6
const LONG_TRAILER_M = 12
export const MAX_TRAILERS = 2

export interface TrailerCombo {
  valid: boolean
  message: string
}

export function trailerCombo(selected: readonly Vehicle[]): TrailerCombo {
  if (selected.length === 0) return { valid: true, message: 'Single unit — no trailer' }
  if (selected.length === 1) {
    const only = selected[0]
    const length = only.length_m != null ? `${only.length_m} m` : 'unknown length'
    return { valid: true, message: `${only.registration} — ${length}` }
  }
  if (selected.length === MAX_TRAILERS) {
    const lengths = selected.map(t => t.length_m ?? 0).sort((a, b) => a - b)
    if (lengths[0] === SHORT_TRAILER_M && lengths[1] === LONG_TRAILER_M) {
      return { valid: true, message: '6 m + 12 m combination — valid' }
    }
    return { valid: false, message: `${lengths[0]} m + ${lengths[1]} m — exceeds 18 m limit` }
  }
  return { valid: false, message: 'Maximum 2 trailers allowed' }
}
```

- [ ] **Step 6: Create the form rules**

Create `frontend/dispatcher/lib/trips/manifest-form.ts`:

```ts
// Rules for the create-trip screen (FP-281 §5, §11): what the dispatcher must still enter,
// whether it is valid, and the exact request each mode sends. Pure: no React, no I/O.

import type { PPManifestPreview, TripFromPPManifestPayload } from '@shared/lib/types/pp-manifest'
import type { TripCreatePayload } from '@shared/lib/types/trip'

/** Driver, horse and trailers: LFG's decision, never read from the manifest (spec §5). */
export interface CrewValues {
  driverId: string
  horseId: string
  trailerIds: string[]
}

/** A time the dispatcher typed over, as a datetime-local value. null follows the source:
 *  the manifest's own time, or nothing for an empty leg. */
export interface ScheduleOverrides {
  departure: string | null
  arrival: string | null
}

/** Precincts the dispatcher chose: both ends of an empty leg, or a hub PP could not link. */
export interface RoutePicks {
  originId: string
  destinationId: string
}

/** Times as datetime-local values, '' where there is none. */
export interface TimeInputs {
  departure: string
  arrival: string
}

export type FormField = 'driver' | 'horse' | 'trailers' | 'origin' | 'destination' | 'departure' | 'arrival'
export type FieldErrors = Partial<Record<FormField, string>>

export interface ManifestGaps {
  origin: boolean
  destination: boolean
}

export const EMPTY_CREW: CrewValues = { driverId: '', horseId: '', trailerIds: [] }
export const NO_OVERRIDES: ScheduleOverrides = { departure: null, arrival: null }
export const NO_PICKS: RoutePicks = { originId: '', destinationId: '' }
export const NO_TIMES: TimeInputs = { departure: '', arrival: '' }

// A positive whole number of at most nine digits, which keeps every value inside a
// Postgres integer (trips.pp_manifest_number).
const MANIFEST_NUMBER = /^[1-9]\d{0,8}$/

/** The typed manifest number, or null when the input is not one. */
export function parseManifestNumber(input: string): number | null {
  const trimmed = input.trim()
  return MANIFEST_NUMBER.test(trimmed) ? Number(trimmed) : null
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** An instant as a datetime-local value in the browser's zone (the dispatcher's local time). */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** A datetime-local value as a UTC instant. The create endpoints refuse zone-less times,
 *  and the journey lock hashes UTC (spec §9). */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString()
}

/** The manifest's own times as input values: what an untouched field shows. */
export function manifestTimes(preview: PPManifestPreview): TimeInputs {
  return {
    departure: preview.planned_departure_at ? isoToLocalInput(preview.planned_departure_at) : '',
    arrival: preview.expected_arrival_at ? isoToLocalInput(preview.expected_arrival_at) : '',
  }
}

/** What each time field shows: the dispatcher's own value, else the source's. */
export function shownTimes(overrides: ScheduleOverrides, source: TimeInputs): TimeInputs {
  return {
    departure: overrides.departure ?? source.departure,
    arrival: overrides.arrival ?? source.arrival,
  }
}

/** Hubs PP could not link to a precinct: the only route values the dispatcher supplies (spec §5). */
export function manifestGaps(preview: PPManifestPreview): ManifestGaps {
  return {
    origin: preview.origin.precinct_id === null,
    destination: preview.destination.precinct_id === null,
  }
}

export function validateCrew(crew: CrewValues, trailersValid: boolean): FieldErrors {
  const errors: FieldErrors = {}
  if (!crew.driverId) errors.driver = 'Select a driver.'
  if (!crew.horseId) errors.horse = 'Select a horse.'
  if (!trailersValid) errors.trailers = 'Fix the trailer combination.'
  return errors
}

/** shown: what the fields display. source: what the manifest supplies ('' for none). */
export function validateSchedule(shown: TimeInputs, source: TimeInputs): FieldErrors {
  const errors: FieldErrors = {}
  // A trip with no planned departure can never be activated (spec §10.2 step 3).
  if (!shown.departure) errors.departure = 'Enter a planned departure.'
  if (!shown.arrival && source.arrival) {
    // A null override means "keep the manifest's", so an emptied field would still lock
    // the manifest's arrival. Refuse rather than show one thing and lock another.
    errors.arrival = 'The manifest sets an expected arrival. Change it, or use the manifest time — it cannot be removed.'
  } else if (shown.departure && shown.arrival && new Date(shown.arrival) <= new Date(shown.departure)) {
    errors.arrival = 'Must be after departure.'
  }
  return errors
}

export function validateManifestRoute(preview: PPManifestPreview, picks: RoutePicks): FieldErrors {
  const gaps = manifestGaps(preview)
  const errors: FieldErrors = {}
  if (gaps.origin && !picks.originId) errors.origin = `Choose the precinct for hub ${preview.origin.hub_code}.`
  if (gaps.destination && !picks.destinationId) {
    errors.destination = `Choose the precinct for hub ${preview.destination.hub_code}.`
  }
  const origin = gaps.origin ? picks.originId : preview.origin.precinct_id
  const destination = gaps.destination ? picks.destinationId : preview.destination.precinct_id
  if (origin && origin === destination) {
    // Blame the end the dispatcher chose: the manifest's own end is not theirs to change.
    errors[gaps.destination ? 'destination' : 'origin'] = 'Origin and destination must be different precincts.'
  }
  return errors
}

export function validateEmptyLegRoute(picks: RoutePicks): FieldErrors {
  const errors: FieldErrors = {}
  if (!picks.originId) errors.origin = 'Select an origin precinct.'
  if (!picks.destinationId) errors.destination = 'Select a destination precinct.'
  else if (picks.originId === picks.destinationId) errors.destination = 'Must differ from origin.'
  return errors
}

/** A time to send. null keeps the source's own value, which the server then uses exactly
 *  (spec §10.2: the request overrides the manifest). Echoing an untouched manifest time
 *  would record it as the dispatcher's override, after a round trip through a
 *  minute-precision local input. */
function overrideToIso(override: string | null, source: string): string | null {
  if (override === null || override === '' || override === source) return null
  return localInputToIso(override)
}

export function buildFromManifestPayload(
  preview: PPManifestPreview,
  crew: CrewValues,
  overrides: ScheduleOverrides,
  picks: RoutePicks,
): TripFromPPManifestPayload {
  const source = manifestTimes(preview)
  const gaps = manifestGaps(preview)
  return {
    manifest_number: preview.pp_manifest.number,
    expected_snapshot_sha256: preview.snapshot_sha256,
    driver_id: crew.driverId,
    horse_id: crew.horseId,
    trailer_ids: crew.trailerIds,
    planned_departure_at: overrideToIso(overrides.departure, source.departure),
    planned_arrival_at: overrideToIso(overrides.arrival, source.arrival),
    // A pick for a linked hub is ignored by the server, so it is not sent at all.
    origin_precinct_id: gaps.origin ? picks.originId : null,
    destination_precinct_id: gaps.destination ? picks.destinationId : null,
  }
}

export function buildEmptyLegPayload(
  crew: CrewValues,
  overrides: ScheduleOverrides,
  picks: RoutePicks,
): TripCreatePayload {
  return {
    trip_type: 'empty_leg',
    driver_id: crew.driverId,
    horse_id: crew.horseId,
    trailer_ids: crew.trailerIds,
    origin_precinct_id: picks.originId,
    destination_precinct_id: picks.destinationId,
    consignments: [],
    planned_departure_at: overrides.departure ? localInputToIso(overrides.departure) : null,
    planned_arrival_at: overrides.arrival ? localInputToIso(overrides.arrival) : null,
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run lib/trips/manifest-form.test.ts lib/trips/trailer-combo.test.ts`
Expected: all pass.

Run: `cd frontend/dispatcher && npm run type-check && npm run lint`
Expected: no errors. If `type-check` reports `order_number` on `TripCreatePayload`, Step 4's page line was missed.

- [ ] **Step 8: Stage**

```bash
git add frontend/dispatcher/lib/trips/manifest-form.ts frontend/dispatcher/lib/trips/manifest-form.test.ts frontend/dispatcher/lib/trips/trailer-combo.ts frontend/dispatcher/lib/trips/trailer-combo.test.ts frontend/shared/lib/types/trip.ts "frontend/dispatcher/app/(app)/trips/new/page.tsx"
```
Suggested commit: `feat(dispatcher): pure rules for manifest trip creation (FP-281)`

---

### Task 3: `useManifestPreview` — lookup state that ignores stale answers

**Files:**
- Create: `frontend/dispatcher/lib/hooks/useManifestPreview.ts`
- Test: `frontend/dispatcher/lib/hooks/useManifestPreview.test.tsx`

**Interfaces:**
- Consumes: Task 1 `previewPPManifest`, `classifyLookupError`, `LookupFailure`, `PPManifestPreview`.
- Produces: `ManifestPreviewState = {status:'idle'} | {status:'loading', manifestNumber} | {status:'loaded', manifestNumber, preview} | {status:'failed', manifestNumber, failure: LookupFailure}`; `useManifestPreview(): { state, lookUp(manifestNumber: number): Promise<void>, replace(preview: PPManifestPreview): void, reset(): void }`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/dispatcher/lib/hooks/useManifestPreview.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  previewPPManifest: vi.fn(),
}))

import { ApiError, previewPPManifest } from '@/lib/api/client'
import { makePreview } from '@/lib/trips/__fixtures__/preview'
import type { PPManifestPreview } from '@shared/lib/types/pp-manifest'
import { useManifestPreview } from './useManifestPreview'

const mockedPreview = vi.mocked(previewPPManifest)
const PREVIEW_82 = makePreview({
  pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'CPT', number: 82, display: 'The Courier Guy · CPT 82' },
})

beforeEach(() => {
  mockedPreview.mockReset()
})

describe('useManifestPreview', () => {
  it('loads the preview for a number', async () => {
    const preview = makePreview()
    mockedPreview.mockResolvedValue(preview)
    const { result } = renderHook(() => useManifestPreview())

    await act(async () => { await result.current.lookUp(81) })

    expect(mockedPreview).toHaveBeenCalledWith(81)
    expect(result.current.state).toEqual({ status: 'loaded', manifestNumber: 81, preview })
  })

  it('classifies a failed lookup', async () => {
    mockedPreview.mockRejectedValue(new ApiError(404, 'PP manifest 999 not found'))
    const { result } = renderHook(() => useManifestPreview())

    await act(async () => { await result.current.lookUp(999) })

    expect(result.current.state).toMatchObject({ status: 'failed', manifestNumber: 999, failure: { kind: 'not_found' } })
  })

  it('ignores an answer that arrives after a newer lookup', async () => {
    let answerSlow: (preview: PPManifestPreview) => void = () => {}
    mockedPreview
      .mockImplementationOnce(() => new Promise<PPManifestPreview>(resolve => { answerSlow = resolve }))
      .mockResolvedValueOnce(PREVIEW_82)
    const { result } = renderHook(() => useManifestPreview())

    let slow: Promise<void> = Promise.resolve()
    act(() => { slow = result.current.lookUp(81) })
    await act(async () => { await result.current.lookUp(82) })
    await act(async () => { answerSlow(makePreview()); await slow })

    expect(result.current.state).toEqual({ status: 'loaded', manifestNumber: 82, preview: PREVIEW_82 })
  })

  it('replace shows a fresh preview and outranks a lookup still in flight', async () => {
    let answerSlow: (preview: PPManifestPreview) => void = () => {}
    mockedPreview.mockImplementationOnce(() => new Promise<PPManifestPreview>(resolve => { answerSlow = resolve }))
    const fresh = makePreview({ snapshot_sha256: 'b'.repeat(64) })
    const { result } = renderHook(() => useManifestPreview())

    let slow: Promise<void> = Promise.resolve()
    act(() => { slow = result.current.lookUp(81) })
    act(() => { result.current.replace(fresh) })
    await act(async () => { answerSlow(makePreview()); await slow })

    expect(result.current.state).toEqual({ status: 'loaded', manifestNumber: 81, preview: fresh })
  })

  it('reset returns to idle', async () => {
    mockedPreview.mockResolvedValue(makePreview())
    const { result } = renderHook(() => useManifestPreview())
    await act(async () => { await result.current.lookUp(81) })

    act(() => { result.current.reset() })

    expect(result.current.state).toEqual({ status: 'idle' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run lib/hooks/useManifestPreview.test.tsx`
Expected: FAIL. `./useManifestPreview` cannot be resolved.

- [ ] **Step 3: Implement the hook**

Create `frontend/dispatcher/lib/hooks/useManifestPreview.ts`:

```ts
'use client'

import { useCallback, useRef, useState } from 'react'
import { previewPPManifest } from '@/lib/api/client'
import { classifyLookupError, type LookupFailure } from '@/lib/trips/trip-api-errors'
import type { PPManifestPreview } from '@shared/lib/types/pp-manifest'

export type ManifestPreviewState =
  | { status: 'idle' }
  | { status: 'loading'; manifestNumber: number }
  | { status: 'loaded'; manifestNumber: number; preview: PPManifestPreview }
  | { status: 'failed'; manifestNumber: number; failure: LookupFailure }

export interface UseManifestPreviewResult {
  state: ManifestPreviewState
  lookUp: (manifestNumber: number) => Promise<void>
  /** Show a preview the server returned elsewhere (a 409 MANIFEST_CHANGED body). */
  replace: (preview: PPManifestPreview) => void
  reset: () => void
}

/** The manifest lookup on the create-trip screen (spec §10.1). Read-only. */
export function useManifestPreview(): UseManifestPreviewResult {
  const [state, setState] = useState<ManifestPreviewState>({ status: 'idle' })
  // Each change takes a ticket, and only the newest may write. A slow answer for 81 must
  // not replace the summary for 82 that the dispatcher asked for after it.
  const ticket = useRef(0)

  const lookUp = useCallback(async (manifestNumber: number): Promise<void> => {
    const mine = ++ticket.current
    setState({ status: 'loading', manifestNumber })
    try {
      const preview = await previewPPManifest(manifestNumber)
      if (mine === ticket.current) setState({ status: 'loaded', manifestNumber, preview })
    } catch (err) {
      // Classified and shown by ManifestLookup: a failed lookup is a screen state, not an
      // exception to rethrow.
      if (mine === ticket.current) {
        setState({ status: 'failed', manifestNumber, failure: classifyLookupError(err, manifestNumber) })
      }
    }
  }, [])

  const replace = useCallback((preview: PPManifestPreview): void => {
    ticket.current += 1
    setState({ status: 'loaded', manifestNumber: preview.pp_manifest.number, preview })
  }, [])

  const reset = useCallback((): void => {
    ticket.current += 1
    setState({ status: 'idle' })
  }, [])

  return { state, lookUp, replace, reset }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run lib/hooks/useManifestPreview.test.tsx`
Expected: 5 passed.

- [ ] **Step 5: Stage**

```bash
git add frontend/dispatcher/lib/hooks/useManifestPreview.ts frontend/dispatcher/lib/hooks/useManifestPreview.test.tsx
```
Suggested commit: `feat(dispatcher): manifest preview hook that ignores stale answers (FP-281)`

---

### Task 4: The manifest card — lookup, summary, warnings

**Files:**
- Create: `frontend/dispatcher/components/trips/new/form-parts.tsx`
- Create: `frontend/dispatcher/components/trips/new/ManifestLookup.tsx`
- Create: `frontend/dispatcher/components/trips/new/ManifestSummary.tsx`
- Create: `frontend/dispatcher/components/trips/new/ManifestWarnings.tsx`
- Test: `frontend/dispatcher/components/trips/new/ManifestLookup.test.tsx`, `ManifestSummary.test.tsx`, `ManifestWarnings.test.tsx`

**Interfaces:**
- Consumes: Task 3 `ManifestPreviewState`; Task 1 `PPManifestPreview`, `PPManifestWarning`.
- Produces (`form-parts`): `fieldClass(invalid: boolean): string`, `FormCard`, `CardTitle({icon: IconName, children})`, `FieldLabel({htmlFor?, required?, children})`, `FieldError({id?, children})`.
- Produces: `ManifestLookup({value, onChange(value), onLookUp(), state, inputError: string | null, onEmptyLeg()})`, `ManifestSummary({preview})`, `ManifestWarnings({warnings, onEmptyLeg()})`.

Design notes (DESIGN_SYSTEM.md, checked against the ui-ux-pro-max forms rules):
- **Blocking warnings** go in one error-container block with `role="alert"` and a heading that says what it means: "This manifest cannot become a trip". **Non-blocking warnings** are prompts, not faults: a neutral `bg-surf-low` row with an icon naming what they ask for (map for a hub, clock for times, file for an open manifest). Colour is kept for the blocking case, and every state has text as well as colour.
- Every lookup failure offers a way out. Live PP gets "Create an empty leg instead", an unreachable PP gets "Try again", and a manifest already on a trip gets a link to that trip.
- The summary does not repeat the times, because the route & schedule card (Task 5) shows them as the values the trip will lock. Waybill lines sit behind a `<details>` so a 40-waybill manifest does not push the form off screen.

- [ ] **Step 1: Write the failing tests**

Create `frontend/dispatcher/components/trips/new/ManifestLookup.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ManifestPreviewState } from '@/lib/hooks/useManifestPreview'
import { ManifestLookup, type ManifestLookupProps } from './ManifestLookup'

function renderLookup(state: ManifestPreviewState, overrides: Partial<ManifestLookupProps> = {}): ManifestLookupProps {
  const props: ManifestLookupProps = {
    value: '81', onChange: vi.fn(), onLookUp: vi.fn(), state, inputError: null, onEmptyLeg: vi.fn(), ...overrides,
  }
  render(<ManifestLookup {...props} />)
  return props
}

describe('ManifestLookup', () => {
  it('looks up on Enter and on the button', () => {
    const props = renderLookup({ status: 'idle' })

    fireEvent.keyDown(screen.getByLabelText(/Manifest number/), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))

    expect(props.onLookUp).toHaveBeenCalledTimes(2)
  })

  it('reports typing to the page', () => {
    const props = renderLookup({ status: 'idle' })

    fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: '82' } })

    expect(props.onChange).toHaveBeenCalledWith('82')
  })

  it('offers an empty leg when live Parcel Perfect has no manifest lookup', () => {
    const message = 'Manifest lookup is not available on the live Parcel Perfect API.'
    const props = renderLookup({ status: 'failed', manifestNumber: 81, failure: { kind: 'unsupported', message } })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    fireEvent.click(screen.getByRole('button', { name: 'Create an empty leg instead' }))
    expect(props.onEmptyLeg).toHaveBeenCalled()
  })

  it('offers a retry when Parcel Perfect is unreachable', () => {
    const props = renderLookup({
      status: 'failed', manifestNumber: 81, failure: { kind: 'retryable', message: 'Parcel Perfect is unreachable — try again shortly.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(props.onLookUp).toHaveBeenCalled()
  })

  it('shows an input error under the field and marks it invalid', () => {
    renderLookup({ status: 'idle' }, { value: 'JNB', inputError: 'Enter the manifest number — digits only, e.g. 81.' })

    expect(screen.getByRole('alert')).toHaveTextContent('digits only')
    expect(screen.getByLabelText(/Manifest number/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('announces a lookup in progress', () => {
    renderLookup({ status: 'loading', manifestNumber: 81 })

    expect(screen.getByRole('status')).toHaveTextContent('Looking up manifest 81')
  })
})
```

Create `frontend/dispatcher/components/trips/new/ManifestSummary.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makePreview } from '@/lib/trips/__fixtures__/preview'
import { ManifestSummary } from './ManifestSummary'

describe('ManifestSummary', () => {
  it('shows what Parcel Perfect says about the manifest', () => {
    render(<ManifestSummary preview={makePreview()} />)

    expect(screen.getByRole('region', { name: 'Manifest The Courier Guy · CPT 81' })).toBeInTheDocument()
    expect(screen.getByText('Closed in PP')).toBeInTheDocument()
    expect(screen.getByText('CPT → JNB')).toBeInTheDocument()
    expect(screen.getByText('PO-CGY-0081')).toBeInTheDocument()
    expect(screen.getByText('2 waybills · 5 parcels · 180.5 kg')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'MFTWB8101' })).toBeInTheDocument()
    expect(screen.getByText('Two pallets shrink-wrapped together')).toBeInTheDocument()
    expect(screen.getByText(/assumed data contract/)).toBeInTheDocument()
  })

  it('says when the manifest is still open and has no client reference', () => {
    render(<ManifestSummary preview={makePreview({ is_closed: false, client_reference: null })} />)

    expect(screen.getByText('Open in PP')).toBeInTheDocument()
    expect(screen.getByText('None on the manifest')).toBeInTheDocument()
  })
})
```

Create `frontend/dispatcher/components/trips/new/ManifestWarnings.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeWarning } from '@/lib/trips/__fixtures__/preview'
import { ManifestWarnings } from './ManifestWarnings'

describe('ManifestWarnings', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<ManifestWarnings warnings={[]} onEmptyLeg={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('links to our own trip that already holds the manifest', () => {
    render(
      <ManifestWarnings
        warnings={[makeWarning('MANIFEST_ALREADY_ON_TRIP', {
          message: 'Manifest CPT 81 is already on trip FP-20261001-AAAA0001.',
          trip_id: 'trip-old', trip_reference: 'FP-20261001-AAAA0001',
        })]}
        onEmptyLeg={vi.fn()}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('This manifest cannot become a trip')
    expect(within(alert).getByRole('link', { name: /Open FP-20261001-AAAA0001/ })).toHaveAttribute('href', '/trips/trip-old')
  })

  it("names held waybills but never another organisation's trip", () => {
    render(
      <ManifestWarnings
        warnings={[makeWarning('WAYBILL_ON_OTHER_TRIP', { message: '1 waybill(s) are already on another trip.', waybills: ['WAY001'] })]}
        onEmptyLeg={vi.fn()}
      />,
    )

    expect(screen.getByText('WAY001')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('offers an empty leg for a manifest with no waybills', () => {
    const onEmptyLeg = vi.fn()
    render(<ManifestWarnings warnings={[makeWarning('NO_WAYBILLS')]} onEmptyLeg={onEmptyLeg} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create an empty leg instead' }))

    expect(onEmptyLeg).toHaveBeenCalled()
  })

  it('lists prompts apart from blocking warnings, without an alert', () => {
    render(
      <ManifestWarnings
        warnings={[makeWarning('NO_PLANNED_TIMES', { message: 'The manifest has no planned departure — enter the planned times.' })]}
        onEmptyLeg={vi.fn()}
      />,
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Manifest notices' })).getByText(/no planned departure/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run components/trips/new`
Expected: FAIL. The component modules cannot be resolved.

- [ ] **Step 3: Create the shared form parts**

Create `frontend/dispatcher/components/trips/new/form-parts.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Ic, type IconName } from '@/components/ui/Ic'
import { cn } from '@shared/lib/utils/cn'

// The underline field: the Material 3 filled look SearchSelect already uses. There is a
// base and one border variant per state, because cn() is a plain join (no tailwind-merge),
// so stacked border colours would leave the winner to stylesheet order.
const FIELD_BASE =
  'w-full bg-surf-low border-0 border-b-2 rounded-t-sm px-3 py-[10px] text-[14px] text-on-surf ' +
  'outline-none focus:bg-sec-c transition-all duration-150'

export function fieldClass(invalid: boolean): string {
  return cn(FIELD_BASE, invalid ? 'border-err focus:border-err' : 'border-outline-v focus:border-sec')
}

export function FormCard({ children }: { children: ReactNode }): React.JSX.Element {
  return <section className="rounded-lg bg-surf-lowest p-6 shadow-level-3">{children}</section>
}

export function CardTitle({ icon, children }: { icon: IconName; children: ReactNode }): React.JSX.Element {
  return (
    <h2 className="mb-[18px] flex items-center gap-2 text-[15px] font-[800] text-on-surf">
      <Ic n={icon} s={16} className="text-sec" />
      {children}
    </h2>
  )
}

/** With htmlFor, a real <label> for a native input. Without it, a caption for a control
 *  that names itself, such as SearchSelect's trigger button. */
export function FieldLabel(
  { htmlFor, required = false, children }: { htmlFor?: string; required?: boolean; children: ReactNode },
): React.JSX.Element {
  const className = 'mb-1 block text-[12px] font-[600] text-on-surf-v'
  // The asterisk is visual. aria-hidden keeps it out of the accessible name.
  const mark = required ? <span aria-hidden="true"> *</span> : null
  return htmlFor
    ? <label htmlFor={htmlFor} className={className}>{children}{mark}</label>
    : <span className={className}>{children}{mark}</span>
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }): React.JSX.Element {
  return <p id={id} role="alert" className="mt-1 text-[11px] font-[500] text-err">{children}</p>
}
```

- [ ] **Step 4: Create `ManifestLookup`**

Create `frontend/dispatcher/components/trips/new/ManifestLookup.tsx`:

```tsx
'use client'

import { useId } from 'react'
import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { Skeleton } from '@/components/ui/Skeleton'
import type { ManifestPreviewState } from '@/lib/hooks/useManifestPreview'
import { FieldError, FieldLabel, fieldClass } from './form-parts'

export interface ManifestLookupProps {
  value: string
  onChange: (value: string) => void
  onLookUp: () => void
  state: ManifestPreviewState
  inputError: string | null
  onEmptyLeg: () => void
}

/** Step 1 of spec §11: the dispatcher types the number, FreightProof pulls the rest. */
export function ManifestLookup(
  { value, onChange, onLookUp, state, inputError, onEmptyLeg }: ManifestLookupProps,
): React.JSX.Element {
  const inputId = useId()
  const helpId = useId()
  const errorId = useId()
  const failure = state.status === 'failed' ? state.failure : null

  return (
    <div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor={inputId} required>Manifest number</FieldLabel>
          <input
            id={inputId}
            value={value}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 81"
            aria-invalid={inputError !== null}
            aria-describedby={inputError ? errorId : helpId}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onLookUp()
              }
            }}
            className={fieldClass(inputError !== null)}
          />
        </div>
        <Button
          variant="secondary"
          iconLeft={<Ic n="search" s={14} />}
          onClick={onLookUp}
          loading={state.status === 'loading'}
          disabled={!value.trim()}
        >
          Look up
        </Button>
      </div>

      {inputError
        ? <FieldError id={errorId}>{inputError}</FieldError>
        : (
          <p id={helpId} className="mt-1 text-[11px] leading-relaxed text-on-surf-v">
            The number on the client&apos;s Parcel Perfect manifest. FreightProof pulls the client, route,
            planned times and every waybill from it.
          </p>
        )}

      {state.status === 'loading' && (
        <div role="status" className="mt-5 flex flex-col gap-2">
          <span className="sr-only">Looking up manifest {state.manifestNumber}…</span>
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {failure && (
        <div role="alert" className="mt-4 rounded-lg bg-err-c px-4 py-3 text-[13px] font-[600] text-err-onc">
          <p className="flex items-start gap-2">
            <Ic n="warn" s={14} className="mt-[2px] text-err" />
            {failure.message}
          </p>
          {failure.kind === 'unsupported' && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onEmptyLeg}>
              Create an empty leg instead
            </Button>
          )}
          {failure.kind === 'retryable' && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onLookUp}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create `ManifestSummary`**

Create `frontend/dispatcher/components/trips/new/ManifestSummary.tsx`:

```tsx
'use client'

import { Chip } from '@/components/ui/Chip'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { PPManifestPreview } from '@shared/lib/types/pp-manifest'

export interface ManifestSummaryProps {
  preview: PPManifestPreview
}

/** What Parcel Perfect says about the manifest (spec §11 step 1). Times are not repeated:
 *  the route & schedule card shows them as the values the trip will lock. */
export function ManifestSummary({ preview }: ManifestSummaryProps): React.JSX.Element {
  const { pp_manifest: ref, totals } = preview

  return (
    <section aria-label={`Manifest ${ref.display}`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">Parcel Perfect manifest</p>
          <p className="mt-1 break-words text-[16px] font-[800] tabular-nums tracking-[0.03em] text-on-surf">
            {ref.display}
          </p>
        </div>
        <Chip type={preview.is_closed ? 'complete' : 'pending'} label={preview.is_closed ? 'Closed in PP' : 'Open in PP'} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fact label="Client" value={preview.client_name} />
        <Fact label="Route" value={`${preview.origin.hub_code} → ${preview.destination.hub_code}`} numeric />
        <Fact
          label="Client reference"
          value={preview.client_reference ?? 'None on the manifest'}
          numeric={preview.client_reference !== null}
        />
        <Fact label="Cargo" value={`${totals.waybills} waybills · ${totals.parcels} parcels · ${totals.weight_kg} kg`} numeric />
      </dl>

      {preview.waybills.length > 0 && (
        <details className="rounded-lg border border-outline-v/20 bg-surf-low">
          <summary className="cursor-pointer px-4 py-3 text-[12px] font-[700] text-on-surf">
            Waybills ({preview.waybills.length})
          </summary>
          <div className="overflow-x-auto px-4 pb-3">
            <table className="w-full text-left text-[12px] text-on-surf">
              <caption className="sr-only">Waybills on manifest {ref.display}</caption>
              <thead>
                <tr className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">
                  <th scope="col" className="py-2 pr-3">Waybill</th>
                  <th scope="col" className="py-2 pr-3">Destination</th>
                  <th scope="col" className="py-2 pr-3 text-right">Parcels</th>
                  <th scope="col" className="py-2 text-right">Weight</th>
                </tr>
              </thead>
              <tbody>
                {preview.waybills.map(line => (
                  <tr key={line.waybill} className="border-t border-outline-v/10">
                    <td className="py-2 pr-3 font-[600] tabular-nums tracking-[0.03em]">{line.waybill}</td>
                    <td className="py-2 pr-3">{line.destination_town}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{line.parcel_count}</td>
                    <td className="py-2 text-right tabular-nums">
                      {line.weight_kg !== null ? `${line.weight_kg} kg` : 'Not stated'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {preview.notes.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">Notes in Parcel Perfect</p>
          <ul className="flex flex-col gap-2">
            {preview.notes.map((note, index) => (
              <li key={`${note.noted_at}-${index}`} className="text-[12px] leading-relaxed text-on-surf">
                <span className="tabular-nums text-on-surf-v">{fmtDateTime(note.noted_at)} · {note.operator}</span>
                <span className="block">{note.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Spec §8: the mock is an assumed contract, and the UI must say so. */}
      <p className="text-[11px] leading-relaxed text-on-surf-v">
        From the mocked Parcel Perfect manifest lookup, an assumed data contract: the live PP API has no
        manifest call. The trip locks this manifest as it stands at creation.
      </p>
    </section>
  )
}

function Fact({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">{label}</dt>
      <dd className={`mt-1 break-words text-[13px] font-[600] text-on-surf ${numeric ? 'tabular-nums tracking-[0.03em]' : ''}`}>
        {value}
      </dd>
    </div>
  )
}
```

- [ ] **Step 6: Create `ManifestWarnings`**

Create `frontend/dispatcher/components/trips/new/ManifestWarnings.tsx`:

```tsx
'use client'

import { Button } from '@/components/ui/Button'
import { Ic, type IconName } from '@/components/ui/Ic'
import { RecordLink } from '@/components/ui/RecordLink'
import { ROUTES } from '@/lib/constants/routes'
import type { PPManifestWarning, PPManifestWarningCode } from '@shared/lib/types/pp-manifest'

// Non-blocking warnings ask the dispatcher for something or inform them. Each gets a
// neutral row and an icon naming what it is about. Colour stays reserved for the blocking
// case (DESIGN_SYSTEM.md §1.2: colour is information).
const PROMPT_ICON: Partial<Record<PPManifestWarningCode, IconName>> = {
  ORIGIN_HUB_UNLINKED: 'map',
  DESTINATION_HUB_UNLINKED: 'map',
  NO_PLANNED_TIMES: 'clock',
  MANIFEST_NOT_CLOSED: 'file',
}

export interface ManifestWarningsProps {
  warnings: readonly PPManifestWarning[]
  /** Offered for a manifest with no waybills: the trip is an empty leg, not a manifest trip. */
  onEmptyLeg: () => void
}

export function ManifestWarnings({ warnings, onEmptyLeg }: ManifestWarningsProps): React.JSX.Element | null {
  if (warnings.length === 0) return null
  const blocking = warnings.filter(warning => warning.blocking)
  const prompts = warnings.filter(warning => !warning.blocking)

  return (
    <div className="flex flex-col gap-2">
      {blocking.length > 0 && (
        <div role="alert" className="rounded-lg bg-err-c px-4 py-3 text-err-onc">
          <p className="flex items-center gap-2 text-[13px] font-[700]">
            <Ic n="warn" s={14} className="text-err" />
            This manifest cannot become a trip
          </p>
          <ul className="mt-2 flex flex-col gap-3 pl-6 text-[12px] leading-relaxed">
            {blocking.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                <p>{warning.message}</p>
                {warning.waybills.length > 0 && (
                  <p className="mt-0.5 font-[600] tabular-nums tracking-[0.03em]">{warning.waybills.join(', ')}</p>
                )}
                {/* Only our own organisation's trips come with an id (piece A keeps foreign
                    holders private), so a missing id means "nothing to open". */}
                {warning.trip_id && (
                  <RecordLink href={ROUTES.tripDetail(warning.trip_id)}>
                    Open {warning.trip_reference ?? 'that trip'}
                  </RecordLink>
                )}
                {warning.code === 'NO_WAYBILLS' && (
                  <Button variant="secondary" size="sm" className="mt-2" onClick={onEmptyLeg}>
                    Create an empty leg instead
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {prompts.length > 0 && (
        <ul aria-label="Manifest notices" className="flex flex-col gap-2">
          {prompts.map((warning, index) => (
            <li
              key={`${warning.code}-${index}`}
              className="flex items-start gap-2 rounded-lg bg-surf-low px-4 py-3 text-[12px] leading-relaxed text-on-surf"
            >
              <Ic n={PROMPT_ICON[warning.code] ?? 'warn'} s={14} className="mt-[2px] text-on-surf-v" />
              {warning.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run components/trips/new`
Expected: all pass.

Run: `cd frontend/dispatcher && npm run type-check && npm run lint`
Expected: no errors.

- [ ] **Step 8: Stage**

```bash
git add frontend/dispatcher/components/trips/new/form-parts.tsx frontend/dispatcher/components/trips/new/ManifestLookup.tsx frontend/dispatcher/components/trips/new/ManifestLookup.test.tsx frontend/dispatcher/components/trips/new/ManifestSummary.tsx frontend/dispatcher/components/trips/new/ManifestSummary.test.tsx frontend/dispatcher/components/trips/new/ManifestWarnings.tsx frontend/dispatcher/components/trips/new/ManifestWarnings.test.tsx
```
Suggested commit: `feat(dispatcher): manifest lookup, summary and warnings for trip creation (FP-281)`

---

### Task 5: Form sections — crew, route, schedule, summary panel

**Files:**
- Create: `frontend/dispatcher/components/trips/new/CrewFields.tsx`
- Create: `frontend/dispatcher/components/trips/new/RouteFields.tsx`
- Create: `frontend/dispatcher/components/trips/new/ScheduleFields.tsx`
- Create: `frontend/dispatcher/components/trips/new/CreateTripSummary.tsx`
- Test: `CrewFields.test.tsx`, `RouteFields.test.tsx`, `ScheduleFields.test.tsx`, `CreateTripSummary.test.tsx` (same folder)

**Interfaces:**
- Consumes: Task 2 `CrewValues`, `ScheduleOverrides`, `TimeInputs`, `FieldErrors`, `NO_OVERRIDES`, `NO_TIMES`, `EMPTY_CREW`, `TrailerCombo`, `MAX_TRAILERS`, `trailerCombo`; Task 4 `form-parts`.
- Produces: `CrewFields({crew, onChange(crew), drivers, horses, trailers, combo, errors})`. `RouteEnd = {kind:'fixed', name, hubCode} | {kind:'pick', value, options: readonly Precinct[], hubCode: string | null}`; `RouteFields({origin, destination, onPick(end: 'origin' | 'destination', precinctId), errors})`. `ScheduleFields({overrides, source: TimeInputs, onChange(overrides), errors})`. `SummaryRow {label, value, numeric?}`; `CreateTripSummary({rows, lockNote, canCreate, busy, errorText, onCreate()})`.

Design notes:
- `CrewFields` ports the old wizard's driver, horse and trailer cards: same `SearchSelect`s, same trailer list and combination banner. The trailer list becomes a `<fieldset>` with a legend, and the combination banner becomes `role="status"`, so a screen reader hears the verdict change. This is where Tom's FP-142 clash message goes (see Questions).
- A manifest-decided route end is plain read-only text with "From manifest · hub CPT", visibly different from a picker. A picker appears only for an unlinked hub, offering only the issuing client's precincts. The backend refuses any other precinct (`PRECINCT_NOT_AVAILABLE`), so the screen does not offer them.
- A time the manifest supplies shows a "From manifest" tag. Once edited, the tag becomes a "Use manifest time" button, which resets the override to `null` (D2).
- The dark summary panel keeps the old wizard's look (DESIGN_SYSTEM.md §8.3), but its labels move from 40% to 60% white so they meet 4.5:1.

- [ ] **Step 1: Write the failing tests**

Create `frontend/dispatcher/components/trips/new/CrewFields.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { mockHorses, mockTrailers } from '@shared/lib/mocks/vehicles'
import { EMPTY_CREW } from '@/lib/trips/manifest-form'
import { trailerCombo } from '@/lib/trips/trailer-combo'
import { CrewFields, type CrewFieldsProps } from './CrewFields'

function renderCrew(overrides: Partial<CrewFieldsProps> = {}): CrewFieldsProps {
  const props: CrewFieldsProps = {
    crew: EMPTY_CREW, onChange: vi.fn(), drivers: mockDrivers, horses: mockHorses, trailers: mockTrailers,
    combo: trailerCombo([]), errors: {}, ...overrides,
  }
  render(<CrewFields {...props} />)
  return props
}

describe('CrewFields', () => {
  it('picks a driver', () => {
    const props = renderCrew()

    fireEvent.click(screen.getByRole('button', { name: 'Select driver…' }))
    fireEvent.click(screen.getByRole('button', { name: /Sipho Dlamini/ }))

    expect(props.onChange).toHaveBeenCalledWith({ ...EMPTY_CREW, driverId: mockDrivers[0].id })
  })

  it('picks a horse', () => {
    const props = renderCrew()

    fireEvent.click(screen.getByRole('button', { name: 'Select horse…' }))
    fireEvent.click(screen.getByRole('button', { name: /GP 12-34 ZX/ }))

    expect(props.onChange).toHaveBeenCalledWith({ ...EMPTY_CREW, horseId: mockHorses[0].id })
  })

  it('adds a trailer', () => {
    const props = renderCrew()

    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(mockTrailers[0].registration) }))

    expect(props.onChange).toHaveBeenCalledWith({ ...EMPTY_CREW, trailerIds: [mockTrailers[0].id] })
  })

  it('disables further trailers at the limit', () => {
    renderCrew({ crew: { ...EMPTY_CREW, trailerIds: [mockTrailers[0].id, mockTrailers[1].id] } })

    expect(screen.getByRole('checkbox', { name: new RegExp(mockTrailers[2].registration) })).toBeDisabled()
  })

  it('shows field errors and announces the combination verdict', () => {
    renderCrew({
      errors: { driver: 'Select a driver.', trailers: 'Fix the trailer combination.' },
      combo: { valid: false, message: '12 m + 12 m — exceeds 18 m limit' },
    })

    expect(screen.getByText('Select a driver.')).toBeInTheDocument()
    expect(screen.getByText('Fix the trailer combination.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('exceeds 18 m limit')
  })
})
```

Create `frontend/dispatcher/components/trips/new/RouteFields.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockPrecincts, PRECINCT_CGY_JHB_ID } from '@shared/lib/mocks/precincts'
import { CGY_ORG_ID } from '@shared/lib/mocks/principals'
import { RouteFields, type RouteEnd } from './RouteFields'

const CLIENT_PRECINCTS = mockPrecincts.filter(p => p.principal_organization_id === CGY_ORG_ID)
const FIXED_ORIGIN: RouteEnd = { kind: 'fixed', name: 'Courier Guy CT — Montague Gardens', hubCode: 'CPT' }
const UNLINKED_DESTINATION: RouteEnd = { kind: 'pick', value: '', options: CLIENT_PRECINCTS, hubCode: 'DUR' }

describe('RouteFields', () => {
  it('shows a manifest-decided end as read-only text with its hub', () => {
    render(<RouteFields origin={FIXED_ORIGIN} destination={UNLINKED_DESTINATION} onPick={vi.fn()} errors={{}} />)

    expect(screen.getByText('Courier Guy CT — Montague Gardens')).toBeInTheDocument()
    expect(screen.getByText(/From manifest · hub/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select origin precinct…' })).not.toBeInTheDocument()
  })

  it("lets the dispatcher pick the client's precinct for an unlinked hub", () => {
    const onPick = vi.fn()
    render(<RouteFields origin={FIXED_ORIGIN} destination={UNLINKED_DESTINATION} onPick={onPick} errors={{}} />)

    expect(screen.getByText(/linked to a precinct/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Select destination precinct…' }))
    expect(screen.queryByRole('button', { name: /FedEx/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Courier Guy JHB/ }))

    expect(onPick).toHaveBeenCalledWith('destination', PRECINCT_CGY_JHB_ID)
  })

  it('shows an error under the end it belongs to', () => {
    render(
      <RouteFields
        origin={FIXED_ORIGIN}
        destination={UNLINKED_DESTINATION}
        onPick={vi.fn()}
        errors={{ destination: 'Choose the precinct for hub DUR.' }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Choose the precinct for hub DUR.')
  })
})
```

Create `frontend/dispatcher/components/trips/new/ScheduleFields.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NO_OVERRIDES, NO_TIMES } from '@/lib/trips/manifest-form'
import { ScheduleFields } from './ScheduleFields'

const SOURCE = { departure: '2026-10-02T18:00', arrival: '2026-10-03T06:00' }

describe('ScheduleFields', () => {
  it('shows untouched manifest times, marked as from the manifest', () => {
    render(<ScheduleFields overrides={NO_OVERRIDES} source={SOURCE} onChange={vi.fn()} errors={{}} />)

    expect(screen.getAllByText('From manifest')).toHaveLength(2)
    expect(screen.getByLabelText(/Planned departure/)).toHaveValue('2026-10-02T18:00')
  })

  it('reports an edit, then offers the manifest time back', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ScheduleFields overrides={NO_OVERRIDES} source={SOURCE} onChange={onChange} errors={{}} />)

    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T19:00' } })
    expect(onChange).toHaveBeenCalledWith({ departure: '2026-10-02T19:00', arrival: null })

    rerender(<ScheduleFields overrides={{ departure: '2026-10-02T19:00', arrival: null }} source={SOURCE} onChange={onChange} errors={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use manifest time' }))
    expect(onChange).toHaveBeenLastCalledWith({ departure: null, arrival: null })
  })

  it('marks the departure required only when there is no source time', () => {
    render(
      <ScheduleFields overrides={NO_OVERRIDES} source={NO_TIMES} onChange={vi.fn()} errors={{ departure: 'Enter a planned departure.' }} />,
    )

    const departure = screen.getByLabelText(/Planned departure/) as HTMLInputElement
    expect(departure.labels?.[0]).toHaveTextContent('Planned departure *')
    expect(screen.queryByText('From manifest')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a planned departure.')
  })
})
```

Create `frontend/dispatcher/components/trips/new/CreateTripSummary.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CreateTripSummary } from './CreateTripSummary'

const ROWS = [{ label: 'Driver', value: 'Sipho Dlamini' }, { label: 'Horse', value: 'GP 12-34 ZX', numeric: true }]

describe('CreateTripSummary', () => {
  it('lists what will be created and creates on click', () => {
    const onCreate = vi.fn()
    render(<CreateTripSummary rows={ROWS} lockNote="Locks the trip." canCreate busy={false} errorText={null} onCreate={onCreate} />)

    expect(screen.getByRole('complementary', { name: 'Trip summary' })).toHaveTextContent('Sipho Dlamini')
    fireEvent.click(screen.getByRole('button', { name: 'Create Trip + Lock to Blockchain' }))

    expect(onCreate).toHaveBeenCalled()
  })

  it('disables the CTA when the trip cannot be created, and says why after an attempt', () => {
    render(
      <CreateTripSummary
        rows={ROWS}
        lockNote="Locks the trip."
        canCreate={false}
        busy={false}
        errorText="Complete the highlighted fields before creating the trip."
        onCreate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Create Trip + Lock to Blockchain' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Complete the highlighted fields')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run components/trips/new`
Expected: the four new files FAIL (modules cannot be resolved). Task 4's tests still pass.

- [ ] **Step 3: Create `CrewFields`**

Create `frontend/dispatcher/components/trips/new/CrewFields.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Ic } from '@/components/ui/Ic'
import { SearchSelect } from '@/components/ui/SearchSelect'
import type { CrewValues, FieldErrors } from '@/lib/trips/manifest-form'
import { MAX_TRAILERS, type TrailerCombo } from '@/lib/trips/trailer-combo'
import type { Driver } from '@shared/lib/types/driver'
import type { Vehicle } from '@shared/lib/types/vehicle'
import { cn } from '@shared/lib/utils/cn'
import { CardTitle, FieldError, FieldLabel, FormCard } from './form-parts'

// Past this many trailers, a filter box earns its space.
const TRAILER_SEARCH_THRESHOLD = 5

export interface CrewFieldsProps {
  crew: CrewValues
  onChange: (crew: CrewValues) => void
  drivers: readonly Driver[]
  horses: readonly Vehicle[]
  trailers: readonly Vehicle[]
  combo: TrailerCombo
  errors: FieldErrors
}

/** Driver, horse and trailers: LFG's decision, never taken from the manifest (spec §5). */
export function CrewFields(
  { crew, onChange, drivers, horses, trailers, combo, errors }: CrewFieldsProps,
): React.JSX.Element {
  const [trailerSearch, setTrailerSearch] = useState('')
  const driver = drivers.find(d => d.id === crew.driverId) ?? null
  const horse = horses.find(h => h.id === crew.horseId) ?? null
  const term = trailerSearch.trim().toLowerCase()
  const shownTrailers = term
    ? trailers.filter(t => [t.registration, t.make ?? '', t.model ?? ''].some(field => field.toLowerCase().includes(term)))
    : trailers

  function toggleTrailer(id: string): void {
    const trailerIds = crew.trailerIds.includes(id)
      ? crew.trailerIds.filter(existing => existing !== id)
      : [...crew.trailerIds, id]
    onChange({ ...crew, trailerIds })
  }

  return (
    <>
      <FormCard>
        <CardTitle icon="user">Driver</CardTitle>
        <FieldLabel required>Assigned driver</FieldLabel>
        <SearchSelect
          options={drivers.filter(d => d.is_active).map(d => ({
            value: d.id, label: d.full_name, sublabel: `License ${d.license_number}`,
          }))}
          value={crew.driverId}
          onChange={driverId => onChange({ ...crew, driverId })}
          placeholder="Select driver…"
          searchPlaceholder="Search by name or license…"
          error={Boolean(errors.driver)}
        />
        {errors.driver && <FieldError>{errors.driver}</FieldError>}
        {driver && (
          <div className="mt-[14px] rounded-lg border border-outline-v/20 bg-surf-low p-[12px_14px]">
            <div className="mb-[10px] text-[15px] font-[700] text-on-surf">{driver.full_name}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-[6px]">
              <MiniField label="License number" value={driver.license_number} numeric />
              <MiniField label="ID number" value={driver.id_number} numeric />
              <MiniField label="Phone" value={driver.phone_number} />
            </div>
          </div>
        )}
      </FormCard>

      <FormCard>
        <CardTitle icon="truck">Horse (truck)</CardTitle>
        <FieldLabel required>Horse</FieldLabel>
        <SearchSelect
          options={horses.filter(h => h.is_active).map(h => ({
            value: h.id,
            label: h.registration,
            sublabel: [h.make, h.model, h.year].filter(Boolean).join(' ') || undefined,
          }))}
          value={crew.horseId}
          onChange={horseId => onChange({ ...crew, horseId })}
          placeholder="Select horse…"
          searchPlaceholder="Search by registration or make…"
          error={Boolean(errors.horse)}
        />
        {errors.horse && <FieldError>{errors.horse}</FieldError>}
        {horse && (
          <div className="mt-[14px] rounded-lg border border-outline-v/20 bg-surf-low p-[12px_14px]">
            <div className="mb-[10px] text-[16px] font-[700] tabular-nums tracking-[0.04em] text-on-surf">{horse.registration}</div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-[6px]">
              <MiniField label="Make" value={horse.make} />
              <MiniField label="Model" value={horse.model} />
              <MiniField label="Year" value={horse.year?.toString()} numeric />
              {horse.gross_vehicle_mass_kg != null && (
                <MiniField label="GVM" value={`${horse.gross_vehicle_mass_kg.toLocaleString()} kg`} numeric />
              )}
            </div>
          </div>
        )}
      </FormCard>

      <FormCard>
        <CardTitle icon="truck">Trailers</CardTitle>
        <p className="mb-4 text-[12px] leading-relaxed text-on-surf-v">
          A truck can run as a single unit with no trailer, pull one trailer of any length, or pull a
          6 m + 12 m combination only. Any other two-trailer combination exceeds the 18 m limit.
        </p>
        {trailers.length === 0 ? (
          <p className="text-[13px] text-on-surf-v">No trailers registered in the fleet.</p>
        ) : (
          <>
            {trailers.length > TRAILER_SEARCH_THRESHOLD && (
              <div className="mb-2 flex items-center gap-2 rounded-t-sm border-b border-outline-v bg-surf-low px-3 py-[8px]">
                <Ic n="search" s={13} className="shrink-0 text-on-surf-v" />
                <input
                  aria-label="Search trailers"
                  value={trailerSearch}
                  onChange={event => setTrailerSearch(event.target.value)}
                  placeholder="Search trailers…"
                  className="flex-1 bg-transparent text-[13px] text-on-surf outline-none placeholder:text-on-surf-v"
                />
              </div>
            )}
            {shownTrailers.length === 0 ? (
              <p className="py-2 text-[13px] text-on-surf-v">No trailers match your search.</p>
            ) : (
              <fieldset className="mb-3 flex flex-col overflow-hidden rounded-lg border border-outline-v/20">
                <legend className="sr-only">Trailers</legend>
                {shownTrailers.map(t => {
                  const checked = crew.trailerIds.includes(t.id)
                  const atLimit = !checked && crew.trailerIds.length >= MAX_TRAILERS
                  return (
                    <label
                      key={t.id}
                      className={cn(
                        'flex items-start gap-3 border-b border-outline-v/10 px-4 py-[10px] transition-colors duration-100 last:border-0',
                        checked ? 'cursor-pointer bg-sec-c' : atLimit ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-surf-low',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={atLimit}
                        onChange={() => toggleTrailer(t.id)}
                        className="mt-[3px] h-4 w-4 shrink-0 accent-sec"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-[600] tabular-nums tracking-[0.04em] text-on-surf">{t.registration}</span>
                          {t.length_m != null && (
                            <span className="rounded-full bg-chain-c px-[8px] py-[1px] text-[11px] font-[700] tabular-nums text-chain-onc">
                              {t.length_m} m
                            </span>
                          )}
                        </div>
                        {(t.make || t.model || t.gross_vehicle_mass_kg) && (
                          <div className="mt-[2px] text-[11px] text-on-surf-v">
                            {[t.make, t.model, t.year].filter(Boolean).join(' ')}
                            {t.gross_vehicle_mass_kg != null ? ` · ${t.gross_vehicle_mass_kg.toLocaleString()} kg GVM` : ''}
                          </div>
                        )}
                      </div>
                    </label>
                  )
                })}
              </fieldset>
            )}
            {/* role=status so a screen reader hears the verdict change as trailers are ticked. */}
            <div
              role="status"
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-3 text-[13px] font-[600]',
                combo.valid ? 'bg-ok-c text-ok-onc' : 'bg-err-c text-err-onc',
              )}
            >
              <Ic n={combo.valid ? 'check' : 'warn'} s={14} className={combo.valid ? 'text-ok' : 'text-err'} />
              {combo.message}
            </div>
            {errors.trailers && <FieldError>{errors.trailers}</FieldError>}
          </>
        )}
      </FormCard>
    </>
  )
}

function MiniField(
  { label, value, numeric = false }: { label: string; value: string | null | undefined; numeric?: boolean },
): React.JSX.Element {
  return (
    <div>
      <div className="mb-[1px] text-[10px] text-on-surf-v">{label}</div>
      <div className={cn('text-[12px] font-[500] text-on-surf', numeric && 'tabular-nums tracking-[0.04em]')}>
        {value || 'Not recorded'}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `RouteFields`**

Create `frontend/dispatcher/components/trips/new/RouteFields.tsx`:

```tsx
'use client'

import { SearchSelect } from '@/components/ui/SearchSelect'
import type { FieldErrors } from '@/lib/trips/manifest-form'
import type { Precinct } from '@shared/lib/types/precinct'
import { FieldError, FieldLabel } from './form-parts'

/** One end of the route: decided by the manifest, or chosen by the dispatcher. */
export type RouteEnd =
  | { kind: 'fixed'; name: string; hubCode: string }
  | { kind: 'pick'; value: string; options: readonly Precinct[]; hubCode: string | null }

export interface RouteFieldsProps {
  origin: RouteEnd
  destination: RouteEnd
  onPick: (end: 'origin' | 'destination', precinctId: string) => void
  errors: FieldErrors
}

export function RouteFields({ origin, destination, onPick, errors }: RouteFieldsProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <RouteEndField label="Origin precinct" end={origin} onPick={id => onPick('origin', id)} error={errors.origin} />
      <RouteEndField label="Destination precinct" end={destination} onPick={id => onPick('destination', id)} error={errors.destination} />
    </div>
  )
}

function RouteEndField(
  { label, end, onPick, error }: { label: string; end: RouteEnd; onPick: (precinctId: string) => void; error?: string },
): React.JSX.Element {
  if (end.kind === 'fixed') {
    return (
      <div className="min-w-0 flex-1">
        <FieldLabel>{label}</FieldLabel>
        {/* Read-only and visibly so: the manifest decides this end, not the dispatcher. */}
        <p className="rounded-t-sm border-b-2 border-outline-v/40 bg-surf-low px-3 py-[10px] text-[14px] font-[600] text-on-surf">
          {end.name}
        </p>
        <p className="mt-1 text-[11px] text-on-surf-v">
          From manifest · hub <span className="tabular-nums tracking-[0.03em]">{end.hubCode}</span>
        </p>
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1">
      <FieldLabel required>{label}</FieldLabel>
      <SearchSelect
        options={end.options.map(p => ({ value: p.id, label: p.name, sublabel: p.address ?? undefined }))}
        value={end.value}
        onChange={onPick}
        placeholder={`Select ${label.toLowerCase()}…`}
        searchPlaceholder="Search precincts…"
        error={Boolean(error)}
      />
      {error
        ? <FieldError>{error}</FieldError>
        : end.hubCode && (
          <p className="mt-1 text-[11px] leading-relaxed text-on-surf-v">
            Hub <span className="tabular-nums tracking-[0.03em]">{end.hubCode}</span> isn&apos;t linked to a precinct.
            Choose the client&apos;s depot.
          </p>
        )}
      {end.options.length === 0 && (
        <p className="mt-1 text-[11px] font-[500] text-err">No precincts are available to choose from.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create `ScheduleFields`**

Create `frontend/dispatcher/components/trips/new/ScheduleFields.tsx`:

```tsx
'use client'

import { useId } from 'react'
import type { FieldErrors, ScheduleOverrides, TimeInputs } from '@/lib/trips/manifest-form'
import { FieldError, FieldLabel, fieldClass } from './form-parts'

const LOCALE = 'en-ZA'

export interface ScheduleFieldsProps {
  overrides: ScheduleOverrides
  /** The source's own times as input values; '' where it has none (always '' for an empty leg). */
  source: TimeInputs
  onChange: (overrides: ScheduleOverrides) => void
  errors: FieldErrors
}

/** Planned times, pre-filled from the manifest and editable (spec §11 step 2). They become
 *  required only where the manifest has none. */
export function ScheduleFields({ overrides, source, onChange, errors }: ScheduleFieldsProps): React.JSX.Element {
  return (
    <div className="mt-[14px] flex flex-col gap-3 sm:flex-row">
      <TimeField
        label="Planned departure"
        required={!source.departure}
        override={overrides.departure}
        source={source.departure}
        onChange={departure => onChange({ ...overrides, departure })}
        error={errors.departure}
      />
      <TimeField
        label="Expected arrival"
        required={false}
        override={overrides.arrival}
        source={source.arrival}
        onChange={arrival => onChange({ ...overrides, arrival })}
        error={errors.arrival}
      />
    </div>
  )
}

interface TimeFieldProps {
  label: string
  required: boolean
  override: string | null
  source: string
  onChange: (value: string | null) => void
  error?: string
}

function TimeField({ label, required, override, source, onChange, error }: TimeFieldProps): React.JSX.Element {
  const inputId = useId()
  const errorId = useId()
  const shown = override ?? source
  // "From manifest" while the field shows the manifest's own value. Once edited, a way back
  // that restores null, so the manifest's exact time is what gets locked (D2).
  const fromSource = source !== '' && shown === source
  const edited = source !== '' && !fromSource
  const parts = shown ? splitLocal(shown) : null

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <FieldLabel htmlFor={inputId} required={required}>{label}</FieldLabel>
        {fromSource && (
          <span className="rounded-sm bg-surf-high px-2 py-[1px] text-[10px] font-[700] uppercase tracking-[0.06em] text-on-surf-v">
            From manifest
          </span>
        )}
        {edited && (
          <button type="button" onClick={() => onChange(null)} className="text-[11px] font-[600] text-sec hover:opacity-75">
            Use manifest time
          </button>
        )}
      </div>
      <input
        id={inputId}
        type="datetime-local"
        value={shown}
        onChange={event => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={fieldClass(Boolean(error))}
      />
      {error
        ? <FieldError id={errorId}>{error}</FieldError>
        : parts && (
          <p className="mt-1 text-[11px] text-on-surf-v">
            <span className="font-[600] text-on-surf">{parts.date}</span> · {parts.time}
          </p>
        )}
    </div>
  )
}

// The moment in words beside the single combined input, so the pick is unambiguous at a
// glance. The rest of the app has no split date and time pattern, so this keeps one input.
function splitLocal(value: string): { date: string; time: string } {
  const d = new Date(value)
  return {
    date: d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }),
  }
}
```

- [ ] **Step 6: Create `CreateTripSummary`**

Create `frontend/dispatcher/components/trips/new/CreateTripSummary.tsx`:

```tsx
'use client'

import { Button } from '@/components/ui/Button'
import { cn } from '@shared/lib/utils/cn'

export interface SummaryRow {
  label: string
  value: string
  /** Identifiers, plates, times: tabular figures (DESIGN_SYSTEM.md §5.2). */
  numeric?: boolean
}

export interface CreateTripSummaryProps {
  rows: readonly SummaryRow[]
  /** One sentence on what the journey lock will cover. */
  lockNote: string
  canCreate: boolean
  busy: boolean
  /** Shown above the CTA after an attempt with invalid fields. */
  errorText: string | null
  onCreate: () => void
}

/** The dark Trip Summary panel of DESIGN_SYSTEM.md §8.3, holding the screen's one gradient CTA. */
export function CreateTripSummary(
  { rows, lockNote, canCreate, busy, errorText, onCreate }: CreateTripSummaryProps,
): React.JSX.Element {
  return (
    <aside
      aria-label="Trip summary"
      className="w-full shrink-0 rounded-lg bg-primary p-[22px] shadow-level-5 lg:sticky lg:top-6 lg:w-[280px]"
    >
      {/* 60% white, not the old wizard's 40%: 4.5:1 on --primary for 11px text. */}
      <h2 className="mb-[14px] text-[11px] font-[700] uppercase tracking-[0.1em] text-white/60">Trip summary</h2>
      <dl>
        {rows.map(row => (
          <div key={row.label} className="mb-2 flex justify-between gap-3 border-b border-white/[0.08] pb-2">
            <dt className="shrink-0 text-[11px] text-white/60">{row.label}</dt>
            <dd
              className={cn(
                'min-w-0 break-words text-right text-white/90',
                row.numeric ? 'text-[13px] font-[600] tabular-nums tracking-[0.05em]' : 'text-[12px] font-[500]',
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mb-4 mt-2 text-[11px] leading-relaxed text-white/60">{lockNote}</p>
      {errorText && (
        <p role="alert" className="mb-3 rounded-md bg-err-c px-3 py-2 text-[12px] font-[600] text-err-onc">{errorText}</p>
      )}
      <Button full onClick={onCreate} disabled={!canCreate} loading={busy}>
        Create Trip + Lock to Blockchain
      </Button>
    </aside>
  )
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run components/trips/new`
Expected: all pass (Task 4's and Task 5's).

Run: `cd frontend/dispatcher && npm run type-check && npm run lint`
Expected: no errors.

- [ ] **Step 8: Stage**

```bash
git add frontend/dispatcher/components/trips/new/CrewFields.tsx frontend/dispatcher/components/trips/new/CrewFields.test.tsx frontend/dispatcher/components/trips/new/RouteFields.tsx frontend/dispatcher/components/trips/new/RouteFields.test.tsx frontend/dispatcher/components/trips/new/ScheduleFields.tsx frontend/dispatcher/components/trips/new/ScheduleFields.test.tsx frontend/dispatcher/components/trips/new/CreateTripSummary.tsx frontend/dispatcher/components/trips/new/CreateTripSummary.test.tsx
```
Suggested commit: `feat(dispatcher): crew, route, schedule and summary sections for trip creation (FP-281)`

---

### Task 6: The one-screen create-trip page

**Files:**
- Rewrite: `frontend/dispatcher/app/(app)/trips/new/page.tsx`
- Test: `frontend/dispatcher/app/(app)/trips/new/page.test.tsx` (create)

**Interfaces:**
- Consumes: Task 1 `createTripFromPPManifest`, `createTrip`, `findLiveTripForManifest`, `classifyCreateError`; Task 2 everything in `manifest-form` and `trailerCombo`; Task 3 `useManifestPreview`; Task 4 `ManifestLookup`, `ManifestSummary`, `ManifestWarnings`, `FormCard`, `CardTitle`; Task 5 `CrewFields`, `RouteFields`, `RouteEnd`, `ScheduleFields`, `CreateTripSummary`, `SummaryRow`. Existing: `useDrivers`, `useVehicles`, `usePrecincts`, `useToast`, `Tabs`, `Modal`, `RecordLink`, `ROUTES`, `COPY.toast.tripCreated`.
- Produces: the default-exported page. Nothing else imports from it.

Screen (spec §11, laid out per DESIGN_SYSTEM.md §8.1 and §8.3):

```
TopBar  "Create Trip" · sub: "From a Parcel Perfect manifest" | "Empty leg — no cargo"
┌ form column (flex-1) ─────────────────────────────┐ ┌ Trip summary (280px, sticky) ┐
│ [notice banner — after a failed create]           │ │ Manifest / Client / Route     │
│ [ From manifest | Empty leg (no manifest) ]  tabs │ │ Departure / Driver / Horse    │
│ Manifest mode:                                    │ │ Trailers / Cargo              │
│   Card "Parcel Perfect manifest": number + Look up│ │ lock note                     │
│     → warnings → summary                          │ │ [Create Trip + Lock …] (CTA)  │
│   Card "Route & schedule" (once creatable)        │ └───────────────────────────────┘
│   Crew cards (once creatable)                     │
│ Empty-leg mode: "Route & schedule" + crew cards   │
└───────────────────────────────────────────────────┘
Bottom strip: [Cancel]
```

Behaviour the tests pin:
- Crew, route and schedule appear in manifest mode only once a preview with `can_create` is loaded: progressive disclosure, and no entry wasted on a blocked manifest. A blocked preview shows its warnings and disables the CTA.
- Editing the manifest number after a lookup clears the summary and the dispatcher's route and time entries. Crew is kept: it does not depend on the manifest.
- Switching mode clears route and time entries and keeps crew.
- CTA, then a confirmation modal, then create. On failure a notice banner takes focus (`tabIndex=-1`, focused in an effect), so keyboard and screen-reader users land on it:
  - **No response:** look the manifest up (§10.4). Found → treat as created. Not found → "not created, try again". The lookup itself fails → say so: a retry is safe, because a manifest can only be on one trip.
  - **`MANIFEST_CHANGED`:** swap in the fresh preview. Keep crew, picks and overrides; untouched times follow the new manifest because they are `null`.
  - **`MANIFEST_ALREADY_ON_TRIP`:** the message, plus a link to the trip when its id is known.
  - **Anything else:** the backend's message.
- An empty leg posts to `POST /trips` with `trip_type: 'empty_leg'` and no `order_number`. A timeout there says the outcome is unknown and links to Active trips (D4).

- [ ] **Step 1: Write the failing page tests**

Create `frontend/dispatcher/app/(app)/trips/new/page.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }))
const toast = vi.hoisted(() => ({ notify: vi.fn() }))

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))
// TopBar mounts ForensicControls, which needs ForensicModeProvider, which reads the user.
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('@/lib/hooks/useDrivers', () => ({ useDrivers: vi.fn() }))
vi.mock('@/lib/hooks/useVehicles', () => ({ useVehicles: vi.fn() }))
vi.mock('@/lib/hooks/usePrecincts', () => ({ usePrecincts: vi.fn() }))
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  previewPPManifest: vi.fn(),
  createTripFromPPManifest: vi.fn(),
  createTrip: vi.fn(),
  findLiveTripForManifest: vi.fn(),
}))

import TripNewPage from './page'
import {
  ApiError, createTrip, createTripFromPPManifest, findLiveTripForManifest, previewPPManifest,
} from '@/lib/api/client'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { useVehicles } from '@/lib/hooks/useVehicles'
import { ROUTES } from '@/lib/constants/routes'
import { makePreview, makeWarning } from '@/lib/trips/__fixtures__/preview'
import { isoToLocalInput } from '@/lib/trips/manifest-form'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import {
  mockPrecincts, PRECINCT_CGY_JHB_ID, PRECINCT_FEDEX_DBN_ID, PRECINCT_FEDEX_JHB_ID,
} from '@shared/lib/mocks/precincts'
import { mockHorses } from '@shared/lib/mocks/vehicles'
import type { Trip } from '@shared/lib/types/trip'

const CTA = 'Create Trip + Lock to Blockchain'
const CONFIRM = 'Yes, create and lock trip'
const created = (id: string): Trip => ({ id }) as Trip   // the page reads only the id
const DRIVER_ID = mockDrivers[0].id
const HORSE_ID = mockHorses[0].id

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(useDrivers).mockReturnValue({ drivers: mockDrivers, isLoading: false, error: null, refetch: vi.fn() })
  vi.mocked(useVehicles).mockReturnValue({
    horses: mockHorses, trailers: [], all: mockHorses, isLoading: false, error: null, refetch: vi.fn(),
  })
  vi.mocked(usePrecincts).mockReturnValue({ precincts: mockPrecincts, isLoading: false, error: null, refetch: vi.fn() })
})

function renderPage(): void {
  render(
    <ForensicModeProvider>
      <TripNewPage />
    </ForensicModeProvider>,
  )
}

async function lookUp(manifestNumber = '81', display = 'The Courier Guy · CPT 81'): Promise<void> {
  fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: manifestNumber } })
  fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
  await screen.findByRole('region', { name: `Manifest ${display}` })
}

function pick(trigger: string, option: RegExp): void {
  fireEvent.click(screen.getByRole('button', { name: trigger }))
  fireEvent.click(screen.getByRole('button', { name: option }))
}

function chooseCrew(): void {
  pick('Select driver…', /Sipho Dlamini/)
  pick('Select horse…', /GP 12-34 ZX/)
}

async function create(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: CTA }))
  fireEvent.click(await screen.findByRole('button', { name: CONFIRM }))
}

describe('Create Trip — from a manifest', () => {
  it('creates a loaded trip from a looked-up manifest and opens it', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    vi.mocked(createTripFromPPManifest).mockResolvedValue(created('trip-new'))
    renderPage()

    await lookUp()
    chooseCrew()
    await create()

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(ROUTES.tripDetail('trip-new')))
    expect(createTripFromPPManifest).toHaveBeenCalledWith({
      manifest_number: 81,
      expected_snapshot_sha256: 'a'.repeat(64),
      driver_id: DRIVER_ID,
      horse_id: HORSE_ID,
      trailer_ids: [],
      planned_departure_at: null,   // untouched manifest times are never sent back (D2)
      planned_arrival_at: null,
      origin_precinct_id: null,
      destination_precinct_id: null,
    })
    expect(toast.notify).toHaveBeenCalledWith({ kind: 'success', title: 'Trip created · Journey lock anchored' })
  })

  it('asks only for what the manifest lacks', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview({
      destination: { hub_code: 'DUR', precinct_id: null, precinct_name: null },
      planned_departure_at: null,
      expected_arrival_at: null,
      warnings: [makeWarning('DESTINATION_HUB_UNLINKED'), makeWarning('NO_PLANNED_TIMES')],
    }))
    vi.mocked(createTripFromPPManifest).mockResolvedValue(created('trip-new'))
    renderPage()
    await lookUp()
    chooseCrew()

    fireEvent.click(screen.getByRole('button', { name: CTA }))

    expect(await screen.findByText('Choose the precinct for hub DUR.')).toBeInTheDocument()
    expect(screen.getByText('Enter a planned departure.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: CONFIRM })).not.toBeInTheDocument()

    pick('Select destination precinct…', /Courier Guy JHB/)
    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T18:00' } })
    await create()

    await waitFor(() => expect(createTripFromPPManifest).toHaveBeenCalled())
    const payload = vi.mocked(createTripFromPPManifest).mock.calls[0][0]
    expect(payload.destination_precinct_id).toBe(PRECINCT_CGY_JHB_ID)
    expect(payload.origin_precinct_id).toBeNull()
    expect(payload.planned_departure_at).toBe(new Date('2026-10-02T18:00').toISOString())
  })

  it('refuses a blocked manifest and asks for nothing else', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview({
      can_create: false,
      warnings: [makeWarning('MANIFEST_ALREADY_ON_TRIP', {
        message: 'Manifest CPT 81 is already on trip FP-20261001-AAAA0001.',
        trip_id: 'trip-old', trip_reference: 'FP-20261001-AAAA0001',
      })],
    }))
    renderPage()

    await lookUp()

    expect(screen.getByRole('link', { name: /Open FP-20261001-AAAA0001/ })).toHaveAttribute('href', ROUTES.tripDetail('trip-old'))
    expect(screen.getByRole('button', { name: CTA })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Select driver…' })).not.toBeInTheDocument()
  })

  it('clears the summary when the number is edited after a lookup', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    renderPage()
    await lookUp()

    fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: '82' } })

    expect(screen.queryByRole('region', { name: /Manifest The Courier Guy/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: CTA })).toBeDisabled()
  })

  it('refuses a number that is not one, without calling the server', () => {
    renderPage()

    fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: 'JNB 69' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))

    expect(screen.getByText('Enter the manifest number — digits only, e.g. 81.')).toBeInTheDocument()
    expect(previewPPManifest).not.toHaveBeenCalled()
  })

  it('shows the new summary when the manifest changed before create, and keeps the crew', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    // The client moved the departure in PP between preview and create.
    const fresh = makePreview({
      snapshot_sha256: 'b'.repeat(64), client_reference: 'PO-CGY-0081-REV', planned_departure_at: '2026-10-02T17:00:00Z',
    })
    const message = 'PP manifest 81 changed since it was previewed — review it again.'
    vi.mocked(createTripFromPPManifest)
      .mockRejectedValueOnce(new ApiError(409, message, { code: 'MANIFEST_CHANGED', message, preview: fresh }))
      .mockResolvedValueOnce(created('trip-new'))
    renderPage()
    await lookUp()
    chooseCrew()

    await create()

    expect(await screen.findByText(/The manifest changed in Parcel Perfect/)).toBeInTheDocument()
    expect(screen.getByText('PO-CGY-0081-REV')).toBeInTheDocument()
    // The untouched departure follows the new manifest; it was never the dispatcher's own.
    expect(screen.getByLabelText(/Planned departure/)).toHaveValue(isoToLocalInput('2026-10-02T17:00:00Z'))

    await create()

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(ROUTES.tripDetail('trip-new')))
    const retry = vi.mocked(createTripFromPPManifest).mock.calls[1][0]
    expect(retry.expected_snapshot_sha256).toBe('b'.repeat(64))
    expect(retry.driver_id).toBe(DRIVER_ID)
    expect(retry.planned_departure_at).toBeNull()
  })

  it('keeps an edited time across a changed manifest', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    const fresh = makePreview({ snapshot_sha256: 'b'.repeat(64), planned_departure_at: '2026-10-02T17:00:00Z' })
    const message = 'PP manifest 81 changed since it was previewed — review it again.'
    vi.mocked(createTripFromPPManifest)
      .mockRejectedValueOnce(new ApiError(409, message, { code: 'MANIFEST_CHANGED', message, preview: fresh }))
      .mockResolvedValueOnce(created('trip-new'))
    renderPage()
    await lookUp()
    chooseCrew()
    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T20:00' } })

    await create()
    await screen.findByText(/The manifest changed in Parcel Perfect/)
    await create()

    await waitFor(() => expect(createTripFromPPManifest).toHaveBeenCalledTimes(2))
    expect(vi.mocked(createTripFromPPManifest).mock.calls[1][0].planned_departure_at)
      .toBe(new Date('2026-10-02T20:00').toISOString())
  })

  it('links to the trip that already holds the manifest', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    const message = 'This PP manifest is already on trip FP-1. Cancel that trip before creating a new one.'
    vi.mocked(createTripFromPPManifest).mockRejectedValue(new ApiError(409, message, {
      code: 'MANIFEST_ALREADY_ON_TRIP', message, trip_id: 'trip-1', trip_reference: 'FP-1',
    }))
    renderPage()
    await lookUp()
    chooseCrew()

    await create()

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open FP-1/ })).toHaveAttribute('href', ROUTES.tripDetail('trip-1'))
  })

  it('finds the trip after a timeout instead of saying "maybe"', async () => {
    const preview = makePreview()
    vi.mocked(previewPPManifest).mockResolvedValue(preview)
    vi.mocked(createTripFromPPManifest).mockRejectedValue(new ApiError(0, 'timed out'))
    vi.mocked(findLiveTripForManifest).mockResolvedValue({ id: 'trip-late' })
    renderPage()
    await lookUp()
    chooseCrew()

    await create()

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(ROUTES.tripDetail('trip-late')))
    expect(findLiveTripForManifest).toHaveBeenCalledWith(preview.pp_manifest)
  })

  it('says the trip was not created when the timeout lookup finds nothing', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    vi.mocked(createTripFromPPManifest).mockRejectedValue(new ApiError(0, 'timed out'))
    vi.mocked(findLiveTripForManifest).mockResolvedValue(null)
    renderPage()
    await lookUp()
    chooseCrew()

    await create()

    expect(await screen.findByText(/no trip was created for this manifest/)).toBeInTheDocument()
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('says so when even the timeout lookup fails, rather than claiming "not created"', async () => {
    vi.mocked(previewPPManifest).mockResolvedValue(makePreview())
    vi.mocked(createTripFromPPManifest).mockRejectedValue(new ApiError(0, 'timed out'))
    vi.mocked(findLiveTripForManifest).mockRejectedValue(new ApiError(0, 'timed out'))
    renderPage()
    await lookUp()
    chooseCrew()

    await create()

    expect(await screen.findByText(/the check for the trip failed too/)).toBeInTheDocument()
  })

  it('offers an empty leg when live Parcel Perfect cannot look manifests up', async () => {
    vi.mocked(previewPPManifest).mockRejectedValue(
      new ApiError(501, 'Manifest lookup is not available on the live Parcel Perfect API.'),
    )
    renderPage()
    fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: '81' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Create an empty leg instead' }))

    expect(screen.getByRole('tab', { name: 'Empty leg (no manifest)' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Create Trip — empty leg', () => {
  it('creates an empty leg through POST /trips, with no order number', async () => {
    vi.mocked(createTrip).mockResolvedValue(created('trip-empty'))
    renderPage()

    fireEvent.click(screen.getByRole('tab', { name: 'Empty leg (no manifest)' }))
    pick('Select origin precinct…', /FedEx JHB/)
    pick('Select destination precinct…', /FedEx DBN/)
    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T18:00' } })
    chooseCrew()
    await create()

    await waitFor(() => expect(createTrip).toHaveBeenCalledWith({
      trip_type: 'empty_leg',
      driver_id: DRIVER_ID,
      horse_id: HORSE_ID,
      trailer_ids: [],
      origin_precinct_id: PRECINCT_FEDEX_JHB_ID,
      destination_precinct_id: PRECINCT_FEDEX_DBN_ID,
      consignments: [],
      planned_departure_at: new Date('2026-10-02T18:00').toISOString(),
      planned_arrival_at: null,
    }))
    expect(nav.push).toHaveBeenCalledWith(ROUTES.tripDetail('trip-empty'))
  })

  it('does not guess after an empty-leg timeout, and points to Active trips', async () => {
    vi.mocked(createTrip).mockRejectedValue(new ApiError(0, 'timed out'))
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Empty leg (no manifest)' }))
    pick('Select origin precinct…', /FedEx JHB/)
    pick('Select destination precinct…', /FedEx DBN/)
    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T18:00' } })
    chooseCrew()

    await create()

    expect(await screen.findByText(/not known whether the empty leg was created/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open Active trips/ })).toHaveAttribute('href', ROUTES.home)
    expect(findLiveTripForManifest).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run "app/(app)/trips/new/page.test.tsx"`
Expected: FAIL. The old wizard has no "Manifest number" field and no tabs, so `getByLabelText(/Manifest number/)` throws.

- [ ] **Step 3: Rewrite the page**

Replace the entire contents of `frontend/dispatcher/app/(app)/trips/new/page.tsx` with:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/ui/TopBar'
import { Tabs } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Ic } from '@/components/ui/Ic'
import { RecordLink } from '@/components/ui/RecordLink'
import { CardTitle, FormCard } from '@/components/trips/new/form-parts'
import { ManifestLookup } from '@/components/trips/new/ManifestLookup'
import { ManifestSummary } from '@/components/trips/new/ManifestSummary'
import { ManifestWarnings } from '@/components/trips/new/ManifestWarnings'
import { RouteFields, type RouteEnd } from '@/components/trips/new/RouteFields'
import { ScheduleFields } from '@/components/trips/new/ScheduleFields'
import { CrewFields } from '@/components/trips/new/CrewFields'
import { CreateTripSummary, type SummaryRow } from '@/components/trips/new/CreateTripSummary'
import { createTrip, createTripFromPPManifest, findLiveTripForManifest } from '@/lib/api/client'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { useManifestPreview } from '@/lib/hooks/useManifestPreview'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { useToast } from '@/lib/hooks/useToast'
import { useVehicles } from '@/lib/hooks/useVehicles'
import { ROUTES } from '@/lib/constants/routes'
import {
  EMPTY_CREW, NO_OVERRIDES, NO_PICKS, NO_TIMES,
  buildEmptyLegPayload, buildFromManifestPayload, localInputToIso, manifestTimes, parseManifestNumber,
  shownTimes, validateCrew, validateEmptyLegRoute, validateManifestRoute, validateSchedule,
  type CrewValues, type FieldErrors, type RoutePicks, type ScheduleOverrides,
} from '@/lib/trips/manifest-form'
import { classifyCreateError } from '@/lib/trips/trip-api-errors'
import { trailerCombo } from '@/lib/trips/trailer-combo'
import { COPY } from '@shared/lib/constants/copy'
import { cn } from '@shared/lib/utils/cn'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { PPManifestHub, PPManifestPreview } from '@shared/lib/types/pp-manifest'
import type { Vehicle } from '@shared/lib/types/vehicle'

type CreateMode = 'manifest' | 'empty_leg'

const MODE_TABS = [
  { id: 'manifest', label: 'From manifest' },
  { id: 'empty_leg', label: 'Empty leg (no manifest)' },
] as const

const PANEL_ID = 'create-trip-panel'

const BAD_NUMBER = 'Enter the manifest number — digits only, e.g. 81.'
const FIELDS_INCOMPLETE = 'Complete the highlighted fields before creating the trip.'
const MANIFEST_CHANGED_NOTE =
  'The manifest changed in Parcel Perfect since you looked it up. Check the updated summary, then create the trip again.'
const TIMEOUT_NOT_CREATED =
  'The server took too long to respond, and no trip was created for this manifest. Try again.'
const TIMEOUT_UNCONFIRMED =
  'The server took too long to respond, and the check for the trip failed too. Trying again is safe: a manifest can only be on one trip.'
const TIMEOUT_EMPTY_LEG =
  'The server took too long to respond, so it is not known whether the empty leg was created. Check Active trips before trying again: empty legs have no duplicate check.'
const LOCK_NOTE_MANIFEST =
  'On create, the manifest key, this manifest as pulled now and the planned times are locked into the journey hash and anchored to Hedera HCS.'
const LOCK_NOTE_EMPTY_LEG = 'On create, the journey lock hash is anchored to Hedera HCS.'
const NOT_SET = 'Not set'

/** What a failed create left the dispatcher to read, or to open. */
interface Notice {
  tone: 'error' | 'warn'
  message: string
  /** The trip already holding this manifest, when it is ours to open. */
  trip?: { id: string; reference: string | null }
  /** An empty-leg timeout: Active trips is where to check. */
  showActiveTrips?: boolean
}

export default function TripNewPage(): React.JSX.Element {
  const router = useRouter()
  const { notify } = useToast()
  const { drivers } = useDrivers()
  const { horses, trailers } = useVehicles()
  const { precincts, error: precinctsError } = usePrecincts()
  const lookup = useManifestPreview()

  const [mode, setMode] = useState<CreateMode>('manifest')
  const [manifestInput, setManifestInput] = useState('')
  const [manifestInputError, setManifestInputError] = useState<string | null>(null)
  const [crew, setCrew] = useState<CrewValues>(EMPTY_CREW)
  const [overrides, setOverrides] = useState<ScheduleOverrides>(NO_OVERRIDES)
  const [picks, setPicks] = useState<RoutePicks>(NO_PICKS)
  const [showErrors, setShowErrors] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)

  // Without this the failure is invisible: the precinct pickers would just be empty.
  useEffect(() => {
    if (precinctsError) {
      notify({
        kind: 'error',
        title: 'Failed to load precincts',
        body: `${precinctsError} Precincts cannot be selected until this loads.`,
      })
    }
  }, [precinctsError, notify])

  // A failed create is announced where the dispatcher's attention goes next.
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const preview: PPManifestPreview | null = lookup.state.status === 'loaded' ? lookup.state.preview : null
  const source = mode === 'manifest' && preview ? manifestTimes(preview) : NO_TIMES
  const shown = shownTimes(overrides, source)
  const selectedTrailers = crew.trailerIds
    .map(id => trailers.find(t => t.id === id))
    .filter((t): t is Vehicle => t !== undefined)
  const combo = trailerCombo(selectedTrailers)
  // In manifest mode nothing else is asked for until the manifest can become a trip.
  const formReady = mode === 'empty_leg' || preview?.can_create === true

  let errors: FieldErrors = {}
  if (mode === 'empty_leg') {
    errors = { ...validateEmptyLegRoute(picks), ...validateSchedule(shown, source), ...validateCrew(crew, combo.valid) }
  } else if (preview) {
    errors = { ...validateManifestRoute(preview, picks), ...validateSchedule(shown, source), ...validateCrew(crew, combo.valid) }
  }
  const hasErrors = Object.keys(errors).length > 0
  const shownErrors: FieldErrors = showErrors ? errors : {}

  // Route, times and the review state belong to one manifest or one empty leg. Crew does
  // not, so it survives every reset.
  function resetEntries(): void {
    setOverrides(NO_OVERRIDES)
    setPicks(NO_PICKS)
    setShowErrors(false)
    setNotice(null)
  }

  function changeMode(next: string): void {
    if (next !== 'manifest' && next !== 'empty_leg') return
    setMode(next)
    resetEntries()
  }

  function changeManifestInput(value: string): void {
    setManifestInput(value)
    setManifestInputError(null)
    // The summary must always describe the number in the box: what is shown is what gets created.
    if (lookup.state.status !== 'idle') {
      lookup.reset()
      resetEntries()
    }
  }

  function lookUpManifest(): void {
    const manifestNumber = parseManifestNumber(manifestInput)
    if (manifestNumber === null) {
      setManifestInputError(BAD_NUMBER)
      return
    }
    resetEntries()
    void lookup.lookUp(manifestNumber)
  }

  function pickPrecinct(end: 'origin' | 'destination', precinctId: string): void {
    setPicks(current => (end === 'origin' ? { ...current, originId: precinctId } : { ...current, destinationId: precinctId }))
  }

  function attemptCreate(): void {
    if (hasErrors) {
      setShowErrors(true)
      return
    }
    setConfirming(true)
  }

  function openCreated(tripId: string): void {
    notify({ kind: 'success', title: COPY.toast.tripCreated })
    router.push(ROUTES.tripDetail(tripId))
  }

  async function submitManifest(current: PPManifestPreview): Promise<void> {
    try {
      const trip = await createTripFromPPManifest(buildFromManifestPayload(current, crew, overrides, picks))
      openCreated(trip.id)
    } catch (err) {
      const failure = classifyCreateError(err)
      switch (failure.kind) {
        case 'no_response': {
          // Creation is atomic: the trip exists in full or not at all. One exact lookup
          // therefore turns "maybe" into a definite answer (spec §10.4).
          let existing: { id: string } | null
          try {
            existing = await findLiveTripForManifest(current.pp_manifest)
          } catch (lookupError) {
            console.warn('Trip lookup after a create timeout failed', lookupError)
            setNotice({ tone: 'error', message: TIMEOUT_UNCONFIRMED })
            return
          }
          if (existing) openCreated(existing.id)
          else setNotice({ tone: 'error', message: TIMEOUT_NOT_CREATED })
          return
        }
        case 'manifest_changed':
          // Crew, picks and edited times stand. Untouched times are null overrides, so they
          // now follow the new manifest.
          lookup.replace(failure.preview)
          setNotice({ tone: 'warn', message: MANIFEST_CHANGED_NOTE })
          return
        case 'already_on_trip':
          setNotice({
            tone: 'error',
            message: failure.message,
            trip: failure.tripId ? { id: failure.tripId, reference: failure.tripReference } : undefined,
          })
          return
        case 'rejected':
          setNotice({ tone: 'error', message: failure.message })
      }
    }
  }

  async function submitEmptyLeg(): Promise<void> {
    try {
      const trip = await createTrip(buildEmptyLegPayload(crew, overrides, picks))
      openCreated(trip.id)
    } catch (err) {
      const failure = classifyCreateError(err)
      setNotice(
        failure.kind === 'no_response'
          ? { tone: 'error', message: TIMEOUT_EMPTY_LEG, showActiveTrips: true }
          : { tone: 'error', message: failure.message },
      )
    }
  }

  async function submit(): Promise<void> {
    setSubmitting(true)
    setNotice(null)
    try {
      if (mode === 'manifest' && preview) await submitManifest(preview)
      else if (mode === 'empty_leg') await submitEmptyLeg()
    } finally {
      setSubmitting(false)
      setConfirming(false)
    }
  }

  // ── Route ends and summary rows ─────────────────────────────────────────────
  const clientPrecincts = preview?.client_organization_id
    ? precincts.filter(p => p.principal_organization_id === preview.client_organization_id)
    : []

  function manifestEnd(hub: PPManifestHub, picked: string): RouteEnd {
    return hub.precinct_id
      ? { kind: 'fixed', name: hub.precinct_name ?? hub.hub_code, hubCode: hub.hub_code }
      : { kind: 'pick', value: picked, options: clientPrecincts, hubCode: hub.hub_code }
  }

  const precinctName = (id: string): string | null => precincts.find(p => p.id === id)?.name ?? null
  const originName = mode === 'manifest' && preview
    ? preview.origin.precinct_name ?? precinctName(picks.originId) ?? `Hub ${preview.origin.hub_code}`
    : precinctName(picks.originId)
  const destinationName = mode === 'manifest' && preview
    ? preview.destination.precinct_name ?? precinctName(picks.destinationId) ?? `Hub ${preview.destination.hub_code}`
    : precinctName(picks.destinationId)

  const rows: SummaryRow[] = [
    mode === 'manifest'
      ? { label: 'Manifest', value: preview?.pp_manifest.display ?? 'Not looked up', numeric: preview !== null }
      : { label: 'Manifest', value: 'Empty leg' },
    ...(mode === 'manifest' && preview ? [{ label: 'Client', value: preview.client_name }] : []),
    { label: 'Route', value: originName && destinationName ? `${originName} → ${destinationName}` : NOT_SET },
    { label: 'Departure', value: shown.departure ? fmtDateTime(localInputToIso(shown.departure)) : NOT_SET, numeric: Boolean(shown.departure) },
    { label: 'Driver', value: drivers.find(d => d.id === crew.driverId)?.full_name ?? NOT_SET },
    { label: 'Horse', value: horses.find(h => h.id === crew.horseId)?.registration ?? NOT_SET, numeric: Boolean(crew.horseId) },
    {
      label: 'Trailers',
      value: selectedTrailers.length ? selectedTrailers.map(t => t.registration).join(', ') : 'None',
      numeric: selectedTrailers.length > 0,
    },
    {
      label: 'Cargo',
      value: mode === 'empty_leg'
        ? 'None — empty leg'
        : preview ? `${preview.totals.waybills} waybills · ${preview.totals.parcels} parcels` : NOT_SET,
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="Create Trip" sub={mode === 'manifest' ? 'From a Parcel Perfect manifest' : 'Empty leg — no cargo'} />

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 md:px-6 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {notice && <NoticeBanner notice={notice} ref={noticeRef} />}

            <Tabs tabs={MODE_TABS} active={mode} onChange={changeMode} panelId={PANEL_ID} ariaLabel="How to create this trip" />

            <div id={PANEL_ID} role="tabpanel" aria-labelledby={`tab-${mode}`} className="flex flex-col gap-4">
              {mode === 'manifest' ? (
                <>
                  <FormCard>
                    <CardTitle icon="file">Parcel Perfect manifest</CardTitle>
                    <ManifestLookup
                      value={manifestInput}
                      onChange={changeManifestInput}
                      onLookUp={lookUpManifest}
                      state={lookup.state}
                      inputError={manifestInputError}
                      onEmptyLeg={() => changeMode('empty_leg')}
                    />
                    {preview && (
                      <div className="mt-5 flex flex-col gap-4 border-t border-outline-v/20 pt-5">
                        <ManifestWarnings warnings={preview.warnings} onEmptyLeg={() => changeMode('empty_leg')} />
                        <ManifestSummary preview={preview} />
                      </div>
                    )}
                  </FormCard>

                  {preview?.can_create && (
                    <FormCard>
                      <CardTitle icon="map">Route &amp; schedule</CardTitle>
                      <RouteFields
                        origin={manifestEnd(preview.origin, picks.originId)}
                        destination={manifestEnd(preview.destination, picks.destinationId)}
                        onPick={pickPrecinct}
                        errors={shownErrors}
                      />
                      <ScheduleFields overrides={overrides} source={source} onChange={setOverrides} errors={shownErrors} />
                    </FormCard>
                  )}
                </>
              ) : (
                <FormCard>
                  <CardTitle icon="map">Route &amp; schedule</CardTitle>
                  <RouteFields
                    origin={{ kind: 'pick', value: picks.originId, options: precincts, hubCode: null }}
                    destination={{ kind: 'pick', value: picks.destinationId, options: precincts, hubCode: null }}
                    onPick={pickPrecinct}
                    errors={shownErrors}
                  />
                  <ScheduleFields overrides={overrides} source={NO_TIMES} onChange={setOverrides} errors={shownErrors} />
                </FormCard>
              )}

              {formReady && (
                <CrewFields
                  crew={crew}
                  onChange={setCrew}
                  drivers={drivers}
                  horses={horses}
                  trailers={trailers}
                  combo={combo}
                  errors={shownErrors}
                />
              )}
            </div>
          </div>

          <CreateTripSummary
            rows={rows}
            lockNote={mode === 'manifest' ? LOCK_NOTE_MANIFEST : LOCK_NOTE_EMPTY_LEG}
            canCreate={formReady && !submitting}
            busy={submitting}
            errorText={showErrors && hasErrors ? FIELDS_INCOMPLETE : null}
            onCreate={attemptCreate}
          />
        </div>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        closeDisabled={submitting}
        title="This action is permanent"
        footer={(
          <div className="flex w-full flex-col gap-2">
            <Button full loading={submitting} onClick={() => { void submit() }}>
              {submitting ? 'Creating trip…' : 'Yes, create and lock trip'}
            </Button>
            <Button variant="secondary" full onClick={() => setConfirming(false)} disabled={submitting}>
              Go back and review
            </Button>
          </div>
        )}
      >
        <div className="flex items-start gap-3">
          <div className="mt-[2px] shrink-0 rounded-full bg-warn-c p-[6px]">
            <Ic n="lock" s={16} className="text-warn" />
          </div>
          <p className="text-[13px] leading-relaxed text-on-surf-v">
            Once created, this trip is anchored to the Hedera blockchain and cannot be deleted. A trip can
            only be cancelled, so its evidence is kept.
          </p>
        </div>
      </Modal>

      <div className="flex shrink-0 gap-[10px] border-t border-outline-v/20 bg-surf-lowest px-6 py-3">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
      </div>
    </div>
  )
}

/** React 19: `ref` is an ordinary prop. tabIndex -1 lets the page move focus here. */
function NoticeBanner({ notice, ref }: { notice: Notice; ref: React.Ref<HTMLDivElement> }): React.JSX.Element {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-lg px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-sec',
        notice.tone === 'error' ? 'bg-err-c text-err-onc' : 'bg-warn-c text-warn-onc',
      )}
    >
      <Ic n="warn" s={16} className={cn('mt-[1px]', notice.tone === 'error' ? 'text-err' : 'text-warn')} />
      <div className="min-w-0 text-[13px] font-[600] leading-relaxed">
        <p>{notice.message}</p>
        {notice.trip && (
          <RecordLink href={ROUTES.tripDetail(notice.trip.id)}>Open {notice.trip.reference ?? 'that trip'}</RecordLink>
        )}
        {notice.showActiveTrips && <RecordLink href={ROUTES.home}>Open Active trips</RecordLink>}
      </div>
    </div>
  )
}
```

Notes for the implementer:
- `StepRail`, `usePpCapabilities`, `PPWaybillSummary`, the per-waybill pull and the `order_number` state all disappear with the old file. Leave `StepRail.tsx`, `usePpCapabilities.ts` and `types/pp.ts` in place (Question 5).
- `Modal`'s footer is a right-aligned flex row. The `w-full flex-col` wrapper stacks the two buttons full width, as the old confirmation did.
- The page needs no `trip_type` or `order_number` handling of its own: the request builders own the payload shapes, and Task 2 tests them.
- `Route &amp; schedule` is the JSX escape that ESLint's `react/no-unescaped-entities` wants. It renders as "Route & schedule".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run "app/(app)/trips/new/page.test.tsx" components/trips/new lib/trips lib/hooks/useManifestPreview.test.tsx`
Expected: all pass.

If `getByRole('button', { name: CONFIRM })` is not found, check that `vitest.setup.ts`'s `showModal` shim is active. The `Modal` opens a `<dialog>` and the shim sets `open`.

- [ ] **Step 5: Type-check, lint and the whole dispatcher suite**

Run: `cd frontend/dispatcher && npm run type-check && npm run lint && npm test`
Expected: no errors, and every suite passes. Nothing else imported from the old page.

- [ ] **Step 6: Stage**

```bash
git add "frontend/dispatcher/app/(app)/trips/new/page.tsx" "frontend/dispatcher/app/(app)/trips/new/page.test.tsx"
```
Suggested commit: `feat(dispatcher): one-screen trip creation from a PP manifest, or an empty leg (FP-281)`

---

### Task 7: The order number leaves the read side — dispatcher labels and the driver PWA

**Files:**
- Modify: `frontend/shared/lib/types/trip.ts`, `frontend/shared/lib/mocks/trips.ts`
- Create: `frontend/dispatcher/lib/format/manifest.ts`, `frontend/dispatcher/lib/trips/search.ts`
- Modify (dispatcher): `app/(app)/page.tsx`, `app/(app)/history/page.tsx`, `components/domain/ChecklistRow.tsx`, `app/(app)/trips/[id]/TripHeaderSummary.tsx`, `components/trips/TripSummary.tsx`, `lib/phase/trip-detail.ts`
- Modify (driver PWA, Tim's area — Question 2): `lib/types/driver-trip.ts`, `app/(app)/trips/page.tsx`, `components/home/HomeContent.tsx`, `components/trip/TripTable.tsx`, `components/trip/TripDetailView.tsx`
- Test (create): `frontend/dispatcher/lib/format/manifest.test.ts`, `frontend/dispatcher/lib/trips/search.test.ts`, `frontend/dispatcher/components/domain/__tests__/ChecklistRow.test.tsx`
- Test (modify): dispatcher `lib/phase/trip-detail.test.ts`, `app/(app)/history/page.test.tsx`, `lib/hooks/useTripHistory.test.tsx`. Driver PWA: `app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient{,.anchoring,.tripgate,.autorefresh}.test.tsx`, `app/(app)/trips/__tests__/page.test.tsx`, `components/home/__tests__/HomeContent.test.tsx`, `components/phase/steps/__tests__/linehaul.test.tsx`, `components/trip/__tests__/TripTable.test.tsx`, `components/trip/__tests__/TripDetailView.test.tsx`, `lib/context/__tests__/TripContext.autorefresh.test.tsx`, `lib/utils/__tests__/trip-filters.test.ts`, `lib/submission/__tests__/phase-submitter.test.ts`

**Interfaces:**
- Consumes: Task 1 `PPManifestRef`.
- Produces: `TripChecklistItem`, `TripSummary` and `Trip` lose `order_number` and gain `pp_manifest: PPManifestRef | null`. `TripChecklistItem` gains optional `trip_type?: TripType`. `DriverTripSummary` loses `order_number` and gains nothing: the driver never receives `pp_manifest` (§7.3, §12).
- Produces: `manifestLabel(ref: PPManifestRef | null, tripType: TripType | null): string`, `EMPTY_LEG_LABEL`, `NO_MANIFEST_LABEL` in `@/lib/format/manifest`; `matchesTripSearch(trip: SearchableTrip, term: string): boolean` in `@/lib/trips/search`. `ColWidths.order` is renamed `ColWidths.manifest`. `TripHeaderFacts.orderNumber: string` becomes `manifestLabel: string`.

This is the change that makes A safe to deploy: the dashboard search stops calling `t.order_number.toLowerCase()`. TypeScript does the inventory: once the field leaves the types, every remaining use is a compile error (Step 4 lists them).

- [ ] **Step 1: Write the failing tests**

Create `frontend/dispatcher/lib/format/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { manifestLabel } from './manifest'

const REF = { issuer_account: 'MOCK01', origin_hub: 'JNB', number: 69, display: 'CGY Logistics · JNB 69' }

describe('manifestLabel', () => {
  it('shows the manifest display when the trip has one', () => {
    expect(manifestLabel(REF, 'loaded')).toBe('CGY Logistics · JNB 69')
  })

  it('says "Empty leg" only when the trip type proves it', () => {
    expect(manifestLabel(null, 'empty_leg')).toBe('Empty leg')
  })

  it('says "No manifest" for a loaded trip without one, or when the type is unknown', () => {
    expect(manifestLabel(null, 'loaded')).toBe('No manifest')
    expect(manifestLabel(null, null)).toBe('No manifest')
  })
})
```

Create `frontend/dispatcher/lib/trips/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchesTripSearch } from './search'

const MANIFEST_TRIP = {
  trip_reference: 'FP-20261001-AB12CD34',
  driver: { full_name: 'Sipho Dlamini' },
  pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'JNB', number: 69, display: 'CGY Logistics · JNB 69' },
}
const EMPTY_LEG = { ...MANIFEST_TRIP, pp_manifest: null }

describe('matchesTripSearch', () => {
  it('matches the trip reference, the driver and the manifest label, ignoring case', () => {
    expect(matchesTripSearch(MANIFEST_TRIP, 'ab12')).toBe(true)
    expect(matchesTripSearch(MANIFEST_TRIP, 'sipho')).toBe(true)
    expect(matchesTripSearch(MANIFEST_TRIP, 'jnb 69')).toBe(true)
    expect(matchesTripSearch(MANIFEST_TRIP, 'cgy')).toBe(true)
  })

  it('handles a trip with no manifest instead of throwing', () => {
    expect(matchesTripSearch(EMPTY_LEG, 'jnb')).toBe(false)
  })

  it('matches everything on a blank term', () => {
    expect(matchesTripSearch(EMPTY_LEG, '   ')).toBe(true)
  })
})
```

Create `frontend/dispatcher/components/domain/__tests__/ChecklistRow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { ChecklistRow, type ColWidths } from '../ChecklistRow'
import type { TripChecklistItem } from '@shared/lib/types/trip'

const COL_WIDTHS: ColWidths = { createdAt: 60, tripId: 242, manifest: 155, driver: 150, route: 130, progress: 300, status: 120 }

function row(overrides: Partial<TripChecklistItem> = {}): TripChecklistItem {
  return {
    id: 'trip-1' as TripChecklistItem['id'],
    trip_reference: 'FP-20261001-AB12CD34',
    pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'JNB', number: 69, display: 'CGY Logistics · JNB 69' },
    status: 'created',
    driver: { full_name: 'Sipho Dlamini' },
    horse: { registration: 'GP 12-34 ZX' },
    origin_precinct_id: null,
    destination_precinct_id: null,
    needs_review_count: 0,
    created_at: '2026-10-01T08:00:00Z',
    current_phase: 'trip_creation',
    current_stop: 0,
    phase_total: 7,
    phase_completed: 1,
    ...overrides,
  }
}

describe('ChecklistRow manifest column', () => {
  it('shows the manifest display, with the full text as a tooltip', () => {
    render(<ChecklistRow trip={row()} colWidths={COL_WIDTHS} precincts={[]} />)

    expect(screen.getByText('CGY Logistics · JNB 69')).toHaveAttribute('title', 'CGY Logistics · JNB 69')
  })

  it('says "Empty leg" for an active empty leg', () => {
    render(<ChecklistRow trip={row({ pp_manifest: null, trip_type: 'empty_leg' })} colWidths={COL_WIDTHS} precincts={[]} />)

    expect(screen.getByText('Empty leg')).toBeInTheDocument()
  })

  it('says "No manifest" for a history row, which carries no trip type', () => {
    render(<ChecklistRow trip={row({ pp_manifest: null })} colWidths={COL_WIDTHS} precincts={[]} />)

    expect(screen.getByText('No manifest')).toBeInTheDocument()
  })
})
```

In `frontend/dispatcher/lib/phase/trip-detail.test.ts`:
- In `seed()`, replace `order_number: 'ORD-SEED',` with `pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'JNB', number: 69, display: 'CGY Logistics · JNB 69' },`.
- Add inside `describe('tripHeaderFacts', …)`:

```ts
  it('names the trip by its PP manifest, from a record or a list row', () => {
    expect(tripHeaderFacts(null, seed())?.manifestLabel).toBe('CGY Logistics · JNB 69')
    expect(tripHeaderFacts(base, null)?.manifestLabel).toBe(base.pp_manifest?.display)
  })

  it('calls a manifest-less empty leg an empty leg, and an untyped row "No manifest"', () => {
    expect(tripHeaderFacts({ ...base, pp_manifest: null, trip_type: 'empty_leg' }, null)?.manifestLabel).toBe('Empty leg')
    expect(tripHeaderFacts(null, seed({ pp_manifest: null }))?.manifestLabel).toBe('No manifest')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run lib/format/manifest.test.ts lib/trips/search.test.ts components/domain/__tests__/ChecklistRow.test.tsx lib/phase/trip-detail.test.ts`
Expected: FAIL. `./manifest` and `./search` cannot be resolved, ChecklistRow renders no manifest label, and `manifestLabel` is undefined on the facts.

- [ ] **Step 3: Change the types and mocks**

In `frontend/shared/lib/types/trip.ts`:
- Add below the existing type imports: `import type { PPManifestRef } from './pp-manifest'`.
- In `interface TripChecklistItem`, replace `  order_number: string` with:

```ts
  // The PP manifest this trip carries (FP-281), or null for empty legs and trips created
  // without one. It replaces the order number, which FreightProof no longer captures.
  pp_manifest: PPManifestRef | null
  // Sent on active-list rows (TripSummary). History rows do not carry it, so a row with no
  // manifest cannot be proven to be an empty leg (see lib/format/manifest.ts).
  trip_type?: TripType
```

- In `interface TripSummary`, replace `  order_number: string` with `  pp_manifest: PPManifestRef | null`.
- In `interface Trip`, replace `  order_number: string` with:

```ts
  // The PP manifest this trip carries (FP-281), or null. The snapshot of it is not here:
  // it is dispatcher-only, on GET /trips/{id}/manifest (spec §7.3).
  pp_manifest: PPManifestRef | null
```

In `frontend/driver-pwa/lib/types/driver-trip.ts`, delete `  order_number: string`. Add nothing in its place: `DriverTripListItemResponse` has no `pp_manifest`, and the driver's label is `trip_reference` (§12).

In `frontend/shared/lib/mocks/trips.ts`, replace each `order_number:` line with the matching `pp_manifest` line. The hub follows the trip's origin precinct:

| Line now | Replace with |
|---|---|
| `order_number: 'FX-ORD-2026-0035',` | `pp_manifest: { issuer_account: 'FDX001', origin_hub: 'JNB', number: 3501, display: 'FedEx South Africa · JNB 3501' },` |
| `order_number: 'CGY-ORD-2026-0038',` | `pp_manifest: { issuer_account: 'CGY001', origin_hub: 'JNB', number: 3801, display: 'The Courier Guy · JNB 3801' },` |
| `order_number: 'FX-ORD-2026-0039',` | `pp_manifest: { issuer_account: 'FDX001', origin_hub: 'DUR', number: 3901, display: 'FedEx South Africa · DUR 3901' },` |
| `order_number: 'FX-ORD-2026-0040',` | `pp_manifest: { issuer_account: 'FDX001', origin_hub: 'JNB', number: 4001, display: 'FedEx South Africa · JNB 4001' },` |
| `order_number: 'FX-ORD-2026-0041',` | `pp_manifest: { issuer_account: 'FDX001', origin_hub: 'JNB', number: 4101, display: 'FedEx South Africa · JNB 4101' },` |
| `order_number: 'FX-ORD-2026-0042',` | `pp_manifest: { issuer_account: 'FDX001', origin_hub: 'JNB', number: 4201, display: 'FedEx South Africa · JNB 4201' },` |
| `order_number: 'FX-ORD-2026-0043',` | `pp_manifest: { issuer_account: 'FDX001', origin_hub: 'JNB', number: 4301, display: 'FedEx South Africa · JNB 4301' },` |

- [ ] **Step 4: Let TypeScript list every remaining use**

Run: `cd frontend/dispatcher && npm run type-check`
Expected errors (fix in Step 5): `app/(app)/page.tsx` (search), `app/(app)/history/page.test.tsx`, `app/(app)/trips/[id]/TripHeaderSummary.tsx`, `components/domain/ChecklistRow.tsx`, `components/domain/__tests__/ChecklistRow.test.tsx` (`manifest` not in `ColWidths`), `lib/phase/trip-detail.ts`, `lib/phase/trip-detail.test.ts`, `lib/hooks/useTripHistory.test.tsx`, and `lib/format/manifest.test.ts` / `lib/trips/search.test.ts` (missing modules).

Run: `cd frontend/driver-pwa && npx tsc --noEmit`
Expected errors (fix in Steps 6–7): `app/(app)/trips/page.tsx`, `components/home/HomeContent.tsx`, `components/trip/TripTable.tsx`, `components/trip/TripDetailView.tsx`, and the nine driver test files listed under **Files**.

If either list has a file not named here, fix it the same way and name it in the task report.

- [ ] **Step 5: Dispatcher — the label, the search, the displays**

Create `frontend/dispatcher/lib/format/manifest.ts`:

```ts
import type { PPManifestRef } from '@shared/lib/types/pp-manifest'
import type { TripType } from '@shared/lib/types/trip'

export const EMPTY_LEG_LABEL = 'Empty leg'
export const NO_MANIFEST_LABEL = 'No manifest'

/** What lists and headers call a trip now the order number is gone (spec §12). A loaded
 *  trip can lack a manifest (trips made before FP-281, or through POST /trips with
 *  consignments), so "Empty leg" is said only when the trip type proves it. */
export function manifestLabel(ref: PPManifestRef | null, tripType: TripType | null): string {
  if (ref) return ref.display
  return tripType === 'empty_leg' ? EMPTY_LEG_LABEL : NO_MANIFEST_LABEL
}
```

Create `frontend/dispatcher/lib/trips/search.ts`:

```ts
import type { PPManifestRef } from '@shared/lib/types/pp-manifest'

/** The fields the dashboard search reads. TripSummary satisfies this. */
export interface SearchableTrip {
  trip_reference: string
  driver: { full_name: string }
  pp_manifest: PPManifestRef | null
}

/** Dashboard filter: the trip reference, the driver's name or the manifest label (client
 *  name, hub and number), ignoring case. A substring match is right for narrowing a live
 *  list. The exact manifest-number match lives server-side, on history and the retry lookup. */
export function matchesTripSearch(trip: SearchableTrip, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return trip.trip_reference.toLowerCase().includes(needle)
    || trip.driver.full_name.toLowerCase().includes(needle)
    || (trip.pp_manifest?.display.toLowerCase().includes(needle) ?? false)
}
```

In `frontend/dispatcher/components/domain/ChecklistRow.tsx`:
- In `interface ColWidths`, rename `order:  number` to `manifest: number`.
- Add `import { manifestLabel } from '@/lib/format/manifest'`.
- Below `const hint = progressHint(trip)`, add `const manifest = manifestLabel(trip.pp_manifest, trip.trip_type ?? null)`.
- Replace the `{/* Order number */}` block (the `div` sized by `colWidths.order` that renders `{trip.order_number}`) with:

```tsx
      {/* PP manifest: the trip's external key since FP-281. title carries the whole label
          when the column truncates it. */}
      <div
        style={{ width: colWidths.manifest }}
        title={manifest}
        className="shrink-0 truncate px-[6px] text-[11px] tabular-nums tracking-[0.03em] text-on-surf-v"
      >
        {manifest}
      </div>
```

In `frontend/dispatcher/app/(app)/page.tsx`:
- In `COL_HEADERS`, replace `{ id: 'order',     label: 'ORDER'          },` with `{ id: 'manifest',  label: 'MANIFEST'       },`.
- In `INITIAL_COL_WIDTHS`, replace `order:     155,` with `manifest:  155,`.
- Add `import { matchesTripSearch } from '@/lib/trips/search'`.
- Replace the whole `filteredTrips` `useMemo` with:

```ts
  const filteredTrips = useMemo(
    () => allTrips.filter(t => matchesTripSearch(t, search)),
    [allTrips, search],
  )
```

- Change the search input's `placeholder` to `"Search trip ID, driver, or manifest…"`.

In `frontend/dispatcher/app/(app)/history/page.tsx`:
- Same `COL_HEADERS` and `INITIAL_COL_WIDTHS` edits as the dashboard.
- Change the search input's `placeholder` to `"Search trip ID, driver, or manifest number…"`. The backend `q` matches a manifest number exactly (piece A, `resource_service`).

In `frontend/dispatcher/app/(app)/trips/[id]/TripHeaderSummary.tsx`:
- Add `import { manifestLabel } from '@/lib/format/manifest'`.
- Below `const originShort = shortPrecinctLabel(origin)`, add `const manifest = manifestLabel(trip.pp_manifest, trip.trip_type)`.
- In the subtitle span, replace `{trip.order_number} · {originShort}` with `{manifest} · {originShort}`.
- Replace `<OverviewRow label="Order" value={trip.order_number} mono />` with `<OverviewRow label="Manifest" value={manifest} mono={trip.pp_manifest !== null} />`.

In `frontend/dispatcher/lib/phase/trip-detail.ts`:
- Add `import { manifestLabel } from '@/lib/format/manifest'`.
- In `interface TripHeaderFacts`, replace `  orderNumber: string` with:

```ts
  /** The PP manifest display, "Empty leg", or "No manifest" (lib/format/manifest.ts). */
  manifestLabel: string
```

- In `tripHeaderFacts`, replace `orderNumber: trip.order_number,` with `manifestLabel: manifestLabel(trip.pp_manifest, trip.trip_type),` and `orderNumber: seed.order_number,` with `manifestLabel: manifestLabel(seed.pp_manifest, seed.trip_type ?? null),`.

In `frontend/dispatcher/components/trips/TripSummary.tsx`, replace
`<p className="mt-1 text-xs text-on-surf-v">Order {facts.orderNumber}</p>` with
`<p className="mt-1 text-xs tabular-nums tracking-[0.03em] text-on-surf-v">{facts.manifestLabel}</p>`.

Dispatcher test fixtures:
- `app/(app)/history/page.test.tsx`, in `makeTrip`: replace `order_number: 'ORD-0001',` with `pp_manifest: null,`.
- `lib/hooks/useTripHistory.test.tsx`: in `makeItem`, replace `order_number: 'ORD-0001',` with `pp_manifest: null,`. The order numbers in that file are only markers telling pages apart, so move them to `trip_reference`: `makeItem({ order_number: 'PAGE-ONE' })` → `makeItem({ trip_reference: 'PAGE-ONE' })`, likewise `'OLD-FILTER'`, `'NEW'` and `'OLD'`, and `result.current.items[0]?.order_number` → `result.current.items[0]?.trip_reference`.

- [ ] **Step 6: Driver PWA — `trip_reference` is the only label**

In `frontend/driver-pwa/app/(app)/trips/page.tsx`, delete `    order_number: t.order_number,` from `demoTripsFor`.

In `frontend/driver-pwa/components/home/HomeContent.tsx`, delete the line
`          <p className="text-sm text-surface-on-variant">{trip.order_number}</p>`.
The `trip_reference` paragraph above it stays, and is now the block's only line.

In `frontend/driver-pwa/components/trip/TripTable.tsx`, replace the two order-number paragraphs (the phone-only `{trip.order_number} · {formatDeparture(…)}` line, the comment after it, and the tablet-only `{trip.order_number}` line) with:

```tsx
          {/* Phones only: from tablet width the departure has its own right-hand column. */}
          <p className="truncate text-xs leading-tight text-surface-on-variant sm:hidden">
            {formatDeparture(trip.planned_departure_at)}
          </p>
```

In `frontend/driver-pwa/components/trip/TripDetailView.tsx`, delete the `right={…}` prop of `<SubpageHeader>`, which rendered the order-number badge. `right` is optional on `SubpageHeader`, and the header title is already `trip.trip_reference`.

- [ ] **Step 7: Driver PWA fixtures**

Each `order_number:` line in these files builds either a `Trip` (shared type, which now needs `pp_manifest`) or a `DriverTripSummary` (which has neither field):

| File | Fixture type | Edit |
|---|---|---|
| `app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.test.tsx` | `Trip` | `order_number: 'ORD-1',` → `pp_manifest: null,` |
| `…/PhaseStepPageClient.anchoring.test.tsx` | `Trip` | same |
| `…/PhaseStepPageClient.tripgate.test.tsx` | `Trip` | same |
| `…/PhaseStepPageClient.autorefresh.test.tsx` | `Trip` | `order_number: 'ORD-AR-PAGE',` → `pp_manifest: null,` |
| `components/home/__tests__/HomeContent.test.tsx` | `Trip` | `order_number: 'ORD-99',` → `pp_manifest: null,` |
| `components/phase/steps/__tests__/linehaul.test.tsx` | `Trip` | `order_number: 'ORD-1',` → `pp_manifest: null,` |
| `components/trip/__tests__/TripDetailView.test.tsx` | `Trip` | `order_number: 'ORD-99',` → `pp_manifest: null,`, and delete `expect(screen.getByText('ORD-99')).toBeInTheDocument()`: the badge is gone, and the test's heading assertion still covers the reference |
| `lib/context/__tests__/TripContext.autorefresh.test.tsx` | `Trip` | `order_number: 'ORD-AR-1',` → `pp_manifest: null,` |
| `lib/utils/__tests__/trip-filters.test.ts` | `Trip` | `order_number: 'ORD-0001',` → `pp_manifest: null,` |
| `lib/submission/__tests__/phase-submitter.test.ts` | `Trip` | `order_number: 'ORD-1',` → `pp_manifest: null,` |
| `app/(app)/trips/__tests__/page.test.tsx` | `DriverTripSummary` | delete `order_number: 'ORD-0001',` |
| `components/trip/__tests__/TripTable.test.tsx` | `DriverTripSummary` | delete `order_number: 'ORD-0001',` |

- [ ] **Step 8: Run everything both apps check**

Run: `cd frontend/dispatcher && npm run type-check && npm run lint && npm test`
Expected: no errors. All suites pass, including the four new or changed test files from Step 1.

Run: `cd frontend/driver-pwa && npx tsc --noEmit && npm run lint && npm test`
Expected: no errors; all suites pass.

Run: `cd frontend && grep -rn "order_number\|orderNumber" --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out .`
Expected: no output.

- [ ] **Step 9: Stage**

```bash
git add frontend/shared/lib/types/trip.ts frontend/shared/lib/mocks/trips.ts \
  frontend/dispatcher/lib/format/manifest.ts frontend/dispatcher/lib/format/manifest.test.ts \
  frontend/dispatcher/lib/trips/search.ts frontend/dispatcher/lib/trips/search.test.ts \
  frontend/dispatcher/components/domain/ChecklistRow.tsx frontend/dispatcher/components/domain/__tests__/ChecklistRow.test.tsx \
  "frontend/dispatcher/app/(app)/page.tsx" "frontend/dispatcher/app/(app)/history/page.tsx" "frontend/dispatcher/app/(app)/history/page.test.tsx" \
  "frontend/dispatcher/app/(app)/trips/[id]/TripHeaderSummary.tsx" frontend/dispatcher/components/trips/TripSummary.tsx \
  frontend/dispatcher/lib/phase/trip-detail.ts frontend/dispatcher/lib/phase/trip-detail.test.ts frontend/dispatcher/lib/hooks/useTripHistory.test.tsx \
  frontend/driver-pwa/lib/types/driver-trip.ts "frontend/driver-pwa/app/(app)/trips/page.tsx" \
  frontend/driver-pwa/components/home/HomeContent.tsx frontend/driver-pwa/components/trip/TripTable.tsx frontend/driver-pwa/components/trip/TripDetailView.tsx \
  "frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.test.tsx" \
  "frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.anchoring.test.tsx" \
  "frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.tripgate.test.tsx" \
  "frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.autorefresh.test.tsx" \
  "frontend/driver-pwa/app/(app)/trips/__tests__/page.test.tsx" \
  frontend/driver-pwa/components/home/__tests__/HomeContent.test.tsx frontend/driver-pwa/components/phase/steps/__tests__/linehaul.test.tsx \
  frontend/driver-pwa/components/trip/__tests__/TripTable.test.tsx frontend/driver-pwa/components/trip/__tests__/TripDetailView.test.tsx \
  frontend/driver-pwa/lib/context/__tests__/TripContext.autorefresh.test.tsx frontend/driver-pwa/lib/utils/__tests__/trip-filters.test.ts \
  frontend/driver-pwa/lib/submission/__tests__/phase-submitter.test.ts
```
Suggested commits (two logical changes, so two commits — stage the driver files second if Ciaran wants them apart):
`feat(dispatcher): label trips by PP manifest instead of order number (FP-281)` and
`feat(driver-pwa): trip reference is the driver's only trip label (FP-281)`

---

### Task 8: The manifest panel shows the H0 snapshot (D1)

**Files:**
- Modify: `frontend/shared/lib/types/pp-manifest.ts` (snapshot types), `frontend/shared/lib/types/manifest.ts`, `frontend/shared/lib/mocks/manifests.ts`
- Create: `frontend/dispatcher/lib/trips/manifest-snapshot.ts`, `frontend/dispatcher/lib/trips/__fixtures__/snapshot.ts`
- Create: `frontend/dispatcher/components/domain/ManifestSnapshot.tsx`
- Modify: `frontend/dispatcher/components/domain/ManifestContent.tsx`
- Test: `frontend/dispatcher/lib/trips/manifest-snapshot.test.ts`, `frontend/dispatcher/components/domain/__tests__/ManifestContent.test.tsx` (both create)

**Interfaces:**
- Consumes: piece A's `ManifestResponse.pp_manifest_snapshot` (the dispatcher branch of `GET /trips/{id}/manifest`). Its shape is `orchestration/pp_manifest.py::manifest_snapshot()`, with each waybill in `consignment_service.serialise_waybill()`'s shape.
- Produces: `PPManifestSnapshot`, `PPManifestSnapshotHeader`, `PPManifestSnapshotNote`, `PPManifestSnapshotWaybill` in `@shared/lib/types/pp-manifest`; `Manifest.pp_manifest_snapshot: PPManifestSnapshot | null`; `SnapshotLine {waybill, destinationTown, parcels, weightKg}`, `SnapshotTotals {waybills, parcels, weightKg}`, `snapshotLines(snapshot)`, `snapshotTotals(lines)` in `@/lib/trips/manifest-snapshot`; `ManifestSnapshot({snapshot, variant: 'only-record' | 'reference'})`; test-only `makeSnapshot()`.

- [ ] **Step 1: Add the snapshot types**

Append to `frontend/shared/lib/types/pp-manifest.ts`:

```ts
// ── The H0 snapshot ───────────────────────────────────────────────────────────
// The PP manifest as it stood at creation, stored on the trip's trip_creation phase row and
// hashed into the journey lock (spec §7.3, §9). Served only on the dispatcher's
// GET /trips/{id}/manifest. Mirrors orchestration/pp_manifest.py manifest_snapshot(); each
// waybill is the shape consignment sync stores (serialise_waybill). Only the fields the
// panel reads are typed. The stored JSON carries more, including receiver contact details,
// which is one more reason it never reaches the driver.

export interface PPManifestSnapshotNote {
  noted_at: string | null
  operator: string
  text: string
}

export interface PPManifestSnapshotHeader {
  manifest_number: number
  issuer_account: string
  issuer_name: string
  origin_hub: string
  destination_hub: string
  created_at: string | null
  closed_at: string | null
  planned_departure_at: string | null
  expected_arrival_at: string | null
  client_reference: string | null
  notes: PPManifestSnapshotNote[]
}

export interface PPManifestSnapshotWaybill {
  details: {
    waybill: string
    dest_town: string
    actual_weight_kg: number | null
  }
  /** One entry per parcel: the parcel count the backend's totals also use. */
  tracks: { trackno: string }[]
}

export interface PPManifestSnapshot {
  header: PPManifestSnapshotHeader
  waybills: PPManifestSnapshotWaybill[]
}
```

In `frontend/shared/lib/types/manifest.ts`:
- Add at the top: `import type { PPManifestSnapshot } from './pp-manifest'`.
- In `interface Manifest`, after `pulled_at: string`, add:

```ts
  // The PP manifest as locked at creation (H0, FP-281), or null on trips without one. Never
  // refreshed: later Parcel Perfect changes show in `consignments`, not here (spec §10.6).
  pp_manifest_snapshot: PPManifestSnapshot | null
```

In `frontend/shared/lib/mocks/manifests.ts`, add `  pp_manifest_snapshot: null,` after the `pulled_at:` line of each of `mockManifest0041`, `mockManifest0042` and `mockManifest0040`.

- [ ] **Step 2: Create the snapshot fixture**

Create `frontend/dispatcher/lib/trips/__fixtures__/snapshot.ts`:

```ts
// Test-only H0 snapshot, shaped like orchestration/pp_manifest.py manifest_snapshot().
// Two waybills, three parcels, 180.5 kg.
import type { PPManifestSnapshot } from '@shared/lib/types/pp-manifest'

export function makeSnapshot(): PPManifestSnapshot {
  return {
    header: {
      manifest_number: 81,
      issuer_account: 'MOCK01',
      issuer_name: 'CGY Logistics',
      origin_hub: 'CPT',
      destination_hub: 'JNB',
      created_at: '2026-10-02T08:00:00+00:00',
      closed_at: '2026-10-02T14:00:00+00:00',
      planned_departure_at: '2026-10-02T16:00:00+00:00',
      expected_arrival_at: '2026-10-03T04:00:00+00:00',
      client_reference: 'PO-CGY-0081',
      notes: [{ noted_at: '2026-10-02T14:25:00+00:00', operator: 'CGY Dispatch', text: 'Kaapstad → Gauteng' }],
    },
    waybills: [
      {
        details: { waybill: 'MFTWB8101', dest_town: 'Johannesburg', actual_weight_kg: 120 },
        tracks: [{ trackno: 'MFTWB81010001' }, { trackno: 'MFTWB81010002' }],
      },
      {
        details: { waybill: 'MFTWB8102', dest_town: 'Midrand', actual_weight_kg: 60.5 },
        tracks: [{ trackno: 'MFTWB81020001' }],
      },
    ],
  }
}
```

- [ ] **Step 3: Write the failing tests**

Create `frontend/dispatcher/lib/trips/manifest-snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { snapshotLines, snapshotTotals } from './manifest-snapshot'
import { makeSnapshot } from './__fixtures__/snapshot'

describe('snapshotLines', () => {
  it('makes one line per waybill, counting parcels from tracks', () => {
    expect(snapshotLines(makeSnapshot())).toEqual([
      { waybill: 'MFTWB8101', destinationTown: 'Johannesburg', parcels: 2, weightKg: 120 },
      { waybill: 'MFTWB8102', destinationTown: 'Midrand', parcels: 1, weightKg: 60.5 },
    ])
  })
})

describe('snapshotTotals', () => {
  it('totals like the backend: weight rounded to two decimals, a missing weight as zero', () => {
    expect(snapshotTotals([
      { waybill: 'A', destinationTown: 'X', parcels: 2, weightKg: 0.1 },
      { waybill: 'B', destinationTown: 'Y', parcels: 1, weightKg: 0.2 },
      { waybill: 'C', destinationTown: 'Z', parcels: 4, weightKg: null },
    ])).toEqual({ waybills: 3, parcels: 7, weightKg: 0.3 })
  })
})
```

Create `frontend/dispatcher/components/domain/__tests__/ManifestContent.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/hooks/useManifest', () => ({ useManifest: vi.fn() }))

import { ManifestContent } from '../ManifestContent'
import { useManifest, type UseManifestResult } from '@/lib/hooks/useManifest'
import { makeSnapshot } from '@/lib/trips/__fixtures__/snapshot'
import { mockManifest0041 } from '@shared/lib/mocks/manifests'
import type { Manifest } from '@shared/lib/types/manifest'

function loaded(manifest: Manifest): UseManifestResult {
  return {
    manifest, isLoading: false, isValidating: false, error: null, errorStatus: null,
    lastUpdated: Date.parse('2026-10-02T10:00:00Z'), refetch: vi.fn(), refetchSilent: vi.fn(),
  }
}

// What piece A returns for a cancelled trip whose waybills moved to its replacement.
const MOVED: Manifest = {
  trip_id: 'trip-cancelled',
  total_parcel_count: 0,
  origin_scan_complete: false,
  consignments: [],
  pulled_at: '2026-10-02T09:00:00Z',
  pp_manifest_snapshot: makeSnapshot(),
}

describe('ManifestContent and the H0 snapshot', () => {
  it('shows the snapshot as the only record when the waybills moved', () => {
    vi.mocked(useManifest).mockReturnValue(loaded(MOVED))

    render(<ManifestContent tripId="trip-cancelled" />)

    const record = screen.getByRole('region', { name: 'Manifest at creation' })
    expect(record).toHaveTextContent('moved to the trip that replaced it')
    expect(record).toHaveTextContent('2 waybills · 3 parcels · 180.5 kg')
    expect(screen.getByText('MFTWB8101')).toBeInTheDocument()
    expect(screen.queryByText('This manifest contains no consignments.')).not.toBeInTheDocument()
  })

  it('keeps the live list and adds the snapshot, collapsed, while cargo is on the trip', () => {
    vi.mocked(useManifest).mockReturnValue(loaded({ ...mockManifest0041, pp_manifest_snapshot: makeSnapshot() }))

    render(<ManifestContent tripId={mockManifest0041.trip_id} />)

    expect(screen.getByText('Manifest at creation · 2 waybills · 3 parcels')).toBeInTheDocument()
    expect(screen.getByText(mockManifest0041.consignments[0].parcel_perfect_reference)).toBeInTheDocument()
  })

  it('changes nothing for a trip without a snapshot', () => {
    vi.mocked(useManifest).mockReturnValue(loaded({ ...MOVED, pp_manifest_snapshot: null }))

    render(<ManifestContent tripId="trip-empty-leg" />)

    expect(screen.getByText('This manifest contains no consignments.')).toBeInTheDocument()
    expect(screen.queryByText(/Manifest at creation/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run lib/trips/manifest-snapshot.test.ts components/domain/__tests__/ManifestContent.test.tsx`
Expected: FAIL. `./manifest-snapshot` cannot be resolved, and the moved trip renders "This manifest contains no consignments."

- [ ] **Step 5: Create the snapshot helpers**

Create `frontend/dispatcher/lib/trips/manifest-snapshot.ts`:

```ts
// Reads the H0 snapshot (FP-281 §7.3) into what the manifest panel shows. Pure.
import type { PPManifestSnapshot } from '@shared/lib/types/pp-manifest'

// pp_manifest.manifest_totals rounds weight to two decimals; match it so the panel's
// creation-time total equals the one the preview showed.
const WEIGHT_DECIMALS = 2

export interface SnapshotLine {
  waybill: string
  destinationTown: string
  parcels: number
  weightKg: number | null
}

export interface SnapshotTotals {
  waybills: number
  parcels: number
  weightKg: number
}

/** One line per waybill as locked at creation. Parcels count tracks[], the same figure
 *  consignment sync stores as expected. */
export function snapshotLines(snapshot: PPManifestSnapshot): SnapshotLine[] {
  return snapshot.waybills.map(waybill => ({
    waybill: waybill.details.waybill,
    destinationTown: waybill.details.dest_town,
    parcels: waybill.tracks.length,
    weightKg: waybill.details.actual_weight_kg,
  }))
}

export function snapshotTotals(lines: readonly SnapshotLine[]): SnapshotTotals {
  const factor = 10 ** WEIGHT_DECIMALS
  const weight = lines.reduce((sum, line) => sum + (line.weightKg ?? 0), 0)
  return {
    waybills: lines.length,
    parcels: lines.reduce((sum, line) => sum + line.parcels, 0),
    weightKg: Math.round(weight * factor) / factor,
  }
}
```

- [ ] **Step 6: Create `ManifestSnapshot`**

Create `frontend/dispatcher/components/domain/ManifestSnapshot.tsx`:

```tsx
'use client'

import { snapshotLines, snapshotTotals } from '@/lib/trips/manifest-snapshot'
import type { PPManifestSnapshot } from '@shared/lib/types/pp-manifest'

export interface ManifestSnapshotProps {
  snapshot: PPManifestSnapshot
  /** only-record: a cancelled trip whose waybills moved, so this is all there is.
   *  reference: collapsed beside the live list, for comparison. */
  variant: 'only-record' | 'reference'
}

/** The PP manifest as locked into the journey hash at creation (H0, spec §7.3). Later
 *  Parcel Perfect changes never alter it (§10.6). */
export function ManifestSnapshot({ snapshot, variant }: ManifestSnapshotProps): React.JSX.Element {
  const lines = snapshotLines(snapshot)
  const totals = snapshotTotals(lines)
  const { header } = snapshot

  const body = (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <Fact label="Manifest" value={`${header.origin_hub} ${header.manifest_number} · ${header.issuer_name}`} />
        <Fact label="Route" value={`${header.origin_hub} → ${header.destination_hub}`} />
        <Fact label="Client reference" value={header.client_reference ?? 'None on the manifest'} />
        <Fact label="At creation" value={`${totals.waybills} waybills · ${totals.parcels} parcels · ${totals.weightKg} kg`} />
      </dl>
      <ul aria-label="Waybills at creation">
        {lines.map(line => (
          <li key={line.waybill} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-outline-v/10 py-2 text-xs">
            <span className="min-w-0 flex-1 break-all font-semibold tabular-nums tracking-[0.03em]">{line.waybill}</span>
            <span className="text-on-surf-v">{line.destinationTown}</span>
            <span className="tabular-nums">
              {line.parcels} parcels{line.weightKg !== null ? ` · ${line.weightKg} kg` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )

  if (variant === 'only-record') {
    return (
      <section aria-label="Manifest at creation" className="min-w-0 space-y-3 rounded-md bg-surf-lowest p-3 text-on-surf">
        <h3 className="text-xs font-bold uppercase tracking-wide text-on-surf-v">Manifest at creation</h3>
        <p className="text-xs leading-relaxed text-on-surf-v">
          No waybills are on this trip any more: after it was cancelled they moved to the trip that replaced
          it. This is the Parcel Perfect manifest as it was locked into the journey hash at creation.
        </p>
        {body}
      </section>
    )
  }

  return (
    <details className="rounded-md bg-surf-lowest p-3 text-on-surf shadow-level-2">
      <summary className="cursor-pointer text-xs font-semibold">
        Manifest at creation · {totals.waybills} waybills · {totals.parcels} parcels
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-on-surf-v">
        The Parcel Perfect manifest as locked into the journey hash. Later Parcel Perfect changes show in the
        list above, not here.
      </p>
      <div className="mt-3">{body}</div>
    </details>
  )
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-on-surf-v">{label}</dt>
      <dd className="mt-1 break-words font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
```

- [ ] **Step 7: Use it in `ManifestContent`**

In `frontend/dispatcher/components/domain/ManifestContent.tsx`:
- Add `import { ManifestSnapshot } from './ManifestSnapshot'`.
- Directly after the closing brace of the `if (!manifest) { … }` block, add:

```tsx
  // A cancelled trip whose waybills moved to the trip that replaced it (spec §10.5) has no
  // consignment rows left. The H0 snapshot is then its only cargo record, and "no
  // consignments" would be a false statement about the trip.
  if (manifest.consignments.length === 0 && manifest.pp_manifest_snapshot) {
    return <ManifestSnapshot snapshot={manifest.pp_manifest_snapshot} variant="only-record" />
  }
```

- In the main `return`, between the consignment list expression (`{visible.length === 0 ? … : (…)}`) and the footer `<div className="border-t border-outline-v/20 pt-3 text-xs text-on-surf-v">`, add:

```tsx
      {manifest.pp_manifest_snapshot && (
        <ManifestSnapshot snapshot={manifest.pp_manifest_snapshot} variant="reference" />
      )}
```

No change to `useManifest`, `useTripResource` or the backend (D1: the per-event refetch is accepted).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run lib/trips/manifest-snapshot.test.ts components/domain/__tests__/ManifestContent.test.tsx`
Expected: all pass.

Run: `cd frontend/dispatcher && npm run type-check && npm run lint && npm test`
Expected: no errors. Every suite passes (`useTripResource.test.tsx` builds its manifests through the hook, not the type, so it is unaffected).

Run: `cd frontend/driver-pwa && npx tsc --noEmit`
Expected: no errors. The driver uses `Linehaul`, not `Manifest`.

- [ ] **Step 9: Stage**

```bash
git add frontend/shared/lib/types/pp-manifest.ts frontend/shared/lib/types/manifest.ts frontend/shared/lib/mocks/manifests.ts frontend/dispatcher/lib/trips/manifest-snapshot.ts frontend/dispatcher/lib/trips/manifest-snapshot.test.ts frontend/dispatcher/lib/trips/__fixtures__/snapshot.ts frontend/dispatcher/components/domain/ManifestSnapshot.tsx frontend/dispatcher/components/domain/ManifestContent.tsx frontend/dispatcher/components/domain/__tests__/ManifestContent.test.tsx
```
Suggested commit: `feat(dispatcher): manifest panel shows the manifest as locked at creation (FP-281)`

---

### Task 9: Backend — remove the wizard-era manifest readers

**Files:**
- Modify: `backend/app/integrations/parcel_perfect.py` (remove `get_waybills_by_manifest` from both clients)
- Modify: `backend/app/orchestration/pp_lookup_service.py` (remove `get_manifest_summaries`)
- Modify: `backend/app/api/v1/endpoints/pp.py` (remove `GET /pp/manifests/{manifest_number}`)
- Modify tests: `backend/tests/unit/test_pp_mock.py`, `backend/tests/unit/test_pp_manifest_mock.py`, `backend/tests/integration/test_pp_endpoints.py`

**Interfaces:**
- Consumes: nothing new. Precondition: Task 6 has replaced the only caller (the old wizard's `fetchManifest`). Step 1's grep proves it.
- Produces: `get_manifest` is the one manifest reader in `integrations/`, and `GET /trips/pp-manifest-preview` the one manifest route. `supports_manifest_lookup`, `GET /pp/capabilities` and `GET /pp/waybills/{ref}` stay (Question 5).

- [ ] **Step 1: Prove nothing calls them**

Run: `grep -rn "pp/manifests\|get_waybills_by_manifest\|get_manifest_summaries" frontend --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next`
Expected: no output. If the old wizard's `fetchManifest` still appears, Task 6 is not done: stop.

- [ ] **Step 2: Write the failing tests**

In `backend/tests/integration/test_pp_endpoints.py`, replace `test_get_manifest_returns_all_waybills_on_manifest` with:

```python
async def test_legacy_manifest_route_is_gone(client: AsyncClient, seed_dispatcher):
    # FP-281: GET /trips/pp-manifest-preview is the one manifest reader. The wizard-era
    # waybill list must not survive as a second door to the same data, one that carries
    # none of the preview's warnings.
    user, org = seed_dispatcher
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    resp = await client.get("/api/v1/pp/manifests/69", headers=auth_header(token))

    assert resp.status_code == 404
```

In `backend/tests/unit/test_pp_mock.py`:
- Delete `test_manifest_lookup_groups_fixtures`, `test_manifest_lookup_unknown_number_returns_empty` and `test_real_client_manifest_lookup_unsupported`. Their `get_manifest` equivalents live in `test_pp_manifest_mock.py`; manifest 69's grouping moves there below.
- Delete `PPUnsupportedError` from the import list (no remaining use).
- Add:

```python
def test_clients_have_one_manifest_reader():
    # FP-281 piece B: get_manifest replaced the wizard-era get_waybills_by_manifest.
    assert not hasattr(MockParcelPerfectClient, "get_waybills_by_manifest")
    assert not hasattr(ParcelPerfectClient, "get_waybills_by_manifest")
```

In `backend/tests/unit/test_pp_manifest_mock.py`, replace `test_both_manifest_readers_apply_staged_membership_and_cargo` with the two tests below. The staged-override path stays covered through `get_manifest`, its only reader now:

```python
async def test_get_manifest_applies_staged_membership_and_cargo(
    store: FakeMockStateStore, today: date,
) -> None:
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("MFTWB8201", manifest=MANIFEST_HAPPY_PATH, parcel_count=2)
    await client.stage_waybill_override("MFTWB8101", manifest=MANIFEST_OPEN_NO_TIMES)

    happy = await client.get_manifest(MANIFEST_HAPPY_PATH)
    open_no_times = await client.get_manifest(MANIFEST_OPEN_NO_TIMES)

    happy_refs = [w.details.waybill for w in happy.waybills]
    open_refs = [w.details.waybill for w in open_no_times.waybills]
    assert "MFTWB8201" in happy_refs and "MFTWB8201" not in open_refs
    assert "MFTWB8101" in open_refs and "MFTWB8101" not in happy_refs
    fresh = await client.get_single_waybill("MFTWB8201")
    assert len(fresh.tracks) == 2
    assert fresh in happy.waybills


async def test_manifest_69_holds_its_four_fixture_waybills(store: FakeMockStateStore, today: date) -> None:
    manifest = await MockParcelPerfectClient().get_manifest(69)

    assert [w.details.waybill for w in manifest.waybills] == ["MOCKWAY001", "WAY001", "WAY002", "WAY003"]
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_pp_mock.py tests/unit/test_pp_manifest_mock.py tests/integration/test_pp_endpoints.py -v`
Expected: `test_clients_have_one_manifest_reader` and `test_legacy_manifest_route_is_gone` FAIL (the method exists, and the route returns 200). The rest pass.

- [ ] **Step 4: Remove the code**

In `backend/app/integrations/parcel_perfect.py`:
- Delete `MockParcelPerfectClient.get_waybills_by_manifest` (the method whose docstring begins "Legacy mock-only wizard read, retained until Piece B replaces its caller").
- Delete `ParcelPerfectClient.get_waybills_by_manifest` (the method raising "PP v28 exposes no manifest-contents endpoint").
- Keep `_waybills_with_overrides`: `get_manifest` uses it.

In `backend/app/orchestration/pp_lookup_service.py`, delete `get_manifest_summaries`.

In `backend/app/api/v1/endpoints/pp.py`:
- Delete the `get_manifest_endpoint` route (`@router.get("/manifests/{manifest_number}", …)` and its function).
- Delete `_MANIFEST_UNSUPPORTED_DETAIL` and the comment above it.
- Change the import to `from app.integrations.parcel_perfect import PPWaybillNotFoundError`.
- Replace the comment above `get_waybill_endpoint` ("Both lookups below reach out to Parcel Perfect…") with:

```python
# Reaches out to Parcel Perfect, whose quota is a partner resource we neither own nor pay
# for: an unbounded loop here abuses someone else's system as much as ours. Budgeted like
# the manifest preview (PP_LOOKUP).
```

- [ ] **Step 5: Run the tests to verify they pass, then lint and type-check**

Run: `cd backend && pytest tests/unit/test_pp_mock.py tests/unit/test_pp_manifest_mock.py tests/integration/test_pp_endpoints.py -v`
Expected: all pass.

Run: `cd backend && ruff check app tests && mypy .`
Expected: no errors (CI runs both).

Run: `grep -rn "get_waybills_by_manifest\|get_manifest_summaries\|pp/manifests" backend/app backend/tests backend/scripts`
Expected: only `test_clients_have_one_manifest_reader` and `test_legacy_manifest_route_is_gone`.

- [ ] **Step 6: Stage**

```bash
git add backend/app/integrations/parcel_perfect.py backend/app/orchestration/pp_lookup_service.py backend/app/api/v1/endpoints/pp.py backend/tests/unit/test_pp_mock.py backend/tests/unit/test_pp_manifest_mock.py backend/tests/integration/test_pp_endpoints.py
```
Suggested commit: `refactor(integrations): remove the wizard-era PP manifest readers (FP-281)`

---

### Task 10: Docs — v7, db-models, glossary, API contract, walkthrough

**Files:**
- Modify: `docs/FreightProof_Full_Picture_v7.md`
- Modify: `docs/db-models.md`
- Modify: `docs/glossary.md`
- Modify: `backend/docs/api_contract_dispatcher_driver.md`
- Modify: `docs/demo-script.md` (the "Demo Script & Walkthrough")

**Interfaces:** none (documentation). Every statement must match the code as merged (piece A plus Tasks 1–9). Where a doc is marked historical (`db-models.md`, the API contract), keep the banner, add a dated FP-281 note under it, and change only what FP-281 changed.

- [ ] **Step 1: v7 — the trip is created from the manifest**

In `docs/FreightProof_Full_Picture_v7.md`:

1. **§3.1 Dispatcher**: in the paragraph beginning "Critically, the dispatcher still uses Pulsit…", replace the text from "FreightProof adds a trip creation step" to the end of the paragraph with:

   > FreightProof adds a trip creation step, designed as selection and confirmation rather than re-entry of data. The dispatcher types the client's Parcel Perfect manifest number. FreightProof pulls the client, the route, the planned times and every waybill and parcel from the manifest. The dispatcher adds only the driver, horse and trailers, plus a precinct or a time on the rare occasion the manifest lacks one. A repositioning move with no cargo is created as an empty leg.

2. **§4 handshake table, row 0**: replace the "What gets captured" cell with:

   > Dispatcher creates the trip from the client's Parcel Perfect manifest number. Client, route, planned times and every waybill and parcel come from the manifest; driver, horse and trailer(s) are LFG's choice. The manifest key, a hash of the manifest snapshot and the planned times are locked in a journey hash anchored to blockchain.

3. **Handshake 0 — Trip Creation**: replace everything from "Bruce was explicit: \"the journey actually starts by virtue of an order.\"" down to and including the bullet "- Planned route and slot times (pulled from Parcel Perfect)" with:

   ```markdown
   Every booking reaches Load Factor on the day: the client creates the manifest in Parcel Perfect around 12:00, and LFG confirms the vehicle then (Bruce, 28 Jul §8–9). The **manifest** is the whole load for one departure, and LFG's Master Waybill references the client's manifest number (5 May §4.1, 28 Jul §5). A FreightProof trip is that Master Waybill made digital: one departure, pointing at one client manifest.

   The dispatcher opens FreightProof and types the manifest number. FreightProof pulls the manifest from Parcel Perfect once, at creation, and shows what it found: the client, the route, the planned times, every waybill and parcel, and anything that blocks creation (for example, the manifest already being on another trip).

   What comes from the manifest:

   - The client, the origin and destination hubs (resolved to the client's precincts), the planned departure and arrival, every waybill and its parcels, and the client's own reference where the manifest carries one

   What the dispatcher enters:

   - Assigned driver (from Load Factor's registered driver list)
   - Assigned horse (truck cab) and trailer(s), each with its own Pulsit tracker device ID
   - A precinct, only where a manifest hub is not linked to one; planned times, only where the manifest has none

   Driver and vehicles are never taken from the manifest: they are LFG's decision, and the client's copy of them is usually not there yet at 12:00. A trip with no cargo (a repositioning move) is created as an **empty leg**, with origin, destination and times entered by hand. Loading priority per consignment and the Pulsit trip reference remain part of the target design, but the current build does not capture them at creation.

   > **Assumed contract.** Parcel Perfect's API has no manifest lookup today; it exposes `getSingleWaybill` only. The manifest pull runs against a mocked, assumed data contract. Against live Parcel Perfect the screen says so and offers an empty leg instead.
   ```

4. In the journey-lock paragraph that follows ("On submission, FreightProof creates a journey lock hash…"), replace "(order number, driver, vehicles, cargo references, route, precinct gates, timestamps)" with "(the manifest key, a SHA-256 of the manifest as pulled, driver, vehicles, route, planned times and timestamps — hashes and identifiers only, never the manifest itself)".

5. **§6.2**: replace "client, order number, and exception type" with "client, Parcel Perfect manifest number, and exception type".

6. **§7 table**: replace "Trip creation and driver/vehicle/cargo assignment tied to an order number" with "Trip creation from the client's Parcel Perfect manifest, with driver and vehicle assignment".

7. **§8.1 table**: insert as the first data row:

   ```markdown
   | The client's manifest: header (client, hubs, planned times, client reference, notes) and every waybill with its parcels | Trip creation: the trip is built from it, and a snapshot of it is locked into the journey hash (assumed contract; see Handshake 0) |
   ```

8. **§15**: insert before "## 15.1 v6 → v7 changes":

   ```markdown
   ## 15.0 v7 amendment — manifest-first trip creation (FP-281, 1 October 2026)

   | Section affected | Change type | What changed |
   |---|---|---|
   | §3.1, Handshake 0, §4 table, §6.2, §7, §8.1 | **Replace** | Trips are created from the client's Parcel Perfect manifest number; the order number is no longer the trip's root reference and is removed from the system. The journey lock covers the manifest key, a hash of the manifest snapshot and the planned times. Empty legs are created without a manifest. Manifest lookup runs on a mocked, assumed contract: live PP has none. Design: `docs/superpowers/specs/2026-09-30-manifest-first-trip-creation-design.md`. |
   ```

   Leave the "Order as root entity" row in the older change tables (§15.4/§15.5) untouched: it records an earlier decision, and §15.0 supersedes it.

- [ ] **Step 2: db-models — the manifest columns**

In `docs/db-models.md`:
- Under the "Historical, non-authoritative reference" banner, add:

  > **Partially updated 2026-10-01 (FP-281):** the `trips` and `precincts` tables below show the PP manifest columns, and the `parcel_manifest_snapshot` row notes its use. Everything else is still the May 2026 record.

- `precincts` table: after the `geofence_radius_metres` row, add
  `| \`pp_hub_code\` | String(10) | nullable; the PP hub this precinct stands for (e.g. \`JNB\`). Unique per principal where set (FP-281) |`
- `trips` table: replace the `order_number` row with
  `| \`order_number\` | String(100) | **nullable and no longer written** (FP-281). Dropped by a later clean-up migration |`
  and add after it:

  ```markdown
  | `pp_manifest_issuer_account` | String(6) | nullable; PP account of the client that issued the manifest (FP-281) |
  | `pp_manifest_origin_hub` | String(10) | nullable; PP hub the manifest leaves from |
  | `pp_manifest_number` | Integer | nullable. The three manifest columns are all set or all null (`ck_trips_pp_manifest_all_or_none`) |
  ```

- Replace the `trips` **Indexes** line with:
  `**Indexes:** \`(driver_id)\`, \`(status)\`, \`(order_number)\` (until the clean-up migration), \`(created_at DESC)\`, and unique \`uq_trips_pp_manifest\` on \`(operator_organization_id, pp_manifest_issuer_account, pp_manifest_origin_hub, pp_manifest_number) WHERE status <> 'cancelled'\`: one non-cancelled trip per manifest.`
- Append to the **Journey lock** note: " Since FP-281 the lock is a fixed key set covering the manifest key, the SHA-256 of the H0 manifest snapshot and the planned times; the order number is no longer in it."
- In the `parcel_manifest_snapshot` row, append to the notes: "Written since FP-281 on the trip-creation (H0) row only: the PP manifest as pulled at creation. Dispatcher-only."

- [ ] **Step 3: Glossary — PP manifest versus the cargo listing**

In `docs/glossary.md`:
- Append to the **Status** line: " · updated 2026-10-01 (FP-281)".
- In the §1 term map, replace the **Manifest** row with these four rows:

  ```markdown
  | **PP manifest** | The client's Parcel Perfect manifest: the whole load for **one departure**, created by the client around 12:00 on the day. LFG's Master Waybill references its number. A trip is created from one (FP-281). Goes **ops-to-ops, never to the driver** (theft risk). | `Trip.pp_manifest_*` key; snapshot on the H0 `PhaseEvent.parcel_manifest_snapshot` (dispatcher-only) | one per trip, or none (empty leg) | **High** |
  | **Manifest (cargo listing)** | In code, "manifest" also names the trip's live cargo listing: `manifest_service`, `GET /trips/{id}/manifest`, `ManifestPanel`. The `pp_manifest_*` prefix keeps the two apart. | `Consignment.pp_raw_json` / `Parcel` rows (dispatcher-only) | — | **High** |
  | **Empty leg** | A repositioning trip with no cargo and therefore no manifest. | `Trip.trip_type = empty_leg`, `pp_manifest_*` null | — | **High** |
  | **Order number** | **Removed (FP-281).** Nothing in PP reliably supplied it, and the PP manifest replaced it as the trip's external key. FreightProof's own identifier is `trip_reference`. | `Trip.order_number`: nullable, never written, dropped in a clean-up migration | — | **High** |
  ```

- [ ] **Step 4: API contract — current trip-creation routes**

In `backend/docs/api_contract_dispatcher_driver.md`:
- Under the "Historical, non-authoritative reference" banner, add:

  > **FP-281 (2026-10-01):** §3.2 and §3.3 below describe the current trip-creation and manifest routes. `order_number` is gone from every trip schema; trip reads carry `pp_manifest: {issuer_account, origin_hub, number, display} | null` instead. The wizard-era `GET /api/v1/pp/manifests/{n}` is removed.

- §3.2 `GET /api/v1/trips`: replace the **Query params** value with "`status` (repeatable, any `TripStatus`), `pp_manifest_number` (int, exact match: the retry lookup after a create timeout, FP-281 §10.4)".
- §3.2 `POST /api/v1/trips`: replace the **Errors** value with "422 if validation fails. There is no duplicate key since FP-281 removed the order number; this path serves empty legs, multi-stop trips, seeds and tests", and the **Request body** value with "`TripCreateRequest` (no `order_number`)".
- Insert after the `POST /api/v1/trips` block:

  ```markdown
  #### `GET /api/v1/trips/pp-manifest-preview?manifest_number={n}` (FP-281)
  Read-only preview of a client's PP manifest before its trip is created.

  | Field | Value |
  |---|---|
  | Auth | Dispatcher JWT |
  | Tags | `["trips"]` |
  | Response 200 | `PPManifestPreviewResponse` (`schemas/pp_manifest.py`): `pp_manifest` (key + display), `snapshot_sha256`, client, origin/destination hub → precinct, planned times, closed flag, client reference, notes, totals, waybill lines, `warnings[]`, `can_create` |
  | Warnings | Blocking: `MANIFEST_ALREADY_ON_TRIP`, `CLIENT_NOT_LINKED`, `WAYBILL_CLIENT_MISMATCH`, `WAYBILL_ON_OTHER_TRIP`, `NO_WAYBILLS`. Prompts: `ORIGIN_HUB_UNLINKED`, `DESTINATION_HUB_UNLINKED`, `NO_PLANNED_TIMES`, `MANIFEST_NOT_CLOSED`. A holder trip in another organisation is reported with `trip_id` and `trip_reference` null |
  | Errors | 404 manifest not found · 501 live PP has no manifest lookup · 502 PP unreachable |

  #### `POST /api/v1/trips/from-pp-manifest` (FP-281)
  Creates a loaded trip from a PP manifest, in one transaction, fail-closed.

  | Field | Value |
  |---|---|
  | Auth | Dispatcher JWT |
  | Tags | `["trips"]` |
  | Request body | `TripFromPPManifestRequest`: `manifest_number`, `expected_snapshot_sha256` (from the preview), `driver_id`, `horse_id`, `trailer_ids`; optional `planned_departure_at` / `planned_arrival_at` (zone required; they override the manifest's); optional `origin_precinct_id` / `destination_precinct_id` (read only for an unlinked hub). Cargo is never accepted from the client |
  | Response 201 | `TripDetailResponse` |
  | Errors | 409 `{code: "MANIFEST_ALREADY_ON_TRIP", message, trip_id, trip_reference}` · 409 `{code: "MANIFEST_CHANGED", message, preview}` · 409 string (a waybill on another live trip, or scanned on a cancelled one) · 422 `{code, message}` (`CLIENT_NOT_LINKED`, `WAYBILL_CLIENT_MISMATCH`, `NO_WAYBILLS`, `PRECINCT_REQUIRED`, `PRECINCT_NOT_AVAILABLE`, `SAME_PRECINCT`, `NO_PLANNED_DEPARTURE`, `SCHEDULE_INVALID`) · 404 · 501 · 502/504 (PP or Hedera: the trip rolls back) |
  | Side effects | Trip, consignments and parcels from the manifest's own waybills, stops, phase plan, H0 snapshot, journey lock anchored to Hedera HCS |
  ```

- §3.3 `GET /api/v1/trips/{trip_id}/manifest`: add a table row
  `| Dispatcher extra (FP-281) | \`pp_manifest_snapshot\`: the PP manifest as locked at creation, or null. Dispatcher branch only. A cancelled trip whose waybills moved returns \`consignments: []\` with the snapshot instead of 404 |`
- §4.1 and §4.2 code blocks: replace each `    order_number: str` with `    pp_manifest: Optional[PPManifestRef] = None  # FP-281: replaces order_number`.

- [ ] **Step 5: Walkthrough — the demo creates the trip from a manifest**

In `docs/demo-script.md`:
- §1 table, add a row:
  `| **Re-seed after the FP-281 migration** | \`scripts/seed_demo.py\` sets each demo precinct's PP hub code. Without it, every manifest shows its hubs as unlinked and asks for both precincts. |`
- §2 step 1: replace the four lines under "**1. Create the trip — dispatcher.**" (from "One origin, one destination…" to "…merely discouraged.") with:

  ```markdown
  Type manifest **81** and look it up. FreightProof pulls the client, the route, the planned times and both
  waybills from (mocked) Parcel Perfect and shows them. Pick the driver, horse and trailer, and create.
  Point out what the dispatcher did **not** type: client, route, times, cargo. The screen still requires a
  departure (from the manifest, or entered when the manifest has none), so a trip that could never be
  activated stays unrepresentable.

  Optional, to show the guards: look up **70** (a mixed-client manifest is refused), **82** (the 12:00 case:
  no times yet, so the dispatcher enters them), or look up 81, stage a header change with
  `POST /api/v1/dev/pp/manifest {"manifest_number": 81, "closed": false}`, and press Create. The screen
  refuses with the new summary (`MANIFEST_CHANGED`).
  ```

- §2 step 2: after the quoted "P0 is fail-closed…" line, add:
  `Add: *"The lock covers the manifest key, a hash of the manifest as pulled, and the planned times — so a changed manifest or an edited time shows as tampering."*`
- §3 honesty list: add
  `- 🔴 **"The manifest lookup is mocked."** Parcel Perfect's API has no manifest call. Trip creation runs on an assumed contract; against live PP the preview returns 501 and the screen offers an empty leg.`
- §5 list: add
  `- Trips are created from the client's Parcel Perfect manifest number, and the order number is gone (FP-281). One non-cancelled trip per manifest is enforced by the database.`

- [ ] **Step 6: Check the docs against the code**

Run: `grep -n "order number\|order_number" docs/FreightProof_Full_Picture_v7.md docs/demo-script.md docs/glossary.md`
Expected: only the §15.0 amendment, the historical §15.4/§15.5 row, and the glossary's "Order number — Removed" row.

Run: `grep -n "from-pp-manifest\|pp-manifest-preview" backend/docs/api_contract_dispatcher_driver.md`
Expected: the two new route headings.

Re-read each Step 1–5 edit beside `backend/app/schemas/pp_manifest.py` and `backend/app/api/v1/endpoints/trips.py`. Every code, field and status named must exist there.

- [ ] **Step 7: Stage**

```bash
git add docs/FreightProof_Full_Picture_v7.md docs/db-models.md docs/glossary.md backend/docs/api_contract_dispatcher_driver.md docs/demo-script.md
```
Suggested commit: `docs: manifest-first trip creation in v7, glossary, models, API contract and walkthrough (FP-281)`

---

### Task 11: Final verification and handoff

**Files:** none new.

- [ ] **Step 1: Dispatcher, end to end**

Run: `cd frontend/dispatcher && npm run lint && npm run type-check && npm test && npm run build`
Expected: no lint or type errors, every suite green, and the build succeeds. Paste the Vitest summary line into the report.

- [ ] **Step 2: Driver PWA and receiver (both compile `frontend/shared`)**

Run: `cd frontend/driver-pwa && npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: green. The build matters: `output: 'export'` fails on a page that lost `'use client'`.

Run: `cd frontend/receiver && npm run type-check && npm test`
Expected: green. The shared type and mock changes compile there too.

- [ ] **Step 3: Backend, in the foreground**

Run: `cd backend && pytest -q`
Expected: all green. Paste the summary line.

Run: `cd backend && ruff check . && mypy .`
Expected: no errors.

- [ ] **Step 4: Leftover sweeps**

Run: `grep -rn "order_number\|orderNumber" frontend --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out`
Expected: no output.

Run: `grep -rn "get_waybills_by_manifest\|get_manifest_summaries\|pp/manifests" backend/app backend/scripts frontend --include='*.py' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next`
Expected: no output (the two pinning tests live under `backend/tests`).

Run: `grep -rn "pp_manifest_snapshot\|pp_manifest" frontend/driver-pwa --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`
Expected: only the `pp_manifest: null,` fixture lines from Task 7 Step 7, which are required by the shared `Trip` type. No driver screen reads either field (POPIA, §7.3).

- [ ] **Step 5: Spec coverage**

| Spec | Task |
|---|---|
| §11 step 1: manifest number → summary (client, route, times, totals, waybill lines, notes, warnings) | 4, 6 |
| §11 step 2: driver, horse, trailers; times "From manifest", editable, required only when missing; precinct picker only for an unlinked hub | 2, 5, 6 |
| §11 step 3: create; `MANIFEST_CHANGED` shows the new summary; `MANIFEST_ALREADY_ON_TRIP` links to the trip | 1, 6 |
| §11 "No manifest (empty leg)" through `POST /trips` | 2, 6 |
| §10.4 exact retry lookup after a timeout | 1, 6 |
| §10.7 errors (404 / 501 / 502 / 409 / 422) on screen | 1, 4, 6 |
| §12 `order_number` out of `frontend/shared` types and mocks | 2, 7 |
| §12 dispatcher header, dashboard search, checklist rows, history → manifest display / "Empty leg" | 7 |
| §12 driver PWA shows `trip_reference`, never the snapshot | 7 |
| §7.3 / §10.5 / §10.6 the H0 snapshot is a cancelled trip's cargo record (D1) | 8 |
| §8 the UI labels the mock manifest as an assumed contract | 4, 10 |
| §13 live PP → 501 message | 1, 4, 6 |
| §15 scenarios 1, 2 (retry half), 5, 6, 7, 8, 9 — frontend side | 6, 7 |
| §16 frontend tests: summary, gaps, empty leg, `MANIFEST_CHANGED`, `MANIFEST_ALREADY_ON_TRIP` | 4, 5, 6 |
| §8 / §17: remove `get_waybills_by_manifest`, `get_manifest_summaries`, `GET /pp/manifests/{n}` | 9 |
| Spec review: docs (v7, db-models, glossary, API contract, walkthrough) | 10 |

- [ ] **Step 6: Browser walkthrough (needs a backend on piece A's schema — Before you start, item 3)**

Ask Ciaran whether such a backend is running before starting. If it is: start the dispatcher with `preview_start` `{name: "dispatcher"}`. Sign in as the seeded demo dispatcher (test credentials from the project's seed files, on localhost only), or ask Ciaran to sign in. Then check each row, reading the page with `read_page` / `get_page_text` and the console with `read_console_messages`:

| Do | Expect |
|---|---|
| Open Create Trip, look up **81** | Summary: The Courier Guy (or the seeded client name) · CPT 81, Closed in PP, 2 waybills; the note with "→" renders. Route & schedule shows both precincts read-only with "From manifest" times. Crew cards appear |
| Pick driver and horse, create, confirm | Lands on the new trip; its header reads the manifest display; the toast says the journey lock is anchored |
| Look up **81** again | Blocking alert "already on trip FP-…" with a working link; CTA disabled; no crew cards |
| Look up **82** | Prompts for no planned departure and an open manifest; the departure field is required and empty |
| Look up **83** | "No waybills" blocking, with "Create an empty leg instead" switching the tab |
| Look up **70** | Waybill-client mismatch blocking, waybills named |
| Look up **69** (if its waybills are free on this database) | Destination hub DUR unlinked; a picker offering only the client's precincts |
| Look up a fresh manifest, then `POST /api/v1/dev/pp/manifest {"manifest_number": <n>, "closed": false}` (dev panel enabled), then create | Warn banner "The manifest changed…", updated summary; a second create succeeds |
| Empty leg tab: two precincts, departure, crew, create | Trip created; its header reads "Empty leg" |
| Dashboard: type "CPT 81" in search | The trip shows; no console errors |
| Open the trip, Manifest panel | Live waybills plus a collapsed "Manifest at creation · 2 waybills · …" |
| Resize to mobile (`resize_window` preset `mobile`) on Create Trip | One column, summary panel below the form, no horizontal scroll. Reset with preset `desktop` |

Take one screenshot of the loaded summary and one of the Manifest panel, and share them with Ciaran. If no such backend is available, record "walkthrough deferred to `dev` after the A+B merge" in the report. Never apply the migration to run it.

- [ ] **Step 7: TASK COMPLETE report**

Produce the CLAUDE.md `TASK COMPLETE` block with:
- **Migrations:** none (piece A's `2026_10_01_ciaran_pp_manifest_trips` is still applied from `dev` after the A+B merge).
- **Shared files:** `frontend/shared/lib/types/trip.ts`, `manifest.ts`, `pp-manifest.ts` (new), `frontend/shared/lib/mocks/trips.ts`, `manifests.ts`.
- **New .env keys:** none.
- **Deprecations:** none found. (`Skeleton` and `Modal` still use the legacy `surface-*` token names; noted, not changed.)
- **Next:**
  - **One PR from `Ciaran` to `dev` carrying A and B together.** Announce it to the team (spec §17).
  - After merge, Ciaran applies piece A's migration on `dev`, then re-runs `scripts/seed_demo.py`, `scripts/dev_reset_lifecycle.py` and `scripts/seed_trips.py` (piece A Task 12 note).
  - Tom: FP-142's clash message goes in `components/trips/new/CrewFields.tsx` (Question 1).
  - Unused after B, left in place (Question 5): `GET /pp/waybills/{ref}`, `GET /pp/capabilities`, `supports_manifest_lookup`, `lib/hooks/usePpCapabilities.ts`, `shared/lib/types/pp.ts`, `components/ui/StepRail.tsx` (if nothing else imports it).
  - Piece C: migration dropping `trips.order_number` and `ix_trips_order_number`, plus the remaining backend `Trip(order_number=...)` test constructors.
  - Delivery dependency before the demo (from piece A): the fix stripping `pp_raw_json` from driver trip responses. Scenario 9 needs it.
  - Optional later (D1): if the manifest panel's per-event refetch ever matters, serve the H0 snapshot from its own immutable endpoint.

---

## Execution notes

- **Order.** Tasks 1–6 build the screen. Task 7 must follow Task 6, because the old wizard reads `TripSummary.order_number` until it is replaced. Task 8 depends on Task 1 only. Task 9 depends on Task 6. Task 10 waits for 1–9.
- **Smallest reviewable units.** Each task ends green on `type-check`, `lint` and the tests it names. A reviewer can approve the API layer (1) or the rules (2) without the screen.
- **When a test does not fail first.** Stop and check that the test exercises the new code, rather than adjusting it until it fails.

