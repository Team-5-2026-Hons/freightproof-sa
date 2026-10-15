# FP-294: Cost analytics. Cargo value exposed (from waybills) and estimated trip and delay cost

**Status: COMPLETE: built and checked 2026-10-15, awaiting Tom's commits, PR into `dev`, and Ciaran applying `tom_add_cost_profiles`.** Written 2026-10-15 from Tom's branch `feature/fp-294-cost-analytics` at `a7af0fc`
(= `Tom` merged with `origin/dev`). Every path below was checked against that commit.
**Owner:** Tom (signs off after every stage). **Written by** Claude, from a decision session with Tom. Every
choice in §2 was agreed with him.
**Ticket:** FP-294 (epic FP-136 "Evidence Analytics & Live Alerting"), Sprint 9. **Feeds** FP-295 (AI insights brief).
**Branch:** `feature/fp-294-cost-analytics`. The executor never creates or switches branches.
**Calendar:** structural freeze **19 Oct**, submission **23 Oct**. This adds a migration, which **Ciaran applies after
merge to `dev`**. Plan the PR early enough for that.

---

## 0. Handoff (paste this first in a new session)

> FreightProof's analytics page counts trips, delays and exceptions, but never shows money. This work adds a
> **Cost** tab to `/analytics` that answers *"what did problems cost us this period, and how much cargo value was
> exposed?"*, and every figure says where it came from:
> (1) **Cargo value exposed** (real, **"From waybills"**): the sum of `consignments.declared_value` on closed trips
> that had a theft-signal exception, split into "still under review" and "reviewed";
> (2) **Estimated operating cost** (**"Estimate"**): truck road distance between the trip's stops (OpenRouteService, cached per depot pair; straight line × road factor as
> the fallback) × R/km (fuel = diesel price × consumption), plus
> driving hours × driver R/h, plus a fixed R/trip;
> (3) **Delay cost** (**"Estimate"**): hours late at arrival, on trips that had a problem, × a delay R/h;
> (4) a new table `cost_profiles` (one row per operator organisation) that holds the rates. Until an admin saves
> rates, the starting rates (worked out from Bruce's figures) apply. An **admin dispatcher edits the rates in the
> Cost tab**, and every figure recalculates.
> Work in **7 stages** (§9). Each ends with something Tom can check. **Stop after each stage for Tom's sign-off.**
> Follow `CLAUDE.md` exactly: a PLAN block before each stage, TASK COMPLETE after it, no git write commands, **never
> `alembic upgrade`**, never read `.env`. Freeze starts 19 Oct: add new files, but don't move or rename existing ones.
> Start at the first stage in §14 that is not DONE.

---

## 1. Rules for whoever executes this

1. Read `CLAUDE.md` first. It overrides nothing here, and nothing here overrides it.
2. Before each stage, output the `PLAN` block. After it, output `TASK COMPLETE` and **stop**.
3. Git: only `git status`, `git diff`, `git log --oneline -10`, `git branch --show-current`, `git fetch`,
   `git add <specific files>`. Tom commits.
4. At the start of each stage run `git fetch origin`, then `git log --oneline HEAD..origin/dev`. If `dev` changed a
   file in §7, or **added a migration**, stop and tell Tom. A new migration on `dev` changes this one's `down_revision` (§4.1).
5. Explain things plainly to Tom: the short answer first, then the detail. If he asks for something that contradicts §2,
   say so and explain why before doing it.
6. If this spec and the code disagree, trust the code, and note it in TASK COMPLETE and in §14.
7. **Migrations:** write it **by hand**. Never `alembic revision --autogenerate`: on this repo it emits 28 destructive
   ops (CLAUDE.md, `docs/design-notes/2026-09-15-alembic-autogenerate-drift.md`). **Never `alembic upgrade`** (shared
   Supabase DB). Ciaran applies it from `dev` after merge. Check with `alembic heads` and
   `grep -nE "op\.[a-z_]+\(" <file>` only.
8. Structure ratchet (`scripts/check_structure.py`): no new function over 100 lines; listed files must not grow.
   Never run `--update`.
9. Never run two pytest processes at once (shared local test DB). Ask before `npm run build` (it clobbers Tom's dev server).
10. The browser may need Tom to sign in. **Never type a password.** Ask Tom.
11. Money is computed in `Decimal` and sent to the frontend as a rounded `float` of rand (§4.3). No floats in the
    arithmetic.

---

## 2. Decisions (with reasons). Don't relitigate these.

| # | Decision | Why |
|---|---|---|
| D1 | **Rates live in a new table `cost_profiles`, one row per operator organisation**, edited by an `admin_dispatcher`. An edit **overwrites** the row (no history). | Tom's call. The ticket says the rates are "set by an admin". History was rejected: it adds code and tests in freeze week, and the tab says plainly that every figure uses the current rates (§5). |
| D2 | **With no row, the starting rates apply** (`DEFAULT_COST_RATES`, §7.1), and the read says `is_default: true`. The first admin save inserts the row. The migration seeds **no data**. | Every organisation gets figures straight away, including the test DB (built by `create_all`, not migrations) and new organisations. A migration with no data stays a pure schema change for Ciaran. |
| D3 | **Starting rates come from Bruce's figures** (minutes of 28 Jul and 1 Sep 2026): diesel **R33.29/L** × **53 L/100 km** (= R17.64/km), other running cost **R15.10/km**, driver **R155/h**, fixed **R0/trip**, delay **R1,100/h**, road factor **1.15** (fallback only). They are worked out in §7.1 so that Bruce's JHB–DBN example comes out at **≈R20,000** (it gives R20,235). | It's defensible at the exam: "we calibrated the model so Bruce's own example comes out right." Every number traces back to something he said, or to a stated assumption (9 h of driving, 195 working hours a month). |
| D4 | **Delay rate R1,100/h = the driver (R155/h) + the truck sitting idle** (Bruce's non-fuel, non-driver cost R8,600 ÷ 9 h ≈ R955/h). | Tom's call. While a truck is stuck, you still pay the driver and the truck earns nothing. |
| D5 | **Distance = the truck road route for each leg (consecutive stops), from OpenRouteService's HGV profile** via the existing `app/integrations/routing.py::compute_truck_route`. Each leg is looked up **once per (from precinct, to precinct) pair and cached in Redis** (§7.6). **Fallback, per leg:** straight line (`haversine_metres`) × road factor, used when there is no `ORS_API_KEY`, ORS fails, or the lookup budget for this request is spent. The response says how many legs were routed and how many were estimated, and each lane says which it used. | Tom's call (15 Oct, after Stage 1). ×1.15 alone is ~10% out on highways and worse on short city trips. The routing code already exists (built 14 Oct for the driver map), uses only depot coordinates (no personal data off-system), and a depot-to-depot distance never changes, so one lookup per pair is enough. No stored trip length exists to use instead (Parcel Perfect sends none; the tracker feed is simulated). |
| D6 | **Driving hours = `trips.actual_arrival_at` − the first attested departure** (`base.trip_departures`), the same measure the Routes tab uses. A closed trip missing either time is **not costed**, and is counted in `trips_not_costed`. | One measure across tabs. Leaving such trips out entirely keeps the total coherent (no trips with distance cost but no driver cost). The count stops it being hidden. |
| D7 | **Delay cost = hours late at final arrival × delay rate, only on "problem trips"**: closed trips with at least one exception not in `EXCLUDED_FROM_PROBLEMS`. Hours late = `max(arrival_delay(trip), 0)`, reusing `on_time.arrival_delay`. Trips with no planned or actual arrival are counted in `lateness_unknown`. | Tom's call. It reuses the On time tab's measure, so the two tabs agree. "Time from the exception to the next step" was rejected (§2 rejected list). The copy says the problem *may* have caused the delay, never that it did. |
| D8 | **Delay cost is shown beside the operating cost, never added to it.** | The driver's late hours are already inside the driver part of operating cost. Adding the two would count them twice. |
| D9 | **Cargo value exposed = the sum of `declared_value` over every consignment on closed trips with at least one `THEFT_SIGNAL_TYPES` exception** (`app/analytics/fleet/constants.py`). It is split into **under review** (any of those theft-signal exceptions not `REVIEWED`) and **reviewed**. | Tom's call. It shares one definition with the Problems tab's theft-signals chart. The **whole load** counts, because `exceptions.consignment_id` is never filled in (model comment, `transit.py`), so we can't tell which consignment was affected. The copy says so. |
| D10 | **Unknown values are counted, never treated as R0:** `consignments_without_value` (null `declared_value`) and `trips_without_consignments` (exposed trips with no consignment rows, e.g. not from Parcel Perfect). | Panel feedback: every figure must be defensible. A silent R0 would understate the exposure. |
| D11 | **Same scope as every other tab: closed trips, bucketed by first attested departure, in SAST** (`base.closed_trips`). | So the page stays consistent, and the existing `scopeNote` keeps being true. A trip still on hold with a seal mismatch shows up once it closes. Noted in §12. |
| D12 | **A new "Cost" tab, the seventh, last in the tab row.** Its cards: headline figures, operating cost over time (stacked by part), delay cost over time, value exposed over time (stacked under review / reviewed), cost by lane, and the rates card. No headline tile. | Tom's call. It's self-contained and doesn't touch the other tabs or `FleetTiles`. |
| D13 | **Provenance in two places.** (a) Each card's required `source` line in the "i" popover (the FP-296 D6/D7 convention). (b) **A small visible label on each headline figure: "Estimate" or "From waybills"**, and a tab note: "Estimates use your cost rates below. Cargo values come from Parcel Perfect waybills." | The ticket requires each figure to say whether it was estimated or came from a waybill. FP-296 rejected *full source text* on card faces. A one-word label is different, and on a money tab, mixing real figures with estimates without saying so is the exact risk the panel raised. |
| D14 | **The rates card sits at the bottom of the Cost tab.** It shows every rate, a one-line "where it came from", and "Starting rates from Bruce's figures" or "Last changed {date} by {name}". **Admins get Edit → form → Save. Everyone else sees it read-only.** Saving refetches the cost figures. | Tom's call: "there has to be a way on the dispatcher portal for me to adjust numbers if things change". Putting the numbers next to the rates that drive them is provenance in itself. |
| D15 | **API:** `GET /api/v1/analytics/fleet/cost` (any dispatcher, needs grain) · `GET /api/v1/analytics/cost-profile` (any dispatcher) · `PATCH /api/v1/analytics/cost-profile` (`require_admin_dispatcher`, rate-limited). Each sits on the existing analytics router, so `main.py` is not touched. | Matches the existing endpoint pattern. PATCH rather than PUT because `lib/api/client.ts` already has `api.patch`, so the shared client doesn't change. |
| D17 | **Fuel is two rates: diesel price (R/L) and consumption (L/100 km).** R/km = price × consumption ÷ 100. | Tom's call (15 Oct). The diesel price changes monthly (DMPR, first Wednesday); an admin types the new pump price instead of working out R/km. |
| D16 | **The cost response carries no personal data**: no driver, vehicle, person or GPS fields. Lanes are named by precinct (business sites). | So FP-295 can send it to a model provider as it is (POPIA: de-identified aggregates only). |

### Rejected alternatives (so nobody re-proposes them)

- **Delay = from the exception being raised until the next phase completed.** It counts normal driving time: a problem 1 h into an 8 h drive would show 7 h "lost".
- **Value exposed = any `critical` exception.** It pulls in breakdowns and other things that don't threaten the cargo.
- **Value exposed = only unreviewed.** Every past month would show R0 once everything has been reviewed.
- **Rate history (dated rows).** See D1.
- **Constants only, no table, no form.** Fails "set by an admin", and Tom needs to edit the rates on the portal.
- **Rates on `/settings`.** The rates would be split from the numbers they drive (D14).
- **Pulse odometer for distance.** The tracker feed is simulated (`PULSE_USE_MOCK`) and records no odometer.
- **Straight line × 1.15 for every leg.** Replaced by D5's routed distance; kept only as the fallback.
- **A single fuel R/km rate.** Replaced by D17.
- **Storing each trip's routed distance on the trip at creation.** It would change trip creation (another dev's code) and need a migration; a per-pair cache gives the same number.
- **Co-driver cost (Bruce: a second driver doubles driver cost).** Trips don't record a second driver (§11).

---

## 3. What it looks like

```
Analytics   Activity · On time · Problems · Review desk · Evidence · Routes & sites · [Cost]
            Period [Last 12 weeks ▾]   View by [Week ▾]
Estimates use your cost rates below. Cargo values come from Parcel Perfect waybills.

┌ Headline (full width) ───────────────────────────────────────────────────────────── (i) ┐
│ R 1 284 300           Estimate     │ R 46 200          Estimate   │ R 197 000  From waybills │
│ Operating cost                     │ Delay cost on problem trips  │ Cargo value exposed      │
│ 64 trips · 3 not costed (no times) │ 41.9 h late over 12 trips    │ R 63 000 still under rev.│
│                                    │                              │ 2 consignments: no value │
└────────────────────────────────────────────────────────────────────────────────────────┘
┌ Operating cost over time ─── (i) ┐ ┌ Delay cost on problem trips ─── (i) ┐
│ stacked columns: fuel · other    │ │ columns per week                    │
│ running · driver · fixed         │ │                                     │
└──────────────────────────────────┘ └─────────────────────────────────────┘
┌ Cargo value exposed ──────── (i) ┐ ┌ Cost by lane (top 10) ──────── (i) ┐
│ stacked: under review · reviewed │ │ bars: operating cost per lane;      │
│                                  │ │ tooltip: trips, R/trip, delay, value│
└──────────────────────────────────┘ └─────────────────────────────────────┘
┌ Cost rates (full width) ─────────────────────────────────────────────── [Edit] (admin) ┐
│ Diesel price    R 33.29 / L    DMPR inland 50ppm, 7 Oct 2026. Update when it changes    │
│ Consumption     53 L / 100 km  Fuel ≈ half of a R20,000 JHB–DBN run (Bruce, 1 Sep 2026) │
│ Other running   R 15.10 / km   Rest of that run after fuel and driver                   │
│ Driver          R 155 / h      R30,000 a month ÷ 195 working hours (Bruce, 28 Jul 2026) │
│ Fixed per trip  R 0            Not set                                                  │
│ Delay           R 1 100 / h    Driver plus the truck standing idle                      │
│ Road factor     × 1.15         Only when a road route can't be looked up (N3 ratio)      │
│ Starting rates from Bruce's figures · All figures use today's rates                     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Admin, Edit:** the rows become number inputs (rand, 2 dp; consumption 1 dp, above 0 and at most 200; road factor 1.00–2.00). Save / Cancel. A field error
  under a bad value. Save → "Rates saved. Figures updated." → the cost cards refetch. The "where it came from" lines
  stay as they are; after an edit the footer reads "Last changed 15 Oct by Tom Davis".
- **Non-admin:** no Edit button. Everything else is identical.
- **No closed trips in the period:** the existing `ChartCard` empty state on every chart card. The rates card is still shown.
- **Save failed:** an inline error with the server's message. The inputs keep their values.

---

## 4. API and data changes

### 4.1 Table `cost_profiles` (model `app/db/models/cost.py`, class `CostProfile`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4` |
| `operator_organization_id` | UUID, `ForeignKey("organizations.id")`, NOT NULL, **unique** | one row per org (D1) |
| `diesel_price_per_litre` | `Numeric(8, 2)` NOT NULL | rand per litre |
| `litres_per_100km` | `Numeric(6, 1)` NOT NULL | consumption; CHECK `> 0 AND <= 200` |
| `running_cost_per_km` | `Numeric(10, 2)` NOT NULL | rand: tyres, maintenance, tolls, vehicle |
| `driver_cost_per_hour` | `Numeric(10, 2)` NOT NULL | rand |
| `delay_cost_per_hour` | `Numeric(10, 2)` NOT NULL | rand |
| `fixed_cost_per_trip` | `Numeric(12, 2)` NOT NULL | rand |
| `road_factor` | `Numeric(4, 2)` NOT NULL | 1.00–2.00 |
| `updated_by_user_id` | UUID, `ForeignKey("users.id")`, NOT NULL | who last saved it |
| `created_at`, `updated_at` | `DateTime(timezone=True)` | house pattern (`server_default=func.now()`, `onupdate`) |

CHECK constraints (named `ck_cost_profiles_*`): every rate `>= 0`, and `road_factor BETWEEN 1.00 AND 2.00`.
Register it in `app/db/models/__init__.py` (**shared file**, flag it).

**Migration** `backend/migrations/versions/2026_10_15_tom_add_cost_profiles.py`, revision `tom_add_cost_profiles`
(under 32 characters), `down_revision = "tim_precinct_geofence_polygon"` (the head at `a7af0fc`; **re-check at every
stage**, rule 4). Written by hand: `op.create_table(...)` with the FK, unique and check constraints, then
`ALTER TABLE public.cost_profiles ENABLE ROW LEVEL SECURITY` (the pattern from `2026_09_23_tim_add_audit_packs.py:137`).
`downgrade()`: disable RLS, then `op.drop_table`. The docstring explains why it is hand-written and why it has no
policies (it copies the audit-packs reasoning). Add `"cost_profiles"` to `_RLS_FROM_OWN_MIGRATION` in
`tests/unit/test_data_api_lockdown_coverage.py`.

### 4.2 Cost profile endpoints (new `app/api/v1/endpoints/cost_profile.py`, `tags=["analytics"]`, included into the analytics router in `endpoints/analytics.py`)

- `GET /api/v1/analytics/cost-profile` → `CostProfileRead`. Auth: `get_current_dispatcher`.
- `PATCH /api/v1/analytics/cost-profile` with body `CostProfileUpdate` → `CostProfileRead`. Auth: `require_admin_dispatcher`.
  Add a new `COST_PROFILE_MUTATION` rate limit in `app/core/limits.py`, shaped like `PRECINCT_MUTATION`. The service
  upserts the org's row, using the defaults for any field not sent, and sets `updated_by_user_id`.
- `CostProfileRead`: the seven rates (float), `fuel_per_km` (derived, float), `is_default: bool`, `updated_at: datetime | None`, `updated_by_name: str | None`
  (from `orchestration/exceptions/review_identity.user_names`, or a join; the executor picks, and it must not import
  across the independence contract).
- `CostProfileUpdate`: all seven fields optional, `Field(ge=0, le=MAX_RATE)`, with the road factor `ge=1, le=2` and consumption `gt=0, le=MAX_LITRES_PER_100KM`, plus a
  `model_validator` that requires at least one field. `MAX_RATE` is a named constant (R1,000,000) that catches typos.

### 4.3 `GET /api/v1/analytics/fleet/cost?start=&end=&grain=` → `CostResponse`

Same parameters, auth and 422 rules as `/fleet/on-time` (`_require_valid_period`). It goes in `endpoints/fleet_analytics.py`.
Schemas live in a new `app/schemas/cost_analytics.py` (it must not import `app.analytics`; the layers contract).
Amounts are in rand, `float`, rounded to 2 dp; hours and km are rounded to 1 dp.

```
CostResponse
  period: PeriodEcho
  rates: CostProfileRead                       # the rates these figures used (provenance)
  operating: OperatingCost {fuel, running, driver, fixed, total, trips_costed, trips_not_costed, distance_km,
                           legs_routed, legs_estimated}
  delay: DelayCost {cost, late_hours, problem_trips, late_problem_trips, lateness_unknown}
  exposure: ValueExposed {under_review, reviewed, total, trips, consignments_without_value, trips_without_consignments}
  buckets: list[CostBucket {start, is_partial, fuel, running, driver, fixed, delay_cost, value_under_review, value_reviewed}]
  lanes: list[LaneCost {origin_precinct_id, origin_name, destination_precinct_id, destination_name,
                        trip_count, operating_total, operating_per_trip, delay_cost, value_exposed,
                        distance_source: "road" | "estimate" | "mixed"}]
```

Lanes are sorted by `operating_total` descending, ties by name. Trips with no origin or destination are excluded,
as `lane_trips` does. All lanes are returned; the frontend shows the top `COST_LANE_LIMIT` (10).

---

## 5. Copy

New `frontend/dispatcher/components/analytics/fleet/costCopy.ts`, `COST_COPY` (kept apart from `copy.ts`, which is already 491 lines):

- Tab label `'Cost'`. Tab note: `'Estimates use your cost rates below. Cargo values come from Parcel Perfect waybills.'`
- Labels: `estimate: 'Estimate'`, `waybill: 'From waybills'`.
- Headline basis lines: `` `${n} trips · ${m} not costed (no departure or arrival time)` `` ·
  `` `${h} h late over ${k} problem trips` `` · `` `${R} still under review` `` · `` `${c} consignments have no declared value` ``.
- Sources (popover `source`):
  - Operating: "Estimated: truck road distance between each trip's stops (OpenRouteService), or the straight line × road factor where a route couldn't be looked up, × your fuel and running rates, plus driving time (first departure to final arrival) × driver rate, plus the fixed rate. Closed trips only."
  - Card-face basis line under operating cost when any leg was estimated: `` `${e} of ${n} legs measured as straight line × road factor` ``.
  - Delay: "Estimated: hours late at final arrival versus the plan, on closed trips that had at least one problem, × your delay rate. The problem may not have caused the delay."
  - Value: "From Parcel Perfect waybills: the declared value of every consignment on closed trips with a theft signal (seal, count, trailer, panic or receiver-ID finding). The whole load counts, because an exception isn't linked to one consignment."
- Rates footer: `'Starting rates from Bruce\'s figures'` | `` `Last changed ${date} by ${name}` ``, then `' · All figures use today\'s rates'`.
- Rate origins (shown beside each rate, frontend constant): exactly the six lines in §3.
- Save: `'Rates saved. Figures updated.'` · error fallback `'Couldn\'t save the rates. Try again.'`

Money format: a new `fmtRand(value: number | null): string` in `lib/format/analytics.ts`
(`Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })`, null → `NO_DATA`).
Per-km and per-hour rates show 2 dp, via a `fmtRandRate`.

---

## 6. What does not change

`main.py`; `core/config.py`; `.env.example`; every `requirements.txt` and `package.json`; the other six tabs and their
endpoints; `FleetTiles`; `copy.ts`; `lib/api/client.ts`; seed scripts; the journey lock and anything on Hedera
(costs never touch the blockchain); the driver PWA.

---

## 7. Implementation design

### 7.1 Pure model (Stage 1). New `app/analytics/cost_model.py` (imports `core` and `decimal` only)

```python
@dataclass(frozen=True)
class CostRates:  fuel_per_km, running_per_km, driver_per_hour, delay_per_hour, fixed_per_trip, road_factor  # all Decimal
DEFAULT_COST_RATES = CostRates(...)   # D3 values, with this derivation as the comment:
#   Bruce, 1 Sep: JHB–DBN run ≈ R20,000; fuel ≈ 50%  → R10,000 over 568 km (N3) ≈ R17.60/km
#   Diesel R33.29/L (DMPR inland 50ppm, 7 Oct 2026) → 17.60 ÷ 33.29 ≈ 53 L/100 km (worked back, not measured)
#   Bruce, 28 Jul: driver ≈ R30,000/month; ÷ 195 h (45 h/week × 4.33) ≈ R155/h; run ≈ 9 h → R1,395
#   Remainder R20,000 − 10,000 − 1,395 ≈ R8,600 ÷ 568 km ≈ R15.10/km (tyres, maintenance, tolls, vehicle)
#   Delay: driver R155 + idle truck R8,600 ÷ 9 h ≈ R955 → ≈ R1,100/h
#   Road factor: 568 km road ÷ 500 km straight (JHB–DBN) ≈ 1.14 → 1.15
```

| Function | Does |
|---|---|
| `CostRates.fuel_per_km` (property) | diesel price × L/100 km ÷ 100 |
| `route_km(points: Sequence[tuple[Decimal, Decimal]], road_factor) -> Decimal` | the **fallback**: sums `haversine_metres` over consecutive stops, ÷ 1000 × factor. Fewer than 2 points → 0 |
| `trip_operating_cost(km, driving_hours, rates) -> CostParts` | `CostParts(fuel, running, driver, fixed)` + `.total` |
| `late_hours(delay_minutes: float \| None) -> Decimal \| None` | None → None; ≤ 0 → 0; else minutes ÷ 60 |
| `delay_cost(hours, rates) -> Decimal` | hours × `delay_per_hour` |
| `to_rand(value: Decimal) -> float` | rounds half-up to 2 dp, for the response |

Named constants (`MINUTES_PER_HOUR`, `METRES_PER_KM`, `MAX_RATE`, `MIN_ROAD_FACTOR`, `MAX_ROAD_FACTOR`) go in the same
module, each with its reason.

### 7.2 Profile service (Stage 2). New `app/orchestration/analytics/cost_profile.py`

`async get_cost_rates(db, *, organization_id) -> tuple[CostRates, CostProfile | None]` (row → `CostRates`, or the defaults),
`async read_cost_profile(...) -> CostProfileRead`, and
`async update_cost_profile(db, *, organization_id, data: CostProfileUpdate, user_id) -> CostProfileRead`
(upsert, then commit as the precinct service does). It may be imported by `analytics.fleet`, and it must not import `analytics.metrics`.

### 7.3 Cost query (Stage 3). New `app/analytics/fleet/cost.py`

Two entry points, because the leg distances are looked up by orchestration (the query layer may not import
`integrations`; layers contract) between them:
- `async trip_legs(db, *, organization_id, period) -> list[TripLeg]`: steps 1–2 below, returning each trip's ordered
  stop precinct ids and coordinates, so orchestration can collect the distinct (from, to) pairs.
- `async build_cost(db, *, organization_id, period, rates: CostRates, leg_km: Mapping[tuple[UUID, UUID], LegDistance]) -> CostResponse`,
  built from:
1. `closed_trips(org, instant_range(...), require_grain(period))` → trip ids, bucket, origin and destination, `departed_at`,
   planned and actual arrival. One query.
2. Stops: `TripStop ⋈ Precinct(latitude, longitude)` for those trip ids, ordered by `(trip_id, sequence)`. **One
   query** (no N+1). Sequence numbering differs between creators (0-based vs 1-based), so order by it and never assume where it starts.
3. Problem trip ids: `TripException.trip_id` on those trips, `exception_type NOT IN EXCLUDED_FROM_PROBLEMS`. One query.
4. Theft-signal rows: `(trip_id, review_status)` for `exception_type IN THEFT_SIGNAL_TYPES`. One query.
5. Consignments of exposed trips: `(trip_id, declared_value)`. One query.
6. Python: per-trip km = sum of its legs' `leg_km` (routed or fallback), then per-trip cost (§7.1), late hours via `on_time.arrival_delay` (build its `TripTimes`, or factor a shared
   helper; the executor picks, but must not change On time's behaviour), aggregation per bucket (zero-filled from
   `buckets(period)`) and per lane.

`app/orchestration/analytics/fleet.py::get_cost(db, *, organization_id, period)` loads the rates (§7.2), calls
`trip_legs`, resolves distances with `lane_distance.leg_distances` (§7.6), calls `build_cost`, and attaches lane precinct
names with the existing `_precinct_names`.

### 7.4 Endpoints (Stages 2–3)
§4.2 and §4.3. Thin: validate, call the service, return. `fleet_analytics.py` gets one endpoint. The new
`cost_profile.py` router is included in `endpoints/analytics.py` beside `fleet_router`.

### 7.6 Leg distances (Stage 3). New `app/orchestration/analytics/lane_distance.py`

`async leg_distances(pairs: Collection[LegPoints], *, road_factor: Decimal) -> dict[tuple[UUID, UUID], LegDistance]`, where
`LegPoints` carries both precinct ids and coordinates, and `LegDistance(km: Decimal, source: Literal["road", "estimate"])`.
- **Cache:** Redis key `lane_km:v1:{from_id}:{to_id}:{from_lat},{from_lng}:{to_lat},{to_lng}` → metres. Coordinates are in the key
  so moving a precinct pin gets a fresh lookup. Direction matters (one-way roads), so A→B and B→A are separate. No expiry:
  a road distance between two fixed points doesn't go stale. Read and write fail open on `RedisError`, as
  `orchestration/trips/route.py` does (copy its pattern; don't import its private helpers).
- **Miss:** `compute_truck_route([RoutePoint(from), RoutePoint(to)])` → `distance_metres`, then cache it. Calls run with bounded
  concurrency (`asyncio.Semaphore(ROUTE_LOOKUP_CONCURRENCY)`), and at most `ROUTE_LOOKUPS_PER_REQUEST` (10) misses are looked up
  per page load. The rest use the fallback this time and get routed on later loads. That keeps the first load fast, and
  stays under ORS's free-tier rate limit (40 directions/min).
- **Fallback** (`RoutingNotConfiguredError`, `RoutingError`, budget spent): `cost_model.route_km([from, to], road_factor)`, source
  `"estimate"`. **Never cached**, so the leg is retried once a key exists or ORS recovers. Log `RoutingError` at warning, and
  `RoutingNotConfiguredError` once at info (it's an expected state on a dev machine).
- **POPIA:** only precinct coordinates (business sites) go to ORS, the rule `integrations/routing.py` states. Never truck or driver positions.
- Constants `ROUTE_LOOKUPS_PER_REQUEST`, `ROUTE_LOOKUP_CONCURRENCY` (3) and the key prefix live in this module with their reasons.
- `ORS_API_KEY` already exists in `core/config.py` and `.env.example`, so **no new .env key**. Without it, every leg uses the fallback.

### 7.5 Frontend (Stages 4–5). `frontend/dispatcher` + `frontend/shared`

| File | Change |
|---|---|
| `frontend/shared/lib/types/cost-analytics.ts` (new) | Mirrors §4.2/§4.3 (`CostProfile`, `CostProfileUpdate`, `FleetCost` and parts). No `any`. |
| `lib/hooks/useFleetAnalytics.ts` | `useFleetCost(query, allTimeStart)` via the existing `useFleetTrend('cost', …)`. Additive. |
| `lib/hooks/useCostProfile.ts` (new) | `useCostProfile()`: the GET plus `save(update)` via `api.patch`, with `status`/`error`. |
| `lib/format/analytics.ts` | `fmtRand`, `fmtRandRate` (§5). Additive. |
| `components/analytics/fleet/costCopy.ts` (new) | §5 copy, and the rate-origin lines. |
| `components/analytics/fleet/CostKindLabel.tsx` (new) | `kind: 'estimate' \| 'waybill'` → the small label (D13). |
| `components/analytics/fleet/tabs/CostTab.tsx` (new) | The cards in §3: `ChartCard` + `TrendColumns` (operating stacked, delay, value stacked) + `CategoryBars` (lanes, `orientation='bars'`) + `DataTable`. Every card gets `source`. The headline card is a `ChartCard` with `className="lg:col-span-2"`. Takes `query`, `allTimeStart`. |
| `components/analytics/fleet/CostRatesCard.tsx` (new) | Read view, plus an edit form inside `AdminOnly` (`components/auth/AdminOnly.tsx`). It validates the same bounds as §4.2. `onSaved` → the tab calls `cost.refetch()`. |
| `app/(app)/analytics/page.tsx` | `{ id: 'cost', label: 'Cost' }` in `TABS`, `cost: DEFAULT_CONTROLS` in `INITIAL_CONTROLS`, and `{active === 'cost' && <CostTab query={query} allTimeStart={allTimeStart} />}`. |

---

## 8. Tests required

### Backend (pytest; `cd backend && source .venv/bin/activate`)

| File | Cases |
|---|---|
| `tests/unit/test_cost_model.py` (new) | **Calibration:** JHB (−26.2041, 28.0473) → DBN (−29.8587, 31.0218), 9 h, defaults → total within 5% of R20,000 · `route_km`: 0 or 1 stop → 0; 2 stops; 3 stops sum the legs; the road factor multiplies · `trip_operating_cost` parts and total · `late_hours`: None, early, exactly on time → 0, 90 min → 1.5 · `delay_cost` · `to_rand` half-up rounding · the defaults satisfy the DB check bounds · `fuel_per_km` = price × consumption · default fuel/km ≈ R17.60 |
| `tests/unit/test_lane_distance.py` (new; Redis and `compute_truck_route` patched at `app.orchestration.analytics.lane_distance`) | cache hit → no ORS call · miss → ORS called with the two precinct points, result cached · no key (`RoutingNotConfiguredError`) → estimate, nothing cached · `RoutingError` → estimate, nothing cached · Redis down → still routes (fails open) · lookup budget: only `ROUTE_LOOKUPS_PER_REQUEST` ORS calls, the rest estimated · moved precinct (new coordinates) → new cache key · A→B and B→A cached separately |
| `tests/unit/test_data_api_lockdown_coverage.py` | add `cost_profiles` (it fails until added, which is the point) |
| `tests/integration/test_cost_profile.py` (new) | GET with no row → defaults, `is_default` true · PATCH as admin → 200, one row in the DB with `updated_by_user_id`, GET returns the new values · a second PATCH updates the **same** row · partial PATCH keeps the other fields · PATCH as a plain dispatcher → 403 · no token → 401 on both · 422: a negative rate, road factor 0.9 and 2.5, consumption 0 and 250, an empty body · another org's row is never read or changed |
| `tests/integration/test_fleet_cost.py` (new; uses `_fleet_seed.seed_trip` / `add_exception`, plus a local `_add_consignment` helper) | 200 shape · operating cost matches a hand calculation for a 2-stop trip · a trip with no arrival → `trips_not_costed` and no money · delay: a late problem trip counts, a late trip with no problems doesn't, a `DISPATCHER_NOTE`-only trip isn't a problem trip, an early trip → 0 · exposure: a theft-signal trip's values summed, `SEAL_UNVERIFIED` doesn't count, the under-review/reviewed split, a null value counted in `consignments_without_value`, a trip with no consignments counted · open trips excluded · another org excluded · saved rates change the result · with routing patched to return a known distance, cost uses it and `legs_routed` counts it; with routing unavailable, the fallback is used and `legs_estimated` counts it · buckets zero-filled · lanes sorted · 401 · 422 bad period · 422 missing grain |

### Frontend (vitest; `cd frontend/dispatcher`)

| File | Cases |
|---|---|
| `lib/format/analytics.test.ts` | `fmtRand` (thousands, null → "—"), `fmtRandRate` 2 dp |
| `components/analytics/fleet/tabs/CostTab.test.tsx` (new, `RoutesTab.test.tsx` mock pattern) | headline figures with the "Estimate"/"From waybills" labels · not-costed and no-value counts shown · each card's source is in its popover · empty period → empty states, rates card still shown · error → retry |
| `components/analytics/fleet/CostRatesCard.test.tsx` (new) | non-admin: no Edit · admin: Edit → inputs → Save calls PATCH with the values → success message + `onSaved` · a bad value blocks Save with a field error · a server error is shown and the inputs keep their values · the default vs "Last changed …" footer |
| `app/(app)/analytics/page.test.tsx` | the Cost tab exists, and selecting it renders `CostTab` |

CI commands (`.github/workflows/ci.yml`):
```bash
cd backend && source .venv/bin/activate && ruff check . && python scripts/check_structure.py && lint-imports && mypy . && pytest -m "not slow"
```
```bash
cd frontend/dispatcher && npm run lint && npm run type-check && npm test && npm run build
```

---

## 9. Stages

Each stage: PLAN → build → that stage's tests → check → TASK COMPLETE → **STOP for Tom**.
Local setup: Redis in Docker; `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000`;
`cd frontend/dispatcher && npm run dev` → <http://localhost:3000/analytics?tab=cost> (Tom signs in).

### Stage 0: Baseline (no code)
`git branch --show-current` (expect `feature/fp-294-cost-analytics`), the rule-4 fetch, `alembic heads` (expect
`tim_precinct_geofence_polygon`), and both CI blocks. Record the counts in §14. Report only: do the seeded demo trips
(`scripts/seed_trips.py`) include any closed trip with a theft-signal exception? If not, the value card will be
empty in a demo. Tell Tom, and don't change the seeds. **Fence:** no edits.

### Stage 1: Pure cost model
§7.1 + `test_cost_model.py`. **Check:** the calibration test passes, and Tom reads the derivation comment.

### Stage 2: Table + rates endpoints
§4.1, §4.2, §7.2, the lockdown test, `test_cost_profile.py`. **Check:** in `/docs`, GET returns the defaults; as admin,
PATCH the fuel rate, then GET shows it; as a dispatcher, PATCH → 403. (The local test DB gets the table from `create_all`;
**the shared DB doesn't have it until Ciaran applies the migration**, so this check runs against the local DB only.)
Tell Tom to give Ciaran a heads-up about the migration.

### Stage 3: Cost query + endpoint
§4.3, §7.3, §7.6, `test_lane_distance.py`, `test_fleet_cost.py`. **Check:** `/docs` → `GET /analytics/fleet/cost` for the last 12 weeks, and the figures match a
hand calculation for one seeded trip. Without `ORS_API_KEY`, `legs_estimated` counts every leg; with it, a second load
returns `legs_routed` from the cache with no ORS call (check the backend log).

### Stage 4: Cost tab (read-only)
§7.5 except `CostRatesCard` editing (show it read-only). §5. Tests: format, `CostTab`, page. **Check (Tom, browser):** the tab,
the labels, the popovers' sources, the empty state.

### Stage 5: Rates editing
`CostRatesCard` admin form + its tests. **Check (Tom, browser, as admin):** Edit → change the delay rate → Save → the delay
figure changes. Signed in as a non-admin dispatcher: no Edit.

### Stage 6: Full checks + wrap-up
Both CI blocks; fill in §14; TASK COMPLETE flagging the shared and team files (§10 R5). Suggested commits:
`feat(db): add cost_profiles table for organisation cost rates (FP-294)` ·
`feat(api): cost profile read and admin update (FP-294)` ·
`feat(api): fleet cost analytics: operating, delay and value exposed (FP-294)` ·
`feat(dispatcher): Cost tab with provenance labels and admin rate editing (FP-294)`.
**Migration handoff for Ciaran** (paste into the PR): revision `tom_add_cost_profiles`, its parent, "apply from `dev` after merge".

---

## 10. Risks and tripwires

| # | Risk | Early warning | Fallback |
|---|---|---|---|
| R1 | The migration isn't applied on the shared DB before the demo → the Cost tab 500s there. | The PR merged without Ciaran's confirmation. | Merge before 19 Oct and confirm with Ciaran. Don't catch the missing-table error in code. |
| R2 | Another migration lands on `dev` first → two heads. | Rule 4, `alembic heads`. | Re-point `down_revision` **only if this branch's migration is unmerged**, and tell Tom. Never edit someone else's chain (CLAUDE.md). |
| R3 | The demo DB has no closed theft-signal trips → the value card is empty. | Stage 0 report. | Tom decides on a demo step (raise a seal mismatch on a demo trip). No seed edits in this work. |
| R4 | Panel challenge: "your costs are made up". | — | The labels (D13), the derivation lines in the rates card, and the calibration test. Say it in exactly these words: *estimated from rates calibrated to Bruce's JHB–DBN run*. |
| R5 | Shared and team files: `app/db/models/__init__.py` (CLAUDE.md shared list), `app/core/constants.py`, `tests/baseline/snapshots/*.json`, `endpoints/analytics.py`, `app/core/limits.py`, `lib/hooks/useFleetAnalytics.ts`, `lib/format/analytics.ts`, `analytics/page.tsx`, `frontend/shared/lib/types/*`, `tests/unit/test_data_api_lockdown_coverage.py`. | — | Additive only; flag them all in TASK COMPLETE. |
| R6 | Import-linter: `schemas` importing `analytics`, or `analytics.fleet` importing `analytics.metrics`. | `lint-imports`. | Keep the schemas free of `app.analytics`; the profile service is its own module. Never add an `ignore_imports` line. |
| R7 | Floating-point money drift. | Unit test on rounding. | Decimal throughout (rule 11). |
| R9 | ORS unavailable at the demo (no key, provider down, rate-limited). | `legs_estimated` > 0. | The fallback keeps every figure working, and the card says how many legs were estimated. Warm the cache before the demo by loading the Cost tab once with "All time". |
| R10 | First Cost-tab load is slow while legs are looked up. | Load > ~3 s. | The per-request budget (10) and concurrency (3) bound it; ORS timeout is `ORS_TIMEOUT_SECONDS` (15 s). If still slow, lower the budget constant. |
| R8 | Freeze-week time pressure. | Stage 3 not done by 17 Oct. | Ship Stages 0–4 (with default rates read-only) and tell Tom. Stage 5 is the cut line, but Tom wants editing, so raise it, don't drop it silently. |

---

## 11. Out of scope

Rate history · per-client or per-lane rates · co-driver cost (no co-driver on trips) · odometer
distance · storing routed distance on trips · costing open (not closed) trips · a headline tile on the tile row · per-consignment exposure (needs
`exceptions.consignment_id` filled in) · seed data changes · the AI brief itself (FP-295) · moving or renaming files.

---

## 12. Things found while reading (for Tom, not built here)

- `sla_configs` (`app/db/models/sla.py`) exists, but no endpoint or service uses it. It is the only other per-org config table.
- `exceptions.consignment_id` is never filled in, so exposure can only be per trip (D9).
- `trips.actual_arrival_at` is written only when the final IN_TRANSIT phase completes. So an overridden final arrival
  leaves it null, and that trip is "not costed" (D6) and has "lateness unknown" (D7).
- Trip stop `sequence` starts at 0 on the app path but at 1 in `_fleet_seed.py` and `seed_audit_pack_demo.py`. It's harmless for
  ordering, but worth making consistent after the freeze.
- No money formatter existed anywhere in the frontend before this work.
- **For FP-295:** `GET /fleet/cost` is safe to send to a model provider as it is (D16). The brief can cite card ids.
- Trips that are still open or on hold with a theft signal aren't in "value exposed" until they close (D11). A "right now" figure would be a follow-up.

---

## 13. Verification summary

On localhost, signed in as an admin dispatcher, the Cost tab shows three headline figures, each labelled "Estimate" or
"From waybills". It shows three trend charts and cost by lane, each with a source line in its popover. The rates card
shows Bruce-derived starting rates with their origins. Editing the delay rate and saving changes the delay figure
straight away. A non-admin sees no Edit. The calibration test shows the model reproduces Bruce's R20,000 JHB–DBN run
within 5%. Both CI blocks are green, `check_structure.py` and `lint-imports` are clean, there is one hand-written
migration whose `op.` lines are all intended, no new `.env` key, and `main.py` is untouched.

---

## 14. Progress

| Stage | Status | Tests (backend / dispatcher) | Notes |
|---|---|---|---|
| 0 Baseline | **DONE** (15 Oct 2026) | backend 2792 pass, 1 fail (passes alone), 4 skipped · dispatcher 2093 pass, 16 files fail to load | See 14.1. None of the failures are from this work. |
| 1 Pure cost model | **DONE** (15 Oct 2026; fuel reworked same day, §15 B1) | +26 unit tests, all pass | `app/analytics/cost_model.py`. Calibration: JHB–DBN 575.4 km (fallback distance) → fuel R10,152 + running R8,688 + driver R1,395 = **R20,235**. ruff, mypy, lint-imports clean; no new structure findings (the two old ones remain, §14.1). |
| 2 Table + rates endpoints | **DONE** (15 Oct 2026) | backend 2839 pass, 0 fail, 4 skipped (+21 integration, +1 unit) | Migration `tom_add_cost_profiles` → parent `tim_precinct_geofence_polygon`, single head; `op.` lines: create_table, RLS on / off, drop_table only. **Not applied anywhere: Ciaran applies from `dev` after merge.** ruff, lint-imports clean; mypy and check_structure show only the old findings (§14.1). B1/B2 snapshots regenerated: additions only (§15 B6). |
| 3 Cost query + endpoint | **DONE** (15 Oct 2026) | backend 2868 pass, 0 fail, 4 skipped (+15 integration, +14 unit) | `analytics/fleet/cost.py`, `orchestration/analytics/lane_distance.py`, `get_cost`, `GET /analytics/fleet/cost`. Tests patch ORS and Redis (never the real service). Snapshots regenerated: additions only (the new route, dispatcher access). mypy/check_structure: only the old findings (§14.1). |
| 4 Cost tab (read-only) | **DONE, browser check partial** (15 Oct 2026) | dispatcher +11 CostTab, +7 format, +1 page test, all pass; page.test 16/16 after `npm ci` | Lint and type-check clean (only GeofenceMap's old missing-package error before `npm ci`). Browser: the tab, tab note, View by and cards render; `GET /fleet/cost` fails on the **shared** DB (expected: `cost_profiles` not yet migrated, R1), shown as each card's "Couldn't load this chart" + Retry; other tabs unaffected. A full visual check with real numbers waits for Ciaran's migration. |
| 5 Rates editing | **DONE, browser check pending migration** (15 Oct 2026) | dispatcher 2439 pass / 181 files (+13 CostRatesCard, +13 costRates) | lint 0 errors (2 old warnings), type-check clean. `npm run build` not run (rule 9). A save can't be tried in the browser until `cost_profiles` exists on the shared DB: while the cost request fails, the card shows only its title, so no Edit button. |
| 6 Full checks + wrap-up | **DONE** (15 Oct 2026) | backend 2868 pass (Stage 3, no backend change since) + slow B7 import test 251 pass · dispatcher 2439 pass / 181 files (Stage 5) | `alembic heads` = 1 (`tom_add_cost_profiles`). Not run locally: CI's fresh-DB `alembic upgrade head` (rule 7, left to CI's throwaway DB) and `npm run build` (dev server running; CI builds). Still open: §15.1. |

### 14.1 Stage 0 findings (15 Oct 2026)

- Branch `feature/fp-294-cost-analytics`; `alembic heads` → `tim_precinct_geofence_polygon` (as §4.1 expects).
- **`git fetch origin` couldn't run from Claude's sandbox** (SSH key not available). Tom runs it and
  `git log --oneline HEAD..origin/dev` himself before Stage 1.
- Backend: ruff and lint-imports (17 kept) clean. **`check_structure.py` FAILS, already before this work** (first reported as clean in error, corrected at Stage 1): `orchestration/fleet/precincts.py::update_precinct` is 103 lines (limit 100), and `orchestration/evidence/action_location.py` grew 695 → 706. Both come from commit `81c88dc` (geofencing). Their owner fixes them; never `--update`. **mypy: 8 errors, already there before this work**, all in test files:
  7 in `tests/integration/test_precinct_polygon_assessment.py` (commit `81c88dc`, geofencing) and 1 in
  `tests/unit/test_phase_schemas.py:15` (commit `d569a65`). CI's `mypy .` fails on these until their owners fix them.
- Backend pytest: 2792 pass, 4 skipped, **1 fail**: `test_trip_pp_manifest_reads.py::test_history_search_matches_manifest_number_exactly`.
  It **passes when run alone**, so it depends on test order or shared state. Already there before this work.
- Dispatcher: lint 0 errors (2 old `<img>` warnings). **type-check fails and 16 test files fail to load**, all because
  `@geoman-io/leaflet-geoman-free` is in `package.json`/lockfile but **not installed locally** (arrived with the `dev`
  merge). Fix: `npm ci` in `frontend/dispatcher` (Tom). `analytics/page.test.tsx` is one of the 16, so this must be done before Stage 4.
  The 2093 tests that ran all pass. `npm run build` not run (rule 9).
- Demo data: `seed_trips.py` trips are all clean (no exceptions). `seed_audit_pack_demo.py` seeds **one closed trip with
  PANIC_BUTTON (reviewed) + PARCEL_COUNT_MISMATCH** and consignments R125,000 + one with **no declared value**. That covers
  the value card and the "no declared value" count (R3), provided that script has been run on the demo DB. The mismatch row
  has no explicit `review_status`; Stage 3 confirms which bucket (under review / reviewed) it lands in.

### 15.1 Still open after this work

- **Ciaran applies `tom_add_cost_profiles`** from `dev` after merge. Until then the Cost tab fails on the shared DB (R1).
- **Browser checks waiting on that migration:** the tab with real numbers (Stage 4), and an admin edit + save (Stage 5).
- **Ask Bruce** for real truck consumption (L/100 km). 53 is worked back from his fuel share, not measured (B1).
- **Watch CI's "apply the whole chain to a fresh database" step** on the PR: the first run of this migration through Alembic.
- **Old repo-wide findings, not from this work:** mypy (8, geofencing tests) and `check_structure.py` (geofencing), §14.1.

## 15. Decisions taken during the build

- **B1 (15 Oct, after Stage 1, Tom):** fuel is diesel R/L × L/100 km instead of one R/km rate (D17). Defaults R33.29/L
  (DMPR regulated inland 50ppm price, effective 7 Oct 2026) and 53 L/100 km, worked back from Bruce's "fuel ≈ half of R20,000
  over 568 km". **The 53 L/100 km is derived, not measured: ask Bruce for real consumption.** Stage 1 code and tests updated.
- **B2 (15 Oct, after Stage 1, Tom):** distance uses the truck road route from OpenRouteService per depot pair, cached, with
  straight line × 1.15 as the per-leg fallback (D5, §7.6). Reason: the routing integration (`app/integrations/routing.py`, commit
  `81c88dc`) was missed when the spec was written. **Tom has no `ORS_API_KEY` yet**: get a free key at openrouteservice.org and
  put it in `backend/.env` (the key name already exists in `.env.example`). Until then, everything uses the fallback.
- **B3 (Stage 2):** the rate bounds (`MAX_COST_RATE`, `MIN/MAX_ROAD_FACTOR`, `MAX_LITRES_PER_100KM`) live in
  `app/core/constants.py`, not `cost_model.py` as §7.1 said, because `schemas/` sits below `analytics/` in the layers
  contract and needs them. `db/models/cost.py` repeats them as literals (CLAUDE.md: `db/` imports nothing else from `app/`);
  `test_db_check_constraints_match_the_core_bounds` fails if they drift.
- **B4 (Stage 2):** no token → **403**, malformed token → **401**, matching the house convention (`test_fleet_on_time.py`),
  not "401" as §8 said. A driver token → 403.
- **B5 (Stage 2):** save is one `INSERT … ON CONFLICT (operator_organization_id) DO UPDATE`, so two admins saving at once for an
  org with no row can't hit the unique constraint. Rates not sent keep their value (the starting rates on first insert).
  The user's name is looked up directly (org-scoped) rather than importing `exceptions.review_identity`.
- **B6 (Stage 2):** `tests/baseline/snapshots/{openapi,auth_map}.json` regenerated with `UPDATE_SNAPSHOTS=1` after checking the
  diff: additions only, the two new routes (GET dispatcher; PATCH admin-dispatcher + `rate_limit:cost_profile_mutation`).
- **B7 (Stage 2):** extra validation: more than 2 decimal places on a rand rate, unknown fields, and an all-null body → 422.
- **B8 (Stage 3):** cached road distances expire after **30 days** (`CACHE_TTL_SECONDS`), not "no expiry" as §7.6 said, so a
  new bypass or a closed road is picked up eventually.
- **B9 (Stage 3):** `build_cost` takes its rates, stops and leg distances as one `CostInputs` object, and the running totals live in
  a small `_Totals` class with one method per figure. That was needed to pass the repo's ruff complexity and argument limits
  (`.claude/hooks/lint-changed.sh`). Behaviour is as §7.3.
- **B10 (Stage 3):** legs of trips that aren't costed (no arrival) are still looked up and cached. That's harmless and keeps the
  lookup independent of the costing rule. A lane whose trips were all "not costed" reports `distance_source: "road"` (no
  estimated legs). Its `operating_per_trip` is null, so the screen should show "—" for it rather than a source label.
- **B11 (Stage 3, local setup):** Tom's `backend/.env` was replaced with a teammate's copy, whose `TEST_DATABASE_URL` pointed at
  that teammate's laptop (port 5432). Fixed to the local `freightproof-test-db` container (port 5433). Other lines in that `.env`
  may also be the teammate's: compare them if the backend or the dispatcher misbehaves.
- **B12 (Stage 4):** the rates card reads `rates` from the `GET /fleet/cost` response instead of a separate
  `useCostProfile` GET (§7.5): one request, and the rates shown are exactly the ones the figures used. Stage 5 adds a hook
  only for the save. Consequence: while the cost request fails, the rates card shows only its title.
- **B13 (Stage 4):** money uses `en-ZA` formatting ("R 1 284 300", rates "R 17,64"), the South African convention, so rates
  show a decimal comma. Totals are whole rand; rates show cents.
- **B14 (Stage 5):** the form sends **only the rates that changed**, and Save stays disabled until one does. It accepts a
  decimal comma ("33,29"). The limits live once in `components/analytics/fleet/costRates.ts`, mirroring the backend's.
  The derived fuel-per-km row updates live as the admin types. Save errors show the server's message, and the inputs keep
  their values. The hook is `useSaveCostRates` (save only, see B12), not `useCostProfile` as §7.5 said.
