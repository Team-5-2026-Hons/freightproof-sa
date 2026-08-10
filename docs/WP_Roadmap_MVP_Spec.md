# FreightProof SA — Work-Package Spec & Production-Readiness Guide

> **Status:** derived spec — no code changed by this document.
> **Source of truth:** `docs/FreightProof_Technical_Full_Picture_v1.md` (§3, §6, §8), verified
> against source at commit `ee4cf32`. Where this doc and that doc disagree, that doc wins.
> **Purpose:** give each developer a plain-language brief for every work package (WP), the
> order they must be done in, and the list of technologies still to be stood up before this
> application can go to a production pilot.
> **Audience:** the four devs (Ciaran, Tim, Chiko, Tom). Read `CLAUDE.md` before starting any WP.

---

## 0. How to read this document

Each WP below has the same shape:

- **What it is** — the problem in one or two sentences, no jargon.
- **Why it matters** — what breaks or stays fake if we skip it.
- **What "done" looks like** — the observable end state.
- **Touches** — the main files/areas, so you can spot cross-dev collisions early.
- **Size** — S (≤ ½ day), M (≤ 2 days), L (multi-day), XL (post-pilot epic).

WPs are grouped by theme, but the **dependency order is what actually governs scheduling** —
see §1. The finish line ("what counts as pilot-ready") is in §4.

---

## 1. The dependency graph (do them in this order)

```
        ┌─────────────────────── the evidence spine (highest priority) ──────────────────────┐
        │                                                                                     │
  WP1 ──┼──► WP2 ──► WP5 ──► WP6                                                               │
        │                                                                                     │
  WP1 ──┴──► WP3                                                                               │
                                                                                              │
  WP4  (parallel, no deps)                                                                     │
  WP7  (parallel — Chiko; touches shared crypto/hashing.py, coordinate)                        │
  WP8  (after WP2)                                                                             │
  WP9  (parallel — Parcel Perfect client, mock-first)                                          │
  WP10 (after WP4 — driver PWA de-mock; coordinate with Tim's branch)                          │
  WP11a / WP11b / WP12 / WP13  (independent of the spine)                                      │
  WP14 / WP15  (post-pilot)                                                                    │
```

**The single most important chain is `WP1 → WP2 → WP5 → WP6`.** This is the evidence-integrity
spine — the reason the product exists. Until it lands, "tamper-proof evidence" is a claim we
cannot back. Everything else is either a functional gap in the trip cycle (WP3, WP4, WP10, WP11)
or production plumbing (WP13).

---

## 2. The work packages

### Theme A — Evidence integrity (the spine)

This theme fixes finding **F4**: *today, what we anchor to Hedera covers almost no evidence.*
H1/H3/H4 have **no hash at all**; H2/H5 compute a hash but it is **never anchored**. That means
a photo could be swapped after the fact without any detection. This theme closes that hole.

---

#### WP1 — Canonical event hashes for every handshake · Size M–L · *foundation*

**What it is.** Make every handshake completion (H1–H5) compute one deterministic SHA-256
"event hash" over its evidence — the file hashes of its photos, GPS, timestamps, seals, and
counts — and store it. Also persist the H3 guard-verified seal (accepted today but silently
thrown away — finding **F5**) plus a new `seal_number_at_exit` field.

**Why it matters.** This is the foundation the whole spine builds on. You cannot anchor
(WP5) or batch-verify (WP6) evidence that was never hashed in a consistent, versioned shape.

**What "done" looks like.** All five `complete_hN` functions store a 64-hex `event_hash`;
the hash shape matches the scheme in the source doc §3.4 exactly; changing any single evidence
field changes the hash; H3 now persists the guard seal fields; `pytest` green.

**Touches.** `orchestration/handshake_service.py`, `schemas/handshakes.py` (H3 field only),
`db/models/handshakes.py` + one Alembic migration (nullable `seal_number_at_exit`),
backend unit + integration tests.

---

#### WP2 — Server-side reconciliation + manifest snapshot at H2 · Size M · *after WP1*

