# Corroboration UI, Parcel Timeline, and Per-Client Views

> **Status:** design spec, pre-implementation · **Author:** Ciaran · **Date:** 2026-08-24
> **Artifact (rendered specimens):** https://claude.ai/code/artifact/a4fd8255-7bda-46cb-a36c-72aab27c9f16
> **Parent:** [../iteration3_plan.md](../iteration3_plan.md)
> **Design system:** [../../frontend/DESIGN_SYSTEM.md](../../frontend/DESIGN_SYSTEM.md) — all specimens use its tokens

Everything the iteration 2 panel asked for reduces to two primitives: **more independent witnesses
at each custody moment**, and **patterns read across them**. Robert's analytics ask and Ammar's
attack on the handover are the same problem from opposite ends.

---

## 1. Panel feedback (iteration 2 review, transcript)

| Who | Ask |
|---|---|
| **Robert Stothers** | Tell me if a driver has a poor record *with other operators*, without exposing who. Plus: "instances along the same routes with the same drivers with similar type loads." |
| **The chair** | Quantify what you actually solve. One end-to-end use case with a number attached, before the demo. |
| **Ammar Canani** | The handover is the weak point. SIM swap defeats anything sent to a phone number. A driver can stop short of the warehouse and have a friend sign. Wants receiver-side proof via QR scanned phone-to-phone. Smart locks flagged for iteration 4. |

> **Transcript note:** the block timestamped 1:05:26–1:06:37 is attributed to Ciaran but is clearly
> the chair — it closes by inviting Ammar to comment. Fix before it reaches the write-up.

**Synthesis:** Ammar's attack is defeated by *adding a witness*. Robert's ask is *reading a pattern
across witnesses*. Build the witness layer and the analytics fall out of it.

---

## 2. Why the map is the wrong primary display

Settle this first — "put both positions on a map" is where everyone starts, and it fails for three
independent reasons, two of them technical.

1. **The map is optional and often absent.** `DriverMap.tsx` loads Google Maps via
   `@googlemaps/js-api-loader` with a deliberately optional key, because the Capacitor APK must
   build without one. It already degrades to a coordinates card. Corroboration cannot depend on a
   surface allowed not to render.
2. **It cannot draw the normal case.** A 200 m geofence on a phone-width map puts the two fixes
   ~18 m apart — under one pixel.
3. **It invites the wrong question.** A map reads as "where is the truck now". `scope-boundaries.md`
   puts live tracking on Pulsit's side. The question is historical: *at the moment this handshake
   was signed, did the independent sources agree?*

That question is **one-dimensional** — a distance against a tolerance. The primary display is
therefore scalar, not cartographic.

> **Design law, extending the one already in `DriverMap.tsx`.** That file is built around "it must
> never render a plausible-looking wrong position." Corroboration needs it one step further:
> **it must never render an unwitnessed handshake as a corroborated one.**

---

## 3. The witness glyph

The driver's self-reported fix is a **filled dot**; each independent witness is a **ring around it**.
Corroboration is drawn as the independent party enclosing the claim — and the metaphor scales,
because a second witness is a second ring.

| State | Mark | Colour | Meaning |
|---|---|---|---|
| Corroborated | ring + dot, concentric | `--ok` | Tracker fix inside fence, separation within tolerance |
| Twice corroborated | two rings + dot | `--ok` | Tracker *and* receiver scan. Delivery phases only |
| Disagreed | dot + ring pulled apart, broken line | `--err` | Raises `GPS_MISMATCH` |
| Unwitnessed | dot + dashed absent ring | `--warn` | Tracker silent. Missing witness is *drawn*, never omitted |
| Not applicable | hairline dash | `--outline-v` | Phase carries no location requirement |

### The fourth state is the point

`pulsit_geofence_confirmed` is `boolean | null`, and `PhaseLocationSection.tsx` currently renders
the null as plain-text "Awaiting Pulsit". In a list of seven phases, a neutral grey null reads as
*fine*. It is not — it means that handshake has exactly the evidence it had before Pulsit existed.

**Unwitnessed is amber, not grey, and never quieter than corroborated.** A null allowed to look
like a pass is how evidence systems quietly become decoration.

## 4. The separation gauge

