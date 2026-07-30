# Trip detail page — UI/UX redesign (design spec)

**Date:** 2026-07-30
**Branch base:** `Phase-refactor` @ `b26ebbb`
**Owner:** Ciaran
**Status:** approved, plan pending

## Why this exists

The trip detail page (`frontend/dispatcher/app/(app)/trips/[id]/page.tsx`) renders every phase in
the committed plan as a timeline card, but only `trip_creation` expands. Every other card is inert:
the evidence the phase actually captured — coordinates, seals, manifests, photos — either isn't
surfaced or isn't reachable from the API at all.

This spec turns each phase card into the evidence record for that phase, with the disclosure
mechanism chosen per phase rather than uniformly.

## Non-goals

- Pulsit integration. Not available yet. Nothing here waits on it.
- Reverse geocoding. No geocoding integration exists and none is added; `Precinct.address` supplies
  the human-readable location and the phase's stored coordinates supply the observed fix.
- A map view. Coordinates render as text and a copyable pair. The eventual pin/map is out of scope.
- Any change to the driver PWA. This is dispatcher-only.
- Retiring `TripException.handshake_event_id`. That rename is Stage 5's (driver-pwa) — see
  *Cross-branch dependencies*.

## Corrections to the original brief

Three assumptions in the request don't match the phase model as built. The design follows the
model, not the brief.

1. **The driver receives the linehaul at `departure`, not `loading`.** `STEP_SLUGS.loading` is `[]`
   by design (`frontend/shared/lib/constants/phase-meta.ts`): loading is system-observed via the
   Parcel Perfect poll, and the driver must never see an expected count, because a "match" against
   a visible number proves nothing (F1). The waybill photo is step `3-waybill` under `departure`;
   handing the waybill copy is step `1-hand-waybill` under `unloading`. **Consequence:** the loading
   panel has no driver-document section, permanently and by intent.

2. **A multi-stop trip has multiple `in_transit` legs.** `in_transit` anchors to the stop it departs
   *from*, so a three-stop cross-dock has three of them. The in-transit mini timeline is therefore
   per-leg. One journey-wide timeline would reintroduce the fixed-shape assumption the phase
   refactor removed.

3. **Destination arrival is already a phase event**, not a missing card. It is `in_transit`'s
   completion (step `1-arrival`), so it becomes the closing node of that leg's mini timeline —
   which is the requested outcome, reached through existing data.

## Data availability

Confirmed by reading the backend at `b26ebbb`.

| Requirement | Source | Status |
|---|---|---|
| Waybills committed at creation | `trip.consignments[]` on `TripDetailResponse` | Available |
| Driver-phone and horse GPS coordinates | `PhaseDescriptor.driver_phone_lat/lng`, `horse_gps_lat/lng` | Available |
| Geofence verdict | `PhaseDescriptor.pulsit_geofence_confirmed` | Available |
| Geofence distances | `Precinct.latitude/longitude/geofence_radius_metres` | Available, computed client-side |
| Per-parcel manifest | `GET /trips/{id}/manifest` (dispatcher-only, role-aware) | Available, no frontend hook yet |
| Seal number, per leg | `PhaseDescriptor.seal_number` | Available, already rendering |
| Identity verification | `trip.idvs_check_status` | Available |
| Photos and documents | `evidence_artifacts` | **Blocked — `POST` only, no read path** |
| In-transit checkpoints | `checkpoints` table | **Blocked — `POST` only, absent from `TripDetailResponse`** |

The artifact gap blocks five distinct pieces of evidence: seal photo, waybill photo, gate photo, POD
photo, POD signature. One endpoint plus one storage function unblocks four of the seven cards, so it
is built first.

The checkpoint gap is accepted, not closed. The in-transit timeline ships with the two phase-derived
nodes it can prove and extends when Pulsit lands.

## Layout

Three columns in the flex row currently at `page.tsx:315`.

| Column | Width | Mounted |
|---|---|---|
| Timeline | `flex-1`, min 420px | Always |
| Manifest panel | resizable — default 520, min 360, max 720 | Only when a loading/unloading card is selected |
| Trip Info | 256px fixed | Always |

The panel reuses `useResizablePanel` and the exported `DETAIL_PANEL_DEFAULT_W` / `_MIN_W` / `_MAX_W`
constants, so it matches the fleet vehicle and driver detail pages. The hook needs no change: it
owns one panel, and this page has one resizable panel.

Only the **left** divider is draggable. Trip Info is fixed-width, so a right divider would have no
width to trade.

Below roughly 1100px the panel overlays Trip Info instead of compressing the timeline. Exact
breakpoint is an implementation detail; the rule is that the timeline never goes under its 420px
minimum.

## Interaction model

Page state gains one field:

```ts
const [selectedManifestPhase, setSelectedManifestPhase] = useState<PhaseEventId | null>(null)
```

- Clicking a `loading` or `unloading` card sets it. Clicking the same card again, or the panel's ✕,
  clears it. At most one open.
- Keyed by `phase_event_id`, never by phase type or plan index — a cross-dock plan contains
  `loading` more than once and each occurrence opens its own manifest slice.