**What it is.** Two fixes. (1) Stop the driver's phone from supplying the "system" count:
today the PWA quietly sends the driver's own visual count as the Parcel-Perfect scan-in count,
so reconciliation compares a number against itself (finding **F1** — meaningless). The server
should fetch the system count itself from the manifest service. (2) At H2 (loading), capture and
store a snapshot of the manifest as it stood at loading, plus the origin unit count (finding
**F6** — the columns exist but nothing ever writes them).

**Why it matters.** Reconciliation is the core evidentiary claim of the delivery step — "the
count at pickup matched the count at drop-off." Right now that claim is self-referential and
therefore worthless. This makes it a real three-way comparison (origin system count vs. delivery
system count vs. driver's visual count).

**What "done" looks like.** The driver cannot supply the system count anywhere; H2 snapshots
populate; a reconciliation mismatch raises a WARNING exception naming three distinct sources;
the H5 "Reconciliation" step in the PWA becomes an await/result screen instead of a number entry.

**Touches.** `orchestration/handshake_service.py`, `orchestration/manifest_service.py`,
`schemas/handshakes.py`, `driver-pwa/lib/api/handshakes.ts` + the H5 reconciliation step
component, tests both sides.

---

#### WP5 — Anchor H2/H5 receipts + async outbox · Size M–L · *after WP1 + WP2*

**What it is.** Actually write the pickup/delivery receipts to the Hedera blockchain — but do it
*asynchronously* through a Celery worker using an outbox pattern, instead of blocking the API
request. The receipt row is created `anchor_status='pending'` inside the completion transaction;
a background task submits it to Hedera, retries with backoff, and marks it `confirmed` (or
`failed` after N attempts, surfaced on the dispatcher timeline). Trip creation (H0) moves onto
the same path with a `--sync` demo fallback.

**Why it matters.** Two problems solved at once. First, this is the leg of F4 that makes evidence
tamper-*evident* — without anchoring, the hashes from WP1 sit in our own database where they could
be altered alongside the evidence. Second, anchoring is currently **synchronous and in-request**
(~4–6s, 15s timeout): one Hedera outage blocks trip creation entirely. The outbox decouples the
two. Note: the Celery worker container **already runs but has zero tasks** — this WP is what
finally gives it a job.

**What "done" looks like.** H2/H5 receipts appear with real consensus timestamps against a test
topic; the completion transaction still commits even if Hedera is down (receipt stays `pending`);
API p95 for completion no longer includes Hedera latency.

**Touches.** `blockchain/anchor_service.py`, new `tasks/anchoring.py`, `tasks/__init__.py`,
`db/models/blockchain.py` + migration (`anchor_status`), `orchestration/{handshake,trip}_service.py`,
`schemas/blockchain.py`, tests (Hedera mocked — no live network in tests).

---

#### WP6 — Per-trip Merkle batching + `/verify` extension · Size L · *after WP5*

**What it is.** When a trip closes (or is cancelled), gather every evidence hash for that trip —
H1/H3/H4 event hashes, checkpoints, exceptions, and any unattached artifacts — into a Merkle
tree, anchor a single root hash, and store the tree. Then extend the existing `/blockchain/verify`
endpoint so anyone can re-compute and check that any individual piece of evidence still belongs
to that anchored root.

**Why it matters.** This is the "verify leg" of F4. WP5 anchors the two receipt handshakes; WP6
covers *everything else* in one efficient anchored root, and — critically — gives us the tool to
*prove* tampering: edit any checkpoint row after the fact and `/verify` reports `db_mismatch`
naming the batch. That is the demonstration that sells the whole platform.

**What "done" looks like.** Closing a seeded trip produces exactly one anchored Merkle root;
editing any checkpoint row afterwards makes `/verify` report `db_mismatch` naming the batch;
unit tests cover odd leaf counts, single-leaf, and determinism.

**Touches.** new `blockchain/merkle.py` (pure functions), `orchestration/{handshake,verification}_service.py`,
`tasks/anchoring.py`, `api/v1/endpoints/blockchain.py`, `schemas/blockchain.py`, unit + integration tests.

---

### Theme B — Trip-cycle functional gaps

These aren't about the blockchain — they're places where the trip cycle itself is broken or fake.

---

#### WP3 — `EXCEPTION_HOLD` override endpoint · Size M · *after WP1*

**What it is.** Give a dispatcher a way to release a trip that is stuck in `exception_hold`
(e.g. a seal-mismatch at the destination gate). A new admin-only endpoint records who overrode
it and why, resolves the linked exception, restores the trip to the status it would have had, and
lets the driver finish.

**Why it matters.** Finding **F7**: today `exception_hold` is a **one-way door** — no code can
move a trip out of it. A single seal mismatch permanently bricks a trip. No override = no way to
close a trip that hit an exception, which is a showstopper for a real pilot.

**What "done" looks like.** A seal-mismatch trip can be overridden and closed end-to-end in an
integration test; 403 for non-admins; 409 if the trip isn't actually in `exception_hold`.

**Touches.** `api/v1/endpoints/handshakes.py`, `orchestration/handshake_service.py`,
`db/models/enums.py` (new `HandshakeStatus.OVERRIDDEN`), `schemas/handshakes.py`, integration tests.
*No migration* (columns already exist).

---

#### WP4 — Idempotent completion + offline queue hardening · Size M · *parallel, no deps*

**What it is.** Make handshake completion safe to retry. The PWA sends an `Idempotency-Key`; the
backend records it and, if the same key arrives twice, returns the current state instead of
erroring. On the PWA side, stop the offline queue from silently discarding failed submissions,
and move queued photo payloads from `localStorage` (too small) to IndexedDB.

**Why it matters.** Finding **F9**: the offline queue currently **drops any 4xx as "terminal"** —
meaning captured evidence can vanish silently when a driver is out of signal (which is most of the
job). And without idempotency, a double-tap or a retry-after-timeout can create duplicate events
or throw a spurious error at the driver. Both are real field-reliability problems.

**What "done" looks like.** A double-tap or replay-after-timeout produces exactly one event and no
driver-facing error; non-duplicate failures stay in the queue with a visible "needs attention"
state instead of disappearing.

**Touches.** `api/v1/endpoints/handshakes.py`, `orchestration/handshake_service.py`,
`db/models/handshakes.py` + migration, `driver-pwa/lib/hooks/useOfflineQueue.ts`,
`driver-pwa/lib/api/{client,handshakes}.ts`, tests both sides.

---

#### WP10 — Driver PWA de-mocking + demo-default flip · Size M–L · *after WP4; coordinate with Tim*

**What it is.** Turn the driver app from a demo into a real client. Flip demo mode to **off by
default** (today it's on unless explicitly disabled); make the trips list and active-trip detail
fetch from the real API instead of reading mock data unconditionally; finish the real Supabase
session → AuthContext hydration; and solve the static-export ID-routing problem for real trip IDs.

**Why it matters.** This is the pilot's **primary capture instrument, and it doesn't exist in
production form yet.** Demo mode is on by default, the trip list/detail read `mockTrips`
unconditionally (there are literal TODOs in the code), and the demo path skips upload + completion
entirely. Until this lands, no real driver can actually use the app against real data.

**What "done" looks like.** A production build with no `NEXT_PUBLIC_DEMO_MODE` set performs zero
mock reads on the driver's critical path; the demo build still works with the flag on; a real
device completes login → H1..H5 → artifacts in storage → receipts.

**Touches.** `driver-pwa/lib/constants/env.ts`, `lib/context/{Auth,Trip}Context.tsx`,
`app/(app)/trips/**`, `components/layout/ProfilePanel.tsx`, PWA tests.
**⚠ Coordinate with Tim** — his UX-fixes branch rewrites many of these same files.

---

#### WP11a — Dispatcher exceptions on the real API · Size M · *independent*

**What it is.** Build the backend `GET /exceptions` list endpoint (org-scoped, with filters) and
wire the dispatcher's exceptions page to it, removing the mock.

**Why it matters.** Exceptions are the dispatcher's **core investigation surface** — it's the
whole point of the dashboard — and it's currently entirely mock-backed (`useExceptions.ts` returns
`mockExceptions`; there is no list API call at all).

**What "done" looks like.** The exceptions page renders real seeded DB exceptions; another org's
exceptions are invisible (cross-org exclusion test passes).

**Touches.** `api/v1/endpoints/exceptions.py`, `orchestration/exception_service.py`,
`schemas/transit.py`, dispatcher `lib/hooks/useExceptions.ts` + pages, integration tests.

---

#### WP11b — Trip cancellation (FP-117) · Size S–M · *independent*

**What it is.** A `POST /trips/{id}/cancel` endpoint that a dispatcher can call from any
non-terminal status, recording a required reason as a dispatcher-source exception, setting the trip
to `cancelled`, and closing the evidence batch (WP6) if evidence exists.

**Why it matters.** There is currently **no way to cancel a trip** — once created it can only run
to completion. That's not viable operationally (cancelled orders, wrong assignments, etc.).

**What "done" looks like.** Cancelled trips are terminal (further handshakes return 409) and their
evidence is retained.

**Touches.** `api/v1/endpoints/trips.py`, `orchestration/trip_service.py`, `db/models/enums.py`, tests.

---

### Theme C — Data & integrations

---

#### WP7 — Journey lock v2 (FP-113, Chiko) · Size M · *parallel — touches shared `crypto/hashing.py`*

**What it is.** Extend the "journey lock" hash (the SHA-256 of committed trip params anchored at
creation) so it covers the *multi-stop, multi-consignment* trip plan: ordered stops, the
consignment list, and a hash of each consignment's raw Parcel-Perfect JSON. Old v1 receipts must
still verify via version dispatch.

**Why it matters.** Since FP-112, trips can have multiple stops and consignments, but the journey
lock still only covers the old single-leg shape — so the cargo plan itself isn't tamper-protected.

**What "done" looks like.** A multi-stop trip's lock covers its cargo plan; pre-v2 seeded trips
still verify.

**Touches.** `crypto/hashing.py` (**shared — coordinate**), `orchestration/{trip,verification}_service.py`, tests.

---

#### WP8 — Linehaul completion (F2 residue) · Size S–M · *after WP2*

**What it is.** Add the seal number(s), trailer list, and vehicle configuration to the linehaul
response the driver sees. These are additive fields only.

**Why it matters.** Finding **F2** is partly fixed (unit-grain counts landed in `ee4cf32`), but
the driver's linehaul still lacks the seal and vehicle-config info that the spec (v7 §8.1) says it
should carry.

**What "done" looks like.** Driver linehaul matches the spec's definition; reconciled against the
real linehaul photo from the Parcel-Perfect site visit.

**Touches.** `orchestration/manifest_service.py`, `schemas/trips.py`,
`frontend/shared/lib/types/manifest.ts`, the PWA linehaul step, tests both sides.

---

#### WP9 — Parcel Perfect client, mock-first · Size M–L · *parallel*

**What it is.** Build the `integrations/parcel_perfect.py` client with the real wire shape and
typed Pydantic models, backed by canned fixture envelopes so it works before we have live
credentials. Add a `PP_ACCOUNTS` credential registry to config and remove the dead PP flags.

**Why it matters.** **No integration code exists at all** yet (no PP, IDVS, Pulsit, Twilio,
SendGrid — the `*_USE_MOCK` flags are dead config). Parcel Perfect is the one integration on the
MVP critical path because it's the source of the "system" counts that reconciliation (WP2) depends
on. Mock-first means we can wire everything now and flip to live after the site visit.

**What "done" looks like.** `PPClient(account).get_single_waybill("...")` returns a validated model
from fixtures; flipping a config flag would hit a live URL through identical code paths.

**Touches.** new `integrations/parcel_perfect.py`, `core/config.py` (**shared — coordinate**) +
`.env.example`, fixtures under `tests/fixtures/pp/`, unit tests.

---

### Theme D — Compliance & production plumbing

---

#### WP12 — POPIA erasure implementation · Size M · *before any real driver data*

**What it is.** Implement the already-approved driver-erasure spec: an admin-gated
`POST /drivers/{id}/erase` that replaces a driver's personal data with an `[erased]` sentinel,
including inside audit trails and blockchain receipt payloads, and records how many receipts were
invalidated.

**Why it matters.** POPIA (SA's data-protection law) gives data subjects a right to erasure. We
legally **cannot onboard real drivers until this exists.** It's a hard gate on the pilot, not a
nice-to-have.

**What "done" looks like.** The full error-matrix test suite is green; an erased driver's licence
number appears nowhere in the database; `/verify` correctly reports `db_mismatch` on the redacted
driver events.

**Touches.** per the approved spec + `orchestration/driver_service.py`, migration, dispatcher
driver-detail page, integration tests.

---

#### WP13 — CI/CD, packaging, environment runbook · Size L · *independent, but gates the pilot*

**What it is.** The whole "make it deployable" package: (1) **CI** — add a Postgres service so the
~100 integration tests actually run, and add driver-pwa lint/type/test jobs; (2) **Packaging** —
production Dockerfiles for the API and dispatcher, and a *signed* Android release build with a
keystore kept outside the repo; (3) a committed **environment runbook** (`docs/deployment.md`)
covering required env vars per environment, Hedera topic provisioning, Supabase region
verification, production CORS/origins, and dead-config removal; (4) optional CD.

**Why it matters.** **Nothing is deployed and there is no path to deploy.** Integration tests
never run in CI (100 skipped), the driver PWA isn't in CI at all, there are no production
Dockerfiles, and the Android release build is unsigned (so it can't be distributed). This is the
work that turns "runs on my machine" into "runs in staging."

**What "done" looks like.** CI runs 224+ tests; a tagged commit produces deployable images + a
signed APK; the runbook alone is enough for someone to stand up staging.

**Touches.** CI config, backend + dispatcher Dockerfiles, `android/app/build.gradle`,
new `docs/deployment.md`.

---

### Theme E — Post-pilot (ticket now, build later)

- **WP14 — Iteration-3 per-stop handshake refactor (F8) · XL.** Replace the hard-wired
  five-handshake shape with a coarse trip status + a plan-driven handshake ledger, so trips with
  arbitrary stops/consignments work without special-casing. Big architectural change; explicitly
  deferred to post-pilot but ticketed now so no new code deepens the five-handshake assumption.
- **WP15 — Custody ledger · L.** A `ConsignmentCustodyEvent` model answering "what was physically
  in the truck at 02:14" per consignment, with per-client evidence cuts. Depends on WP2 + WP11a.

---

## 3. Technologies still to be set up for production

Everything below is either **not provisioned**, **stubbed**, or **dead config** today. Grouped by
what has to happen. (Source: §6, §6.4. "REPORTED" = flagged in the source doc; "VERIFIED" = checked
against code.)

### 3.1 Already in the stack, but not wired up / not running work

| Technology | State today | What's needed | WP |
|---|---|---|---|
| **Hedera (HCS)** | SDK integrated; anchoring works but is **synchronous & in-request**; `HEDERA_TOPIC_ID` default is empty | Provision an account + a consensus **topic per environment**; move anchoring to async outbox; decide testnet vs mainnet (open question Q5) | WP5, WP13 |
| **Celery worker** | Container **runs with zero tasks** — idle scaffold | Give it the anchoring + Merkle tasks (or drop the service if the spine slips) | WP5, WP6 |
| **Redis** | Running in dev compose as the Celery broker | Stand up a managed instance for staging/prod | WP13 |
| **Supabase Storage** | Used for evidence artifacts | Provision the `evidence-artifacts` bucket; **service-role key server-side only, never in client code** | WP13 |
| **Supabase Postgres** | Dev/local only | Managed instance; **verify the project region is `af-south-1`** (POPIA requires SA data residency — §7.5) | WP13 |

### 3.2 Integrations that don't exist yet (no code at all)

| Integration | Purpose | MVP? | WP |
|---|---|---|---|
| **Parcel Perfect** | Source of the "system" manifest counts reconciliation depends on | **Yes — critical path** | WP9 |
| **IDVS** (ID verification) | Driver identity verification; check currently records `PENDING` forever | Post-pilot | — |
| **Pulsit** (telematics) | Vehicle/GPS telematics | Post-pilot | — |
| **Twilio** (SMS/WhatsApp OTP) | Driver + receiver OTP delivery; libs are in `requirements.txt` but unused | Post-pilot (demo uses stub) | — |
| **SendGrid** (email) | Notifications; lib present, unused | Post-pilot | — |

> Note: `CLAUDE.md`'s architecture section lists five integration modules (`pulse.py`,
> `parcel_perfect.py`, `idvs.py`, `twilio.py`, `sendgrid.py`) that **do not exist yet** — they're
> the target, not the current state.

### 3.3 CI / CD / packaging (none of this exists)

- **CI can't run integration tests** — no Postgres service container; ~100 tests skipped. → WP13
- **Driver PWA is absent from CI** entirely (only dispatcher gets lint/tsc/test). → WP13
- **No production Dockerfiles** — dispatcher has `Dockerfile.dev` only; no CD pipeline. → WP13
- **Android release build is unsigned** — no `signingConfig`/keystore, so the APK can't be
  distributed. Driver APK distribution channel is an open question (Q4). → WP13
- **No deployment runbook** — required env vars, Hedera topic setup, region verification, prod CORS
  all undocumented. → WP13 (`docs/deployment.md`)

### 3.4 Dead config to remove or wire (hygiene)

- `AWS_*` / `S3_BUCKET_NAME` — storage is Supabase, not S3; the `s3_key`/`s3_bucket` column names
  are legacy.
- `IDVS_USE_MOCK` / `PULSE_USE_MOCK` / `PP_USE_MOCK` — referenced nowhere; remove or wire in WP9/WP13.
- `ENVIRONMENT` / `ALLOWED_ORIGINS` default to dev/localhost — must be overridden in prod.
- Confirm every `/dev/*` route 404s in production builds and `NEXT_PUBLIC_DEV_*` is unset.

---

## 4. The finish line — what "pilot-ready" means

Per the source doc, a production pilot needs **all** of:

- **WP1–WP6** — the evidence spine complete (the whole value proposition).
- **WP8** — linehaul complete.
- **WP10** — driver PWA de-mocked.
- **WP11a + WP11b** — dispatcher exceptions real + trip cancellation.
- **WP13** — CI/CD, packaging, runbook.
- **WP7 (FP-113)** — journey lock v2 landed.
- **WP9** — PP fixtures validated against a **real waybill from the site visit**.
- **WP12** — POPIA erasure **before any real driver data touches the system**.
- **FP-122** — consent pack signed.

Everything after that — **WP14, WP15, IDVS, Pulsit, Twilio/SendGrid notifications** — is
post-pilot hardening.

---

## 5. Suggested near-term ownership (for discussion, not a decree)

This is a starting point for the sprint conversation, chosen to minimise cross-dev collisions:

- **The spine needs an owner first.** WP1 is the foundation everyone else builds on — it may be
  worth doing as a pair or assigning to whoever has the most `handshake_service.py` context, rather
  than a solo grab, because WP2/WP3/WP5 all wait on it.
- **Self-contained backend WPs that don't collide with Tim's frontend merge:** WP3 (override),
  WP4 (idempotency), WP11a/b (exceptions + cancel). Good independent picks.
- **WP7** is already Chiko's (touches shared `crypto/hashing.py` — coordinate before editing).
- **WP10** should wait until **Tim's UX branch merges to `dev`**, since it rewrites many of the
  same driver-PWA files. Racing it guarantees conflicts.
- **WP9 and WP13** are large and independent — good candidates for whoever finishes their spine
  slice first.

> **Coordination reminders (from `CLAUDE.md`):** `core/config.py`, `db/models/__init__.py`,
> `main.py`, and `crypto/hashing.py` are shared — flag any change and coordinate. Alembic
> migrations must be name-prefixed and rebased against `dev` before autogenerate. No git writes
> by agents.

---

*Derived from `FreightProof_Technical_Full_Picture_v1.md`. When that document reaches v1.1 after
the Parcel Perfect site visit, re-sync this spec's §2 (WP2/WP8/WP9) and §3.2.*
