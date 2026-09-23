# Insurer Audit Trail: Audit Pack PDF + Interactive Evidence Page — Build Plan

> **Status:** built (Stages 1–7), not yet merged · **Author:** Tim (drafted with Claude) · **Date:** 2026-09-23
> **Overlaps:** FP-161 *"Evidence packet export — what an insurer would actually need"* (owner: **Thomas**).
> Stage 0 below settles ownership before any code is written.
> **Branch this was drafted on:** `Feat-ValueAddedDocumentation`

---

## Build log (update after every stage — a resumed session starts here)

Tim waived the Stage 0 team gate on 2026-09-23 ("this is for me and its my addition"), so the
build goes straight through. Still: no commits, no `alembic upgrade` on the shared DB, and flag
shared-file edits. Run tests with
`cd backend && TEST_DATABASE_URL="postgresql+asyncpg://timgultig@localhost:5433/freightproof_test" .venv/bin/pytest -q <paths>`.

| Stage | State | Notes |
|---|---|---|
| 1 Manifest | **done** | `schemas/audit_pack.py`, `orchestration/audit_pack_analysis.py` (33 unit), `orchestration/audit_pack_builder.py` (17 integration, seed in `tests/integration/audit_pack_seed.py`), `GET /api/v1/trips/{id}/audit-trail/preview` in `api/v1/endpoints/audit_packs.py` (7 integration). Shared: `main.py` router, `core/limits.py` AUDIT_PACK_BUILD |
| 2 PDF | **done** | `app/reporting/` (route_svg.py, pdf_renderer.py, templates/audit_pack.html.j2 + .css), `GET .../audit-trail/preview.pdf`, `orchestration/audit_pack_service.render_preview_pdf`, `IncidentSummary` in manifest, `core/display.py`. Deps: weasyprint 70, jinja2 (requirements.txt), pypdf (dev). Dockerfile apt: pango/harfbuzz/dejavu — **container build NOT verified (no Docker on Tim's Mac)**; check on first Railway deploy. `mirror_base_url()` added to blockchain/hedera.py. `mypy.ini` weasyprint stanza |
| 3 Issue/seal/revoke | **done** | Models `db/models/audit_packs.py` (AuditPack, AuditPackAccessEvent; registered in models/__init__). Migration `migrations/versions/2026_09_23_tim_add_audit_packs.py` (rev `tim_add_audit_packs` ← `tim_driver_location_mismatch`), hand-written, DDL validated on a scratch PG17 DB — **NOT applied to shared dev DB; apply from `dev` after merge**. Service: issue/list/revoke/download in `audit_pack_service.py` (issue is in-request, anchor fail-open). Endpoints: `POST/GET /trips/{id}/audit-packs`, `GET /audit-packs/{id}`, `POST /audit-packs/{id}/revoke`, `GET /audit-packs/{id}/access-events`, `GET /audit-packs/{id}/pdf` (re-hashes before serving, 409 if altered). Storage: `upload_audit_pack_pdf`/`download_audit_pack_pdf` (prefix `audit-packs/` in evidence bucket). Config: `AUDIT_PACK_PORTAL_BASE_URL` (+ .env.example). Enums: SubjectType.AUDIT_PACK, BlockchainReceiptType.AUDIT_PACK_ISSUED, AuditPackAccessEventType, `enum_text()`. Deviation from plan 3.3: seal verification will live in the public verify endpoint (Stage 4), not `verify_subject`, to avoid touching blockchain/subject_visibility |
| 4 Share link + page | **done** | Public API `api/v1/endpoints/audit_packs_public.py`: `GET /public/audit-packs/{token}` (view), `/{token}/pdf`, `/{token}/artifacts/{id}` (only manifest-named files), `POST /{token}/verify` (live re-check + seal + records-added count), `GET /public/audit-packs/seal/{pack_id}` (PDF's verify URL, no evidence). Service `orchestration/audit_pack_access.py`. 410 for revoked/expired returned as a response (not raised) so the denied log commits. CORS folds in `AUDIT_PACK_PORTAL_BASE_URL`. `subject_visibility` gained AUDIT_PACK (tenant test updated). **Full suite 2041 passed, 0 failed.** Portal: `frontend/client-portal` (Next 15, port 3003, Node 22 via `nvm use 22`): `/p/[token]` PackViewer, `/v/[packId]` SealCheck. `npm run build` OK |

| 5 Interactive evidence | **done** | Timeline (`lib/timeline.ts`), Leaflet `RouteMap` (layers, dashed gaps, tiles with `referrerPolicy: strict-origin`), `EventDetail` + `EvidencePhoto`, Sections (cargo, exceptions, parties, coverage, integrity, data protection). Checked by screenshot at 1400px and at a true 390px (Playwright; headless Chrome can't go below 500px) |
| 6 Browser verification | **done** | `lib/verify.ts`: hashes the server's canonical string (no TS canonicaliser), mirror check with timeout, `unavailable` ≠ mismatch. Vectors from backend in `test/fixtures/verify-vectors.json` (incl. non-ASCII). Photo byte check, PDF copy check against the **sealed** payload's pdf_sha256. 31 portal tests green, eslint + tsc clean |
| Dispatcher UI | **done** | New "Audit packs" tab on trip detail (`TripPanel` gains `'audit'`): `components/trips/AuditPacksPanel.tsx` (list, status chip, seal, views, PDF, access log, revoke, preview), `components/domain/IssueAuditPackDialog.tsx` (issue form → share link shown once). `lib/api/auditPacks.ts`, `lib/types/auditPack.ts`, `lib/hooks/useAuditPacks.ts`; `api.getBlob` added to `lib/api/client.ts`. Dispatcher suite 1034 passed |
| 7 Claims extras | **done** (except 7.5) | Incident declarations: `incident_declarations` table (in the same migration), `orchestration/incident_declaration_service.py`, `POST/GET /trips/{id}/incident-declarations` (any dispatcher), manifest `declarations` + `latest_declared_facts()`, observations `notifications.*` (TAPA 9.3.1 24h client rule). Incident fact sheet: `reporting/incident_sheet.py` + template, `GET .../audit-trail/incident-sheet.pdf` (admin, 409 if no critical incident) and public `/{token}/incident-sheet.pdf` from the frozen snapshot; TAPA category shown as a suggestion. ECT s15(3) methodology + s15(4) certificate pages in the PDF (template, not legally reviewed). Portal + dispatcher UI for both. **Not built: 7.5 email OTP before first view.** Docs: runbook §4a, demo-script §9, client-portal README |
| 8 Anchor exceptions/Merkle | not started | Needs an explicit decision on the `exceptions.gps_*` "never hashed" rule (see §11 Stage 8) |

**Final verification (2026-09-23):** backend full suite 2067 passed / 0 failed; dispatcher 1043 passed; portal 32 passed; ruff, mypy, eslint and tsc clean on all new code (pre-existing mypy errors in action_location_service / dev_truck_service / proximity_service and 2 ruff errors in the 6ee6103df09a merge migration are untouched). Migration DDL validated on a scratch PG17 database; **not applied to the shared dev DB**.

---

## 0. Handoff block (paste this first in any new session)

FreightProof already records a trip's full custody chain: a phase ledger (P0–P6), seal numbers and
photos, parcel counts, driver-phone GPS pings, tracker fixes at each handshake, exceptions and the
dispatcher's review of each one, and receiver identity checks. Three moments are anchored to Hedera
HCS: trip creation (journey lock), departure, and confirmation. Departure and confirmation also commit
their photo hashes (FP-154).
**Nothing turns that into something an insurer, loss adjuster or SAPS detective can use.** This plan
adds an **Audit Pack**. It is a frozen, versioned snapshot of one trip (or one consignment) that is:

1. rendered as a **PDF** that is hashed, stored and anchored to Hedera when issued, and
2. published on a **zero-login interactive page**, opened through an expiring, revocable share link.
   The page has a timeline, a multi-source map, the cargo reconciliation and exceptions, and
   **verification in the insurer's own browser** against the public Hedera mirror node. The insurer
   does not have to trust FreightProof to check the anchors.

The content is driven by what claims actually require (§2). The main sources are a real South African
goods-in-transit claim form, TAPA TSR 2023, ECT Act s15, and published insurer/adjuster guidance.
Every fact in the pack carries an **evidence tier** (Anchored / Corroborated / Recorded / Declared), so
the document never implies that an unanchored record is chain-verified. That was the reviewer's
warning on FP-161.

**Chosen approach:** a server-side snapshot → WeasyPrint PDF → anchor → capability-token link →
Next.js page in `frontend/client-portal/`, whose README already reserves it for "downloadable PDF
evidence reports". **Done so far:** Stages 1–7 built and tested (see the Build log). **Next:** apply the migration from `dev` after merge, deploy the client portal (runbook §4a), then decide on Stage 8.

---

## 1. Why this is the highest-value feature left

- **Bruce framed the insurer as the buyer of evidence** (16 Apr): *"a stable, blockchain-backed
  evidence package that insurers can rely on for claims assessments."* Clients only look closely
  when something goes wrong, which is when this pack is needed (26 Mar minutes, §6).
- **The Iteration 2 panel flagged the insurer gap:** *"We need to look into what the insurers would
  need"*. Their notes add: *"Nobody has modelled the insurer, and they are the commercial buyer of
  evidence. An `EvidencePacket` dispatcher component exists with no export path."*
  (`docs/iteration2-feedback-response-2026-08-25.md` §4.3).
- **The pack turns data that already exists into business value.** Almost everything in §2 is
  already captured. The work is assembling it, presenting it honestly, and making it independently
  verifiable.
- **Scale of the problem (context for the report, not for the product):** SAPS figures show about
  420 trucks hijacked in Q2 2025 and 9,068 between Jan 2021 and Dec 2025, with Gauteng accounting
  for more than 60%. TAPA EMEA recorded R577m in direct cargo losses across 2,670 SA incidents in
  one 18-month window, while only 3.4% of incidents reported a value. *(Re-verify against primary
  sources before quoting in the report; see §14.)*

---

## 2. Research: what insurers, adjusters and police actually ask for

### 2.1 The four proofs an insurer needs for a cargo theft claim

Across the insurer and adjuster sources (Tive, LogRock, MiWay, Mont Blanc), a theft claim rests on four
proofs:

| Proof | What it means | What loses the claim |
|---|---|---|
| **Value** | Invoice or declared value, what and how much was loaded | Valuation disputes; paperwork that is "wrong, incomplete or contradictory" |
| **Custody** | An unbroken record of who controlled the freight at each stage | "Broken chain of custody", listed as a top denial reason |
| **Breach time and place** | Where and when the loss happened, backed by GPS | Multi-hour gaps in the record "that insurers use to challenge claims" |
| **Prompt notification** | When the operator, police and insurer were told | Late reporting. Every policy wants "prompt" notice; TAPA wants the client told within 24h. For SASRIA (civil-unrest) claims, a police case "ideally within 48 hours" |

Other common denial reasons: **insider dishonesty** (not covered under standard cargo forms), and
**unattended vehicle or security-condition breaches**, such as stopping outside approved places.

### 2.2 A real South African goods-in-transit claim form

This is the Carl Greaves Brokers GIT claim form (FSP 13147), used here as a primary source. It asks for the following, and FreightProof can answer most of it:

- **§2 Date and place of the event**, including the time.
- **§3 Vehicle:** make/type, registration, trailer, and owner.
- **§6 Goods:** description, number of packages, value, owner of the goods, when and where they were
  loaded, who loaded and unloaded, **driver name and ID number**, *"Did the driver check the
  consignment?"*, *"Were clean receipts given at the time of loading?"*, and how the goods were packed.
- **§7 Circumstances:** the full journey, *"What action did the driver take immediately after the
  loss?"*, *"Have consignees accepted delivery?"*, and the conditions of carriage used.
- **§8 Police:** *"NB!! All losses must be reported to the police"*, plus station, **case number**,
  officer, and date reported.
- **Required attachments:** contract of carriage or load confirmation, driver's statement, supplier
  invoice, **SAPS case number**, horse and trailer **roadworthy and licence certificates**, an itemised
  claim, a **signed delivery note or waybill**, and the driver's **PrDP and licence**.

### 2.3 TAPA TSR 2023 (the security standard insurers and shippers recognise)

These requirements come from TSR 2023 Appendix A (hard-sided truck), and the pack should evidence them:

| Req. | Requirement | Where it shows up in the pack |
|---|---|---|
| 9.3.1 | Notify the Buyer (client) of suspected theft **within 24 hours**; notify law enforcement immediately | Notification times, from the review log plus declared fields |
| 9.11.5 / 9.24 | Controlled tamper-evident seals (ISO 17712), with records of who applies and removes them | Seal chain section |
| 9.14.9–10 | Tracker must report tampering, **truck stoppage**, battery, **door opening**, trailer untethering | Tracker-event layer, when Pulsit supplies it |
| 9.17.2 | Alert on tracker failure or GPS loss | **GPS coverage gaps** shown explicitly |
| 9.19.3 | Report ad-hoc route or stop changes to the Buyer | Route-deviation exceptions |
| 9.21 | Protocol for unscheduled stops; notify the Buyer within 24h | Stationary periods outside precincts |
| 9.22.3 | Check trailer, lock and seal integrity before and after every stop | Checkpoints and seal checks |
| 9.30.1 | Verify box/pallet counts before loading and after discharge; **keep records ≥ 2 years** | Count reconciliation; retention policy |
| 9.31.2 | Shipping docs must show collection/delivery time and date, driver signature, shipper and receiver signatures, shipment details | Custody timeline and POD |

### 2.4 SAPS and police reporting

- Reporting a crime opens a docket with a **CAS number**. The claim form asks for the station, CAS
  number, officer, and the date reported.
- A detective needs to know when and where the incident happened, the vehicle and trailer
  registrations, the cargo description and value, the driver, the last known location, and the
  tracking provider. **That list is the "Incident Fact Sheet" (§3.3).**
- FreightProof must **record** these declared facts. It must not file anything with SAPS or take part
  in the response. That keeps the scope spine intact.

### 2.5 Evidential weight in South African law (ECT Act 25 of 2002)

- **s15(1):** a data message may not be excluded as evidence just because it is electronic.
- **s15(3):** its weight depends on *"the reliability of the manner in which the data message was
  generated, stored or communicated… the reliability of the manner in which the integrity of the data
  message was maintained… the manner in which its originator was identified"*.
  → **The pack's methodology appendix should answer these three points one by one.**
- **s15(4):** a data message *"made by a person in the ordinary course of business, or a copy or
  printout of or an extract from such data message **certified to be correct by an officer** in the
  service of such person, is on its mere production… admissible in evidence… and **rebuttable proof**
  of the facts contained"*.
  → **The PDF should end with an s15(4) certification page** for the operator's officer to sign.
  This is probably the single most valuable page for a claim or court. *(The wording must be reviewed
  by someone legally qualified before real use; it is a template.)*
- Courts abroad have accepted public-blockchain timestamps as evidence (Marseille, March 2025; Yuga
  Labs v. Ripps, 9th Cir. 2025), but only with an **explanation of how the record was produced and
  collected**. The methodology appendix is that explanation.

### 2.6 POPIA constraints on sharing

- Sharing with an insurer for a claim can rest on **s11(1)(f), legitimate interest** of the responsible
  party or of the third party receiving the data. Data subjects can object (s11(3)), and the principle
  of **minimality** still applies.
- **Consequences for the design:** mask the driver's ID number by default; never include phone
  numbers; include the GPS trail only for the trip window and only by explicit choice; scope each pack
  to one recipient, one purpose and one expiry; log every access; and cut per consignment so one
  client's data never appears in another client's pack. v7 §6.1 already requires that: *"a FedEx
  discrepancy must not surface in Courier Guy's evidence PDF"*. Only hashes go to Hedera. That rule
  is unchanged.

### 2.7 Coverage map: each need against what FreightProof holds today

| Need (source) | FreightProof data today | Status |
|---|---|---|
| Date, time and place of loss (claim form §2, SAPS) | `exceptions.created_at`, `gps_lat/lng`; last corroborated position | **Have**, but exceptions are **not anchored** |
| Vehicle make, registration, trailer (§3) | `vehicles.*`, `trip_trailers` | **Have** |
| Roadworthy and licence certificates | only `vehicles.licence_disc_expiry` | **Partial**: no roadworthy certificate |
| Driver name and ID number (§6) | `drivers.full_name`, `id_number` | **Have**, masked by default |
| Driver licence and **PrDP** | `license_number`, `license_expiry` (a labelling bug on this field is still open) | **Partial**: PrDP not modelled |
| Driver identity verified (collusion angle) | `trips.idvs_check_status`, `idvs_checked_at` | **Have** |
| Goods description, package count (§6) | `consignments.parcel_perfect_reference`, `parcel_count_expected`, `unit_count_expected`, `parcels.*` | **Have** |
| Value of goods (the value proof) | `consignments.declared_value` | **Partial**: declared, not the invoice |
| Owner of goods | `consignments.client_organization_id` | **Have** |
| When and where loaded; driver checked the load (§6) | loading phase `completed_at`, precinct, `driver_visual_count`, `parcel_count_origin`, linehaul photo | **Have**; loading is unanchored |
| "Clean receipt at loading" | waybill and linehaul photos | **Have** |
| Seal numbers and records (TAPA 9.11.5) | departure `seal_number` + seal photo (**anchored**, v2); destination seal exceptions | **Have** |
| Tracking records / GPS | phone pings (`trip_location_pings`), horse fix per handshake/checkpoint, `trailer_gps_snapshots` | **Partial**: not continuous; Pulsit route reports (FP-158) would fill the gap |
| Unbroken custody | phase ledger P0–P6, anchors at P0/P3/P6 | **Have**: the strongest asset |
| Breach time and location | `seal_broken_in_transit`, `panic_button`, `route_deviation` exceptions with GPS | **Have**, unanchored |
| Prompt notification (TAPA 9.3.1: client within 24h) | exception `created_at` → `reviewed_at`, `contact_method` | **Partial**: SAPS/insurer/client notification times not recorded |
| SAPS station, CAS number, officer, date (§8) | — | **Gap** → Incident Declaration (Stage 7) |
| Driver statement; "action taken immediately" (§7) | driver-raised exception `description`, dispatcher `review_note` | **Partial** |
| Consignee accepted delivery; signed POD (§7) | confirmation POD photo + signature (**anchored**, v2), receiver handover + IDVS | **Have** |
| Unattended vehicle; stops outside approved places (TAPA 9.21/9.22) | derivable from pings + precinct geofences | **Derived**, and weak where pings are sparse |
| Insider-involvement indicators | dispatcher overrides, driver substitutions, `driver_vehicle_separation`, `driver_location_mismatch`, anchored vehicle/driver record edits | **Have**: presented neutrally |
| Record integrity (ECT s15(3)) | Hedera anchors + `verification_service.verify_subject` | **Have** |
| Business-records certificate (ECT s15(4)) | — | **Gap** → certificate page (Stage 7) |

**Takeaway:** the custody chain is strong. The weak points are the **unanchored incident records**
(exceptions, checkpoints, pings) and **facts declared after the event** (SAPS case, notifications). The
plan handles both honestly (tiers, §4) and proposes closing the first gap in Stage 8.

---

## 3. What we build: one snapshot, three renderings

An **Audit Pack** is a frozen, versioned JSON **manifest** of everything below, captured at issue time.
Every rendering is produced from that manifest, so the PDF and the page cannot disagree.

### 3.1 Full Trip Audit Trail (PDF): the default

For claims, delivery disputes, client audits and SLA proof. Estimated 8–20 pages plus appendices.

### 3.2 Interactive Evidence Page (web)

The same content, explorable: a timeline synced to a map, photo viewer, raw hashes, and **verification
in the browser**. It is opened through a share link and needs no account.

### 3.3 Incident Fact Sheet (1–2 page PDF): Stage 7

This is the first page to hand to a **SAPS detective, the tracking company, or a TAPA IIS report**.
It covers incident time and place, the last corroborated position, the vehicle and trailer
registrations, a cargo summary and declared value, the driver (masked ID), the tracking provider, and
notification times. It includes a QR code to the full pack.

### 3.4 Scopes

- **Whole trip:** for the operator's own insurer, or for a single-client trip.
- **Single consignment:** for one client, a consignee or *their* insurer. Other clients' consignments
  and parcels are removed, and so are exceptions scoped to *another* consignment. `phase_service`
  already sets `consignment_id` and `trip_stop_id` on count-mismatch exceptions, despite the stale
  model comment saying nothing populates them. **Unscoped trip-level exceptions stay in**: a panic
  or hijack affects every consignment on the truck. Stage 1.3 must test that no other client's
  reference appears in a scoped pack's descriptions.

---

## 4. The honesty model: evidence tiers

The FP-161 review warned: *"Avoid exporting a polished document that implies every included fact is
chain-verified."* Every fact, row and section therefore carries one of four tiers, as a badge on the
page and a symbol in the PDF:

| Tier | Meaning | Examples today |
|---|---|---|
| **⛓ Anchored** | Its hash is on Hedera and re-verifies (field-level where the anchored payload names the field) | Journey lock (P0); departure `seal_number`, `seal_photo_sha256`, `waybill_photo_sha256` (P3 v2); confirmation `pp_scan_in_count`, `driver_visual_count`, `pod_photo_sha256`, `pod_signature_sha256` (P6 v2); **critical-field** driver/vehicle/precinct changes (`blockchain/critical_fields.py`). Cosmetic edits such as make or model are ● only |
| **⇄ Corroborated** | Independent sources agreed at capture time, but it is not anchored | `action_location_assessment`: phone vs tracker distance, in-precinct verdict |
| **● Recorded** | FreightProof's own database record, captured when it happened, not anchored | Activation, loading and unloading phases; checkpoints; exceptions; GPS pings; dispatcher reviews |
| **✎ Declared** | Entered by the operator after the event | SAPS CAS number, insurer notified at, claim reference |

The pack also shows **anchor state honestly**: `pending`, or `failed` with a retry owed, is never shown
as success. `AnchorStatus` already says *"Never render `failed` as success"*.

**Pack seal (separate from the tiers):** when a pack is issued, its manifest hash and PDF hash are
anchored together. This proves **the pack has not changed since it was issued**. It does **not** prove
the facts inside it are true, and the methodology page says so in plain words.

---

## 5. Content specification (section by section; the PDF and the page use the same order)

Times are shown in **SAST (Africa/Johannesburg)**, with UTC and Hedera consensus timestamps in the
integrity appendix.

**§A Cover and verification summary**
- Pack ID (e.g. `TRP-0042-AP2`), trip reference, order number, scope, **issued to** (name,
  organisation, purpose, external reference such as a claim number), issued by, issued at, and expiry.
- A verification box: "*12 of 12 anchored records verified at issue · 3 anchors pending · 0
  mismatches*". Also a pack fingerprint (manifest SHA-256), a QR code to the verification page, and a
  key to the tier symbols.
- A watermark on every page: *"Issued to {recipient} for {purpose} · {pack id}"*. It discourages
  leaks.

**§B Observations (factual, not conclusions)**
Deterministic, rule-based sentences. No AI narrative, and no blame language. FreightProof records and
does not judge. Each observation links to its evidence rows. The initial rule set:
1. Custody completeness, e.g. "7 of 7 phases completed; 1 dispatcher override at P4 (reason recorded)."
2. Anchor integrity, e.g. "All 3 anchored phases verified against Hedera."
3. Seal continuity, e.g. "Seal ABC123 applied at departure (⛓) matched at destination (●). The
   destination check happens at unloading, which is not anchored today."
4. Count reconciliation per consignment: origin vs driver visual count vs destination.
5. Location agreement at each handshake, e.g. "Phone and truck tracker agreed within 85 m at 5 of 5
   handshakes."
6. **Coverage gaps**, e.g. "No phone position between 13:10 and 13:57 (47 min)." The threshold is a
   named constant, defaulting to 30 min. That default is informed by TSR 9.14.x tracker reporting
   intervals, which range from 5 to 60 min by level.
7. **Stationary periods outside any precinct** (≥ N min), with their location.
8. Exceptions and **response latency** (raised → reviewed; contact method).
9. Identity: driver IDVS result and time; substitutions (who, why, approver, ⛓); receiver identity
   result.
10. Timeliness: planned slot vs actual time, per stop.
11. **Record changes during the trip window**: dispatcher overrides, and edits to driver or vehicle
    records (critical-field edits are anchored). Adjusters look for these as collusion signals.
12. **Trip end state**, e.g. "Trip did not complete: status `exception_hold`, last completed phase P3
    Departure at 09:58, 4 phases pending." A hijacked trip never reaches P6, and the pack must be
    issuable and still make sense in that case.

**§C Incident summary** (only when the trip has critical exceptions, or the purpose is a claim or
police report)
- A key-times strip: last corroborated custody → incident raised → dispatcher reviewed → SAPS reported
  (✎) → insurer notified (✎) → client notified (✎), with the elapsed time between each.
- Incident location (map inset), last known position with its source, and the exception record(s) in
  full.
- ✎ Declared incident facts: SAPS station, CAS number, officer, date reported, tracking company
  notified at, insurer claim reference.

**§D Parties and trip plan**
Operator, client(s), consignee(s), stops with precinct name and address plus slot times, trip type,
planned vs actual departure and arrival, SLA reference, Pulsit trip reference.

**§E Vehicle(s)**
Horse and trailers: registration, make, model, year, VIN, *licence disc valid on trip date: yes/no*,
tracker device IDs, and record-change history (⛓).

**§F Driver**
Name, **ID number masked** (full only when the issuer ticks "required by insurer claim form"), licence
number and *valid on trip date*, IDVS status and time, and substitutions. PrDP is shown as "not
recorded by FreightProof" until it is modelled; no silent omission.

**§G Cargo and consignments**
Per consignment: PP reference, client, declared value, expected units and parcels, and the manifest
snapshot. The reconciliation table: `parcel_count_origin` → `driver_visual_count` →
`parcel_count_destination`, with differences highlighted. The parcel list (barcode, PP scan out/in
times) goes in the appendix.

**§H Custody chain timeline (the core)**
One row or card per phase, in ledger order. Each shows:
- the phase and stop, planned slot vs actual time, and who acted (driver or dispatcher override, with
  the note);
- **where:** phone GPS, tracker GPS, trailer GPS, in-precinct verdict and distances (⇄), plus any
  location warning the driver acknowledged, with their reason;
- **evidence:** seal number, and the seal, waybill, linehaul, POD and signature photos with their
  SHA-256, marked ⛓ when committed by an anchored payload; the receiver handover and identity result;
- **anchor:** status, Hedera topic, sequence number, transaction ID, consensus time, and the verify
  result.

**§I Seal chain**
Applied (number, photo, time, place, ⛓) → integrity checks → verified at destination
(match / mismatch / unverified) → broken.

**§J In-transit record**
Checkpoints (type, time, location, selfie and cargo photo, deviation flag), derived stationary periods,
coverage gaps, route deviations.

**§K Exceptions and response log**
Every exception in scope: type, source, severity, time, location, description, supporting artifact,
review status and outcome, reviewer, review time, contact method and note, and latency.

**§L Location evidence**
- **PDF:** an SVG route drawing produced on the server (precinct geofence circles, the phone trail as
  a polyline, tracker fixes, exception and checkpoint markers, gaps drawn dashed, a scale bar). **No
  third-party map tiles**, so no trip coordinates reach a tile server and the output is deterministic.
  A coverage table follows: first and last fix, number of fixes by source, longest gap, and share of
  the trip window covered.
- **Page:** a Leaflet map with toggleable layers per source, synced to the timeline, plus a time
  scrubber.
- **Downloads:** the full trail as CSV/JSON (when the trail is included).
- **An honest caveat printed on the page and in the PDF:** *"Phone positions are recorded only while
  the driver app is in use; the vehicle tracker is queried at handshakes and checkpoints. Absence of a
  position is not evidence the vehicle was stationary."*

**§M Integrity appendix**
For every anchored record: subject, receipt type, data hash, topic, sequence number, transaction ID,
consensus timestamp, the **exact canonical JSON that was hashed**, and the verify result at issue
time. Then **manual verification steps** that anyone can follow without FreightProof:
1. SHA-256 the canonical JSON string.
2. Open `https://{mirror}/api/v1/topics/{topic}/messages/{seq}` and base64-decode `message`.
3. Compare the two.

Also the evidence file hashes, and the pack seal.

**§N Methodology (ECT s15(3))**
One page, structured around the section's three factors: how records are generated (the driver app,
Pulsit, Parcel Perfect, IDVS), how they are stored (Postgres in af-south-1, Supabase Storage,
append-only ledgers), how integrity is maintained (hashing, Hedera HCS, the fail-open retry policy),
and how originators are identified (driver auth, IDVS, dispatcher accounts).

**§O Certificate (ECT s15(4)), Stage 7**
*"I, ____, in my capacity as ____ of {operator}, certify that this document is a correct printout of
and extract from data messages made in the ordinary course of business…"*, with signature, date, and a
commissioner-of-oaths block left optional. The wording is marked as a template pending legal review.

**§P Data protection notice**
Purpose, recipient, lawful basis, the redactions applied, expiry, and a contact for objections.

---

## 6. What the interactive page looks like

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FreightProof · Audit Pack TRP-0042-AP2        Issued to: Santam Claims (Claim │
│ JHB → DBN · 12–13 Sep 2026 · Scope: whole trip  #CLM-88123) · expires 13 Oct  │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ ⛓ 12/12 anchored records verified in YOUR browser against Hedera testnet  │ │
│ │ [Re-run verification]  [Download PDF]  [Check a PDF copy]  [Raw data ▾]   │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ Observations                                                                 │
│  • 7/7 phases completed · 1 override (P4, note recorded)                      │
│  • Seal ABC123 applied ⛓ · matched at destination ● (unloading not anchored) │
│  • Gap: no phone position 13:10–13:57 (47 min)                               │
├───────────────────────────────┬──────────────────────────────────────────────┤
│ TIMELINE                      │ MAP  [phone ☑][tracker ☑][trailer ☐][gaps ☑] │
│ ● P0 Created   08:02  ⛓       │                                              │
│ ● P1 Activated 08:40  ●       │     (precinct circles, trail, markers;       │
│ ● P2 Loaded    09:15  ● ⇄     │      selecting a timeline row pans here)     │
│ ▶ P3 Departed  09:58  ⛓ ⇄     │                                              │
│   seal ABC123 · 2 photos ⛓    │ ◀────────●───────────────────────▶ time      │
│ ⚠ Panic button 14:32  ●       ├──────────────────────────────────────────────┤
│ ● P5 Unloaded  19:40  ●       │ DETAIL: P3 Departure                         │
│ ● P6 Confirmed 20:05  ⛓       │ Phone −26.2041, 28.0473 · tracker 85 m ⇄     │
│                               │ Seal photo [img]  sha256 9f2c…  ⛓ matches    │
│ Cargo · Exceptions · Parties  │ [Verify this photo's bytes in my browser]    │
│ Integrity · Methodology       │ Hedera: 0.0.51234 #118 · 09:58:14.2 SAST ↗   │
└───────────────────────────────┴──────────────────────────────────────────────┘
```

On a phone the layout stacks: banner → observations → timeline, where each row expands to show its
detail and a mini-map → the full map → the other sections. The side gutter is 16px and nothing scrolls
horizontally.

---

## 7. Verification design

### 7.1 In the insurer's browser: "don't trust us"

- **Confirmed on 2026-09-23:** both `testnet.mirrornode.hedera.com` and
  `mainnet-public.mirrornode.hedera.com` return `Access-Control-Allow-Origin: *`, so the page can
  query Hedera **directly from the browser**.
- **Method, which avoids reimplementing Python's JSON canonicalisation in TypeScript:** the manifest
  carries, for each anchored record, the **exact canonical string** the server hashed. For each record
  the browser:
  1. computes `crypto.subtle.digest('SHA-256', utf8(canonical))`;
  2. fetches the mirror message for `{topic, seq}` and base64-decodes it;
  3. checks that the two are equal, then shows ✓ with the consensus timestamp;
  4. runs `JSON.parse(canonical)` and highlights report fields that **equal anchored values** (seal
     number, counts, photo hashes).

  Because the page displays facts parsed from the string that was actually hashed, the check is sound
  without a JavaScript canonicaliser.
- **Photo byte check:** the browser fetches the photo bytes **through our public API**, hashes them,
  and compares the result with `seal_photo_sha256` and the other committed hashes in the anchored
  payload. Proxying doesn't weaken the check: the comparison is against a hash on Hedera, so a server
  serving different bytes would fail it. This also avoids depending on Supabase Storage CORS. The page then says *"This photo is byte-identical to the one committed to Hedera at
  09:58:14 SAST."*
- **PDF copy check:** the insurer drops a PDF file onto the page. The browser hashes it and compares
  the result with `pdf_sha256`, which is itself in the anchored pack seal.

### 7.2 Server-side live re-check

`POST /public/audit-packs/{token}/verify` re-runs the existing `verify_subject()` for each anchored
subject **against the current database**. It answers a different question: *"has anyone changed the
live records since issue?"* It also reports records **added** since issue (a count only, no content):
*"3 records were added to this trip after this pack was issued. Ask the operator for an updated
pack."*

---

## 8. Access model and lifecycle

1. **Issue.** A dispatcher (admin role) opens a trip in **any status**, whether closed, cancelled,
   `exception_hold` or still active (a hijacked trip never closes), and selects **Create audit pack**.
   If any anchor is `pending` or `failed`, the modal says so ("P6 anchor still pending, issue now or
   wait?"). Phase anchors are dispatched asynchronously, so a pack issued the minute a trip closes can
   catch P6 mid-flight. They enter: recipient name, organisation and email; purpose
   (`insurance_claim | delivery_dispute | police_report | client_audit | sla_evidence`); external
   reference; scope (trip or one consignment); toggles for *include GPS trail*, *include full driver
   ID number*, and *include checkpoint selfies*; and expiry (7 / 30 / 90 days, default 30).
2. **Build.** A Celery task assembles the manifest, renders the PDF, stores it in Supabase Storage,
   computes the SHA-256s, and anchors the pack seal. Status moves `building → ready`, or `failed` with
   a reason. The anchor is fail-open like phase anchors: the pack is usable with "seal pending".
3. **Share.** The API returns the link **once**, as `https://{portal}/p/{token}`. Only
   `sha256(token)` is stored, the same pattern as `handover_capability_tokens`. The dispatcher copies
   it. Automatic email is a later option; there is no SendGrid client yet, only config keys.
4. **Access.** The insurer opens the link and needs no account, which matches "roles without accounts
   get zero-login" in CLAUDE.md. Every view, PDF download, verification run and denied access (expired
   or revoked) is written to `audit_pack_access_events` and shown to the dispatcher ("viewed 4 times,
   last 14 Sep 10:02").
5. **Revoke or expire.** Revoking stops access immediately. The pack record, PDF and anchor are
   **kept**, because they are evidence of what was issued.
6. **Reissue.** A new version (`AP3`) gets a fresh snapshot. Older versions stay listed.
7. **Retention.** Keep issued packs for at least 3 years, the ordinary Prescription Act period for
   claims (*confirm*). TAPA 9.30 needs count records for at least 2 years.

**Option for Stage 7+:** a one-time email code before first view. It binds the link to the recipient's
inbox and cuts the risk of a forwarded link.

---

## 9. Architecture

### 9.1 Data model (one Alembic migration, `2026_xx_xx_tim_add_audit_packs.py`)

```
audit_packs
  id UUID PK · trip_id FK trips · consignment_id FK consignments NULL
  organization_id FK organizations      -- issuing operator (visibility scoping)
  pack_version SMALLINT                 -- AP1, AP2… per (trip, scope)
  pack_type VARCHAR(30)                 -- full_trail | incident_fact_sheet
  purpose VARCHAR(30) · external_reference VARCHAR(100) NULL
  recipient_name VARCHAR(200) · recipient_organization VARCHAR(200) · recipient_email VARCHAR(320) NULL
  include_location_trail BOOL · include_full_driver_id BOOL · include_selfies BOOL
  manifest_version SMALLINT · manifest_json JSONB · manifest_sha256 CHAR(64)
  pdf_storage_bucket VARCHAR(255) NULL · pdf_storage_key VARCHAR(500) NULL · pdf_sha256 CHAR(64) NULL
  build_status VARCHAR(20)              -- building | ready | failed
  anchor_status VARCHAR(20)             -- reuse AnchorStatus
  blockchain_receipt_id FK blockchain_receipts NULL
  token_hash CHAR(64) UNIQUE · expires_at TIMESTAMPTZ · revoked_at TIMESTAMPTZ NULL
  issued_by_user_id FK users · revoked_by_user_id FK users NULL
  created_at · updated_at

audit_pack_access_events                -- append-only
  id · audit_pack_id FK · event_type VARCHAR(30)  -- viewed | pdf_downloaded | verify_run | photo_viewed | denied_expired | denied_revoked
  client_ip VARCHAR(64) NULL · user_agent VARCHAR(400) NULL · created_at · updated_at

incident_declarations                   -- Stage 7, append-only, ✎ tier
  id · trip_id FK · exception_id FK NULL
  saps_station VARCHAR(200) NULL · saps_cas_number VARCHAR(50) NULL · saps_officer VARCHAR(200) NULL
  reported_to_saps_at · tracking_company_notified_at · insurer_notified_at · client_notified_at (all NULL)
  insurer_claim_reference VARCHAR(100) NULL · note TEXT NULL
  declared_by_user_id FK users · created_at · updated_at
```

- The enums are `String` columns, so no DB enum migration is needed. Add
  `SubjectType.AUDIT_PACK` and `BlockchainReceiptType.AUDIT_PACK_ISSUED`.
- Pack-seal payload (no PII): `{"payload_version":1,"pack_id","trip_id","pack_version","manifest_sha256","pdf_sha256","issued_at"}`.
- **Prune the autogenerated migration.** CLAUDE.md warns that autogenerate adds 28 foreign
  operations, including dropping the Supabase auth foreign keys. Do not `alembic upgrade` from the
  feature branch.

### 9.2 Backend modules (layering: endpoints → orchestration → storage/blockchain/crypto → db)

| Module | Responsibility | Tested by |
|---|---|---|
| `schemas/audit_pack.py` | Pydantic v2: `AuditPackManifest` (versioned) and its section models; create/read/public DTOs | schema validator tests |
| `orchestration/audit_pack_builder.py` | **Loads** the trip graph and **assembles** the manifest: phases, evidence, receipts plus canonical strings, exceptions, checkpoints, pings, consignments. Applies scope and redaction | unit tests (pure assembly) + integration |
| `orchestration/audit_pack_analysis.py` | **Pure functions** for observations: gaps, stationary periods, last corroborated position, response latency, reconciliation, override and edit detection. Thresholds are named constants | unit tests (no DB) |
| `orchestration/audit_pack_service.py` | Lifecycle: issue (token, snapshot, dispatch build), revoke, list, access logging, `resolve_token()` | integration tests |
| `reporting/pdf_renderer.py` + `reporting/templates/*.html.j2` + `reporting/route_svg.py` | Jinja2 → HTML → **WeasyPrint** PDF; server-drawn SVG route. **A new package, so it needs team agreement** (§10 D8) | renderer smoke tests |
| `tasks/audit_packs.py` | Celery: render → upload → hash → anchor (reuses `anchor_subject`) | task test with a fake Hedera adapter |
| `api/v1/endpoints/audit_packs.py` | Dispatcher: `POST /trips/{id}/audit-packs`, `GET /trips/{id}/audit-packs`, `GET /audit-packs/{id}/access-events`, `POST /audit-packs/{id}/revoke`, `GET /trips/{id}/audit-trail/preview`. `tags=["audit-packs"]` | integration: 200/401/403/404/422 |
| `api/v1/endpoints/public_audit_packs.py` | Token: `GET /public/audit-packs/{token}`, `.../pdf`, `.../photos/{artifact_id}` (streams bytes, scoped to pack), `POST .../verify`. Rate-limited with a new `AUDIT_PACK_PUBLIC` limit. `tags=["audit-packs-public"]` | integration: valid/expired/revoked/unknown token |
| `orchestration/verification_service.py` | Add a reconstruct branch for `SubjectType.AUDIT_PACK` | unit + integration |

**Reuse, don't rebuild:** `anchor_subject`, `compute_payload_hash` and `canonicalize_payload`;
`verify_subject`; `create_signed_url` and `hash_stored_evidence_file`; the token-hash pattern from
`handover_service`; `rate_limit`; the `captured_anchor_dispatches` test fixture.

### 9.3 Frontend

- **Insurer page:** `frontend/client-portal/`, a new Next.js 15 App Router app. Its README reserves
  it for exactly this. It is read-only, uses `@shared/*` types, and deploys as a new Vercel project the
  same way the receiver app did (deployment-runbook §4). Routes: `/p/[token]` (the page) and
  `/p/[token]/print` (optional print view).
- **Dispatcher "Audit packs" panel** on trip detail: create modal, list with status, views and expiry,
  copy link, revoke. **This is in `frontend/dispatcher/`, which is not Tim's area.** Hand it to the
  dispatcher owner, or demo the flow via Swagger until then.
- **Shared types** go in `frontend/shared/types/audit-pack.ts`. `shared/` is read-only for Tim, so it
  needs coordination.

---

## 10. Decisions: options considered and why

| # | Decision | Chosen | Rejected, and why |
|---|---|---|---|
| D1 | How insurers get access | **Expiring, revocable capability link**, with email OTP later | *Insurer accounts/RBAC:* a new role and onboarding for a party that shows up once per claim, contrary to the zero-login principle. *Emailing the PDF only:* no interactive verification and no access log |
| D2 | Where the page lives | **`frontend/client-portal/`** (the reserved home) | *Receiver app route:* fastest, since the token-page pattern and deployment exist, but it mixes consignee handover with insurer evidence. **This is the fallback if scaffolding slips.** *Dispatcher public route:* couples an external audience to the ops app, and Tim doesn't own it |
| D3 | PDF engine | **WeasyPrint + Jinja2** in the backend | *Playwright/Chromium:* one template for both outputs, but ~400 MB of Chromium alongside a JDK already in the image; RAM on Railway. *ReportLab:* no system dependencies but slow, fiddly layout. *Client-side react-pdf:* the server can't vouch for bytes it didn't produce, so they can't be anchored |
| D4 | Snapshot or live | **Frozen manifest at issue** + a live re-check | *Live rendering:* the insurer's document would silently change under them, which is fatal for evidence |
| D5 | Browser verification | **Hash the server-supplied canonical string**, then parse it | *TS canonicaliser:* a fragile match with Python `json.dumps` (non-ASCII escapes, float formatting). *Server-only verification:* the insurer would have to trust us |
| D6 | Maps | **Server-drawn SVG in the PDF; Leaflet on the page** with the dispatcher's tile config | *Tiles in the PDF:* leaks coordinates to a tile provider, non-deterministic output, OSM tile-use policy |
| D7 | Narrative | **Deterministic rule-based observations** | *LLM summary:* not reproducible, can't be defended at examination, risks implying blame |
| D8 | Where rendering code sits | **New `app/reporting/` package**, at the same layer as `storage/`, called only from orchestration | *Inside `orchestration/`:* mixes presentation with business logic. **Needs team agreement: it changes the architecture diagram** |
| D9 | Anchoring unanchored incident records | **Separate Stage 8, owned by the exception/checkpoint owners**, with tiers covering the gap meanwhile | *Anchoring them inside the pack build:* anchoring after the fact proves little. Records must be anchored close to when they happen |

---

## 11. Stages

Each stage ends with something you can **see** working. Every step has a Goal / Where / Verify / Fence.
Effort estimates are rough single-developer days.

### Stage 0: Decisions and ownership (≈0.5 day, no code)

**Visible end:** a short decision note, agreed in the team chat or at standup.

- **0.1 FP-161 ownership.** Goal: agree with Thomas who builds what. One proposal: Thomas owns content
  and insurer validation (§2, §5 and the Bruce questions); Tim owns the backend and the page. Verify:
  the Jira ticket is updated. Fence: no code before this.
- **0.2 Architecture calls.** Get agreement on D2 (client-portal), D8 (`reporting/` package), the new
  tables, and the shared-file edits (`main.py`, `config.py`, `models/__init__.py`, `requirements.txt`,
  `Dockerfile`, new `package.json`). Verify: recorded in the note.
- **0.3 POPIA calls.** Agree on: reading `trip_location_pings` after trip close for an issued pack
  (a new read purpose); driver ID masked by default; selfies off by default. Verify: recorded.
- **0.4 Research step with Bruce.** This is the domain where planning without real input goes wrong.
  Ask him for one redacted real claim (hijack or short delivery): what the insurer or loss adjuster
  requested, which GIT insurer LFG uses, and whether FedEx's insurer would accept a consignment-scoped
  pack. Verify: answers recorded in `docs/meeting_minutes/`. Fence: don't block Stages 1–2 on the
  reply.

### Stage 1: The manifest (walking skeleton, ≈2 days)

**Visible end:** `GET /api/v1/trips/{id}/audit-trail/preview` in Swagger returns the full manifest
for the seeded demo trip, including observations.

- **1.1 Schemas.** Goal: `AuditPackManifest` v1 and its section models (§5), tier enum, and
  `AnchoredRecord{canonical, data_hash, topic, seq, tx_id, consensus_at, verify_status}`. Where:
  `schemas/audit_pack.py`. Verify: `pytest tests/unit/test_audit_pack_schemas.py`. Fence: no DB
  access.
- **1.2 Analysis functions.** Goal: gaps, stationary periods, last corroborated position,
  reconciliation, response latency, overrides and record edits. Pure functions only. Where:
  `orchestration/audit_pack_analysis.py`. Verify: `pytest tests/unit/test_audit_pack_analysis.py`,
  covering the happy path, an empty trail, a single ping, a gap exactly at the threshold, and a
  cross-midnight trip. Fence: thresholds as named constants, no magic numbers.
- **1.3 Builder.** Goal: load the trip graph in a fixed number of queries (no N+1), then assemble.
  Canonical strings come from `canonicalize_payload(receipt.payload_json)`, which must reproduce
  `data_hash` (assert it). Apply scope and redaction. Where: `orchestration/audit_pack_builder.py`.
  Verify: an integration test on a fixture trip with 7 phases, 1 exception and pings asserts the
  sections, the tiers, and that a consignment scope drops the other client's rows. Fence: read-only;
  don't touch `phase_service` or `exception_service`.
- **1.4 Preview endpoint** (admin dispatcher). Verify: integration tests for 200, 401, 404 (a trip in
  another org) and 422. Fence: no persistence yet.

### Stage 2: The PDF (≈2 days)

**Visible end:** `GET /api/v1/trips/{id}/audit-trail/preview.pdf` downloads a readable PDF of the demo
trip with a route drawing.

- **2.1 Spike the dependency first (tripwire R2).** Add `weasyprint` and `jinja2`, plus the Pango
  apt packages in the `Dockerfile`, then run `docker build` and render a hello-world PDF *inside the
  container*. Verify: the PDF opens. Fence: if this fails, stop and switch to the D3 fallback before
  writing templates.
- **2.2 Templates** for §A–§N (§O and the incident sheet come in Stage 7), print CSS (A4, page
  numbers, running header, watermark, tier symbols with a legend). Where: `reporting/templates/`.
- **2.3 Route SVG.** Project lat/lng to a local equirectangular frame and draw precincts, trail, fixes,
  markers, dashed gaps and a scale bar. Where: `reporting/route_svg.py`. Verify: a unit test checks
  the SVG contains the expected elements for a fixture; the image looks right.
- **2.4 Renderer.** `render_pdf(manifest) -> bytes`. Verify: a test asserts `%PDF` magic, a page count
  above 1, and text extraction includes the trip reference. This needs `pypdf` as a test-only
  dependency; flag it. Fence: no storage and no anchoring yet.

### Stage 3: Issuing, sealing, revoking (≈2 days)

**Visible end:** issuing a pack via Swagger yields `ready`, a PDF in Storage, and a pack-seal
transaction visible on the Hedera mirror or HashScan.

- **3.1 Migration** for `audit_packs` and `audit_pack_access_events`, following the full Alembic
  protocol in CLAUDE.md. Verify: `grep -nE "op\.[a-z_]+\(" <file>` lists only our operations, and
  `alembic check` shows no new drift. Fence: never `alembic upgrade` on the shared DB from this
  branch.
- **3.2 Service and task:** issue, build, store, hash, anchor (fail-open), revoke, list. Verify:
  integration tests assert DB state after issue and after revoke, and that the anchor dispatch was
  captured with the correct payload.
- **3.3 `verify_subject` support for `AUDIT_PACK`.** Verify: unit test for a match and a tampered
  `pdf_sha256`.

### Stage 4: Share link and page skeleton (≈2.5 days)

**Visible end:** open `https://localhost:3xxx/p/{token}` in an incognito window to see the cover,
observations and timeline, and download the PDF. An expired or revoked token shows a clear "no longer
available" page.

- **4.1 Public endpoints plus access logging and the rate limit.** Verify: integration tests for a
  valid token (200 + an event row), expired (410 + a `denied_expired` row), revoked, unknown (404, no
  row), and the rate limit tripping.
- **4.2 Scaffold `client-portal`** with Next 15, TS strict, Tailwind and the `@shared/*` alias, copying
  the receiver app's config and design tokens. Verify: `npm run build` and `vitest` pass on Node 22
  (memory: Node 18 can't run vitest).
- **4.3 Page:** banner, observations, and the timeline with expandable rows. Typed fetch wrapper, no
  raw `fetch()` in components. Fence: read-only; no mutations in this app.

### Stage 5: The interactive evidence (≈3 days)

**Visible end:** clicking a timeline row pans the map and opens the detail with photos. Layer toggles
and the time scrubber work, and the cargo, exceptions, parties and integrity tabs are populated.

- 5.1 Map (Leaflet, source layers, gaps, precinct circles), synced to the timeline.
- 5.2 Detail drawer with photos, loaded lazily through the public photo endpoint. Only artifacts in the
  pack's manifest are served, never an arbitrary `artifact_id` from the trip.
- 5.3 Cargo reconciliation, exceptions and response log, parties, and a raw data download (manifest
  JSON and trail CSV).
- Verify: vitest component tests, a manual phone-width check at 375px, and an accessibility pass
  (keyboard access to the timeline, alt text on photos). Fence: no editing or annotating by the
  insurer.

### Stage 6: Browser verification (≈2 days) — the demo moment

**Visible end:** the banner turns ✓ record by record as the browser queries Hedera. "Verify this photo"
confirms the photo bytes. Dropping an altered PDF shows ✗.

- **6.1 Test vectors (tripwire R4).** A backend script writes
  `frontend/client-portal/test/fixtures/verify-vectors.json` containing `{canonical, data_hash}` from
  real receipts, including a non-ASCII case. The TS `sha256Hex(canonical)` must match every vector.
  Verify: the vitest suite.
- **6.2 Mirror check**, with a timeout and a clear "Hedera unreachable — not a failed verification"
  state (the same distinction as `VerifyStatus.ERROR`).
- **6.3 Photo byte check and PDF drop check.**
- **6.4 Tamper demo script.** On a dev DB, change a phase's seal number. The live re-check reports
  `db_mismatch`, while the pack's anchored seal and the Hedera check stay ✓. Write it into
  `docs/demo-script.md`.

### Stage 7: Claims and police extras (≈3 days)

**Visible end:** a claim pack with SAPS details, an incident fact sheet, and a certificate page.

- 7.1 An `incident_declarations` table plus endpoint (✎ tier; append-only, with a correction as a new
  row) and a dispatcher form, which goes to the dispatcher owner.
- 7.2 The Incident Fact Sheet template (§3.3).
- 7.3 The ECT s15(4) certificate page and the §N methodology page. The wording is labelled a template.
- 7.4 A proposed mapping from `ExceptionType` to TAPA IIS incident categories, shown on the fact sheet
  as a suggestion only.
- 7.5 An optional email OTP before first view.
- Fence: no automatic submission to SAPS, insurers or TAPA. Recording, not responding.

### Stage 8: Strengthen the chain (a dependency, owned by the exception/checkpoint owners, ≈3 days)

**Visible end:** a panic or seal-broken exception displays ⛓ in the pack.

- Anchor **critical** exceptions (`panic_button`, `seal_broken_in_transit`, `seal_mismatch`,
  `parcel_count_mismatch`, `cargo_damage`, `route_deviation`) individually when raised, using the
  fail-open pattern. **The GPS trade-off:** `exceptions.gps_lat/lng` currently carries a model comment
  saying it must never enter a hash or anchoring path. Leaving GPS out keeps that rule, but the
  incident *location* then stays ● Recorded. Committing a *salted* hash of the fix would make it ⛓
  while revealing nothing on-chain, but it changes the rule, which is a team decision.
- At trip close, build a **Merkle batch** over the remaining exceptions, checkpoints and ping hashes.
  This activates the existing unused `merkle_batches` and `merkle_batch_leaves` tables. The pack can
  then give inclusion proofs.
- **This touches `exception_service` and the `TripLocationPing` "never hashed or anchored" rule, so it
  needs an explicit team and POPIA decision.** A Merkle root over salted leaf hashes reveals no
  location, but the rule must be changed deliberately, not silently.

**Total for Tim (Stages 0–7, excluding the dispatcher UI and Stage 8):** about 17 developer-days. Stages
1–4 plus 6 are the minimum demoable slice, about 11 days.

---

## 12. Risks and tripwires

| Risk | Tripwire (when you'll know) | Fallback |
|---|---|---|
| **R1** Ownership collision with FP-161 / Thomas | Stage 0.1, before any code | Split: content and validation (Thomas), build (Tim) |
| **R2** WeasyPrint system libraries fail in the Railway image | Stage 2.1 container spike | ReportLab, or Chromium only in the Celery worker image |
| **R3** Incident facts are mostly ● Recorded, which weakens the claims story | Stage 1 preview: count the tiers in the incident section | Prioritise Stage 8 with its owner; the tiers stay honest in the meantime |
| **R4** Browser hash ≠ server hash (encoding) | Stage 6.1 test vectors | Show server-side verification results, labelled "verified by FreightProof" |
| **R5** Team or POPIA objection to exposing the trail or driver ID | Stage 0.3 | Trail and full ID off by default; summary statistics only |
| **R6** Scope creep into claims management (claim status, insurer workflow, auto-filing) | Any ticket that *responds* rather than *records* | Out of scope per `scope-boundaries.md` §0 |
| **R7** Forwarded link reaches the wrong person | The access log shows unexpected IPs or views | Revoke; expiry; watermark; email OTP (7.5) |
| **R8** Big trips (thousands of pings) make rendering slow | A Stage 2 render takes >10s on the demo trip | Downsample the trail in the PDF (e.g. Douglas–Peucker); full trail in the CSV |
| **R9** The certificate wording is treated as legal advice | Stage 7.3 | Label it a template; get legal review before real use |

---

## 13. Open questions

1. **Thomas:** how do we split FP-161 (Stage 0.1)?
2. **Team:** do we agree to client-portal (D2), the `reporting/` package (D8), and a post-close read of
   the GPS trail?
3. **Bruce:** which GIT insurer does LFG use, and what did the loss adjuster ask for on the last hijack
   claim? Is a consignment-scoped pack useful to FedEx's insurer?
4. **Bruce:** would a Pulsit route report (FP-158) give a continuous vehicle trail we could include as
   a layer? That would turn the weakest row in §2.7 into a strong one.
5. **Team:** should PrDP number and expiry be added to `drivers`? The claim form demands it, and it
   would be a separate small migration.
6. **Who** signs the s15(4) certificate at LFG in practice (ops manager, or a director)?

---

## 14. Sources

- Carl Greaves Brokers, *Goods in Transit Claim Form* (FSP 13147): https://www.cgbrokers.co.za/assets/files/Goods%20in%20Transit%20Claim%20Form.pdf
- TAPA EMEA, *TSR 2023 Appendix A — Hard-sided Truck*: https://tapaemea.org/wp-content/uploads/2023/08/Appendix-A_TSR-2023-Standard-Requirements_Hard-sided-Truck.pdf
- TAPA EMEA incident reporting (TIS/IIS): https://tapaemea.org/incident-service/reporting/
- ECT Act 25 of 2002, s15–17: https://www.internet.org.za/ect_act.html · https://www.saflii.org/za/legis/consol_act/ecata2002427/
- Tive, *Cargo Theft Insurance Claims: How Continuous Visibility Changes Recovery*: https://www.tive.com/blog/cargo-theft-insurance-claims-recovery
- LogRock, *Stolen Cargo Insurance Claim*: https://www.logrock.com/commercial-truck-insurance/stolen-cargo-insurance-claim/
- MiWay, *Goods in transit South Africa: a safety checklist and insurance guide*: https://www.miway.co.za/blog/goods-in-transit-south-africa-a-safety-checklist-and-insurance-guide
- Mont Blanc Financial Services, *GIT Insurance South Africa*: https://www.mbfs.co.za/knowledge-center/2025/12/12/goods-in-transit-git-insurance/
- SASRIA claims (police case within 48h), via Mont Blanc / Sasria FAQ: https://blog.mbfs.co.za/2026/01/12/sasria-riot-strike-civil-unrest-insurance/ · https://sasria.co.za/claims-and-underwriting/frequently-asked-questions/
- SAPS crime reporting and CAS number: https://www.saps.gov.za/services/report_crime.php
- POPIA s11 (lawful processing): https://popia.co.za/section-11-consent-justification-and-objection/ · Webber Wentzel, *POPIA: what insurers need to know*: https://www.webberwentzel.com/News/Pages/the-protection-of-personal-information-act-what-insurers-need-to-know.aspx
- Hijacking and cargo-loss statistics: https://digitfms.co.za/news/truck-hijacking-cargo-theft-fleet-security-south-africa-2026/ · https://tapaemea.org/intelligence/truck-hijacks-up-24-in-south-africa/
- Blockchain evidence in court: https://truescreen.io/articles/blockchain-evidence-court-admissibility-standards/ · https://www.trmlabs.com/resources/blog/building-strong-cases-with-blockchain-evidence-admissibility-chain-of-custody-experts-and-court-ready-reporting
- Hedera Mirror Node REST API: https://docs.hedera.com/hedera/sdks-and-apis/rest-api (CORS checked directly, 2026-09-23)
- Internal: `docs/meeting_minutes/meeting_minutes_bruce_16-04-2026_Detailed.md` §5–6 · `..._26-03-2026_Detailed.md` §6 · `docs/iteration2-feedback-response-2026-08-25.md` §4.3 · `docs/reviews/2026-09-10-ciaran-branch-review.md` (FP-161 row) · `docs/scope-boundaries.md` · `docs/FreightProof_Full_Picture_v7.md` §13 · `frontend/client-portal/README.md`
