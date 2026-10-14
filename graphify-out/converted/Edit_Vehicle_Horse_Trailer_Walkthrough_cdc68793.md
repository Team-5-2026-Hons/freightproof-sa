<!-- converted from Edit_Vehicle_Horse_Trailer_Walkthrough.docx -->

Edit Vehicle / Horse / Trailer
Code Walkthrough  •  FreightProof SA Demo
INF4027W Honours Project  •  UCT 2026
# Overview
Horses and trailers are both stored in the vehicles table and use the same PATCH endpoint. The vehicle_type field (HORSE or TRAILER) is set at creation and cannot be changed — swapping a horse to trailer mid-trip would silently break trip logic.

Every vehicle edit goes through the orchestration layer which:

- Applies the patch to the Vehicle row in Supabase (PostgreSQL)
- Computes a diff of critical fields (before vs after)
- Always creates a VehicleEvent audit row — even for cosmetic changes
- Anchors the diff to Hedera HCS only if a critical field changed
- Classifies the event type based on exactly which critical field changed

# 1.  The HTTP Request

All fields are optional — only send the ones you want to change:

{
"registration":          "CA 123-456",    // critical — triggers LICENSE_PLATE_CHANGED
"pulsit_device_id":      "DEV-001",       // critical
"vin_number":            "WBA3A5C5XDF...",// critical — triggers VIN_UPDATED
"licence_disc_expiry":   "2027-03-31",    // critical — triggers LICENSE_DISC_RENEWED
"make":                  "Mercedes",      // cosmetic
"model":                 "Actros",        // cosmetic
"year":                  2022,            // cosmetic
"gross_vehicle_mass_kg": 56000,           // cosmetic
"length_m":              13,              // cosmetic
"is_active":             false            // critical — triggers DEACTIVATED
}

// vehicle_type is intentionally excluded — cannot be changed after creation


# 2.  HTTP Layer  (vehicles.py)
File: backend/app/api/v1/endpoints/vehicles.py : 45

Thin layer — maps domain errors to HTTP codes and calls update_vehicle():


# 3.  Orchestration  (resource_service.py)
File: backend/app/orchestration/resource_service.py : 288

## Step 1 — Fetch and verify
Fetches the Vehicle row scoped to the dispatcher's organization_id. Raises ResourceNotFoundError if not found or belongs to a different org.

## Step 2 — Snapshot old critical fields

old = {
"registration":        vehicle.registration,
"licence_disc_expiry": vehicle.licence_disc_expiry.isoformat(),
"vehicle_type":        vehicle.vehicle_type.value,
"vin_number":          vehicle.vin_number,
"pulsit_device_id":    vehicle.pulsit_device_id,
"is_active":           vehicle.is_active,
}


## Step 3 — Apply patch + flush

patched = data.model_dump(exclude_unset=True)  # only fields that were sent
for field, value in patched.items():
setattr(vehicle, field, value)
await db.flush()   # persists to DB without committing


## Step 4 — Snapshot new critical fields + compute diff
The same six fields are read again after the flush. diff_critical_fields() compares old vs new:

diff = diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS)
# diff is None  → no critical field changed
# diff is a dict → {field: {old: ..., new: ...}} for each changed critical field


## Step 5 — Classify the event type

## Step 6 — Always create a VehicleEvent row

event = VehicleEvent(
vehicle_id          = vehicle.id,
event_type          = event_type.value,
changed_fields      = diff or {'_no_critical_change': True, '_patch': patched},
changed_by_user_id  = current_user_id,
)


## Step 7 — Hedera anchoring (critical changes only)
Hedera is only called if diff is not None:

if diff is not None:
canonical = {
"vehicle_event_id":     str(event.id),
"vehicle_id":           str(vehicle.id),
"event_type":           event_type.value,
"fields":               diff,
"changed_by_user_id":   str(current_user_id),
"timestamp":            event.created_at.isoformat(),
}
receipt = await anchor_subject(
db,
subject_type  = SubjectType.VEHICLE_EVENT,
subject_id    = event.id,
canonical_payload = canonical,
receipt_type  = BlockchainReceiptType.VEHICLE_UPDATED,
)
event.blockchain_receipt_id = receipt.id


