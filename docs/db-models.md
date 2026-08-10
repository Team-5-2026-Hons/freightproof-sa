# FreightProof SA — Database Models Reference

> **Audience:** All team members. Read this before writing migrations, adding models, or writing orchestration logic.
>
> **Last updated:** 2026-05-10 · **Migration:** `0001_initial_schema.py` (19 tables)

---

## Contents

1. [Stack & Conventions](#1-stack--conventions)
2. [Entity Overview](#2-entity-overview)
3. [Enums](#3-enums)
4. [Organizations & Locations](#4-organizations--locations)
5. [People](#5-people)
6. [Vehicles](#6-vehicles)
7. [Trips](#7-trips)
8. [Cargo](#8-cargo)
9. [Evidence](#9-evidence)
10. [Handshake Events](#10-handshake-events)
11. [In-Transit Monitoring](#11-in-transit-monitoring)
12. [Exceptions](#12-exceptions)
13. [Driver Substitutions](#13-driver-substitutions)
14. [Blockchain & Merkle Trees](#14-blockchain--merkle-trees)
15. [SLA Configuration](#15-sla-configuration)
16. [Cross-Cutting Design Decisions](#16-cross-cutting-design-decisions)
17. [Relationship Map](#17-relationship-map)

---

## 1. Stack & Conventions

| Concern | Choice |
|---|---|
| ORM | SQLAlchemy 2.0 async (`Mapped` / `mapped_column`) |
| DB | PostgreSQL via Supabase (asyncpg driver) |
| Migrations | Alembic (async-aware, `NullPool` during migration) |
| Primary keys | `UUID` everywhere — never serial/integer |
| Timestamps | `created_at` on every table; `updated_at` via DB trigger on mutable tables |
| GPS coords | `Numeric(10, 7)` — preserves ~1 cm precision |
| PII boundary | Stays in PostgreSQL (`af-south-1`). Only SHA-256 hashes reach Hedera. |

**Session factory** (`db/session.py`):
- `pool_pre_ping=True` — detects stale Supabase connections before use
- `expire_on_commit=False` — prevents illegal lazy-loads in async context
- FastAPI dependency `get_db()` yields one `AsyncSession` per request, closed after response

---

## 2. Entity Overview

```
organizations ─┬─ precincts
               ├─ users          (dispatchers/admins)
               ├─ drivers
               ├─ vehicles
               ├─ trip_templates ─── trips ──┬─ trip_trailers
               └─ sla_configs                │
                                             ├─ consignments ─── parcels
                                             ├─ handshake_events ─── trailer_gps_snapshots
                                             ├─ checkpoints
                                             ├─ exceptions
                                             ├─ driver_substitutions
                                             ├─ evidence_artifacts
                                             ├─ blockchain_receipts
                                             └─ merkle_batches ─── merkle_batch_leaves
```

`trips` is the central entity. Almost every other table references it.

---

## 3. Enums

All defined in `backend/app/db/models/enums.py`.

### TripStatus — the state machine

Happy path (left-to-right). `exception_hold` and `cancelled` can be entered by the dispatcher from **any** active state — they are not terminal only at unloading.

```
created → origin_gate_in → loading → origin_gate_out → in_transit → dest_gate_in → unloading → closed
   ↓              ↓            ↓              ↓               ↓             ↓            ↓
cancelled    cancelled    cancelled      cancelled        cancelled     cancelled    cancelled
exception_hold  ...          ...            ...             ...           ...      exception_hold
```

### HandshakeType

| Value | Sequence | Blockchain-anchored? |
|---|---|---|
| `trip_creation` | 0 | Yes (journey lock hash) |
| `origin_gate_in` | 1 | No (feeder) |
| `loading` | 2 | Yes (pickup receipt) |
| `origin_gate_out` | 3 | No (feeder) |
| `dest_gate_in` | 4 | No (feeder) |
| `unloading` | 5 | Yes (delivery receipt) |

### HandshakeStatus

`pending` → `in_progress` → `completed` | `exception` | `overridden`

### ExceptionType (18 types)

`seal_mismatch`, `parcel_count_mismatch`, `gps_mismatch`, `route_deviation`, `vehicle_substitution`, `driver_substitution`, `checkpoint_timeout`, `waybill_count_mismatch`, `sequence_violation`, `panic_button`, `delivery_refused`, `cargo_damage`, `seal_broken_in_transit`, `mechanical`, `document_review`, `dispatcher_note`, `escalation`, `trip_hold`

### Other enums

| Enum | Values |
|---|---|
| `OrganizationType` | `operator`, `principal`, `both` |
| `VehicleType` | `horse`, `trailer` |
| `ExceptionSource` | `system`, `driver`, `dispatcher` |
| `ExceptionSeverity` | `info`, `warning`, `critical` |
| `ArtifactType` | `photo`, `document` |
| `BlockchainReceiptType` | `journey_lock`, `pickup`, `delivery`, `checkpoint_batch`, `exception_batch`, `driver_substitution` |
| `MerkleBatchType` | `checkpoint`, `exception`, `document` |
| `IdvsStatus` | `pending`, `verified`, `failed` |
| `ParcelStatus` | `pending`, `scanned_out`, `scanned_in`, `exception` |

---

## 4. Organizations & Locations

### `organizations`

Top-level tenant. Every actor (operator, principal, or dual-role) belongs to one.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String(255) | not null |
| `org_type` | Enum OrganizationType | `operator` / `principal` / `both` |
| `contact_email` | String(255) | nullable |
| `created_at` | TimestampTZ | server default NOW() |
| `updated_at` | TimestampTZ | auto-updated via trigger |

### `precincts`

A physical depot or warehouse. Every trip has an origin and destination precinct.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String(255) | not null |
| `address` | Text | nullable |
| `principal_organization_id` | UUID FK → organizations | the principal who owns this site |
| `latitude` | Numeric(10,7) | not null |
| `longitude` | Numeric(10,7) | not null |
| `geofence_radius_metres` | Integer | default 200; used by Pulsit geofence checks |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

---

## 5. People

### `users`

Dispatcher and admin accounts only. Drivers have their own table and no portal login.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID FK → organizations | |
| `email` | String(255) | unique, not null |
| `hashed_password` | String(255) | bcrypt, not null |
| `full_name` | String(255) | not null |
| `is_active` | Boolean | default true; soft-disable instead of delete |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

### `drivers`

Drivers authenticate per-trip via OTP — they do not have persistent portal accounts.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID FK → organizations | the operator who employs them |
| `full_name` | String(255) | not null |
| `id_number` | String(13) | SA national ID, not null |
| `phone_number` | String(20) | not null |
| `license_number` | String(50) | not null |
| `idvs_status` | Enum IdvsStatus | `pending` / `verified` / `failed`; default pending |
| `idvs_last_verified_at` | DateTime | nullable; set when IDVS check completes |
| `is_active` | Boolean | default true |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

---

## 6. Vehicles

### `vehicles`

Horse (tractor cab) and trailer are both rows in this single table — distinguished by `vehicle_type`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID FK → organizations | the operator who owns it |
| `registration` | String(50) | e.g. `CA 123-456` |
| `vehicle_type` | Enum VehicleType | `horse` or `trailer` |
| `pulsit_device_id` | String(100) | GPS tracker ID; unique per org (constraint below) |
| `is_active` | Boolean | default true |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

**Unique constraint:** `(organization_id, pulsit_device_id)` — one Pulsit device per fleet vehicle.

A trip links to exactly **one horse** (`trips.horse_id`) and **one or more trailers** via the join table below.

---

## 7. Trips

### `trip_templates`

Reusable config for recurring operator↔client routes. Trips can be spawned from a template.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `operator_organization_id` | UUID FK → organizations | |
| `client_organization_id` | UUID FK → organizations | |
| `name` | String(255) | not null |
| `default_origin_precinct_id` | UUID FK → precincts | nullable |
| `default_destination_precinct_id` | UUID FK → precincts | nullable |
| `is_active` | Boolean | default true |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

---

### `trips` — the central entity

One row per depot-to-depot journey.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_reference` | String(50) | unique, human-readable (e.g. `FP-2026-001`) |
| `order_number` | String(100) | Parcel Perfect or client order ref |
| `operator_organization_id` | UUID FK → organizations | |
| `client_organization_id` | UUID FK → organizations | |
| `driver_id` | UUID FK → drivers | current assigned driver |
| `horse_id` | UUID FK → vehicles | the tractor unit |
| `origin_precinct_id` | UUID FK → precincts | |
| `destination_precinct_id` | UUID FK → precincts | |
| `template_id` | UUID FK → trip_templates | nullable |
| `pulsit_trip_reference_id` | String(100) | nullable; Pulsit's own ID for this journey |
| `status` | Enum TripStatus | default `created` |
| `journey_lock_hash` | String(64) | SHA-256 of committed trip params; anchored to Hedera at creation |
| `idvs_check_status` | Enum IdvsStatus | default `pending` |
| `idvs_checked_at` | DateTime | nullable |
| `planned_departure_at` | DateTime | nullable |
| `planned_arrival_at` | DateTime | nullable |
| `actual_departure_at` | DateTime | nullable |
| `actual_arrival_at` | DateTime | nullable |
| `created_by_user_id` | UUID FK → users | the dispatcher who created the trip |
| `closed_at` | DateTime | nullable; set when status → `closed` or `cancelled` |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

**Indexes:** `(driver_id)`, `(status)`, `(order_number)`, `(created_at DESC)`

> **Journey lock:** `journey_lock_hash` is a SHA-256 of the committed trip parameters (vehicle, driver, origin, destination, consignment references) at creation. It is anchored to Hedera HCS. If the current record hash no longer matches the Hedera transaction, tampering is detected. **Never modify trip parameters after creation without raising an explicit exception event.**

---

### `trip_trailers`

Many-to-many join between trips and trailers.

| Column | Type | Notes |
|---|---|---|
| `trip_id` | UUID FK → trips | composite PK |
| `trailer_id` | UUID FK → vehicles | composite PK |
| `pulsit_device_id_snapshot` | String(100) | immutable snapshot — prevents retroactive device reassignment from altering the audit trail |

---

## 8. Cargo

### `consignments`

A consignment is pulled from Parcel Perfect and linked to a trip at creation.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips | nullable — linked at trip creation |
| `parcel_perfect_reference` | String(100) | not null |
| `client_organization_id` | UUID FK → organizations | |
| `origin_precinct_id` | UUID FK → precincts | nullable |
| `destination_precinct_id` | UUID FK → precincts | nullable |
| `declared_value` | Numeric(15,2) | nullable (ZAR) |
| `parcel_count_expected` | Integer | nullable; from PP manifest |
| `slot_time_origin` | DateTime | nullable; scheduled loading window |
| `slot_time_destination` | DateTime | nullable; scheduled delivery window |
| `pp_raw_json` | JSONB | nullable; raw Parcel Perfect response for audit |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

### `parcels`

Individual parcel within a consignment. Barcodes are scanned at loading and delivery.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `consignment_id` | UUID FK → consignments | |
| `barcode` | String(100) | not null |
| `description` | Text | nullable |
| `delivery_stop` | String(100) | nullable; used for multi-drop routes |
| `pp_scan_out_at` | DateTime | nullable; when PP scanned it out |
| `pp_scan_in_at` | DateTime | nullable; when PP scanned it in |
| `status` | Enum ParcelStatus | default `pending` |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

**Indexes:** `(consignment_id)`, `(barcode)`

---

## 9. Evidence

### `evidence_artifacts`

Every photo or document uploaded during handshakes or checkpoints. Files live in Supabase Storage (S3-compatible); this table holds metadata and the SHA-256 hash for integrity verification.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips | deferred FK (added via ALTER TABLE — see §16) |
| `artifact_type` | Enum ArtifactType | `photo` or `document` |
| `s3_key` | String(500) | path within bucket |
| `s3_bucket` | String(255) | Supabase Storage bucket name |
| `file_hash` | String(64) | SHA-256 of file bytes; verified on retrieval |
| `mime_type` | String(100) | e.g. `image/jpeg` |
| `captured_by_driver_id` | UUID FK → drivers | nullable |
| `captured_by_user_id` | UUID FK → users | nullable; for dispatcher-uploaded docs |
| `captured_lat` | Numeric(10,7) | nullable; phone GPS at capture |
| `captured_lng` | Numeric(10,7) | nullable |
| `captured_at` | DateTime | not null; device timestamp |
| `created_at` | TimestampTZ | server default NOW() |

---

## 10. Handshake Events

### `handshake_events`

One row per handshake per trip. H0 (trip_creation), H2 (loading), H5 (unloading) are blockchain-anchored; H1, H3, H4 feed data into the adjacent anchors.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips | |
| `handshake_type` | Enum HandshakeType | |
| `sequence_number` | SmallInteger | 0–5 |
| `status` | Enum HandshakeStatus | default `pending` |
| `dispatcher_override_user_id` | UUID FK → users | nullable; set when a dispatcher overrides |
| `dispatcher_override_note` | Text | nullable |
| **GPS — driver phone** | | |
| `driver_phone_lat` | Numeric(10,7) | nullable |
| `driver_phone_lng` | Numeric(10,7) | nullable |
| **GPS — horse Pulsit** | | |
| `horse_gps_lat` | Numeric(10,7) | nullable |
| `horse_gps_lng` | Numeric(10,7) | nullable |
| `pulsit_geofence_confirmed` | Boolean | nullable; True if Pulsit confirmed vehicle inside precinct geofence |
| **Seal & parcel counts** | | |
| `seal_number` | String(100) | nullable |
| `parcel_count_origin` | Integer | nullable |
| `parcel_count_destination` | Integer | nullable |
| `driver_visual_count` | Integer | nullable |
| `parcel_manifest_snapshot` | JSONB | nullable; immutable snapshot of parcel list at this handshake |
| **Photo artifact FKs** | | deferred FKs (ALTER TABLE) |
| `seal_photo_artifact_id` | UUID FK → evidence_artifacts | nullable |
| `waybill_photo_artifact_id` | UUID FK → evidence_artifacts | nullable |
| `gate_photo_artifact_id` | UUID FK → evidence_artifacts | nullable |
| `pod_photo_artifact_id` | UUID FK → evidence_artifacts | nullable |
| **Blockchain** | | |
| `event_hash` | String(64) | nullable; SHA-256 of this event's data |
| `blockchain_receipt_id` | UUID FK → blockchain_receipts | nullable; deferred FK |
| `completed_at` | DateTime | nullable |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

**Unique constraint:** `(trip_id, handshake_type)` — exactly one of each handshake type per trip.
**Index:** `(trip_id, sequence_number)`

---

### `trailer_gps_snapshots`

Per-trailer GPS reading taken from Pulsit at each handshake. Separate from horse GPS because trailers carry independent tracking units.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `handshake_event_id` | UUID FK → handshake_events | |
| `trailer_id` | UUID FK → vehicles | |
| `pulsit_device_id` | String(100) | snapshot of the device ID at this moment |
| `lat` | Numeric(10,7) | not null |
| `lng` | Numeric(10,7) | not null |
| `captured_at` | DateTime | not null |
| `created_at` | TimestampTZ | server default NOW() |

---

## 11. In-Transit Monitoring

### `checkpoints`

A driver-logged or Pulsit-pulled in-transit event between handshakes (e.g. scheduled stop, fuel stop, stationary alert).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips | |
| `checkpoint_type` | String(50) | e.g. `scheduled_stop`, `stationary_alert`, `driver_initiated` |
| `driver_phone_lat` | Numeric(10,7) | nullable |
| `driver_phone_lng` | Numeric(10,7) | nullable |
| `horse_gps_lat` | Numeric(10,7) | nullable |
| `horse_gps_lng` | Numeric(10,7) | nullable |
| `selfie_artifact_id` | UUID FK → evidence_artifacts | nullable |
| `cargo_photo_artifact_id` | UUID FK → evidence_artifacts | nullable |
| `note` | Text | nullable |
| `is_deviation` | Boolean | default false; true if GPS deviates from expected route |
| `merkle_batch_id` | UUID FK → merkle_batches | nullable; set when batched for blockchain |
| `created_at` | TimestampTZ | server default NOW() |

**Index:** `(trip_id, created_at)`

---

## 12. Exceptions

### `exceptions` (model: `TripException`)

An anomaly recorded at any point — raised by system, driver, or dispatcher. Linked optionally to a specific handshake or checkpoint.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips | |
| `handshake_event_id` | UUID FK → handshake_events | nullable |
| `checkpoint_id` | UUID FK → checkpoints | nullable |
| `exception_type` | Enum ExceptionType | see §3 for full list |
| `source` | Enum ExceptionSource | `system` / `driver` / `dispatcher` |
| `severity` | Enum ExceptionSeverity | `info` / `warning` / `critical` |
| `description` | Text | not null |
| `supporting_artifact_id` | UUID FK → evidence_artifacts | nullable |
| `resolved` | Boolean | default false |
| `resolved_by_user_id` | UUID FK → users | nullable |
| `resolved_at` | DateTime | nullable |
| `resolver_note` | Text | nullable |
| `merkle_batch_id` | UUID FK → merkle_batches | nullable; set when batched for blockchain |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

**Indexes:** `(trip_id, resolved)`, `(severity)`

---

## 13. Driver Substitutions

### `driver_substitutions`

Records every mid-trip driver change — planned (e.g. shift handover at a fuel stop) or unplanned (emergency). Blockchain-anchored separately from handshakes.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips | |
| `original_driver_id` | UUID FK → drivers | |
| `substituting_driver_id` | UUID FK → drivers | |
| `exchange_location` | String(255) | free-text, e.g. `Harrismith N3 fuel stop` |
| `approving_dispatcher_user_id` | UUID FK → users | the dispatcher who authorised the swap |
| `is_planned` | Boolean | not null |
| `substitution_at` | DateTime | not null |
| `exception_id` | UUID FK → exceptions | nullable; only set for **unplanned** substitutions |
| `blockchain_receipt_id` | UUID FK → blockchain_receipts | nullable; deferred FK |
| `created_at` | TimestampTZ | server default NOW() |

---

## 14. Blockchain & Merkle Trees

### `blockchain_receipts`

One row per anchoring event on Hedera HCS. Contains the hash and all Hedera transaction metadata, but **never PII** (POPIA compliance).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips | deferred FK (ALTER TABLE) |
| `receipt_type` | Enum BlockchainReceiptType | see §3 |
| `data_hash` | String(64) | SHA-256 of the anchored payload |
| `hedera_topic_id` | String(100) | nullable; HCS topic |
| `hedera_tx_id` | String(200) | nullable; Hedera transaction ID |
| `hedera_sequence_number` | BigInteger | nullable |
| `hedera_consensus_timestamp` | DateTime | nullable |
| `payload_json` | JSONB | not null; hashed payload — no PII, audit-safe |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

**Indexes:** `(trip_id, receipt_type)`, `(hedera_tx_id)`

---

### `merkle_batches`

Aggregates multiple checkpoints or exceptions into a single Merkle tree before anchoring to Hedera. Reduces Hedera transaction costs for high-frequency events.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips | deferred FK (ALTER TABLE) |
| `batch_type` | Enum MerkleBatchType | `checkpoint` / `exception` / `document` |
| `merkle_root` | String(64) | nullable; computed once all leaves are added |
| `leaf_count` | Integer | default 0 |
| `blockchain_receipt_id` | UUID FK → blockchain_receipts | nullable; set once anchored |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

---

### `merkle_batch_leaves`

Each leaf is one checkpoint, exception, or artifact hashed into the Merkle tree.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `batch_id` | UUID FK → merkle_batches | |
| `leaf_index` | Integer | not null; position in tree |
| `leaf_hash` | String(64) | not null; SHA-256 of the source record |
| `source_type` | String(50) | `checkpoint`, `exception`, or `artifact` |
| `source_id` | UUID | not null; polymorphic — the ID of the originating row |
| `created_at` | TimestampTZ | server default NOW() |

**Unique constraint:** `(batch_id, leaf_index)`

---

## 15. SLA Configuration

### `sla_configs`

Configures time thresholds per operator–client–route combination. Null origin/destination means "applies to all routes for that operator–client pair."

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `operator_organization_id` | UUID FK → organizations | |
| `client_organization_id` | UUID FK → organizations | |
| `origin_precinct_id` | UUID FK → precincts | nullable — null means all origins |
| `destination_precinct_id` | UUID FK → precincts | nullable — null means all destinations |
| `max_pickup_overrun_minutes` | Integer | nullable |
| `max_delivery_overrun_minutes` | Integer | nullable |
| `max_checkpoint_interval_minutes` | Integer | default 15 (matches Pulsit stationary alert threshold) |
| `effective_from` | Date | not null |
| `effective_to` | Date | nullable — null means currently active |
| `created_at` / `updated_at` | TimestampTZ | trigger-managed |

> **Spec gap (v6 §6.3):** The v6 spec mentions "per-route insurance cover" (e.g. R3M for CT runs, R1M for DBN day runs) as part of the SLA definition. There is currently no `insurance_cover_amount` column in this table. If insurance cover needs to be queryable per route, a future migration will be required. For now it lives in the physical SLA annexure documents.

---

## 16. Cross-Cutting Design Decisions

### Deferred foreign keys (circular dependencies)

Several tables were created before the tables they reference (e.g. `evidence_artifacts` is created before `trips` because handshakes reference both). These FKs are added via `ALTER TABLE` in migration step 13 with `use_alter=True` in SQLAlchemy.

**Important:** deferred means the FK *constraint* is added late — it does not mean the column is nullable. The `trip_id` columns on `evidence_artifacts`, `blockchain_receipts`, and `merkle_batches` are all `nullable=False` in the ORM. The artifact FK columns on `handshake_events` and `blockchain_receipt_id` on `driver_substitutions` are `nullable=True`.

| Table | Deferred FK column | Nullable? |
|---|---|---|
| `evidence_artifacts` | `trip_id` | NOT NULL |
| `blockchain_receipts` | `trip_id` | NOT NULL |
| `merkle_batches` | `trip_id` | NOT NULL |
| `handshake_events` | `seal_photo_artifact_id`, `waybill_photo_artifact_id`, `gate_photo_artifact_id`, `pod_photo_artifact_id`, `blockchain_receipt_id` | all nullable |
| `driver_substitutions` | `blockchain_receipt_id` | nullable |

### Auto-updated timestamps

`update_updated_at_column()` is a PostgreSQL trigger function applied to 9 tables:

`users`, `drivers`, `consignments`, `parcels`, `trips`, `handshake_events`, `exceptions`, `blockchain_receipts`, `merkle_batches`

All other tables have `created_at` only (they are append-only by design).

### Adding a new model — checklist

1. Create `backend/app/db/models/<name>.py` using `Mapped` / `mapped_column` syntax
2. Import it in `backend/app/db/models/__init__.py`
3. Include `created_at` and (if mutable) `updated_at`
4. Run `git fetch origin && git rebase origin/dev` before generating migration
5. Name migration `YYYY_MM_DD_<yourname>_<description>.py`
6. Flag in PR and TASK COMPLETE if the migration touches shared tables

---

## 17. Relationship Map

```
organizations (1)
  ├── (n) users
  ├── (n) drivers
  ├── (n) vehicles
  ├── (n) precincts          [via principal_organization_id]
  ├── (n) trip_templates     [as operator]
  ├── (n) trip_templates     [as client]
  ├── (n) trips              [as operator]
  ├── (n) trips              [as client]
  └── (n) sla_configs        [as operator and as client]

trips (1)
  ├── (1) driver             → drivers
  ├── (1) horse              → vehicles
  ├── (1) origin_precinct    → precincts
  ├── (1) destination_precinct → precincts
  ├── (1) created_by_user    → users
  ├── (1) template           → trip_templates [optional]
  ├── (n) trip_trailers      → vehicles [many-to-many]
  ├── (n) consignments
  │     └── (n) parcels
  ├── (6) handshake_events   [one per HandshakeType, enforced by unique constraint]
  ├── (n) checkpoints
  ├── (n) exceptions
  ├── (n) driver_substitutions
  ├── (n) evidence_artifacts
  ├── (n) blockchain_receipts
  └── (n) merkle_batches

handshake_events (1)
  ├── (n) trailer_gps_snapshots
  ├── (0-4) evidence_artifacts [seal, waybill, gate, pod photos — nullable FKs]
  └── (1) blockchain_receipt  [optional, for H0/H2/H5]

merkle_batches (1)
  └── (n) merkle_batch_leaves

exceptions (1)
  └── (1) merkle_batch        [optional]

checkpoints (1)
  └── (1) merkle_batch        [optional]
```
