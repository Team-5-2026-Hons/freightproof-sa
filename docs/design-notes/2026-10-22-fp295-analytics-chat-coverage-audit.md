# FP-295 analytics chat: coverage audit (every element on /analytics × every kind of question)

**Written** 2026-10-22 by Claude, on `feature/fp-295-analytics-chat-explain` (branched from `Tom` at `5e8ccfbe`).
**Stage 0 of the "explain anything" round. No code.** Tom reads this before Stage 1 is built.

**Why this exists.** Tom asked *"what do the Cost at a glance figures tell us"* and then *"how do we come up with
operating cost, where does that number come from"*, and got *"For which period…?"* twice. The chat can answer
*figure* questions well (24/24 on the eval), but it has no way to answer *explanation* questions: what a chart is
for, why it exists, how a number is worked out. Tom's dispatcher assistant (`feature/dispatcher-assistant`) is
strong because it started with a coverage audit (`2026-10-21-dispatcher-assistant-coverage-audit.md`): every fact the
app shows was listed and given an answer route *before* building. This document does the same for the Analytics page.

---

## 1. Summary

**Two causes of the failure** (both confirmed in the code):

1. **Explanations only travel with figures.** Since B43 each figure tool's result starts with `about`, the page's own
   lines for that tab (`analytics_chat/definitions.py`). But a figure tool needs a period, and the instructions say to
   ask for one whenever none is named, so the chat can't explain anything without first asking "for which period?".
2. **The B42 "last year" question back is forced by code, whatever the question.** `period_hints.ambiguity_question`
   fires on "last year" alone and tells the model "Call no tool, and reply with exactly this question". Tom's
   follow-up contained "last year", so the method question was turned into a period question. This is my own bug.

**The audit:** 51 elements on the page (§4) × 8 kinds of question (§2) = 408 cells.

| Verdict | Meaning | Today |
|---|---|---|
| EXPLAIN | Answered from the page guide (Stage 1), with no period | **Not answerable today** (cause 1). This is the gap |
| FIGURES | Answered by the existing figure tool for that tab | OK (24/24 eval, B37–B44) |
| BOTH | Needs the guide *and* the figures ("how did we get to R 124 430?") | Figures OK; the explaining half is missing |
| REFUSE | Out of scope by project rule: predictions, ranking or naming drivers/vehicles/sites, map pin locations, telling anyone what to do | OK (prompt rules), but the refusal must still *explain* the rule (§5) |
| POINT | Not on this page; the answer names where it is | Partly: only the Live trips → Dashboard pointer exists (B43) |

**Every element gets EXPLAIN for all 8 kinds.** No element on the page is unexplainable: each has a title, an on-page
question (its purpose), a source line, and a definition in the page spec. The work is to collect that knowledge into
one place the chat can read without a period.

**What Stage 1 must hold** (one entry per element in §4, plus the page-level entry):

| Field | Kind of question it answers | Where the words come from |
|---|---|---|
| `title`, `tab`, `chart_type` | what it is, where it is | `copy.ts` / `costCopy.ts` |
| `purpose` | Q2 why it exists / what question it answers | the page's own `question` line, word for word, plus the reason from the page spec §13 or the cost spec §2 |
| `shows` | Q1 what it shows | the page's `basis` text (template, unfilled) and §5 of the page spec |
| `method` | Q3 how each number is worked out | §4 rules G1–G16 and §5 of the page spec; cost spec §2 D5–D10 and §7; the code; **thresholds read from `constants.py` and `period.ts` values, never typed in** |
| `sources` | Q4 where the data comes from | the page's `source` line, word for word (already in `definitions.py`) |
| `counted`, `left_out` | Q5 what's in and what's not | page spec §2 decisions (D8, D10, D12, D13), §4, §5 |
| `terms` | Q6 what its words mean | page notes, the constants' *why* comments |
| `odd_states` | Q7 why it looks like that | empty, faded, low-sample, "too few trips", "—" (rules G7–G9, §7.6) |
| `controls` | Q8 what the controls do | §3 of the page spec, `period.ts` presets |

---

## 2. The eight kinds of question