A track from zero to the tolerance band with the measurement plotted on it. Past the band the scale
**breaks** and the marker pegs, carrying the real figure — 18 m and 3.1 km cannot share a linear axis.

Three states: marker inside the band (`--ok-c` fill); marker pegged past a break mark (`--err-c`);
and — importantly — **an empty dashed track** when there is no reading. An absent gauge lets the eye
skip the row; a drawn-but-empty one says *there should have been a measurement here*.

## 5. Staleness — the second axis

Agreement alone is not corroboration. `trailer_gps_snapshots.captured_at` is a separate timestamp
from the phase event's. A tracker fix taken 40 minutes before the handshake that happens to agree is
**weak** corroboration — the truck could have left and returned. Two sources agreeing about
different moments is not two sources agreeing.

| Tracker fix age | Reads as | State |
|---|---|---|
| < 2 min | Truck confirmed at gate | Corroborated |
| 2–15 min | Truck confirmed, reading 8 min old | Corroborated |
| > 15 min | Last tracker reading too old to corroborate | **Unwitnessed** |

15 minutes is borrowed from the domain, not invented — `db/models/sla.py` documents it as the Pulsit
stationary-alert threshold. Put it in `core/config.py` beside `GPS_TOLERANCE_METRES`.

## 6. Placement — the timeline gutter

One glyph per phase in a gutter column on the dispatcher's trip detail page, plus a
"6 of 7 corroborated" roll-up. The integrity of a whole trip becomes one downward glance.

This makes **the shape of one trip comparable to the shape of another** — which is exactly the
primitive the Sprint 7 analytics aggregate. Corroboration rate per driver, lane and facility is this
column, counted.

## 7. Evidence tier — promote, don't add a widget

`EvidenceTag` is already "the most important domain component" per the design system. Corroboration
should *drive* it rather than compete with it.

| What backs the handshake | Tier |
|---|---|
| Driver's attestation alone | Baseline |
| Phone fix inside the geofence — one source | Medium Evidence |
| Phone fix *and* a fresh tracker fix agreeing | High Evidence |
| Two corroborating sources, anchored to Hedera HCS | Highest — Primary Evidence |

A **disagreement does not demote the tier** — it routes to `GPS_MISMATCH`. A mismatch is not weaker
evidence, it is strong evidence of something else. Downgrading it to "Medium" would hide the most
valuable record the platform can produce.

> **Open decision:** this changes what "High Evidence" means on phase events already anchored in
> iteration 2. Domain call, not styling.

## 8. Driver side — record, never block, never accuse

Do **not** gate the handshake on the geofence check.

1. Blocking a driver is *operating*, not recording — fails the scope spine.
2. Bruce ruled directly: trusted-driver pool is the fraud control, **not** on-the-spot verification
   (3 Mar); driver communication must minimise distraction.
3. A flat tracker battery in a dead zone would stop a legitimate driver completing a legitimate
   handshake — the evidence platform making operational decisions on bad data.

