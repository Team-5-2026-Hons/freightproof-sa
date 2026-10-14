# Precinct List Card Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild the `/precincts` list so each precinct reads like a place, not a row of numbers — a real street-map thumbnail with the geofence drawn to scale, then the same header/subtitle/spec-block anatomy the vehicles page already uses.

**Answer to the question asked:** Yes — real map imagery per card is possible, cheaply, with no Leaflet instance per card and no paid API. See "How the thumbnail works".

---

## Why the current card is wrong

Three faults, in order of how much they cost the dispatcher:

1. **It shows coordinates where the address should be.** `-29.08520, 26.15960` is not how a human identifies a depot. `PrecinctRead` already carries `address` and the card never renders it. A dispatcher scanning for "the Riverhorse Valley one" gets nothing to scan.
2. **The schematic thumbnail is contentless.** Every card shows an identical blue circle. It encodes radius — which is currently the same 200 m for all three — and nothing about *where*. Three identical circles is decoration, and Principle 2 forbids decorative colour.
3. **Ownership is buried in a text run.** `Geofence 200 m · shared with you` hides the one fact that changes what the dispatcher can *do*. Vehicles put status in a `Chip` at top-right; precincts bury it in prose.

The vehicles card works because it front-loads identity (registration + status chip), then a typed subtitle, then a `surf-low` block of hard identifiers. The precinct card should use that same skeleton — with the map taking the place of the identity line, because a depot's identity *is* its location.

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Static raster tiles composited as `<img>`, not a Leaflet instance per card.** | One Leaflet map per card means N map objects, N event-handler sets and N teardowns on a page that is meant to scroll. Tiles are directly addressable by `{z}/{x}/{y}`, so a thumbnail is pure arithmetic plus 4 cached images. No new dependency. |
| D2 | **Street (OSM) tiles on the list; satellite stays on the detail page.** | At 280×150 px, satellite imagery is brown mush — you cannot tell Epping from Linbro. A street map gives road geometry and labels, which is what makes a thumbnail recognisable at a glance. Satellite earns its place on the detail/edit map, where the job is "is the pin on the actual building". |
| D3 | **Zoom is derived from the geofence radius**, so the fence always occupies ~55 % of the thumbnail width. | A fixed zoom renders a 50 m fence as an invisible dot and a 5 km fence as a circle larger than the card. Derived zoom makes every card's fence legible, and makes the *difference* between a 200 m and a 2 km fence visible as a change in map scale rather than a number to read. |
| D4 | **The geofence circle is drawn to scale over the tile, with a metre scale bar.** This is the card's signature element. | It is the one thing no other card in this app does, and it is true to the domain: the radius is the number FP-68's verdict depends on. Same metres-per-pixel maths already proven in `GeofenceSchematic`. |
| D5 | **`Shared` gets a chip; `Mine` gets none.** | Colour is information. Marking the exceptional case — you can see this but cannot edit it — is information; marking the normal case is decoration. It also makes shared precincts scannable, which is the actual need. *Alternative if you want strict vehicle parity: always render a chip, `Mine` as `pending` (grey). Pick one; do not do both.* |
| D6 | **Fall back to the existing `GeofenceSchematic` when a tile fails to load.** | It already exists, is zero-dependency and always renders. Same principle as the detail map: degrade to a correct diagram, never a grey void. Reuse, do not reinvent. |
| D7 | **Wider grid: `1 / 2 / 3` columns** (vehicles use up to 4). | The map band needs horizontal room to be worth having. Three across at `xl` keeps cards ≥ 280 px. |

---

## How the thumbnail works

Slippy-map tiles are addressable as `{z}/{x}/{y}` PNGs — the same URLs `GeofenceMap` already uses. For a given centre and zoom:

```
n          = 2^z
tileX      = (lng + 180) / 360 · n
tileY      = (0.5 − ln((1+sin φ)/(1−sin φ)) / 4π) · n        // φ = lat in radians
metresPerPx = 156543.03392 · cos(lat) / 2^z
```

