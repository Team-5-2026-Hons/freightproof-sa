<!-- converted from Edit_Driver_Walkthrough.docx -->

Edit Driver
Code Walkthrough  •  FreightProof SA Demo
INF4027W Honours Project  •  UCT 2026
# Overview
Driver edits are not simple database updates. Every change goes through the orchestration layer which:

- Applies the patch to the Driver row in Supabase (PostgreSQL)
- Computes a diff of critical fields (before vs after)
- Always creates a DriverEvent audit row — even for cosmetic changes
- Anchors the diff to Hedera HCS only if a critical field changed

POPIA: the license_number plaintext is never stored in the event log or sent to Hedera — only its SHA-256 hash.

# 1.  The HTTP Request

All fields are optional — only send the ones you want to change:

{
"full_name":       "Jane Smith",       // cosmetic
"phone_number":    "+27821234567",      // cosmetic
"license_number":  "DL-98765",          // critical — hashed for Hedera
"license_expiry":  "2028-06-30",        // critical
"is_active":       false                // critical — triggers DEACTIVATED event
}


# 2.  HTTP Layer  (drivers.py)
File: backend/app/api/v1/endpoints/drivers.py : 48

Thin layer — maps domain errors to HTTP codes and calls update_driver():


# 3.  Orchestration  (resource_service.py)
File: backend/app/orchestration/resource_service.py : 121

## Step 1 — Fetch and verify
Fetches the Driver row scoped to the dispatcher's organization_id. Raises ResourceNotFoundError if not found or belongs to a different org.

## Step 2 — Snapshot old critical fields
Before applying any changes, the current values of the three critical fields are captured:

old = {
"license_number_sha256": sha256(driver.license_number),  # hashed, not plaintext
"license_expiry":        driver.license_expiry.isoformat(),
"is_active":             driver.is_active,
}


## Step 3 — Apply patch + flush

patched = data.model_dump(exclude_unset=True)  # only fields that were sent
for field, value in patched.items():
setattr(driver, field, value)
await db.flush()   # persists to DB without committing


## Step 4 — Snapshot new critical fields + compute diff
The same three fields are read again after the flush, then diff_critical_fields() compares old vs new:

new = {
"license_number_sha256": sha256(driver.license_number),
"license_expiry":        driver.license_expiry.isoformat(),
"is_active":             driver.is_active,
}

diff = diff_critical_fields(old, new, _DRIVER_CRITICAL_HASHED)
# diff is None if no critical field changed
# diff is a dict of {field: {old: ..., new: ...}} if something changed


## Step 5 — Classify the event type

## Step 6 — Always create a DriverEvent row

event = DriverEvent(
driver_id           = driver.id,
event_type          = event_type.value,
changed_fields      = diff or {'_no_critical_change': True, '_patch': safe_patch},
changed_by_user_id  = current_user_id,
)
# Note: license_number plaintext is stripped from safe_patch before storage


## Step 7 — Hedera anchoring (critical changes only)
Hedera is only called if diff is not None (i.e. a critical field actually changed):

if diff is not None:
canonical = {
"driver_event_id":      str(event.id),
"driver_id":            str(driver.id),
"event_type":           event_type.value,
"fields":               diff,          # hashed license, not plaintext
"changed_by_user_id":   str(current_user_id),
"timestamp":            event.created_at.isoformat(),
}
receipt = await anchor_subject(
db,
subject_type  = SubjectType.DRIVER_EVENT,
subject_id    = event.id,
canonical_payload = canonical,
receipt_type  = BlockchainReceiptType.DRIVER_UPDATED,
)
event.blockchain_receipt_id = receipt.id


anchor_subject() computes a SHA-256 of the canonical dict and submits it to Hedera HCS — same mechanism as trip creation.

# 4.  Full Call Chain

PATCH /api/v1/drivers/{driver_id}
→ drivers.py: update_driver_endpoint()         error mapping only
→ resource_service.py: update_driver()
→ SELECT Driver WHERE id = driver_id AND org = org   fetch + auth check
→ snapshot old critical fields
→ apply patch fields to driver row
→ db.flush()
→ snapshot new critical fields
→ diff_critical_fields()                   compare before / after
→ classify event type
→ INSERT DriverEvent row
→ db.flush()
→ if critical diff:
→ anchor_subject()                     SHA-256 + Hedera HCS
→ INSERT BlockchainReceipt
→ event.blockchain_receipt_id = receipt.id
→ db.refresh(driver)
→ 200 DriverRead


# 5.  Critical vs Cosmetic Fields

Cosmetic changes still produce a DriverEvent row for full audit trail, but no Hedera call is made — no hash, no receipt.

# 6.  Key Points for the Demo
- Change full_name only → event logged, no Hedera call. Show the DriverEvent in the detail response.
- Change license_number → event logged as LICENSE_RENEWED, Hedera anchored, BlockchainReceipt created.
- Set is_active=false → event logged as DEACTIVATED, Hedera anchored.
- POPIA: open the BlockchainReceipt fields in the response — you'll see the license_number_sha256, never the raw license string.
- Use GET /drivers/{id} to show the full event history after each edit.


Delete after demo — 2026-05-19
| Field | Value |
| --- | --- |
| Method + path | PATCH /api/v1/drivers/{driver_id} |
| Auth | JWT bearer token — dispatcher only |
| Success response | 200 OK + DriverRead body |
| Schema | DriverUpdateBody  (schemas/people.py:93) |
| Exception | HTTP status |
| --- | --- |
| ResourceNotFoundError | 404 Not Found — driver_id not in this org |
| Condition | Event type |
| --- | --- |
| No critical field changed | COSMETIC_UPDATE |
| license_number_sha256 in diff | LICENSE_RENEWED |
| is_active changed to False | DEACTIVATED |
| license_expiry changed (other) | — (falls through to diff present) |
| Field | Type | Goes to Hedera? |
| --- | --- | --- |
| full_name | Cosmetic | No |
| phone_number | Cosmetic | No |
| license_number | Critical | Yes — as SHA-256 hash (never plaintext) |
| license_expiry | Critical | Yes |
| is_active | Critical | Yes |