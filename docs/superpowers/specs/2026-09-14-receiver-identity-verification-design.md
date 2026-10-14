# Receiver Identity Verification — Design

**Status:** Draft for team review · **Date:** 2026-09-14 · **Author:** Tim (with Claude)
**Depends on:** FP-155 (receiver QR handover), FP-236/237/239/240
**Ticket:** none yet — this spec precedes the ticket

---

## 1. Problem

FP-155 lets a receiver confirm a delivery from a QR code with no account: they type a
name and an ID number, sign, and swipe. Nothing checks that the identity they typed is
real. In a disputed delivery — the case this whole platform exists for — the strongest
thing the record can currently say is "someone standing at the destination typed these
characters."

This spec adds identity verification to that moment, using Didit's hosted KYC flow
(document capture + live face match) against the South African Department of Home
Affairs registry.

## 2. The decision in one paragraph

At the handover, the receiver gives explicit consent, completes a **full Didit
verification session** (ID document + passive liveness + face match + IP analysis) on
their own phone, and only then signs and confirms. The result is fetched
**server-side** and attached to the confirmation. If anything prevents that — no
document on them, no signal, Didit unreachable, monthly free quota spent — the flow
degrades down a defined ladder and the delivery still confirms, with the reason recorded
as evidence. No trip may reach a terminal state with a verification still in flight.

## 3. Principles carried from the existing codebase

These are not new inventions. Each already governs code in this repo, and this feature
inherits them rather than relitigating them.

| Principle | Where it is already established |
|---|---|
| **Record, never gate.** A failed check is evidence, not a refusal. | `phase_service.py` seal-mismatch; `HandoverTokenAttempt` |
| **A gap is not a mismatch.** They must be separate exception types or the dispatcher queue fills with false positives. | `enums.py` — `SEAL_UNVERIFIED` vs `SEAL_MISMATCH` |
| **A wrong value is still evidence.** Never 422 away what the receiver actually produced. | `schemas/handover.py`; `frontend/shared/lib/utils/sa-id.ts` |
| **Evidence, not operations.** FreightProof records; it does not adjudicate in real time. | `CLAUDE.md` |
| **Personal data stays in `af-south-1`; only hashes reach Hedera.** | `CLAUDE.md` |
| **Every public failure looks identical.** No oracle for a guesser. | `api/v1/endpoints/handover.py` |
| **Integrations quarantine their guesses.** Assumed API shapes live in named constants and one parser. | `integrations/pulsit.py` |

## 4. Options considered and rejected

Recorded so the choice is defensible under examination, not so the reader can skip them.

**Offline structural check only (Luhn + embedded DOB).** Free, no vendor, no personal
data leaves the system. Rejected as *insufficient alone*: it proves a number is
internally consistent, never that the person exists or is present. Retained as a
possible cheap addition, not as the answer.

**Credit bureau lookup (Datanamix, XDS, TransUnion).** ~R1–3 per check, ordinary
personal information, onshore. Rejected because bureau data is *derived from credit
records*, so it evidences "this number appears in commercial records", not "this number
is in the National Population Register". TransUnion themselves caution it is not a DHA
replacement. For a platform whose product is evidence that survives a dispute, that
distinction is the whole game.

**DHA NPR number-only lookup via an accredited intermediary.** R10 real-time, or **R1
per check in off-peak batch** after the 2025-07-01 fee change. Authoritative, ordinary
personal information, onshore, and the cheapest appropriate check. Rejected for this
iteration in favour of Didit on the team's explicit direction: it verifies a *number*,
not a *person present at the door*, and has no liveness component.

**Capture-only (receiver photographs their ID, no verification).** Free, fits the
platform's grain exactly — FreightProof photographs seals and waybills rather than
validating them. Rejected as the primary path on the team's direction, but its logic
survives as **tier 3** below.

**Didit, verification after confirmation (async webhook).** Considered and rejected:
it allows a trip to complete with the verification still `PENDING`, leaving an
indeterminate evidence state, and it makes the signature unattributable to a verified
identity. See §6.