Render a 2×2 block of `<img>` tiles inside an `overflow-hidden` box, translated by the fractional part of `tileX`/`tileY` so the precinct sits dead centre. Overlay the geofence as an SVG circle of radius `radiusMetres / metresPerPx` pixels, plus a scale bar reusing `niceScaleMetres` from `GeofenceSchematic`.

**Verified numerically** (280 px card, target fence ≈ 55 % of width):

| Precinct | Radius | Derived zoom | m/px | Fence Ø on card |
|---|---|---|---|---|
| Bloemfontein | 200 m | 16 | 2.09 | 192 px |
| Cape Town | 50 m | 18 | 0.50 | 202 px |
| Johannesburg | 5000 m | 11 | 68.6 | 146 px |

Clamp zoom to **[10, 18]** (Esri and OSM both serve to 19; 10 is coarse enough for any legal radius). At the extremes the circle may exceed the card — clip it rather than shrinking the map; a fence bigger than the view is honest information.

**Rejected alternatives:**
- *Leaflet per card* — see D1.
- *Google/Mapbox Static Maps API* — needs a key and a billing account, and routes every dispatcher's facility list through a third party's logs. The story already rejected a third-party geocoder on the same grounds.
- *`next/image`* — would proxy every tile through the Next image optimizer, adding a server hop to fetch a 256 px PNG that is already optimally sized and CDN-cached. Use a plain `<img>` with an `eslint-disable-next-line @next/next/no-img-element` and a comment saying why.

---

## Card anatomy