The driver gets a passive strip using the `sat` icon (already reserved for "GPS / Pulsit geofence
reading"), and **the swipe stays enabled in every state**. Copy for the null case:
*"No tracker reading — your position is still recorded."*

---

## 9. The handover gap (Ammar) — and a correction

**Verified 2026-08-24: there is no receiver OTP.** Zero hits for `receiver` or `consignee` in models
or endpoints; `frontend/client-portal/` contains only a README; no Twilio or SendGrid integration
exists. The receiver flow is **documentation only** — `CLAUDE.md` and the client-portal README
describe it as a plan.

**What does exist is the driver login** — phone OTP through Supabase over a WhatsApp sandbox
(`app/login/page.tsx` → `app/otp/page.tsx`; `people.py:37` records that drivers authenticate by
phone, not email). That is live code and it is the surface Ammar was actually describing. A SIM swap
there does not fake a signature — it takes over a driver's whole account.

So there are two jobs:
- **Receiver handover** — a free design decision, still on paper.
- **Driver authentication** — a live weakness needing device binding at enrolment, so a fresh SIM on
  an unknown handset cannot silently inherit a driver's identity. Separate spike; name it on the
  iteration 3 risk list.

### The QR handover

Keep the no-account principle by **moving the secret off the network and onto the glass**:

1. Driver's device displays a QR encoding a one-time capability token bound to *this* trip, *this*
   stop, a nonce and a short expiry (~5 min).
2. Receiver scans with their ordinary phone camera. No install, no account, no SIM in the loop.
3. The scan opens a page that captures the receiver's own position and posts the confirmation
   against that capability token.

**Why it beats the OTP on each of Ammar's points:**
- **SIM swap gains nothing** — the token never travels over SMS or WhatsApp; it is transferred
  optically, in person, and expires.
- **It proves physical co-presence** — the receiver stood in front of the driver's screen.
- **It supplies a third independent fix** — the receiver's device reports position at receipt, from
  a party with no incentive to help the driver. Ammar's "stop short and have a friend sign" attack
  lands *outside* the delivery precinct and is recorded as a mismatch by the same geofence machinery.

**Residual weakness, state it yourself:** a *colluding* receiver at the correct location still
defeats this, and no handover mechanism survives both parties colluding. What FreightProof can do is
make collusion leave a trace — the receiver's device and position are anchored, so the same
"receiver" recurring across unrelated deliveries surfaces in the recurrence analytics.

**Smart locks** (Ammar's iteration 4 suggestion) fit with one boundary held: FreightProof **records**
the unlock event as a further witness; it never **commands** the unlock. Commanding it would move the
platform from recording into operating.

---

## 10. Parcel search — the capability Bruce called the market gap

**This is a headline feature of iteration 3, not a supporting view.** Bruce said so twice.

> **Introductory meeting:** "while tracking the 18-meter truck (the asset) is common, there is a
> massive gap in tracking the **individual parcel** within that asset (deconsolidation)."

> **24 June 2026, minutes §6.1:** "Parcel-level tracking is **very important**. A key use case is
> dispute resolution: if a client reports a missing parcel, LFG needs to determine whether the
> parcel was in their custody and, **if so, at which point in the journey it left**. FreightProof's
> ability to search a specific parcel reference and trace it through loading events, in-transit
> checkpoints and delivery handshakes was confirmed as **a significant capability gap in the
> current market**."

And then his next paragraph sets the constraint that shapes the whole design:

> **§6.2:** "LFG therefore **cannot track at individual parcel level** — only at the consolidated
> unit/pallet level. FreightProof should track at the **unit level**… FedEx's internal systems
> (Parcel Perfect) hold the parcel-to-pallet mapping."

**Both are true at once, and holding both is the design problem. Search is by parcel; custody is by
unit.** A view showing per-parcel custody events would have to invent observations LFG never made —
fabricated evidence, fatal on this platform. The honest view answers Bruce's question exactly as he
framed it: *was it in our custody, and where did it leave?*

The driver never scans parcels — Parcel Perfect does, at the branch. Load Factor receives a sealed
unit and cannot see inside it, which is the point of sealing it.

### Answer "where is it" before "where has it been"

`Parcel.status` is a four-value enum (`pending` / `scanned_out` / `scanned_in` / `exception`) that
answers *now* crudely while overwriting its own history. The view leads with a current-state header —
last known position (from the trip's phase ledger), custody state, and PP scan status — and puts the
history spine beneath it.

A parcel's history is therefore two different kinds of knowledge, and blending them lies by omission:

- **Reported** — Parcel Perfect scans, per-parcel, accurate but unanchored and unwitnessed by FreightProof.
- **Inherited** — during the linehaul the parcel was sealed inside a consignment. Nobody could see
  inside, but the *load's* custody chain is anchored and corroborated, so the parcel's position is
  inherited from the sealed unit.

Every courier tracking page renders these identically. **Rendering them differently is the
differentiator, drawn.**

### The spine

Reported events use a muted hollow square; anchored events use the witness glyph. The linehaul
window is wrapped in a **sealed band** — a `--chain`-bordered rail labelled
*"Sealed — contents not observable · seal 44192"* — containing the anchored custody phases.

### The payoff: bounded loss

Worked example. Parcel scanned out at the origin branch, loaded into CN-0412 (18 units, seal
applied intact), departed, unloaded at destination with **seal intact and 18 units**, then **no
scan-in at the destination branch**.

> The parcel entered a sealed unit and the seal was never broken — verified at departure, verified at
> arrival, corroborated by two witnesses at each. Eighteen units in, eighteen units out. So the
> parcel cannot have left during the linehaul, and the loss is **bounded to the branch handling
> either side of it.** FreightProof did not find the parcel. It proved where the parcel *cannot*
> have been lost, and handed the dispute back with a much smaller search.

This directly implements `scope-boundaries.md` §1: *"correlates Parcel Perfect scans against the
anchored custody chain so a loss can be proven and bounded to a segment."*

**Cost: no migration.** Parcel → consignment → trip → `phase_events` → `trip_stops` is already
navigable, and `Parcel` already carries `barcode`, `pp_scan_out_at`, `pp_scan_in_at`. The sealed band
is the trip's phase ledger filtered to the window between the consignment's pickup and delivery stops.

### ⚠ Blocking question — the pallet grain

The band above is drawn at **waybill** grain. Bruce's 24 June grain is the **pallet**, which sits
between waybill and parcel:

> "a 10-pallet shipment may contain parcels from multiple FedEx clients across different pallets.
> LFG tracks each pallet as a unit."

If that holds, a parcel's sealed window is *its pallet's* journey rather than the whole waybill's —
which bounds a loss far more tightly and is a materially better answer for the dispute.

**Current state, verified 2026-08-24:**
- There is **no `HandlingUnit` model**. Not built.
- What exists is `Consignment.unit_count_expected` — a pallet *count* with no pallet *entity*
  (`trips.py:83-85`), so the system cannot say which pallet a parcel was on.
- `manifest_service.py:124` sums pallets for the driver's count; `phase_meta.py:49` notes the driver
  counts pallets, never parcels.

**This is [facility_visit_findings_2026-07-16.md](../facility_visit_findings_2026-07-16.md) open
question §6.8, still unanswered.** The July visit reframed the hierarchy to
`manifest → waybill → piece`, which drops pallets entirely, and ruled: *"keep the concept parked —
do not delete it and do not bake it in — until Bruce/LFG confirm."* That document also warns
explicitly about "the way the 'pallet grain' assumption nearly was" cemented as fact.

The question was parked when nothing depended on it. **Iteration 3 builds the parcel view, so it now
sets the grain of the best screen in the demo.** Ask Bruce before Sprint 6 gets far — it is a
five-minute question with a large downstream consequence (`HandlingUnit` entity + migration, or not).

---

## 11. Per-client views — a lens, not a portal

Multi-client break-bulk creates a tension: **the trip is the evidence unit, but one trip carries
several clients.** FedEx must see their cargo's custody chain is sound without learning who else was
on the truck, what they shipped, or what it was worth.

The resolution is the principle already used on the realtime channel and on Hedera — **share the
proof, never the contents.** Corroboration evidence is about the *vehicle and the driver*, not the
cargo, so it can be shown in full. Co-loaded consignments become anonymous mass.

| Shown | Withheld |
|---|---|
| Your consignment CN-0412 · 18 units | Who the other 3 clients are |
| Full custody chain, all 7 phases | Their contents, refs or values |
| Witness state per phase | Their exceptions |
| Seal history · 44192 | Driver's continuous GPS trail |
| Exceptions touching your cargo | Driver ID number and personal detail |
| "Travelled alongside 3 other consignments" | Raw coordinates — forensics only |

"Travelled alongside 3 other consignments" is the load-bearing sentence: honest about consolidation,
leaking nothing commercial. **A count is not an identity.**

> **Build it as a view-as-client toggle in the dispatcher, not as the portal.** `client-portal/` is
> still just a README, and a third frontend while two features land is how iterations slip. The lens
> is zero new surface *and* its own test harness — if a dispatcher sees something through the lens
> the client shouldn't, the redaction bug is visible immediately. When the portal is eventually
> scaffolded, it renders the lens and nothing else.

`trip_location_pings` is the sharpest line. Its module docstring calls it the sharpest POPIA case in
the schema — a movement trail of a named person, *"materially more sensitive than a fix attached to
an evidence event"* — readable only through the trip's authorisation path. It **never** crosses the lens, at any tier. Clients get fixes attached to evidence events;
never the trail between them.

---

## 12. Analytics the panel asked for

### Tier 1 — operational, no privacy question

Driver, vehicle and lane grains as per [../iteration3_plan.md](../iteration3_plan.md) §2, plus:

**Facility — corroboration rate per precinct.** The row nobody asks for and everybody needs:
entirely non-personal, immediately actionable, and the control that stops driver metrics being read
naively. A site failing often has a misconfigured geofence or bad signal, not dishonest drivers.

### Tier 2 — Robert's recurrence detector

He described the query almost exactly: *"instances along the same routes with the same drivers with
similar type loads."* That is a `GROUP BY` with a `HAVING` clause, not machine learning. Within one
operator it raises no privacy question — the operator already knows all of it.

Two rules make it defensible rather than accusatory:
1. **Every row is a count with its evidence one click away**, never an opaque score.
2. **The grouping always shows what varied.** A "count short at Isando across three different
   drivers" row *exonerates* the drivers by showing the constant is the facility — precisely the
   reasoning a bare driver leaderboard destroys.

### Tier 3 — cross-operator reputation

**The naive version is broken, and saying so is worth marks.** Hashing a driver's ID number and
sharing counts against the hash does not pseudonymise anything: a South African ID is thirteen digits
with heavy internal structure (DOB, sequence, citizenship, checksum). The search space is enumerable
offline, so the hash reverses in minutes. A pseudonym that can be reversed is not a pseudonym.

| Approach | Cost | Problem |
|---|---|---|
| Network-wide secret pepper held by the platform | Low | Makes FreightProof the trusted central party — undercuts the decentralisation argument |
| Verifiable credentials / blind signatures | High | Correct, and far beyond one honours iteration |
| **Consent-gated portable record** | Medium | Needs a consent flow and onboarding change — but POPIA-native, and it reframes the product |

> **The reframe that makes it work.** It is not *the operator's dossier on a driver*. It is **the
> driver's portable record, which the driver owns and chooses to present** — like a credit record or
> certificate of service. A driver with a clean anchored history can *prove* it when changing
> employers, which is worth real money to a good driver. Robert gets his reliability signal; the
> driver gets an asset instead of a surveillance file.

That satisfies POPIA the right way round: lawful basis by consent, purpose limitation in the query,
and — critically for **s71** — the system surfaces *facts a human then judges*, never an automated
score with employment consequences. The record is visible to the driver and contestable, which a
hidden industry blacklist could never be.

**This is the feature that finally justifies the blockchain.** Almost everything FreightProof does
today could be a well-audited database. A cross-operator reputation count must be unforgeable by any
single operator, unsuppressable by the operator who looks bad, and verifiable without a trusted
intermediary. That is exactly and only what an append-only public ledger provides.

**Scope honestly:** do *not* claim a live inter-operator network. Design the scheme, document the
cryptography including what was not solved, and demo the mechanism with two mock organisations on the
same testnet topic. Natural iteration 4 headline.

---

## 13. Quantifying what we solve

Four numbers, computed from the existing schema, shown once at the start of the demo.

| Tile | Source |
|---|---|
| Cargo value under anchored evidence | Sum of declared consignment value on trips with complete chains |
| Handshakes with two or more independent witnesses | Witness count from the glyph states |
| Trips closing with an unbroken evidence chain | Proportion closing without a broken link |
| **Median time to produce proof, vs the manual baseline** | **BLOCKED — needs a real figure from Bruce** |

The fourth is deliberately blank and it is the most important. Time-to-proof is the number that sells
the platform — today a disputed delivery means days of phoning depots; here it is an export. **Do not
put an invented number on a slide in front of an industry panel.**

---

## 14. Copy — system language → human language

| Before | After |
|---|---|
| `Pulsit geofence: Confirmed ✓` | Truck confirmed at gate |
| `Pulsit geofence: Mismatch ✗` | Truck was 3.1 km away when this was signed |
| `Pulsit geofence: Awaiting Pulsit` | No tracker reading — driver's position only |
| `Driver / vehicle separation: 18 m` | Driver and truck 18 m apart |

"Truck was 3.1 km away when this was signed" is the sentence that wins the demo. It states a fact,
names the moment, and lets the room draw its own conclusion.

---

## 15. Progressive disclosure

Rides the existing D2 forensics toggle rather than adding a second disclosure mechanism.

| View | Shows |
|---|---|
| Normal dispatcher | Glyph, chip, one plain sentence |
| Trip detail, expanded | Separation gauge, tracker fix age, precinct and radius |
| Forensics (admin) | Raw coordinate pairs, haversine result, tolerance, `pulsit_device_id`, `captured_at`, receiver scan token, Hedera anchor |

The ring diagram — fence at true scale with a metre-scale inset — belongs at the forensics layer
only: the one place someone builds an argument from it rather than scanning.

---

## 16. Build order

> **Superseded for scheduling, 2026-08-25.** This table is still the best UI-level breakdown of the
> work and the only place the pieces are costed individually — but it is no longer the schedule.
> Sprint assignment lives in [../iteration3_plan.md](../iteration3_plan.md) §5, and two rows below
> (parcel spine UI, client lens) are contested cuts pending a team decision. The rendered artifact
> now carries the recommended sequence and the one real alternative to it.


| Piece | Where | Cost |
|---|---|---|
| `WitnessGlyph` — 5 states, pure SVG, no deps | new, `components/domain/` | Small |
| `SeparationGauge` — broken-scale track | new, `components/domain/` | Small |
| Rewrite `PhaseLocationSection` around both | exists today | Small — `lib/phase/geo.ts` already computes the numbers |
| Glyph gutter on trip timeline + roll-up | `PhaseChain` / trip detail | Medium |
| Freshness threshold in `core/config.py`, applied in `geofence_service` | backend | Small |
| Parcel timeline endpoint — barcode → derived ledger history | backend, no migration | Small |
| Parcel spine UI with sealed band + bounded-loss callout | dispatcher | Medium — the demo's best screen |
| Client lens — view-as-client toggle + redaction rules | dispatcher | Medium |
| Tier 1 analytics + facility corroboration rate | `app/analytics/` | Medium |
| Recurrence detector + evidence-linked rows | `app/analytics/`, dispatcher | Medium |
| Impact panel — three tiles now, fourth when Bruce answers | dispatcher | Small |
| Passive strip on driver phase step | `PhaseStepPageClient` | Small |
| Evidence-tier derivation from witness count | `EvidenceTag` call sites | Medium — decide the rule first |
| QR capability-token handover + receiver scan page | driver PWA + new route | Large — but replaces nothing built |
| Driver-auth device binding spike | `auth/`, driver PWA | Spike — risk list |
| Cross-operator reputation — design + two-org simulation | spike, then iteration 4 | Defer |
| Forensics ring diagram, smart-lock witness | behind D2 toggle / iteration 4 | Defer |

The first three are roughly a day and cover the corroboration demo.

---

## 17. Decisions needed

> **Updated 2026-08-25.** Decision 2 below is **closed** — Ammar asked for the QR handover directly
> and in detail in the Q&A, and since no receiver OTP was ever built there is nothing to migrate.
> The remaining decisions each now carry a recommendation *and* the alternative, in the rendered
> artifact. Two new design decisions joined them: what happens when the receiver cannot scan, and
> what a live tamper alert actually looks like on the dispatcher's screen. The full fourteen-item
> agenda — including the Jira reset and the items for Bruce — is in the *Before Sprint 6* artifact.


1. **Does corroboration drive `EvidenceTag`?** Changes what "High Evidence" means on already-anchored iteration 2 events.
2. **Does the QR handover replace the receiver OTP?** Nothing is built, so the only cost is the decision. Contradicts `CLAUDE.md`; needs team + Bruce.
3. **How far on cross-operator reputation?** Recommend: spike now, two-org simulation iteration 4.
4. **Driver-auth device binding?** Live code, unlike the handover. Recommend spike + risk-list entry now; raise with Ammar unprompted.
5. **Pallet grain — does a `HandlingUnit` sit between waybill and parcel?** Not a team decision — a
   question for Bruce, and the only genuinely **blocking** item. Sets the precision of the parcel
   view. Site-visit open question §6.8, parked since July. Ask this week. See §10.