- Panel header names the phase and its stop: `Manifest · Loading · Stop 1 · Cape Town`, derived from
  the selected phase's `stop_sequence` via the existing `precinctForStop` helper.

Three disclosure mechanisms coexist and must not interfere. Opening the panel does not collapse an
open dropdown, and vice versa.

| Mechanism | Phases |
|---|---|
| Expanding dropdown | `trip_creation`, `activation`, `departure`, `confirmation` |
| Side panel | `loading`, `unloading` |
| Always expanded, not clickable | `in_transit` |

## Component 1 — artifact read path

### Backend

- **`app/storage/supabase_storage.py`** — add
  `async def create_signed_url(*, s3_bucket: str, s3_key: str, ttl_seconds: int) -> str`.
  First read function in the module; the bucket is private and written with the service-role key.
- **`app/core/config.py`** — add `EVIDENCE_SIGNED_URL_TTL_SECONDS: int = 300`.
  **Shared file — flag in TASK COMPLETE.**
- **`app/orchestration/artifact_service.py`** — add
  `list_artifacts_for_trip(db, trip_id, *, operator_organization_id)`, with the tenancy check
  mirroring `get_manifest_for_dispatcher` in `manifest_service.py`.
- **`app/schemas/evidence.py`** — add `EvidenceArtifactWithUrl(EvidenceArtifactRead)` carrying
  `signed_url: str | None`. A subclass, not a new field on `EvidenceArtifactRead`: that schema is the
  driver PWA's `POST` response, and the driver has no business receiving read URLs.
- **`app/api/v1/endpoints/artifacts.py`** — a second `APIRouter(prefix="/trips/{trip_id}/artifacts",
  tags=["artifacts"])` alongside the existing `/artifacts` router, following the pattern
  `manifest.py` already establishes for trip-scoped routes.
  **Dispatcher auth only** (`get_current_dispatcher`) — a driver must never enumerate a trip's
  evidence.
- **`app/main.py`** — register the new router. **Shared file — flag in TASK COMPLETE.**

`signed_url` is nullable because minting can fail per-artifact (missing object, storage error). A
failure degrades that one row to metadata-only; it never fails the whole list.

### Why signed URLs rather than proxying bytes

Authorisation happens once at mint time, the FastAPI process never carries image payloads, `<img
src>` works natively without blob handling, and the browser caches normally. The trade-off accepted:
for the TTL window the URL is a bearer capability. Mitigated by the 300s default and by the fact
that the URL is only ever minted for an authenticated dispatcher scoped to their own organisation.

POPIA is unaffected — the bytes stay in Supabase Storage in `af-south-1`, and only the SHA-256 hash
ever reaches Hedera.

### Frontend

- **`frontend/shared/lib/types/evidence.ts`** — add `EvidenceArtifactWithUrl`.
- **`frontend/dispatcher/lib/hooks/useTripArtifacts.ts`** — built on `useAsyncData`, fetched lazily.
- **`EvidencePhoto`** — thumbnail expanding to a lightbox. Handles `signed_url === null` as a
  visible "evidence recorded, image unavailable" state rather than a broken image.
- **`EvidenceDocument`** — filename, type, captured-at, open link.

Artifacts are matched to their slot by id: the frontend maps `phase.seal_photo_artifact_id` and the
four sibling fields against the fetched list. The list itself carries no phase attribution.

Optional, droppable: inside `ForensicOnly`, re-hash the fetched bytes in the browser and compare to
`file_hash`. This is the one capability signed URLs enable that proxying does not, and it fits the
existing `VerifyButton` / `ForensicOnly` pattern. Not load-bearing — cut it if it costs time.

## Component 2 — per-phase cards

### Trip Creation — dropdown

Extends the existing `TripCreatedDetail` with a `Consignments` section. Per waybill: PP reference,
client organisation, expected units, expected parcels, declared value, pickup → delivery stop, PP
manifest number. Footer carries totals.

The full breakdown belongs on this card rather than in the sidebar because "what was committed at
creation" is the journey-lock semantic — it describes the event that was hashed, not current state.
The sidebar is 256px and cannot hold a waybill table regardless.

Sidebar `Cargo` block becomes a count summary: `3 waybills · 18 pallets · 240 parcels`.

### Activation — dropdown

- Expected location: `Precinct.address` and the precinct's coordinates.
- Observed: `driver_phone_lat/lng` and `horse_gps_lat/lng`, each copyable.
- Derived, client-side: each fix's distance from the geofence edge, and the separation between
  driver phone and horse GPS. Divergence between the two is itself evidence — the driver being at
  the gate while the truck is 3km away is exactly what this platform exists to record.
- `pulsit_geofence_confirmed` verdict.
- `trip.idvs_check_status`.
- Slot time vs actual arrival.
- Gate photo (`gate_photo_artifact_id`).
- `dispatcher_override_note` when the phase was overridden.

### Loading — side panel

From `GET /trips/{id}/manifest`. Consignment rows expand to delivery-stop groups, which expand to
parcels with `scanned_out` state. Totals and `origin_scan_complete` in the footer.