| # | Kind | Example (Tom's words or close to them) |
|---|---|---|
| Q1 | What does it show? | "What does the Lane risk chart show?" |
| Q2 | Why does it exist / what question does it answer? | "What's the purpose of this graph, why was it made?" |
| Q3 | How is each number worked out? | "How do we come up with operating cost?" |
| Q4 | Where does the data come from? | "Where does the cargo value come from?" |
| Q5 | What's counted and what's left out? | "Are cancelled trips in Trips over time?" |
| Q6 | What do its words mean? | "What's an override?" · "What counts as on time?" |
| Q7 | Why does it look like that? | "Why is the last bar faded?" · "Why does it say read with care?" |
| Q8 | What do the controls do? | "What does View by change?" · "What's Pattern period?" |

Plus questions about **the chat itself** ("what can you answer?", "why can't you rank drivers?", "what is the AI
spend?"), handled by the page-level entry.

---

## 3. Rules used for the verdicts

1. **The page as it is today wins over any old spec.** The specs are used for *why*; *what* and *how* are checked
   against the current code. Example: the spec says Lane risk names each dot; since 21 Oct it shows dots only.
2. **Numbers in an explanation come from code, not from prose.** A threshold (15 min early, 5 trips, 30 days, 53
   bars) is read from its constant, so the guide can't drift from what the page does.
3. **The page's own sentences are quoted word for word** (as B43 already does), with a test that fails if they drift.
4. **An explanation states no fleet figures.** It may quote rates, thresholds and dates that the guide itself holds.
   The figure guard (`number_check`) treats the guide as a source (Stage 2).
5. **Refusals still explain.** "Why can't you rank drivers?" gets the reason (page spec D13, FP-156 decision 06),
   not just "I can't".

---

## 4. Coverage table

**Today** = what the chat does now. "fig" = the figure tool for that tab answers figure questions; "—" = nothing.
Every row's eight kinds are EXPLAIN unless the row says otherwise. Sources: **PS** = page spec
`2026-09-15-fleet-analytics-page-spec.md`, **CS** = cost spec `2026-10-15-fp294-cost-analytics-spec.md`,
**copy** = `components/analytics/fleet/copy.ts`, **ccopy** = `costCopy.ts`, **K** = `app/analytics/fleet/constants.py`.

### 4.0 Page level (the frame around every tab)

| # | Element | What the guide must say (summary) | Sources | Today |
|---|---|---|---|---|
| P1 | **Scope note** ("Trends count closed trips…") | Closed trips only, grouped by the day of their first attested departure, SAST. Why departure and not completion: consistency with the driver/vehicle/site pages (PS D8). Tiles are right now | copy `scopeNote`, PS D8, G3–G4 | — |
| P2 | **Data note** (FreightProof's own records, test and demo trips included, simulated feeds) | Which checks run on simulated/mock feeds (tracker, parcels/waybills, receiver ID) | copy `dataNote` | in `about` only (needs a period) |
| P3 | **View by** (Week / Month / Year) | Groups the over-time charts' bars; weeks start Monday; max 53 bars, otherwise the option is disabled and the page switches to the next coarser grain with a note; Routes & sites has none | PS §3, K `MAX_TREND_BUCKETS`, copy `tooManyBuckets`, `grainSwitched` | — |
| P4 | **Period** and its presets | Presets depend on View by (Week: last 4/12/26 weeks, this year, all time; Month: last 3/6/12 months, this year, all time; Year: this year, last 3 years, all time; Routes & patterns: general list) + Custom range; a preset ends today and includes the unfinished week/month/year; All time starts at the organisation's first trip; end can't be after today | PS §3, G11–G12, `lib/format/period.ts` `PRESETS_BY_GRAIN` | — |
| P5 | **Information** button | Opens the page notes: scope note, data note, and the tab's note (Problems, Review desk, Cost) | `app/(app)/analytics/page.tsx` `PAGE_NOTES`, `TAB_NOTES` | — |
| P6 | **"i" on each chart** | Shows the chart's question, what it's based on, how to read it, its source, and for time charts what "faded" means | `ChartCard.tsx`, `InfoPopover` | — |
| P7 | **Show table / zoom** | The table holds every value (no hovering needed); zoom opens the same view larger | PS D27, `ChartCard.tsx` | — |
| P8 | **Faded bars** | A part week/month/year at either end of the period, or one still running (G8) | copy `chart.partialFootnote` | — |
| P9 | **"Based on only N trips, read with care"** | Shown under `LOW_SAMPLE_TRIPS` (5) trips; the chart still draws | `lib/format/period.ts` `LOW_SAMPLE_TRIPS`, copy `lowSample` | — |
| P10 | **"Not enough data yet"** / "—" / "no data" | Empty state per chart; "—" means nothing to measure (a rate with no denominator), never 0 % (G9) | PS §7.6, G9 | prompt rule only |
| P11 | **Tabs** | Seven tabs; only the open tab loads; why the tabs are split the way they are (PS D2–D3, CS D12) | PS D2, D3 | — |
| P12 | **The chat itself** | What it answers (figures and explanations), what it won't (predictions, per-driver/vehicle/site, map pin locations, advice) and why; "Based on" lines; AI spend and the monthly cap | FP-295 spec D3–D12, B44 | — |

### 4.1 Headline tiles (no period, ever)

| # | Element | Method in brief (the guide holds the full version) | Sources | Today |
|---|---|---|---|---|
| T1 | **Live trips** | Trips with status created, active or on hold (`LIVE_TRIP_STATUSES`): includes planned trips not yet departed; doesn't split them; opens the Dispatcher Dashboard's Active Trips | copy `liveTrips.sub`, PS §5.0, `tiles.count_live_trips` | fig + B43 description |
| T2 | **Critical Exceptions Waiting** | Critical problems with review status "needs review"; oldest one's age in whole days and hours; warning styling above 0; opens /exceptions | PS §5.0, `tiles.critical_waiting` | fig |
| T3 | **Licences & discs** | Active drivers' licence expiry and active vehicles' disc expiry in bands: expired, ≤ 30 d, 31–90 d, 91–180 d, no date (edges from K `EXPIRY_BAND_EDGES_DAYS`); further than 180 days isn't shown; 30 and 90 match the drivers list's red and amber | PS §5.0, K | fig |
| T4 | **Unused vehicles** | Active trucks and trailers with no trip departure in the last `TILE_WINDOW_DAYS` (30) SAST days and not on a live trip; vehicles only, never drivers (PS D13) | PS §5.0, K, `tiles.unused_vehicles` | fig + B43 |
| T5 | **Tile row source line** | "Counted live from this system's trips…" | copy `tiles.source` | in `about` |

### 4.2 Activity

| # | Element | Method in brief | Purpose (page question) | Sources | Today |
|---|---|---|---|---|---|
| A1 | **Trips over time** | Closed trips per bucket by first departure, split loaded / empty run | "Are we getting busier?" | PS 1.1, copy | fig |
| A2 | **Cancellations over time** (+ cancelled trips list) | Cancelled trips by the day they were cancelled, against every trip that **ended** in the bucket (cancelled + closed); why the note isn't shown (PS D20) | "How often are trips abandoned?" | PS 1.7, D20 | fig (**B43 fixed a wrong description**) |
| A3 | **Busy patterns** (4 charts, Departures/Arrivals switch, own Pattern period, default All time) | Driver-completed departure / in-transit steps, any trip status, dispatcher steps left out; per-occurrence averages (G13: the 31st only divided by months that have one); busiest bar highlighted; month-of-year needs a full year | "When are we busiest?" | PS 1.3, D5, G13 | fig |

### 4.3 On time

| # | Element | Method in brief | Purpose | Sources | Today |
|---|---|---|---|---|---|
| O1 | **On-time departures and arrivals** | Strict: on or before plan, no grace (PS D9); only trips with planned times; arrival = final driving leg's attested arrival (overrides don't set it); the dock/road reading note | "Are we getting more punctual?" | PS 2.1, D9 | fig |
| O2 | **How late is late** (switch) | Bands from K `EARLY_THRESHOLD_MINUTES` (15) and `LATE_BUCKET_EDGES_MINUTES` (15, 60, 180); Early + On time = the on-time count in O1 | "A little late often, or very late sometimes?" | PS 2.2, K | fig |
| O3 | **Plans vs reality** | (actual arrival − departure) − (planned arrival − planned departure), split histogram, whole period (View by doesn't change it); "faster than planned usually means the plan was too generous"; why it was redesigned twice (PS D23–D24) | "Are our planned times realistic?" | PS 2.5, D23, D24 | fig |
| O4 | *(removed)* **Where the time goes** | Removed (PS D24); per-driver step timings live on the driver pages → POINT | — | PS D24 | — |

### 4.4 Problems

| # | Element | Method in brief | Purpose | Sources | Today |
|---|---|---|---|---|---|
| R0 | **Problems tab note** | Dispatcher notes never count (PS D10, K `EXCLUDED_FROM_PROBLEMS`), so totals can be lower than on driver pages | — | copy, PS D10 | in `about` |
| R1 | **Problems over time** | Counts per bucket, warning under critical; rate per trip in the tooltip and table; why counts, not "per 100 trips" (PS D25: "400 per 100" on two trips); why it's the tab's anchor chart (PS §13: leading indicator) | "Are things getting better or worse?" | PS 3.1, D25, §13 | fig |
| R2 | **Theft warning signs** | The theft-sign types in K `THEFT_SIGNAL_TYPES` (8, listed from the constant); why "seal not checked" and "receiver ID not checked" are left out (paperwork gaps); TAPA reasoning (PS §13) | "Is theft risk going up?" | PS 3.2, D12, D25, K | fig |
| R3 | **Most common problems** | Bars per problem type with a count above 0, split by who raised it (system / driver / dispatcher); why types never created aren't listed (PS D11) | "Which problems happen most?" | PS 3.3, D11 | fig |
| R4 | **Where in the trip** | Problems by the trip step they were raised at (plan order) + "Not linked to a step"; step names as the page shows them | "At which step do problems happen?" | PS 3.4, copy `byStep.steps` | fig |
| R5 | **Risky times of day** | Share of driving minutes per SAST quarter-day (K `DAY_BLOCKS`) against share of problems raised while driving; why six-hour blocks; the late-signal caveat (PS D21) | "Is any time of day riskier than its share of driving?" | PS 3.5, D21, K | fig |

### 4.5 Review desk

| # | Element | Method in brief | Purpose | Sources | Today |
|---|---|---|---|---|---|
| V0 | **Review desk tab note** | Any trip status; legacy (migration) reviews left out. **Check in Stage 1:** the page spec (§5.4) says only critical problems enter the queue automatically, but `tiles.py` says every exception enters it now (`review_policy.initial_review_status`). The guide must state what the code does today | — | copy, PS §5.4, `tiles.py` | in `about` |
| V1 | **Waiting now, by age** | Critical, needs review, right now; bands from K `REVIEW_AGE_EDGES_HOURS` (1, 24, 72) | "How long have critical problems been waiting for review?" | PS 4.1, K | fig |
| V2 | **Is the pile growing?** | Critical problems still waiting at the end of each bucket (or now) | "Are critical problems being reviewed as fast as they arrive?" | PS 4.2 | fig |
| V3 | **How fast critical problems get reviewed** | Median (and mean) hours from raised to reviewed, by the day reviewed; medians per bucket can't be added | "How long does a critical problem wait for a dispatcher?" | PS 4.3 | fig |
| V4 | **What reviews concluded** | Every review of any severity concluded in the period, by outcome (five outcomes); a large "data discrepancy" share means false alarms; why a donut (PS D25) | "What do dispatchers find when they review?" | PS 4.4, D25 | fig |
| V5 | *(not on the page)* reviews per dispatcher | Deliberately left out (PS D13) → REFUSE, with the reason | — | PS D13 | prompt rule |

### 4.6 Evidence

| # | Element | Method in brief | Purpose | Sources | Today |
|---|---|---|---|---|---|
| E1 | **Tracker agreement** | Each attested stop step's tracker check: confirmed / no reading / mismatch; agreement = confirmed ÷ (confirmed + mismatch), no-reading outside it; driving step never checked; simulated feed; why this tab exists (PS §13: chain of custody) | "Does the truck's tracker agree with where the driver said they were?" | PS 5.1, §13, copy | fig |
| E2 | **Overrides over time** | Share of steps on closed trips a dispatcher completed for the driver; why it matters (no photos, seal or tracker check) | "How often does a dispatcher complete a step for the driver?" | PS 5.2, copy | fig |
| E3 | **Receiver sign-off** | Share of attested sign-offs scanned by the receiver's own phone; same-phone confirmations and rejected scans; live from 13 Sep 2026, so earlier periods read low | "How often does the receiver confirm the delivery on their own phone?" | PS 5.7, copy `signoff.live` | fig |
| E4 | *(removed)* **Blockchain receipts** | Removed (PS D25, D26) → explain that it was removed and why | — | PS D25, D26 | — |

### 4.7 Routes & sites (Period only, no View by)

| # | Element | Method in brief | Purpose | Sources | Today |
|---|---|---|---|---|---|
| S1 | **Busiest sites** | Pickups = attested loading steps; deliveries = attested unloading on loaded trips (an empty run's unloading isn't a delivery); top 10, "Show all" | "Which sites see the most of our trucks?" | PS 1.6, copy | fig |
| S2 | **Lane risk** | One dot per lane (origin → destination depot): trips across, problems per trip up (dispatcher notes out); faint lines at the average lane; top-right "busy and risky"; names on hover and in the table (since 21 Oct) | "Which lanes are both busy and risky?" | PS 6.3, 21 Oct chart fix | fig |
| S3 | **Driving time per lane** | First departure to final arrival per closed trip; typical = median, bad day = 90th percentile; lanes under 5 trips faded "too few trips"; the only place lanes survive in the app | "How long does each route take, on a normal day and a bad one?" | PS 2.4, copy | fig |
| S4 | **Incident map** | What it shows and why (TAPA, PS §13), whose position each pin uses, Today/This period switch. **Pin locations and per-pin details stay REFUSE/POINT** (a pin is where a named driver was, PS D14; FP-295 spec D5): the chat explains the map and points to it | "Where do problems happen?" | PS 3.6, D14, copy `incidents` | — (no tool, by design) |

### 4.8 Cost

| # | Element | Method in brief | Purpose | Sources | Today |
|---|---|---|---|---|---|
| C0 | **Cost tab note + Estimate / From waybills labels** | Why each figure is labelled (CS D13) | — | ccopy, CS D13 | in `about` |
| C1 | **Cost at a glance** (3 figures) | Operating cost (estimate), delay cost on problem trips (estimate, beside, never added: CS D8), cargo value exposed (from waybills, split under review / reviewed); the "trips", "h late over N problem trips" and "still under review" lines; trips not costed | ccopy `headline.question` | CS D6–D10 | fig |
| C2 | **Operating cost over time** | Per trip: road distance between consecutive stops (OpenRouteService HGV route, cached per depot pair; else straight line × road factor) × (fuel per km + other running per km) + driving hours × driver rate + fixed per trip; fuel per km = diesel price × consumption ÷ 100 (CS D17); trips missing a time aren't costed (CS D6). **The current rates are part of the answer** | "What did running our trips cost, and what drove it?" | CS D3, D5, D6, D17, §7.1 | fig |
| C3 | **Delay cost on problem trips** | Hours late at final arrival × delay rate, only on closed trips with at least one problem; why the delay rate is the driver plus an idle truck (CS D4); "the problem may not have caused the delay"; why the rejected "exception to next step" method was wrong (CS rejected list) | "What might lateness on trips with problems have cost us?" | CS D4, D7 | fig |
| C4 | **Cargo value exposed** | Sum of declared values of every consignment on closed trips with a theft sign; the whole load counts (exceptions aren't linked to one consignment); unknown values counted, never R0 (CS D10) | "How much cargo value was on trips with a sign of theft?" | CS D9, D10 | fig |
| C5 | **Cost by lane** | Operating cost per lane's closed trips; delay and value shown beside, not added; per trip; distance source per lane (road / estimate / mixed) | "Which routes cost the most to run?" | ccopy `lanes`, CS | fig |
| C6 | **Cost rates card** | Every rate with its unit and **where it came from** (Bruce's figures, DMPR, etc.), starting rates vs "last changed by"; only admins can edit; all figures use today's rates (no history, CS D1) | "Every estimate on this tab is worked out from these rates." | ccopy `rates`, CS D1–D4, D14, D17 | — |

---

## 5. Refusals that must still explain

| Question | Reply must say | Why (source) |
|---|---|---|
| "Which driver has the most problems?" | The page deliberately shows no driver ranking or score; per-driver figures are on each driver's own page | PS D13, FP-156 decision 06 |
| "Which dispatcher reviews fastest?" | Left out for the same reason | PS D13 |
| "Where exactly did the panic alert happen?" | The chat doesn't read pin locations (a pin is where a named driver was); the map on Routes & sites shows it | PS D14, FP-295 spec D5 |
| "Will delays get worse?" | It can't predict; offers the trend so far | FP-295 spec D12 |
| "Should we drop the Durban lane?" | It describes patterns worth looking into; it doesn't make operational calls (evidence, not operations) | CLAUDE.md "Evidence, not operations" |

---

## 6. Proposed eval questions (Stage 5, ~30, explanation only)

Drawn from the table so every tab and every kind of question is covered at least once. Tom approves the list before
the run (~$0.35).

1. How do we come up with operating cost? *(Tom's question; C2, Q3: must include the current rates)*
2. What do the Cost at a glance figures tell us? *(C1, Q1)*
3. Where does the cargo value exposed come from? *(C4, Q4)*
4. Why isn't delay cost added to operating cost? *(C1/C3, Q5)*
5. Where did the diesel price come from? *(C6, Q4)*
6. What does the Live trips tile count? *(T1, Q1/Q5)*
7. Why are planned trips in Live trips? *(T1, Q2)*
8. What counts as an unused vehicle? *(T4, Q6)*
9. What's the purpose of the Trips over time chart? *(A1, Q2)*
10. Why are trips grouped by departure date and not by when they finished? *(P1, Q2)*
11. How are cancellations counted? *(A2, Q3)*
12. How is the busy patterns average worked out? *(A3, Q3)*
13. What counts as on time? *(O1, Q6)*
14. What does "early" mean in How late is late? *(O2, Q6)*
15. What does Plans vs reality show, and why was it made? *(O3, Q1/Q2)*
16. Why aren't dispatcher notes counted as problems? *(R0, Q5)*
17. Which problem types count as theft signs, and why isn't "seal not checked" one? *(R2, Q5)*
18. Why does Problems over time show counts and not a rate per 100 trips? *(R1, Q2)*
19. How does Risky times of day decide a time is risky? *(R5, Q3)*
20. What does "Not linked to a step" mean? *(R4, Q6)*
21. What goes into the review queue? *(V0, Q5; checks the Stage 1 finding)*
22. Why is the review speed a median? *(V3, Q3)*
23. What does a big "data discrepancy" share mean? *(V4, Q6)*
24. How is tracker agreement worked out, and is the tracker real? *(E1, Q3/Q4)*
25. What's an override and why does it matter? *(E2, Q6)*
26. Why does receiver sign-off look low before mid-September? *(E3, Q7)*
27. What does the Lane risk chart show, and what do the faint lines mean? *(S2, Q1/Q6)*
28. Why are some lanes faded in Driving time per lane? *(S3, Q7)*
29. Why is the last bar faded? *(P8, Q7)*
30. What does View by change, and why can't I pick Week for all time? *(P3, Q8)*
31. How did we get to R 124 430 operating cost in the last 12 weeks? *(BOTH: figure + method)*
32. Which driver causes the most problems? *(REFUSE with reason, PS D13)*

---

## 7. Things found while auditing (for Tom, nothing changed here)

1. **Review-queue rule disagreement** (V0): page spec §5.4 says only critical problems enter the queue automatically;
   `tiles.py` says every exception enters it now. The guide will follow the code; the spec is out of date on this
   point. Worth a line to whoever owns `review_policy`.
2. **Theft sign types grew**: the page spec's D12/D25 list 6–7 types; `THEFT_SIGNAL_TYPES` now has 8 (seal
   compromised and trailer location mismatch added). The page's source line still reads correctly ("Seal,
   trailer-separation, parcel, waybill, panic and receiver-ID"). The guide reads the list from the constant.
3. **Lane risk names**: the page spec (6.3, D25) still says each dot is named; since 21 Oct only on hover. The spec
   wasn't updated in that UI change.
4. **"Problems" and severities**: the Problems over time basis says "warning and critical problems"; the chat's
   instructions say a problem count includes every severity (info, warning, critical). Nothing creates `info` today
   (PS 3.1), so the figures agree, but the guide should say the same thing as the page. Check in Stage 1.

---

## 8. What happens next

Tom reads this. On his OK, Stage 1 builds `analytics_chat/page_guide.py` holding one entry per row of §4 (P1–P12,
T1–T5, A1–A3, O1–O4, R0–R5, V0–V5, E1–E4, S1–S4, C0–C6), with the fields in §1, and the drift tests. The eval list
in §6 is confirmed or edited before Stage 5.