# 4.  Full Call Chain

PATCH /api/v1/vehicles/{vehicle_id}
→ vehicles.py: update_vehicle_endpoint()       error mapping only
→ resource_service.py: update_vehicle()
→ SELECT Vehicle WHERE id = vehicle_id AND org = org
→ snapshot old critical fields
→ apply patch fields to vehicle row
→ db.flush()
→ snapshot new critical fields
→ diff_critical_fields()                   compare before / after
→ classify event type (6 possible outcomes)
→ INSERT VehicleEvent row
→ db.flush()
→ if critical diff:
→ anchor_subject()                     SHA-256 + Hedera HCS
→ INSERT BlockchainReceipt
→ event.blockchain_receipt_id = receipt.id
→ db.refresh(vehicle)
→ 200 VehicleRead


# 5.  Critical vs Cosmetic Fields

Cosmetic changes still produce a VehicleEvent row for a full audit trail, but no Hedera call is made.

# 6.  Horse vs Trailer — Same Endpoint
There is no separate endpoint for trailers. Both are vehicles:


vehicle_type is set at creation (POST /vehicles) and is permanently excluded from VehicleUpdateBody. Attempting to pass it in a PATCH request will be silently ignored by Pydantic's exclude_unset logic.

# 7.  Key Points for the Demo
- Change make/model only → VehicleEvent logged as COSMETIC_UPDATE, no Hedera call.
- Change registration → VehicleEvent logged as LICENSE_PLATE_CHANGED, Hedera anchored, BlockchainReceipt created.
- Change licence_disc_expiry only → LICENSE_DISC_RENEWED event, Hedera anchored.
- Set is_active=false → DEACTIVATED event, Hedera anchored. Vehicle will no longer appear in active vehicle lists.
- Use GET /vehicles/{id} to show the full event history and blockchain receipts after each edit.
- Same PATCH /vehicles/{id} works for both horses and trailers — just use the correct vehicle_id.


Delete after demo — 2026-05-19
| Field | Value |
| --- | --- |
| Method + path | PATCH /api/v1/vehicles/{vehicle_id} |
| Auth | JWT bearer token — dispatcher only |
| Success response | 200 OK + VehicleRead body |
| Schema | VehicleUpdateBody  (schemas/vehicles.py:60) |
| Applies to | Horses AND trailers — same endpoint, same logic |
| Exception | HTTP status |
| --- | --- |
| ResourceNotFoundError | 404 Not Found — vehicle_id not in this org |
| DuplicateResourceError | 409 Conflict — registration already exists (creation only) |
| Condition (checked in order) | Event type |
| --- | --- |
| No critical field changed | COSMETIC_UPDATE |
| registration changed | LICENSE_PLATE_CHANGED |
| is_active changed to False | DEACTIVATED |
| Only licence_disc_expiry changed | LICENSE_DISC_RENEWED |
| Only vin_number changed | VIN_UPDATED |
| Multiple critical fields changed | VEHICLE_UPDATED |
| Field | Type | Goes to Hedera? | Event label |
| --- | --- | --- | --- |
| registration | Critical | Yes | LICENSE_PLATE_CHANGED |
| pulsit_device_id | Critical | Yes | VEHICLE_UPDATED |
| vin_number | Critical | Yes | VIN_UPDATED |
| licence_disc_expiry | Critical | Yes | LICENSE_DISC_RENEWED |
| is_active | Critical | Yes | DEACTIVATED |
| make / model / year | Cosmetic | No | COSMETIC_UPDATE |
| gross_vehicle_mass_kg | Cosmetic | No | COSMETIC_UPDATE |
| length_m | Cosmetic | No | COSMETIC_UPDATE |
| vehicle_type | Excluded | N/A | Cannot be changed |
| vehicle_type | Used as | How to identify |
| --- | --- | --- |
| HORSE | The truck / prime mover | vehicle_type = 'horse' in the GET response |
| TRAILER | The trailer(s) attached | vehicle_type = 'trailer' in the GET response |