The panel rather than a dropdown, because: a manifest is unbounded (dozens of waybills × dozens of
parcels each) and expanding it inline pushes the rest of the timeline several screens down; the
fetch is lazy and separate from trip detail, so it needs its own loading, error and
"404-before-loading-starts" states, which a panel owns cleanly and a card expansion does not; and
one panel component serves both loading and unloading with a different column emphasis.

No document section — see *Corrections* item 1.

### Departure — dropdown

Seal number, seal photo, waybill photo, both coordinate pairs, geofence verdict, anchor status.
Per-leg seal display already works and is preserved: each departure shows its own seal, which is the
multi-stop proof on screen.

### In Transit — always expanded, one mini timeline per leg

Nodes, in order:

1. `Departed` — this leg's `in_transit.created_at`.
2. Exceptions attached to this leg.
3. `Arrived` — this leg's `completed_at`.

Two nodes plus exceptions. Weighbridges, driver substitutions, vehicle substitutions and periodic
checkpoints are all Pulsit-or-checkpoint-sourced and are not rendered, because the data cannot be
fetched. The timeline is built to extend.

Exception attachment is the one known inaccuracy. `page.tsx:300` currently bolts each exception onto
the last done/warn row via `findLastIndex` — an approximation. The backend already exposes a real
`phase_event_id` on `TripExceptionRead` (`schemas/transit.py:77`), but the shared frontend type still
declares `handshake_event_id`. Until that rename lands, keep the approximation **and comment it as
one**. Do not present index-guessed placement as phase-accurate.

### Unloading — side panel

Same component as loading, with `scanned_in` emphasis, plus `parcel_count_destination` versus
`driver_visual_count` reconciliation and the seal-verify result.

### Confirmation — dropdown

POD photo, POD signature, coordinates, reconciliation verdict.

## Component 3 — status pill

`page.tsx:372-378` stops constructing `${name} — PENDING` / `${name} — IN PROGRESS`. The label
becomes the bare phase name from `PHASE_NAMES`, with a `<Chip>` beside it. `Chip` already exposes a
`pending` type, so no new variants are needed.

`meta` at `page.tsx:342-346` drops its status prefix. It currently prepends the same status word, so
leaving it would print "Pending" twice once the pill exists. After the change `meta` carries the stop
only.

## Known gaps recorded, not built

**`evidence_artifacts` has no `phase_event_id`.** Only the five named slots on `PhaseDescriptor`
(`seal_photo_artifact_id`, `waybill_photo_artifact_id`, `gate_photo_artifact_id`,
`pod_photo_artifact_id`, `pod_signature_artifact_id`) can be placed in the timeline. An arbitrary
document uploaded during a trip has no phase attribution and cannot be shown in its phase. Closing
this needs an Alembic migration adding the FK, plus a column on the upload endpoint. Out of scope
here; this paragraph is the record that it is owed.

**Checkpoints are write-only.** `endpoints/checkpoints.py` exposes `POST` only, and `Checkpoint[]` is
absent from `TripDetailResponse`. The selfie/cargo-photo/GPS captures already being written are
invisible to the dispatcher. Closing this needs a `GET` and a response-schema change.

**`EvidencePacket.tsx` uses stale design tokens** — `text-surface-on` and `border-outline-variant`,
where the rest of the dispatcher uses `text-on-surf` and `border-outline-v`. Not touched by this
work. Flag as a deprecation finding if the file is edited for any reason.

## Cross-branch dependencies

`TripException.handshake_event_id` → `phase_event_id` in `frontend/shared/lib/types/exception.ts`.

Four consumers: `driver-pwa/lib/context/TripContext.tsx`, two driver-pwa test files, and
`frontend/shared/lib/mocks/trips.ts`. Three of the four are driver-pwa, and the Stage 5 breakage
inventory already assigns the rename there.

**The rename belongs to Stage 5, not to this work.** This spec takes a read dependency on it: the
in-transit card renders index-approximated exception placement until the rename lands, then switches
to `phase_event_id`. Doing the rename here would change three driver-pwa files on a dispatcher
branch and collide with Tim directly.

Shared files this work touches: `backend/app/core/config.py`, `backend/app/main.py`,
`frontend/shared/lib/types/evidence.ts`. The first two need coordination per CLAUDE.md. The third is
additive — a new interface, no existing shape changed — so it is collision-safe.

## Verification

Per stage, the check is that the stage's own evidence renders against seeded data. `seed_trips.py`
already seeds a partially-walked cross-dock trip (`b26ebbb`), which is the fixture that exercises
multi-stop behaviour: two loading phases, two in-transit legs, per-leg seals.

- Backend: `cd backend && pytest`. New endpoint needs integration coverage for 200, 401, 404 and
  cross-organisation access, plus unit coverage for the TTL and the tenancy filter.
- Frontend: `tsc --noEmit` clean, and the cross-dock seeded trip opens two distinct manifests from
  its two loading cards.
- Regression guard, every stage: the plan-length assumptions must stay dead. Nothing may assume six
  phases, seven phases, or one occurrence of a phase type. `dispatcher/lib/phase/derive.test.ts`
  holds the existing plan-length regression tests.