```
┌─────────────────────────────────────────────┐
│░░░░░░░░ OSM street tiles, 150px ░░░░░░░░░░░░│  ← rounded top, overflow-hidden
│░░░░░░░░░░░░░╭───────────╮░░░░░░░░░░░░░░░░░░░│     geofence circle, to scale
│░░░░░░░░░░░░░│     ●     │░░░░░░░░░░░░░░░░░░░│     centre dot = the precinct
│░░░░░░░░░░░░░╰───────────╯░░░░░░░░░░░░░░░░░░░│
│░ ├──100 m──┤ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  ← scale bar on translucent pill
├─────────────────────────────────────────────┤
│ ◉ Bloemfontein Depot (Hamilton)   [Shared]  │  ← 15/700 + chip, as VehicleCard
│ 12 Sookhai Place, Riverhorse Valley         │  ← 11/500/0.03em, --sec, truncate
│ ┌─────────────────────────────────────────┐ │
│ │ Coordinates      −29.08520, 26.15960    │ │  ← surf-low block, InfoRow mono
│ │ Geofence                        200 m   │ │
│ │ Sharing               Shared with you   │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

Mapping to the vehicles skeleton, so the two pages feel like siblings:

| VehicleCard | PrecinctCard |
|---|---|
| `truck` icon + registration | `map` icon + name |
| Active / Inactive chip | Shared chip (or none — D5) |
| `Horse · Man · TGX · 2025` subtitle | `address` subtitle |
| Pulsit / VIN / GVM / expiry block | Coordinates / Geofence / Sharing block |
| — | **map thumbnail above the header** |

**Design-system compliance:** coordinates and radius use `InfoRow mono` (tabular-nums, §5.2 — mandatory for GPS). Card is `Card` at elevation 3, `r-lg`. The scale-bar pill uses `surf-lowest` at ~85 % alpha for legibility over imagery. No new colour tokens. No emoji (§10.10).

---

## Files

| File | Responsibility |
|---|---|
| `frontend/dispatcher/lib/map/tiles.ts` *(create)* | Pure slippy-map maths: `tileCoordinates`, `metresPerPixel`, `zoomForRadius`, `tileUrl`. No React, no DOM — trivially unit-testable. |
| `frontend/dispatcher/lib/map/__tests__/tiles.test.ts` *(create)* | Known-value tests (see Task 1). |
| `frontend/dispatcher/components/map/StaticGeofenceThumbnail.tsx` *(create)* | The 2×2 tile composite + SVG geofence + scale bar, with `GeofenceSchematic` fallback on image error. **Must not import Leaflet** — `GeofenceMap.tsx` remains the only file permitted to. |
| `frontend/dispatcher/components/precincts/PrecinctCard.tsx` *(create)* | The card. Presentational; mirrors `VehicleCard.tsx`. |
| `frontend/dispatcher/components/precincts/__tests__/PrecinctCard.test.tsx` *(create)* | Renders address, chip logic, owned vs shared. |
| `frontend/dispatcher/app/(app)/precincts/page.tsx` *(modify)* | Swap the inline card markup for `PrecinctCard`; widen the grid to `1 / 2 / 3`; add the tile attribution line. |

**No backend change. No shared-file change. No new dependency.**

---

## Task 1: Tile maths

- [ ] **Step 1: Write the failing tests** — `lib/map/__tests__/tiles.test.ts`

Test against known values (these are verified, not invented):

```ts
// z=16, Bloemfontein (-29.0852, 26.1596) → tile 37530/38306
// z=16, Durban      (-29.7942, 30.9820) → tile 38408/38454
// metresPerPixel(-29.0852, 16) ≈ 2.087
// zoomForRadius: 200 m → 16 · 50 m → 18 · 5000 m → 11
```

Also assert the invariants:
- `zoomForRadius` is clamped to `[10, 18]` for any finite input, and returns a sane value for 0/negative/NaN.
- `metresPerPixel` is positive and strictly decreases as zoom increases.
- `tileCoordinates` returns a fractional part in `[0, 1)` so the pixel offset is always within one tile.
- Longitude 180 / −180 and latitude near the Mercator limit do not produce `NaN` or a negative tile index.

- [ ] **Step 2: Run, confirm they fail on the missing module.**
- [ ] **Step 3: Implement `lib/map/tiles.ts`.** Constants named (`TILE_SIZE_PX = 256`, `EQUATOR_METRES_PER_PIXEL_Z0 = 156543.03392`, `MIN_TILE_ZOOM = 10`, `MAX_TILE_ZOOM = 18`, `FENCE_FRACTION_OF_CARD = 0.55`) — no magic numbers. Comment *why* the Mercator formula is what it is, not what it does.
- [ ] **Step 4: Run, confirm green.**

## Task 2: `StaticGeofenceThumbnail`

- [ ] **Step 1: Write the failing test.** Assert: renders 4 `<img>` with tile URLs derived from the right z/x/y; the circle's SVG radius equals `radiusMetres / metresPerPixel` within an epsilon; an `onError` on any tile swaps to `GeofenceSchematic`; `alt` text is meaningful (`"Street map showing {name}"`), not empty.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement.** Props: `{ latitude, longitude, radiusMetres, name, className }`. Notes:
  - `loading="lazy"` and `decoding="async"` on every tile — a 30-precinct list must not fire 120 requests on mount.
  - OSM tile URL: `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (use the keyless host; do **not** use the `{s}` subdomain form, which is deprecated).
  - Track failure with a single `useState<boolean>` flipped by any tile's `onError`; once true, render `GeofenceSchematic` and stop.
  - The centre dot and circle reuse the `sec` token via Tailwind `fill-sec` / `stroke-sec` — **never** `var(--sec)`, which does not exist in this codebase, and never a hex literal (eslint bans it).
- [ ] **Step 4: Run, confirm green.**

## Task 3: `PrecinctCard`

- [ ] **Step 1: Write the failing test.** Assert: the address renders (and falls back to `—` when null); a non-owned precinct shows the Shared chip and an owned one does not; coordinates render at 5 dp with the mono treatment; clicking calls `onClick`.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement**, mirroring `VehicleCard.tsx` structure exactly — `Card` wrapper, header row, subtitle line, `surf-low` `InfoRow` block. Props: `{ precinct, isOwned, onClick }`. Ownership is passed **in**, not computed here: the card stays presentational and the page keeps the single `isOwned` definition it already has.
- [ ] **Step 4: Run, confirm green.**

## Task 4: Wire up the page

