# FP-154: Evidence Artifact Payload Versioning

## Purpose

Evidence uploads already store `SHA-256(file_bytes)` in
`evidence_artifacts.file_hash`. Before FP-154, departure and confirmation
receipts did not commit those digests, so replacing a private Storage object did
not change the phase payload checked against Hedera.

FP-154 makes new pickup and delivery receipts commit role-labelled evidence
digests. Hedera still receives only `SHA-256(canonical_json(payload))`. Raw
files, Storage paths, artifact IDs, GPS, and personal information remain
off-chain.

## Canonical Contracts

An unversioned phase receipt is legacy and must be reconstructed exactly as it
was originally anchored. This includes both the current phase-v1 shapes and the
older `handshake_event_id` / `handshake_type` shapes retained when
`handshake_events` was renamed to `phase_events`. Verification selects those
frozen contracts from their exact payload shape. Explicit version values are
reserved for immutable contracts; new phase receipts use `payload_version: 2`.

Departure v2 adds:

```json
{
  "payload_version": 2,
  "seal_photo_sha256": "<sha256>",
  "waybill_photo_sha256": null
}
```

Confirmation v2 adds:

```json
{
  "payload_version": 2,
  "pod_photo_sha256": "<sha256>",
  "pod_signature_sha256": "<sha256>"
}
```

These fields extend the existing phase fields. The optional waybill key remains
present as `null` when no legacy waybill was submitted. Digests are labelled by
role so exchanging files with different content changes the canonical payload.
Relinking to another same-trip artifact with identical bytes does not change the
commitment: artifact IDs and capture metadata are not committed by these payloads.

Only the integer `2` is accepted as an explicit version. Explicit `1`, booleans,
strings, null, and unknown versions are rejected rather than guessed. Existing
unversioned receipts are never rewritten or backfilled.

## Write Path

1. The assigned driver uploads photos through `POST /api/v1/artifacts`; FP-155
   receivers upload their signature through the capability-authorized
   `POST /api/v1/handover/{raw_token}/confirm` route. Each path validates its own
   authorization, size and file signature, then uses the shared Storage persistence
   path. The server computes SHA-256 from uploaded bytes, not a client-supplied
   digest. Receiver artifacts retain their receiver attribution, not a driver ID.
2. The private file is stored at a new `{trip_id}/{uuid}` Storage key. PostgreSQL
   records its digest, storage location and capture metadata.
3. On departure/confirmation completion, the service checks that every referenced
   artifact belongs to the same trip. Two different roles must use distinct
   artifacts. It builds the v2 payload using those stored digests.
4. The service serializes sorted JSON keys with no extra whitespace, computes its
   SHA-256, and saves that `event_hash` with the phase evidence and `pending` anchor
   status in the same database transaction. The driver can continue immediately.
5. After commit, a background task publishes to Celery without blocking the API
   event loop. The worker locks the phase row, validates the queued payload hash
   and receipt type, and sends only the 64-character digest to Hedera HCS.
6. The worker stores `BlockchainReceipt.payload_json`, `data_hash`, topic,
   sequence, transaction ID and consensus time, then links the receipt and sets
   `anchor_status = anchored`. Re-delivery skips an already-linked receipt.

For example, a confirmation commits this off-chain canonical payload:

```json
{
  "payload_version": 2,
  "phase_event_id": "<confirmation UUID>",
  "trip_id": "<trip UUID>",
  "phase_type": "confirmation",
  "pp_scan_in_count": 42,
  "driver_visual_count": null,
  "pod_photo_sha256": "<hash of POD image bytes>",
  "pod_signature_sha256": "<hash of signed attestation image bytes>"
}
```

The HCS message is `SHA-256(canonical_json(the_payload_above))`, not that JSON.

## Verification

Verification proceeds from the cheapest local check to the external services:

