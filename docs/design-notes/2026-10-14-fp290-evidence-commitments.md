# FP-290: what each evidence receipt commits to

**Status:** implemented on `Ciaran` (stages A–C, plus the end-to-end test in `backend/tests/integration/test_fp290_incident_chain.py`). Plan: [`docs/superpowers/plans/2026-10-14-fp290-critical-evidence-anchors.md`](../superpowers/plans/2026-10-14-fp290-critical-evidence-anchors.md).

This note says, precisely, what a FreightProof receipt proves and what it does not. A receipt is a SHA-256 hash published to a Hedera Consensus Service (HCS) topic. It proves that *this exact set of values existed, in this exact form, no later than the consensus time*. It does not prove the values were true. Nothing but the hash ever leaves PostgreSQL (POPIA): see [`app/blockchain/anchor_service.py`](../../backend/app/blockchain/anchor_service.py).

## 1. One action, one event, one receipt

Four things can happen to an incident, and each is its own `evidence_anchor_events` row with its own frozen payload, hash and Hedera receipt. A later action never edits an earlier event or receipt.

| Action | Anchored when | Event `receipt_type` | `occurred_at` (server clock) |
|---|---|---|---|
| Raise | A persisted exception has `severity = critical`, from any source | `exception_raised` | `exception.created_at` |
| Review | Every *new* actual review: single, each row of a batch, and dispatcher-authored notes | `exception_reviewed` | `exception.reviewed_at` |
| Cancel | `cancel_trip` explicitly (never inferred from a note's text) | `trip_cancelled` | `trip.closed_at` |

Never anchored: claims and releases, same-reviewer replays, warning/info reports (they get a review event only when reviewed), and everything before FP-290 (§7).

A cancellation writes a dispatcher note that is born reviewed by its author. That note is its own exception row, so one cancellation produces **two** events on the note (`trip_cancelled` and the authored `exception_reviewed`), and a critical report that is later reviewed produces a third event, on the report. In the end-to-end test a broken-seal report that is raised, then cancelled around, then reviewed has four events and four receipts: report/raised, report/reviewed, note/cancelled, note/reviewed.

## 2. Coverage matrix: committed vs only recorded

"Committed" means it is reachable from the hashed payload (free text and people only as SHA-256 digests). "Recorded" means FreightProof stores it and shows it, but a changed value cannot be detected from the receipt. Builders: [`canonical.py`](../../backend/app/orchestration/evidence_anchors/canonical.py). The payload is built from typed value records, not ORM objects, so adding a column to a table cannot add it to a payload.

**Raise (`exception_raised`)**

| Committed | Only recorded |
|---|---|
| `trip_id`, `exception_id`, `occurred_at` | GPS latitude/longitude, accuracy, and every location assessment (§3) |
| `exception_type`, `source`, `severity` | Driver device capture time (`driver_captured_at`), `client_report_id` |
| `description` as SHA-256 of the exact UTF-8 text (no trimming; `null` ≠ `""`) | Review fields and claim state (they change later, by design) |
| Context ids (`phase_event_id`, `checkpoint_id`, `consignment_id`, `trip_stop_id`, `vehicle_id`) as one digest | Photo metadata: MIME type, device capture time, storage key and URL |
| Every photo: `artifact_id` + SHA-256 of the file bytes; sorted by id; `[]` when there are none | |

**Review (`exception_reviewed`)**

| Committed | Only recorded |
|---|---|
| `exception_record_sha256`: the whole raise record above, so a review is bound to the report *as it was* | Reviewer's name and e-mail (only a digest of their user id is committed) |
| Reviewer as `sha256({"actor_type":"user","user_id":…})` | The claim that preceded the review |
| `review_outcome`, `contact_method`, `occurred_at = reviewed_at` | |
| `review_note` as a digest | |
| For a dispatcher-authored note only: the note text as `authored_statement_sha256` | |

**Cancel (`trip_cancelled`)**

| Committed | Only recorded |
|---|---|
| `trip_id`, the note's `exception_id`, `status = "cancelled"`, `occurred_at = trip.closed_at` | Phase rows, which are deliberately left as they were (the plan was abandoned partway, not completed) |
| Who: digest of the note's reviewer id | The dispatcher's name |
| Cause: digest of the exact persisted note text, prefix included | |

Version rules: `payload_version` must be the integer `1`; a bool, string, missing field, or an event kind that does not match the receipt type makes verification return `error`, never a match.

## 3. Why GPS is never hashed

GPS has no field in any payload, so a GPS-only edit cannot change a receipt (`test_gps_only_edit_still_verifies`, `test_record_types_have_no_gps_or_location_fields`). Three reasons:

1. **It is derived, not observed.** The server re-derives location assessments (geofence, proximity, tracker corroboration) as other data arrives. Hashing them would turn a legitimate re-assessment into a false "tampered" result.
2. **Hashing it would not protect it.** Coordinates are low-entropy; anyone can enumerate a city grid and match the digest. A hash of a coordinate is a coordinate in disguise, which POPIA treats as personal data.
3. **The device is the only source.** The receipt cannot make a phone's reading more true; it can only freeze it. The audit pack therefore labels every position `recorded` (`position_tier` is a literal `"recorded"` in the manifest), whatever the anchoring of the rest of the report.

## 4. Cargo: what the journey lock does and does not commit

The journey lock is unchanged by FP-290 (v1 and v2 payload bytes are pinned by `tests/baseline/test_b3_canonical_hashes.py`). Cargo is covered only indirectly:

- For a trip created from a Parcel Perfect (PP) manifest, the lock contains `pp_manifest` (the manifest key) and `pp_manifest_snapshot_sha256`: the SHA-256 of the manifest snapshot stored on the trip-creation phase row at creation time. Verification **recomputes** that hash from the stored snapshot, so editing or deleting the snapshot reads as tampering (`test_created_trip_verifies_and_an_edited_snapshot_does_not`, `test_deleted_manifest_snapshot_fails_verification`). See [`crypto/hashing.py`](../../backend/app/crypto/hashing.py) and [`verification/trip_payloads.py`](../../backend/app/orchestration/verification/trip_payloads.py).
- It commits the manifest **as it was at creation**. Later PP polls, parcel scans and count changes are not in it; they are the phase ledger's job (`test_pp_poll_after_creation_keeps_verification`).
- A trip with no PP manifest (an empty leg, or a manually built load) has `pp_manifest = null` and `pp_manifest_snapshot_sha256 = null`. **Its lock has no cargo commitment at all**: adding a consignment afterwards still verifies (`test_non_manifest_lock_carries_no_cargo_commitment_and_later_cargo_does_not_move_it`). That is a stated limitation, not an oversight; a future journey-lock v3 would be needed to change it.

## 5. Three different times

| Time | Source | Where it lives | What it tells you |
|---|---|---|---|
| **Capture time** | The driver's phone clock (`driver_captured_at`, artifact `captured_at`) | Recorded only; not in any payload | When the device says it happened. Unverifiable, and an offline phone can be minutes or days behind real time |
| **Server time** | The API process clock when it wrote the row | Committed as `occurred_at` | When FreightProof first accepted the action. This is the time the receipt vouches for, as the server's claim |
| **Consensus time** | Hedera, when the hash was ordered on the topic | On the receipt row (`hedera_consensus_timestamp`); not in the hash | An upper bound: the committed values existed *no later than this* |

**A later anchor proves a later commitment, not a later event.** If Hedera is down for two hours, a raise event is anchored two hours after `occurred_at`. The receipt then proves "this record existed by T+2h", not "it happened at T+2h" and not "it happened at T". The gap between `occurred_at` and consensus time is the window in which the stored record could have been changed before it was frozen on-chain; the event row's frozen `event_hash` (written in the action's own transaction) keeps that window honest, because the worker refuses to anchor anything that no longer rebuilds to that hash (§6). The audit pack shows both times.