- [ ] **Step 1:** Replace the inline card markup in `app/(app)/precincts/page.tsx` with `<PrecinctCard>`, passing `isOwned={isOwned(p)}`.
- [ ] **Step 2:** Widen the grid to `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4`.
- [ ] **Step 3: Add the attribution line** once at the foot of the list, not per card:
  `© OpenStreetMap contributors` — 10 px, `on-surf-v`. **This is a licence condition, not a nicety.** Link it to `https://www.openstreetmap.org/copyright`.
- [ ] **Step 4:** Verify:
  ```bash
  cd frontend/dispatcher && npx vitest run && npx tsc --noEmit && npx eslint app/ components/ lib/ && npx next build
  ```
  Expected: tests green, tsc clean, eslint 0 errors (the 2 pre-existing `<img>` warnings in `EvidencePhoto.tsx` stay; your own `<img>` carries a justified disable comment), build succeeds.

- [ ] **Step 5: Verify in the browser** — the part no test covers:
  1. All three seeded precincts show *visibly different* maps.
  2. Bloemfontein/Cape Town/Johannesburg are each recognisable by road layout.
  3. The scale bar reads correctly against the circle (a 200 m fence spans roughly two 100 m bars).
  4. Edit a precinct's radius to 50 m and to 2000 m — the thumbnail should re-frame, not just resize the circle.
  5. Block `tile.openstreetmap.org` in devtools → every card falls back to the schematic, no grey boxes.
  6. Throttle to Slow 3G → cards render text immediately; tiles fill in progressively; no layout shift (the map band must reserve its height).

---

## Hosting

Tiles are fetched by the **viewer's browser**, not by the server. There is no server-side egress, no build-time dependency and nothing to configure at deploy time, so the hosting target (Vercel, a container, a VM) does not affect whether this works. `output: 'export'` is on `driver-pwa`, not dispatcher, so there is no static-export complication either.

Two things do matter:

- [ ] **CSP will silently kill this.** There is no Content-Security-Policy today — `frontend/dispatcher/next.config.js` says so deliberately. When one is added, `img-src` **must** include the tile host or every tile fails and every card falls back to the schematic, with no visible error to explain why. Add the host at the same time as the CSP, not after someone spends an afternoon debugging blank maps.
- [ ] **Provider terms, not hosting mechanics, are the real constraint.** OSM's public tile server runs on donated infrastructure, best-effort, and is not intended as a CDN for production traffic. Fine for this project's scale with attribution in place. Before any public launch, move to a provider with an actual usage agreement — MapTiler, Stadia Maps, Carto and Thunderforest all have free tiers that cover this comfortably. The swap is deliberately cheap: the tile URL lives behind one function in `lib/map/tiles.ts`, so it is a one-line change plus a key.

Separately, and predating this plan: **`GeofenceMap` already uses Esri World Imagery with no key** on the detail page. Esri's terms are less unambiguous than OSM's for a public deployment — confirm before the project is published publicly. This is inherited from the parent story, not introduced here.

## Risks

- **Tile fetches now happen on the list, not just the detail page.** A dispatcher opening `/precincts` requests tiles for every facility they can see, in one burst, from a third party. No personal data is involved — a precinct is a business address, per the POPIA position already settled in the parent story — but it is a new outbound pattern and the team should know it exists. If it is ever unwanted, D6's fallback is already the off switch: drop the tile layer and the schematic renders.
- **OSM tile usage policy.** The public tile server is fine for a demo and a project of this size, but it is not a CDN for production traffic. If this ever ships to real load, move to a tile host with a usage agreement. Worth a line in `known-issues.md`.
- **Layout shift.** The map band must have a fixed height from first paint, or the whole grid reflows as tiles arrive.
- **`GeofenceSchematic` is shared with the detail page.** Changing its public props would break Task 13's page. Consume it as-is; if it needs a new prop, add it additively.

## Out of scope

Clustering, a whole-fleet overview map, address geocoding (deliberately deferred in the parent story — the reasoning is in `2026-08-31-precinct-create-edit.md`), and any backend change.