1. Rebuild the version-selected payload from current PostgreSQL rows.
2. Compare its SHA-256 with `blockchain_receipts.data_hash`.
3. For v2, stream the linked private Supabase objects through a cache-busted,
   non-redirecting authenticated URL and hash their current bytes.
4. Rebuild the payload with those live digests and compare it again.
5. Ask the Hedera mirror node to confirm the receipt hash.

The outcomes are:

| Condition | Status |
| --- | --- |
| Current committed fields and Hedera agree; for v2, linked Storage bytes also agree | `verified` |
| Committed fields, role digests, or stored object bytes differ or are missing | `db_mismatch` |
| Hedera does not contain the expected hash | `hedera_mismatch` |
| No receipt exists | `no_receipt` |
| Unknown payload version or service outage | `error` |

A definitive missing Storage object is an integrity mismatch. A Storage outage
is an availability failure and must not be described as tampering. Hedera is not
queried after a local mismatch. Verification applies the same 10 MiB ceiling as
upload and bounds concurrent Storage streams; an oversized replacement is an
integrity mismatch rather than an unbounded download. A wall-clock deadline
covers both waiting for a download slot and reading the complete response.

## Security Boundary

This proves that the evidence bytes currently read from Storage are the bytes committed
by the v2 receipt. It does not prove that the scene depicted was truthful, and
it cannot retroactively protect files linked to v1 receipts because their
digests were never anchored.

The backend performs Storage reads with its existing service credential. The
credential and downloaded bytes are never returned to the dispatcher. The UI
starts deep evidence verification only when a dispatcher explicitly verifies a
pickup or delivery receipt, avoiding automatic evidence downloads on page load.
The verification response sets `evidence_verified: true` only when a v2 receipt's
linked object bytes were checked and matched. A verified v1 receipt is labelled
as legacy in the UI and makes no claim about linked files.

Celery delivery is at-least-once. The worker row-locks the phase and skips an
already-linked receipt, while payload-hash and receipt-type checks reject stale
or altered task arguments. A recorded Hedera failure causes a bounded Celery
retry while the driver request remains fail-open.

| Data | PostgreSQL | Private Storage | Hedera HCS |
| --- | --- | --- | --- |
| Phase ID, trip ID, seal/count fields, payload version | Yes, including receipt payload | No | Only within the outer digest |
| Role-labelled evidence digests | Yes | No separate metadata required | Only within the outer digest |
| Photos and signed attestation image | Metadata/links only | Original uploaded bytes | Never |
| Storage paths, artifact IDs, driver/GPS/capture metadata | Yes | Paths and file contents as applicable | Never |
| Final canonical payload digest | Yes | No | The entire HCS message |

FP-154 covers the departure seal photo, optional legacy departure waybill photo,
confirmation POD photo and confirmation signature/attestation image. It does not
claim coverage for loading's linehaul sheet, unloading's arrival photo, exception
photos, arbitrary later uploads or raw scan/GPS events. Those require their own
future committed payload or Merkle batch. Trip-level journey-lock verification
still checks committed trip details, not every file associated with the trip.

## Recovery

The phase ledger is the durable source of anchor debts; no additional outbox
table or database migration is necessary for this feature.

- The normal worker retries failures three times, 30 seconds apart.
- On broker failure, the API makes a best-effort local asynchronous attempt.
- Every 60 seconds, Celery Beat schedules a recovery batch of at most 20 phases.
  Only completed/exception departure or confirmation rows with an event hash,
  no linked receipt, and `pending`/`failed` anchor status are eligible. A row must
  have been untouched for five minutes, allowing the normal worker time to finish.
- Recovery locks one eligible row with `FOR UPDATE SKIP LOCKED`, rebuilds the
  v1 or v2 payload from its evidence, and requires its hash to equal the original
  completion-time `event_hash`. It never replaces that baseline.
- Changed or missing evidence stays `failed` and is logged for investigation.
  Attempts update `updated_at` and commit separately, so failures do not monopolize
  a batch and successful receipts are not rolled back with another phase.