## 6. "Anchored" in the audit pack vs Verify

These are two different questions and they use different inputs.

| | Audit-pack tier (`anchored` / `recorded`) | Verify (portal button, API) |
|---|---|---|
| Question | "Does the pack's frozen snapshot rest on an intact receipt?" | "Is the live database, and live file storage, still what the receipt committed?" |
| When | At issue, no network | On demand, live |
| Photo bytes | **Not re-read.** Uses the stored `file_hash` | **Re-hashed** from the actual object in Storage (`hash_stored_evidence_file`) |
| Hedera | Not contacted | Mirror node checked for that topic/sequence/hash |

The pack says *anchored* only when all of these hold ([`anchor_tiers.py`](../../backend/app/orchestration/audit_packs/anchor_tiers.py)): the event is `anchored` with a linked receipt; that receipt is about this event, this trip and this kind; its hash equals the event's frozen hash; both stored payloads still hash to it; **and** a payload rebuilt from today's rows (with today's stored photo hashes) hashes to the same value. A photo is *anchored* only if the intact raise event committed that artifact with that exact hash. A review or cancellation receipt anchors that action only; it never promotes the report or its photos. Pending and failed events are shown as such, never rounded up.

Verify goes further ([`evidence_payloads.py`](../../backend/app/orchestration/verification/evidence_payloads.py)): it rebuilds from live rows, replaces each stored photo hash with the hash of the bytes in Storage now, and compares to both the event hash and the receipt hash. Changed data or bytes, or missing bytes, is `db_mismatch`. A storage or mirror outage is `error`, never a mismatch: an outage is not tamper evidence. The pack's live check pins to the exact `receipt_id` the pack froze, so a later duplicate cannot substitute.

The practical consequence: a pack can read "anchored" while a file has been swapped in Storage since the upload, provided the `file_hash` column was left alone. Verify is what catches that. The pack is a snapshot; Verify is the check.

## 7. Why the dispatcher is review-only

The dispatcher sees every photo, the report, the review and the cancellation, and can review. It shows **no anchor status, retry text or Verify button** (decided 15 Oct; `ExceptionAnchors.tsx` was built and then removed). The one exception, added 16 Oct: in forensic mode (admin dispatcher, toggle on) the exception detail page lists a HashScan link per action that has reached Hedera (`ExceptionHederaLinks.tsx`), built from the topic id and sequence number now carried on each `anchor_events` entry. Pending and failed events show nothing, and no hash is shown. Receipts and coverage live in the audit pack (PDF and incident sheet) and the shared client portal.

The topic id and sequence number are returned only to an admin dispatcher, and only by the exception detail endpoint (`attach_hedera_refs`); every other read, and every non-admin, gets `null`. Receipts are admin-only everywhere else (`/blockchain/receipts`, trip detail's `blockchain_receipts`), so the pointer into one is too. They identify a public Hedera record that carries a hash, never personal data (POPIA).

Rationale, as reflected in the design (confirm against the decision record before examination): (a) the audience for a receipt is a third party, an insurer, SAPS or a client, so that is where it is presented; (b) the dispatcher cannot act on anchor debt, because retry is automatic (§8), so a status badge there would be an alarm with no action; (c) a green tick on the working screen invites using "anchored" as an operational all-clear, which it is not (§6).

## 8. Retry and recovery runbook

**How debt arises.** The action's transaction writes the source rows, the photo membership, the event and its frozen hash together. After the *outer* commit the event id (only the id) is published to Celery; if the broker is down a local fallback anchors in-process. A Hedera error leaves the event `failed`; a lost publish leaves it `pending`. In both cases the evidence is safe and the source is untouched.

**Automatic recovery** ([`tasks/evidence_anchors.py`](../../backend/app/tasks/evidence_anchors.py), [`recovery.py`](../../backend/app/orchestration/evidence_anchors/recovery.py)):

- The task retries 3 times, 30 s apart.
- A Celery Beat sweep runs every 60 s and takes up to 20 events that are `pending` or `failed` (however many times they have failed), have no receipt, and whose `updated_at` is older than 300 s. It locks each with `FOR UPDATE SKIP LOCKED` and moves `updated_at`, so two sweeps never fight and one stuck event cannot starve the rest.
- After an outage ends, expect debt to clear within roughly 5–6 minutes, longer if more than 20 events are owed (20 per minute).

**Checking by hand.**

```sql
select id, trip_id, exception_id, receipt_type, anchor_status, updated_at
from evidence_anchor_events where receipt_id is null order by updated_at;
```

An empty result means nothing is owed. Logs carry ids and error classes only.

**Triage when an event stays `failed` after Hedera is healthy.** The worker compares against the *original* `event_hash` and refuses to anchor if the stored payload no longer hashes to it, or the source rows no longer rebuild to it. The log says `stored payload no longer matches its frozen hash`, `source rows changed since the action`, or `cannot be rebuilt`. That means the evidence was edited after the action. **Do not re-baseline it, edit `event_hash`, or set `receipt_id` by hand**: the whole point is that a receipt only ever commits what actually happened. Leave it `failed`; the audit pack will say so; find out who changed the row.

**Forcing a retry** (after the 300 s age, Beat does this on its own):

```bash
celery -A app.tasks call tasks.evidence_anchors.anchor_event --args='["<event_id>"]'
```

Safe to run twice: the event row is locked, and a linked receipt is never submitted again by this path.

**Deploy.** The FP-290 migration (`2026_10_14_ciaran_evidence_anchors.py`) is applied to the shared database from `dev`, after merge, by the migration owner. Never `alembic upgrade` from a feature branch.

## 9. Known limitations

- **No exactly-once on HCS.** If the worker crashes after Hedera accepts a message but before the commit, the retry submits again. The topic then holds two messages with the same hash; the event row is the application identity and links exactly one receipt. The orphan message is harmless but real.
- **No collision incident type.** The enum has none, so the demonstration uses a broken-seal incident. A seal incident is not called a collision.
- **No backfill.** Exceptions that predate FP-290 have no events and show as *recorded*, not *pending*. Reviewing an old critical exception creates a review event only; a raise event is never fabricated afterwards, because it would commit a record that had already been open to editing.
- **Photos are frozen at creation.** 0–5 per report, 10 MiB each, no post-submit edits or amendments. A photo the driver did not attach is not covered.
- **Only hashes are public.** To prove what a hashed field said, the plaintext must still be in the database. A receipt cannot recover deleted text.
- **Warnings and info reports are not anchored.** Only critical raises, and every actual review.
- **Pack "anchored" is not a bytes check** (§6). Verify is.
- **No cargo commitment on non-PP legs** (§4).