## 5. Why Didit, and what it costs

[Didit](https://didit.me) gives **500 full KYC sessions per month, free, forever** — the
complete bundle (ID document + passive liveness + face match + IP analysis), not a
degraded tier. Session 501 bills $0.33 with no rate limit at the threshold.

Two things the team is knowingly taking on by choosing it:

1. **POPIA s26 — special personal information.** Passive liveness and face match are
   *biometric processing*. s26 prohibits this unless a s27 exemption applies. We rely on
   **s27(1)(a), explicit consent**, which requires a consent gate before the session and
   proof of the wording consented to. See §12.
2. **POPIA s72 — cross-border transfer.** Didit is a US/EU processor. Sending a South
   African receiver's document and face offshore needs a documented transfer mechanism
   and a processor agreement. This cuts against the `af-south-1` rule in `CLAUDE.md`, so
   it is called out rather than absorbed silently.

Note Didit also sells a number-only DHA lookup (`zaf_africa_national_id`) at **$1.10 ≈
R20**, which is *not* part of the free tier and is ~20× the R1 off-peak intermediary
rate. We do not use it.

## 6. Architecture: verify, then confirm

### 6.1 The invariant

> **No trip reaches a terminal state with a verification in flight.** By the time the
> confirmation phase completes, every delivery carries a final verification state —
> `VERIFIED`, `FAILED`, or `UNVERIFIED` with a reason.

### 6.2 Flow

```
receiver scans QR
  └─> GET /handover/{token}            (existing; mints browser-binding cookie)
  └─> consent gate                      (s27(1)(a); wording hashed and stored)
  └─> POST /handover/{token}/verify     (new; server creates Didit session)
        ├─ quota ledger checked FIRST — no call if exhausted
        └─ provider_session_id persisted against the token BEFORE redirect
  └─> redirect to Didit session_url     (document + live face, on receiver's phone)
  └─> Didit redirects back to receiver app
  └─> POST /handover/{token}/verify/resolve   (new; browser says only "I'm back")
        └─ server fetches GET /v3/session/{OUR stored id}/decision/  ← AUTHORITY
  └─> terminal verification state in hand
  └─> POST /handover/{token}/confirm    (existing; signature + confirmation)
```

Verification precedes the signature, so the signature is attributable to a verified
identity. That is the evidential point of the feature and the reason for this ordering.

### 6.3 Why verify-first is safe

The objection to verifying first is that the capability token expires in
`HANDOVER_TOKEN_EXPIRY_MINUTES` (10), and a slow Didit round trip could burn it, leaving
the delivery unconfirmable behind a generic 404. Two mechanisms close this:

**Bounded one-time token extension.** `opened_at` already pauses the rotating series —
`rotate_capability_token` will neither retire an opened token nor issue a successor to
one — so the receiver's code stays alive. On verification start we extend `expires_at`
**once**, conditionally, capped by `IDVS_TOKEN_EXTENSION_MINUTES`. The token stays
single-use and browser-bound throughout.

*Trade-off, stated rather than buried:* this lengthens the life of the only credential on
an unauthenticated write path. It is bounded, one-shot, and applies only to a token a
human has demonstrably opened.

**The escape hatch already exists.** If a receiver abandons mid-session and the token
dies, the driver's `force=true` re-issue (FP-237) shows a fresh code and the handover
restarts at tier 3/4. No new mechanism is needed.

## 7. Security rules

### 7.1 Never trust the browser for verified state

**The callback from Didit is a signal that the flow finished. It is never the answer.**

Didit's own team shipped a fix for exactly this failure on their WordPress plugin: the
endpoint accepted whatever status the visitor's browser submitted, so anyone could post
`{sessionId: "...", status: "Approved"}` and mark themselves verified. The correction was
to fetch the authoritative decision server-side with the API key
([didit-protocol/plugin-wordpress#8](https://github.com/didit-protocol/plugin-wordpress/pull/8)).

Our exposure is **worse than a WordPress site's**, because the receiver route is
unauthenticated by design — the capability token is the only credential. If a returned
token were trusted, anyone holding a live QR could self-declare `VERIFIED` and the
feature becomes theatre in a dispute.

Therefore:

- `provider_session_id` is generated by us and persisted **before** the redirect.
- `/verify/resolve` accepts **no** session identifier, status, or token from the client.
  Its entire body is empty; the capability token in the path is the only input.
- The server fetches `GET /v3/session/{stored_id}/decision/` with `IDVS_API_KEY`.
- The client can never name a session, so it can never substitute one.

### 7.2 Identity cross-check (substitution defence)

A single-use session URL prevents **replay** but not **substitution**: a receiver could
forward the Didit link *before* opening it, and a confederate completes it with their own
entirely genuine ID. Every check passes; the wrong person is verified.

The full bundle extracts document data, which gives us the control for free:
**compare Didit's extracted surname and ID number against the name and number the
receiver typed.** A mismatch records `RECEIVER_ID_MISMATCH`.

Comparison is normalised (case, whitespace, diacritics) and compares surname plus ID
number only — given-name ordering and initials vary too much between documents and
self-entry to carry a fraud signal. A mismatch is recorded, never used to block.

### 7.3 Webhook

The webhook is a **backstop**, not the primary path. It is a new public write-capable
surface and carries the same posture as the rest of `public_router`:

- HMAC signature verified against `IDVS_WEBHOOK_SECRET`; invalid ⇒ 401, logged.
- Timestamp freshness checked against replay.
- **Idempotent by session id** — Didit retries up to 5× with exponential backoff, and a
  duplicate must never raise a second exception or double-count quota.
- Unknown session ⇒ log and return 200. Never make Didit retry into a wall.
- Rate-limited per IP, like `HANDOVER_PUBLIC`.

### 7.4 Late decisions

A webhook arriving **after** terminalisation does not change the terminal status — that
would break the §6.1 invariant. It is recorded as a late annotation
(`late_decision_status`, `late_decision_at`) on the row.

This follows the precedent set throughout the codebase: record it, do not refuse and
forget it happened.

## 8. The tier ladder

Every tier confirms the delivery. What changes is the strength of the evidence recorded
— never whether the truck can leave.

| Tier | Situation | Behaviour | Status / exception |
|---|---|---|---|
| **1** | Document + live face, Didit approves, identity cross-check passes | Full free-tier session | `VERIFIED` — no exception |
| **2a** | Didit declines | Session completes, fails | `FAILED` + `RECEIVER_ID_MISMATCH` (WARNING) |
| **2b** | Didit approves but extracted identity ≠ typed identity | §7.2 cross-check | `FAILED` + `RECEIVER_ID_MISMATCH` (WARNING) |
| **3** | No document on them, camera available | Selfie captured as **our own** evidence artifact — no Didit call, no quota burned, no s26 | `UNVERIFIED` / `NO_DOCUMENT` + `RECEIVER_ID_UNVERIFIED` (INFO) |
| **4** | No camera, declines consent, or no connectivity | Existing FP-155 flow unchanged | `UNVERIFIED` + `RECEIVER_ID_UNVERIFIED` (WARNING) |
| **5** | Quota spent / Didit unreachable / abandoned | Degrades to 3 or 4 automatically | `UNVERIFIED` with the specific reason |

**Tier 3 is presence evidence, not identity evidence.** A bare selfie with nothing to
match against proves a live human confirmed, not who they are. It is deliberately *our*
capture rather than a Didit liveness-only call, because a partial Didit call burns a full
session from the 500 either way — spending quota on a weaker check would only make the
hard stop arrive sooner.

## 9. Data model

New file: `backend/app/db/models/receiver_verification.py`
Registered in `db/models/__init__.py`. Migration: `2026_09_<dd>_tim_add_receiver_verification.py`, dated on creation and named per the `CLAUDE.md` convention. Rebase against `dev` before autogenerating — see the Alembic-conflict rule.

### `ReceiverIdentityVerification`

One row per handover confirmation.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `handover_confirmation_id` | FK → `handover_confirmations.id`, **unique** | One verification per confirmation, enforced at the database |
| `trip_id` | FK → `trips.id` | Denormalised for single-read dispatcher queries, matching `HandoverCapabilityToken` |
| `status` | enum | `PENDING` / `VERIFIED` / `FAILED` / `UNVERIFIED` |
| `tier` | enum | `DOCUMENT_AND_FACE` / `SELFIE_ONLY` / `TYPED_ONLY` |
| `unverified_reason` | enum, nullable | `NO_DOCUMENT` / `DECLINED_CONSENT` / `NO_CONNECTION` / `QUOTA_EXHAUSTED` / `VENDOR_UNAVAILABLE` / `ABANDONED` |
| `provider` | str(20) | `didit`. Recorded so a future provider swap stays legible in old rows |
| `provider_session_id` | str(64), nullable | The pointer. Persisted **before** redirect (§7.1) |
| `provider_decision_at` | timestamptz, nullable | |
| `identity_match` | bool, nullable | §7.2 cross-check outcome. Null when no document data exists |
| `selfie_artifact_id` | FK → `evidence_artifacts.id`, nullable | Tier 3 only |
| `consent_given_at` | timestamptz, nullable | s27(1)(a) evidence |
| `consent_text_hash` | str(64), nullable | SHA-256 of the exact consent wording shown |
| `late_decision_status` | str(20), nullable | §7.4 |
| `late_decision_at` | timestamptz, nullable | |
| `created_at` / `updated_at` | timestamptz | Per `CLAUDE.md` |

**Deliberately absent: the document images, the face image, and Didit's extracted ID
number.** Didit holds those; we hold a decision and a session reference. This is data
minimisation and matches the architecture doc's line that FreightProof *"does not
replicate identity data"*.

*Known trade-off:* in a dispute, the underlying images must be re-queried from Didit
rather than read locally — evidence that matters lives with a third party, offshore. If
the team decides that is unacceptable for a cargo-theft platform, the alternative is
storing the images in `af-south-1` and accepting the larger POPIA footprint. Flagged for
decision, not assumed.

`consent_text_hash` matters more than it appears: an s27(1)(a) basis is only as good as
proof of **what wording** was agreed to. Hashing the copy makes that provable later, and
the wording must therefore be treated as versioned content, not a UI string someone
edits freely.

### `IdvsQuotaLedger`

| Column | Notes |
|---|---|
| `period` | `YYYY-MM`, **UTC** — Didit resets 00:00 UTC, which is 02:00 SAST on the 1st |
| `provider` | `didit` |
| `sessions_used` | int |
| unique on (`period`, `provider`) | |

Incremented by a **conditional update**:

```sql
UPDATE idvs_quota_ledger
   SET sessions_used = sessions_used + 1
 WHERE period = :period AND provider = :provider
   AND sessions_used < :limit
RETURNING sessions_used;
```

No row returned ⇒ quota exhausted ⇒ degrade. This is the same atomic-gate idiom as
`redeem_capability_token`: concurrent handovers race the database, not each other in
Python.

### Enum additions (`db/models/enums.py`)

`ReceiverVerificationStatus`, `ReceiverVerificationTier`,
`ReceiverVerificationUnverifiedReason`, and two `ExceptionType` members:
`RECEIVER_ID_MISMATCH`, `RECEIVER_ID_UNVERIFIED`.

Keeping those two exception types separate is not cosmetic — it is the same reasoning
`enums.py` already records for `SEAL_UNVERIFIED` vs `SEAL_MISMATCH`: conflating a gap
with a fraud indicator puts false positives in front of a dispatcher triaging a real
investigation.

## 10. Components

| Layer | File | Responsibility |
|---|---|---|
| Integration | `integrations/idvs.py` **(new)** | `IdvsClient` Protocol · `MockIdvsClient` · `DiditIdvsClient` · `get_idvs_client()`. Every assumed Didit shape quarantined in named constants and one parser, per `pulsit.py` |
| Orchestration | `orchestration/receiver_verification_service.py` **(new)** | Quota ledger, session creation, decision resolution, cross-check, tier resolution, exception raising |
| API | `api/v1/endpoints/handover.py` | Three routes added to `public_router` |
| Model | `db/models/receiver_verification.py` **(new)** | §9 |
| Schemas | `schemas/handover.py` | Request/response shapes |
| Tasks | `tasks/` | Sweeper ageing stale `PENDING` → `ABANDONED` |
| Frontend | `frontend/receiver/` | Consent gate, redirect handling, return polling, tier 3 selfie capture |

**Layering check:** `integrations/idvs.py` imports only `config` and `mock_state` — never
`api/` or `orchestration/`. Endpoints stay thin and call the service. Conforms to
`CLAUDE.md`.

## 11. API surface

All on `public_router`, all unauthenticated, all rate-limited, all returning the single
generic 404 on any failure — no new oracle.

| Route | Purpose |
|---|---|
| `POST /handover/{raw_token}/consent` | Record consent + wording hash. Must precede a session |
| `POST /handover/{raw_token}/verify` | Check quota, create Didit session, persist session id, extend token once, return `session_url` |
| `POST /handover/{raw_token}/verify/resolve` | **Empty body.** Server fetches the authoritative decision for its own stored session id |
| `POST /handover/webhooks/didit` | Signed backstop (§7.3) |

`GET /handover/{raw_token}` gains a `verification` block so a returning browser can
re-render state after the redirect without trusting its own memory.

## 12. POPIA

| Section | Obligation | How it is met |
|---|---|---|
| **s26 / s27(1)(a)** | Biometric processing prohibited absent an exemption | Explicit consent gate before any session; `consent_given_at` + `consent_text_hash` recorded. Withdrawal is **prospective** — it stops future processing and does not retract a delivery record already made. This must be stated in the consent copy |
| **s72** | Cross-border transfer | Processor agreement with Didit; documented transfer basis. **Open action — legal, not code** |
| **s18** | Notification to data subject | Consent screen names Didit, the purpose, and what is retained where |
| **s10 / s13** | Minimality, purpose limitation | We store a decision and a session pointer, never images or extracted numbers (§9) |
| **s11(1)(f)** | Lawful basis for the non-biometric parts (name, ID number, position) | Legitimate interest — cargo-theft and delivery-fraud prevention. Deliberately not consent: consent is withdrawable at will, and an evidence record that a disputing party can dissolve is not evidence |
| **Retention** | | We hold no biometric data. Didit's own retention policy governs theirs — **open action: confirm and document it** |

## 13. Error handling and degradation

| Failure | Detection | Result |
|---|---|---|
| Browser offline | `navigator.onLine` / fetch failure | Tier 4, `NO_CONNECTION`, no Didit call |
| Session creation times out | Short client + server timeout | Tier 4, `VENDOR_UNAVAILABLE` |
| Quota spent | Ledger checked before any call | Tier 3/4, `QUOTA_EXHAUSTED` |
| No document | Receiver's choice on consent screen | Tier 3 + selfie artifact |
| Signal drops mid-Didit | Poll deadline elapses | Tier 3/4, `ABANDONED` |
| Didit declines | Decision fetch | `FAILED` + `RECEIVER_ID_MISMATCH` |
| Extracted ≠ typed | §7.2 | `FAILED` + `RECEIVER_ID_MISMATCH` |
| Webhook replayed | Idempotency by session id | No-op |
| Webhook after terminalisation | §7.4 | Recorded as annotation only |
| Decision fetch fails | HTTP error | Nothing stored; webhook recovers; sweeper ages it out |

**A total connectivity dead zone is out of scope.** The receiver needs data to load the
scan page at all — with none, the whole FP-155 handover fails, not just verification.
This matrix covers flaky or dropped connectivity and Didit being unreachable while our
API is reachable. The dead-zone case is a pre-existing FP-155 gap, not one this feature
introduces.

## 14. Configuration

Existing keys finally used: `IDVS_USE_MOCK`, `IDVS_API_KEY`, `IDVS_API_URL`.

New (**`core/config.py` and `.env.example` are shared files — flag in TASK COMPLETE**):

| Key | Default | Purpose |
|---|---|---|
| `IDVS_WORKFLOW_ID` | `""` | Didit workflow selecting the full KYC bundle |
| `IDVS_WEBHOOK_SECRET` | `""` | HMAC verification (§7.3) |
| `IDVS_MONTHLY_SESSION_LIMIT` | `500` | Hard stop. Never bill |
| `IDVS_SESSION_TIMEOUT_SECONDS` | `10` | Session-creation call ceiling |
| `IDVS_DECISION_POLL_SECONDS` | `90` | Client deadline before `ABANDONED` |
| `IDVS_TOKEN_EXTENSION_MINUTES` | `10` | One-shot capability-token extension cap (§6.3) |

New rate limit in `core/limits.py`: `IDVS_VERIFY`, sized below `HANDOVER_PUBLIC` because
each call can spend quota.

## 15. Testing

**Unit** — quota ledger under concurrency; tier resolution matrix; identity cross-check
normalisation (case, whitespace, diacritics, surname-only); webhook HMAC verification and
replay rejection; `MockIdvsClient`.

**Integration** — full consent → verify → resolve → confirm path; `/verify/resolve`
rejects any client-supplied session id (§7.1 regression test); quota exhaustion degrades
to tier 3/4 and makes no outbound call; no-document path writes a tier 3 selfie artifact;
vendor outage never blocks confirmation; replayed webhook is idempotent; unknown session
returns 200; late webhook annotates without changing terminal status; every public
failure returns the identical generic 404.

Both `MockIdvsClient` and a stubbed `DiditIdvsClient` are exercised. `IDVS_USE_MOCK=true`
throughout the suite — no test makes a network call.

## 16. Staging

| Stage | Scope | Independently verifiable |
|---|---|---|
| **1** | `integrations/idvs.py` + `MockIdvsClient` + models + migration + quota ledger | Unit tests green; mock returns deterministic decisions |
| **2** | Service + the four routes + webhook + exceptions | Integration tests green; full flow works against the mock |
| **3** | Receiver UI — consent gate, redirect, return polling, tier 3 capture | Manual walk-through on a phone |
| **4** | Real credentials, `IDVS_USE_MOCK=false` | Blocked on §17 |

Stages 1–3 need no vendor account. The honours deliverable is fully demonstrable on the
mock, which is the same posture `pulsit.py` takes toward a vendor that has not yet
supplied a specification.

## 17. Open actions (not code)

1. **s72 transfer mechanism + Didit processor agreement.** Legal. Blocks stage 4.
2. **Didit's retention policy** for documents and face images — confirm and document.
3. **Consent wording** drafted and version-controlled (it is hashed into evidence).
4. **Scope sign-off:** the architecture docs scope IDVS to *driver* verification at trip
   creation. Receiver verification is an extension and needs team agreement.
5. **Delivery volume** from Load Factor — determines how often the 500 hard stop bites.
6. **Decide §9's trade-off:** decision-and-pointer only, or store images in `af-south-1`.

## 18. Related and deliberately out of scope

**Driver verification.** `drivers.idvs_status` and `trips.idvs_check_status` have been
written `PENDING` and never updated since they were created
(`trip_service.py:259`, `driver_service.py:89`). That is what the architecture docs
actually specify IDVS for, and Didit's free tier suits it *better* than it suits
receivers — drivers are known, employed, consented under FP-122, on company-issued
devices, and enrolled once rather than per trip, so the s26 and s72 arguments are far
easier and a roster fits inside 500/month comfortably. **Separate ticket.**