A crash between commit and broker publish, exhausted normal retries, or a lost
broker message is therefore recoverable from PostgreSQL. If the original payload
can no longer be reconstructed, recovery deliberately refuses to create a new
anchor from changed data.

There is still no exactly-once HCS claim: Hedera may accept a message before a
timeout or database commit failure hides its receipt. A later retry may submit
the same digest again. This cannot change the committed evidence, but it can
create duplicate HCS messages and extra fees. Eliminating that ambiguity needs
persisted Hedera transaction IDs and transaction reconciliation, not just a queue.

## Running It

Deploy the API and updated Celery worker together. Run exactly one Celery Beat
scheduler for the environment. A worker without Beat handles ordinary dispatches
but cannot schedule the periodic recovery scan.

For the development Docker stack, the additive Compose override supplies Beat
without editing the team's shared `docker-compose.dev.yml`:

```powershell
docker compose -f infrastructure/docker/docker-compose.dev.yml -f infrastructure/docker/docker-compose.anchors.yml up -d --build api worker beat
```

Outside Docker, from `backend`, run `celery -A app.tasks worker --loglevel=info`
and `celery -A app.tasks beat --loglevel=info` as separate processes. Beat also
runs the repository's existing Parcel Perfect schedule. No new environment
keys, dependency changes, migrations or receipt backfills are required.

In the dispatcher, open a trip as an admin dispatcher and turn forensic mode on.
The pickup/delivery receipt control verifies that exact `phase_event_id`. The
trip detail refreshes metadata every ten seconds while a completed phase owes
a receipt and the tab is visible; it does not automatically download evidence.
Results distinguish legacy field verification from v2 evidence-byte verification.

## Validation

The regression suite exercises upload -> phase completion -> worker -> receipt
-> authenticated verification with real hashing and PostgreSQL, mocking only the
external Storage/HCS transports. It then replaces stored bytes without updating
the DB digest and verifies `db_mismatch` without an extra Hedera request.

Additional tests cover frozen legacy shapes, missing/replaced/swapped evidence,
unsupported versions, Storage outages and legacy error envelopes, cache nonces,
redirect refusal, streaming byte/time limits, recovery, task registration/retries,
admin forensic gating, focus, timers, stale responses and receipt refresh.

After syncing with `dev` at `6332f9c`, an additional end-to-end case exercises
FP-155's receiver QR flow: token issue, browser binding, receiver confirmation,
receiver-attributed signature upload, driver phase completion, v2 anchoring,
verification and replacement detection. No receiver or handover production code
was changed; the existing receiver artifact hash is committed under the same
`pod_signature_sha256` role.

Validation on that base: full backend `1514 passed, 4 skipped`; dispatcher
`776 passed`; driver PWA `747 passed`. Backend Ruff and mypy (125 source files)
pass. Dispatcher and driver lint have zero errors; all three frontends pass
type-check and production build. Frontend checks used Node 22.23.2 after `npm ci`
from the committed lockfiles; backend checks used Python 3.12.2 and throwaway
PostgreSQL 17. The four backend skips are existing seed-fixture cases covered by
adjacent tests, not excluded integration files.

The driver build used `NEXT_PUBLIC_API_URL=https://api.example.invalid` only for
compilation validation; this is not a deployable configuration, and no `.env`
file was changed. Existing python-jose/test AsyncMock, JSDOM/React and `<img>`
warnings remain. Live CDN/HCS, real worker crash injection and real-browser
screen-reader testing are not represented by these mocked tests.

## Demonstration

1. Complete a departure or confirmation and wait for its receipt to anchor.
2. Verify that receipt from the forensic timeline and observe `verified`.
3. Replace the linked object's bytes while leaving the database hash unchanged.
4. Verify again and observe `db_mismatch` before any Hedera lookup.
5. Verify an old unversioned phase-v1 or migrated handshake receipt and show
   that its original fields still verify without making a Storage claim.
