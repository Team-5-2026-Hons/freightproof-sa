# Incident Management (Hijacking + Parcel Issues) — Implementation Plan

> **Status:** DRAFT. §2 decisions ANSWERED by Tim on 20 Oct 2026. Nothing built yet. Next step:
> write each stage's full TDD task breakdown (failing test → implementation → green).
>
> **For agentic workers:** once approved, execute stage by stage with
> superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** let a dispatcher open an *incident*, which groups exceptions, records who reported what
and when, names the affected cargo, and keeps an append-only follow-up log ending in an explicit
outcome. For a hijacking, the dispatcher can stop the trip, the driver's phone stops asking for
work, and the dispatcher is walked through the SAPS / insurer paperwork. All of it goes into the
audit pack.

**Architecture:** new `incidents` aggregate (4 tables, one additive column) with an append-only
`incident_updates` ledger. The status, owner and outcome columns on `incidents` are caches
rebuilt from that ledger, the same rule `current_phase` follows. Stopping a trip reuses
`cancel_trip`'s terminal path, so no new `TripStatus`. The audit pack manifest gains an
`incidents` section built from the same ledger.

**Tech stack:** FastAPI + SQLAlchemy 2.0 async + Alembic (pruned!), Pydantic v2, Next.js 15
dispatcher + driver-pwa, Vitest, pytest-asyncio, WeasyPrint templates.

**Branch:** `feat/drivererror-reviews` (git branch names can't contain spaces).

---

## 1. What already exists (don't rebuild it)

| Need | Already in the codebase | Gap |
|---|---|---|
| Observation records | `TripException` (`db/models/transit.py:101`). `review_status` / `review_outcome` give one immutable review (`orchestration/exceptions/review.py`) | No grouping, no follow-up after "reviewed" |
| Police / notification facts | `IncidentDeclaration` (`db/models/audit_packs.py:138`): SAPS station, CAS no., officer, insurer/client/tracking notified times. Append-only. `DeclareIncidentDialog.tsx` in the dispatcher | Pinned to a trip or exception, not to an incident. Nothing tells the dispatcher it's the next step |
| Stopping a trip | `cancel_trip` (`orchestration/trips/administration.py`): row lock, `CANCELLED`, ends any pending handover, writes a DISPATCHER_NOTE to the ledger, sends realtime `TRIP_CLOSED` | The reason is free text. Nothing links it to the hijacking |
| Driver panic | `PanicPageClient.tsx` → `panic_button` (CRITICAL), queued offline when there's no signal | Depends on the driver having the phone |
| Insurer pack | `build_audit_manifest` (`orchestration/audit_packs/builder.py:819`), `summarise_incident` (`analysis.py:164`), incident fact sheet PDF (`reporting/incident_sheet.py`, TAPA suggestions) | The incident is inferred from the *first critical exception*. A hijacking reported by phone, with no panic, raises **NoIncidentError** and gets no fact sheet |
| Shortage detection | `consignments/scans.py::_raise_discrepancy` → `parcel_count_mismatch`. Per-parcel `pp_scan_out_at` / `pp_scan_in_at` on `Parcel` | Nothing shows a missing scan-in per parcel as "no scan recorded" |
| Evidence on a cancelled trip | `exceptions/creation.py` has no trip-status guard, and late-evidence custody exists | Driver-pwa drops a cancelled trip without telling the driver (`TripContext.tsx:206`) |

---

## 2. Decisions (answered by Tim, 20 Oct 2026)

1. **Ownership: Tim builds everything.** The audit-pack waiver is extended to cover this feature's dispatcher
   UI (Stages 5, 6 and 6.5). Ciaran gets told before Stage 5 starts, because `TripDetailPanel.tsx`, the Sidebar
   and the exception detail page are high-traffic dispatcher files that may be on his branch.
2. **Stopping a trip reuses `TripStatus.CANCELLED`.** "Stopped by an incident" is shown from the
   `incidents.trip_stopped_at` link. No enum change.
3. **Closing as `theft_reported` without a SAPS CAS number: warn, don't block.** The close succeeds.
   The dialog shows a warning first, and the audit pack carries an `incident.theft_reported_without_cas`
   observation, so the gap is visible to the insurer.
4. **Hedera anchoring comes after the MVP (Stage 8).** `reported_by_name` must stay out of any hashed payload.
5. **Dispatcher document upload is IN the MVP, behind a backend flag** `INCIDENT_DOCUMENTS_ENABLED`
   (default `False`). It mirrors the `DRIVER_SUBSTITUTIONS_ENABLED` pattern: orchestration checks the
   flag and raises a typed error (503), and the incident detail read exposes `document_upload_enabled`
   so the dispatcher hides the control. See Stage 6.5.
6. **No driver consignment picker.** The driver's `cargo_damage` report stays as it is. The dispatcher
   names the affected cargo inside the incident.

---

## 3. Domain model

Exception = observation ("seal broken", "count short", "tracker silent").
Incident = the investigation those observations belong to.

```
Trip 1 ──< Incident 1 ──< IncidentUpdate         (append-only ledger — the truth)
                 │  ──< IncidentException >── TripException   (an exception is in ≤1 incident)
                 │  ──< IncidentParcel    >── Parcel / Consignment
                 └──< IncidentDeclaration (existing table + nullable incident_id)
```

Three separate states the UI must never merge (pasted point 5):

| Question | Answered by |
|---|---|
| Is the trip still running? | `Trip.status` (active / closed / cancelled) |
| Has someone assessed this alert? | `TripException.review_status` (unchanged) |
| Is the investigation finished, and what did it establish? | `Incident.status` + `Incident.outcome` |

### Enums (append to `backend/app/db/models/enums.py`, String-stored like `ExceptionType`, so no PG enum migration)

```python
class IncidentType(str, enum.Enum):
    HIJACKING      = "hijacking"
    PARCEL_SHORTAGE = "parcel_shortage"
    PARCEL_DAMAGE  = "parcel_damage"
    # Breakdown deliberately absent — out of MVP scope (Tim, 20 Oct).

class IncidentStatus(str, enum.Enum):
    OPEN          = "open"
    INVESTIGATING = "investigating"
    CLOSED        = "closed"

class IncidentConfidence(str, enum.Enum):
    SUSPECTED    = "suspected"     # inferred from FreightProof signals only
    REPORTED     = "reported"      # someone told us (a phone call stays this)
    CORROBORATED = "corroborated"  # independent evidence agrees (SAPS case, recovery, scans)

class IncidentReporterRole(str, enum.Enum):
    DRIVER = "driver"; CLIENT = "client"; RECEIVER = "receiver"
    TRACKING_COMPANY = "tracking_company"; POLICE = "police"
    OPERATOR_STAFF = "operator_staff"; FREIGHTPROOF = "freightproof"; OTHER = "other"

class IncidentReportChannel(str, enum.Enum):
    PHONE = "phone"; WHATSAPP = "whatsapp"; EMAIL = "email"
    IN_PERSON = "in_person"; IN_APP = "in_app"   # opened from an existing exception

class IncidentOutcome(str, enum.Enum):
    RECORDING_ERROR    = "recording_error"
    CARGO_RECOVERED    = "cargo_recovered"
    PARTIAL_RECOVERY   = "partial_recovery"
    SHORTAGE_CONFIRMED = "shortage_confirmed"
    DAMAGE_CONFIRMED   = "damage_confirmed"
    THEFT_REPORTED     = "theft_reported"
    INCONCLUSIVE       = "inconclusive"

class IncidentUpdateKind(str, enum.Enum):
    OPENED = "opened"; NOTE = "note"; STATUS_CHANGED = "status_changed"
    ASSIGNED = "assigned"; CONFIDENCE_CHANGED = "confidence_changed"
    EXCEPTION_LINKED = "exception_linked"; PARCEL_ADDED = "parcel_added"
    PARCEL_FINDING = "parcel_finding"; EXTERNAL_ACTION = "external_action"
    TRIP_STOPPED = "trip_stopped"; CLOSED = "closed"; REOPENED = "reopened"

class ParcelFinding(str, enum.Enum):
    NO_SCAN_RECORDED  = "no_scan_recorded"   # the default — NOT "stolen"
    LOCATED           = "located"
    CONFIRMED_MISSING = "confirmed_missing"
    DAMAGE_CONFIRMED  = "damage_confirmed"
    RECORDING_ERROR   = "recording_error"

class ExternalAction(str, enum.Enum):
    TRACKING_COMPANY_ALERTED = "tracking_company_alerted"
    SAPS_REPORTED = "saps_reported"; INSURER_NOTIFIED = "insurer_notified"
    CLIENT_NOTIFIED = "client_notified"; DRIVER_WELFARE_CHECK = "driver_welfare_check"
    RECOVERY_REPORTED = "recovery_reported"; OTHER = "other"
```

### Tables (new `backend/app/db/models/incidents.py`, registered in `db/models/__init__.py`, which is a shared file)

- **`incidents`**: `id`, `reference` (unique, e.g. `INC-20261020-0007`), `trip_id` FK, `operator_organization_id` FK,
  `incident_type`, `summary` (what was reported), `reported_by_name` (nullable, PII, never hashed),
  `reporter_role`, `report_channel`, `reported_occurred_at` (nullable, "unknown" is honest),
  `received_at` (not null), `recorded_by_user_id` FK, `trip_stopped_at` (nullable).
  **Caches** (rewritten only by orchestration, under `FOR UPDATE`): `status`, `confidence`,
  `assigned_to_user_id`, `outcome`, `closed_at`, `closure_reason`. Plus `created_at` / `updated_at`.
- **`incident_updates`**: `id`, `incident_id` FK, `kind`, `note`, `from_value` / `to_value` (String 50),
  `parcel_id` / `exception_id` / `phase_event_id` / `artifact_id` (nullable FKs, the supporting evidence),
  `external_action`, `action_at` (when the outside action happened, as distinct from when it was typed),
  `recorded_by_user_id` FK, `created_at` / `updated_at`. No API path updates or deletes a row.
- **`incident_exceptions`**: `incident_id`, `exception_id` (**unique**), `linked_by_user_id`, timestamps.
- **`incident_parcels`**: `incident_id`, `parcel_id`, `consignment_id`, `added_by_user_id`, cached `latest_finding`,
  timestamps. Unique on (`incident_id`, `parcel_id`).
- **`incident_declarations`**: add a nullable `incident_id` FK. Additive. Existing rows stay trip-scoped.

Migration: `2026_10_xx_tim_add_incidents.py`. **Prune autogenerate to these 5 changes only**
(CLAUDE.md ⚠ section). Add RLS lockdown for the 4 new tables to match `ciaran_lock_down_data_api`.
`test_data_api_lockdown_coverage` will fail until that's done. Apply from `dev` after merge only.

### The pure core (most exam-defensible piece): `orchestration/incidents/state.py`

```python
ALLOWED: dict[IncidentStatus, frozenset[IncidentStatus]] = {
    IncidentStatus.OPEN:          frozenset({IncidentStatus.INVESTIGATING, IncidentStatus.CLOSED}),
    IncidentStatus.INVESTIGATING: frozenset({IncidentStatus.CLOSED}),
    IncidentStatus.CLOSED:        frozenset({IncidentStatus.INVESTIGATING}),  # via REOPENED only
}

@dataclass(frozen=True)
class IncidentState:
    status: IncidentStatus
    confidence: IncidentConfidence
    assigned_to: uuid.UUID | None
    outcome: IncidentOutcome | None
    closed_at: datetime | None
    parcel_findings: Mapping[uuid.UUID, ParcelFinding]

def replay(updates: Sequence[UpdateFact]) -> IncidentState: ...       # ledger → state
def check_transition(current: IncidentStatus, target: IncidentStatus) -> None: ...  # raises IncidentStateError
def check_close(outcome, reason) -> None: ...  # raises when the reason is blank
def close_warnings(outcome, *, has_cas_declaration) -> list[str]: ...  # §2.3: warn, never block
```

Invariant tested on every write path: `cache columns == replay(ledger)`.

---

## 4. Stages

Each stage ends with something you can see working. Run every verification command before
ticking a stage. Backend tests use PG17 on :5433 (see memory: backend-local-test-db). Dispatcher
tests need Node 22 (`node -v` first).

### Stage 0: Review + decisions (this document)
- [x] Tim answers §2.1–2.6 (20 Oct)
- [ ] Tell Ciaran the dispatcher stages are coming (TripDetailPanel, Sidebar, exception detail)
- [ ] `git fetch origin` and check for unmerged migrations on `dev` (Ciaran's `driver_transfer_v2` is the latest)

### Stage 1: Data model + pure state machine (backend)
**Create:** `app/db/models/incidents.py`, `app/orchestration/incidents/__init__.py`, `state.py`,
`app/core/exceptions.py` additions (`IncidentStateError` → 409, `IncidentClosedError` → 409),
migration file. **Modify:** `enums.py` (additive), `db/models/__init__.py` (shared), `audit_packs.py` (+`incident_id`).
**Tests:** `tests/unit/test_incident_state.py`:
`test_replay_opened_only_is_open`, `test_replay_status_then_close_sets_outcome`,
`test_check_transition_closed_to_open_raises`, `test_check_close_without_reason_raises`,
`test_close_warnings_theft_reported_without_cas_warns`, `test_close_warnings_theft_reported_with_cas_empty`,
`test_check_close_inconclusive_allowed_with_reason`,
`test_replay_parcel_finding_latest_wins`, `test_replay_reopened_clears_outcome`.
**Verify:** `cd backend && pytest tests/unit/test_incident_state.py -v` green, `alembic check` shows
only pre-existing drift, `grep -nE "op\.[a-z_]+\(" migrations/versions/*tim_add_incidents*` lists only the 5 intended changes.

### Stage 2: Write paths (backend orchestration + endpoints)
**Create:** `orchestration/incidents/creation.py`, `updates.py`; `schemas/incidents.py`
(Pydantic v2, with an `IncidentUpdateCreate` discriminated union on `kind`); `api/v1/endpoints/incidents.py` (`tags=["incidents"]`).
**Modify:** `orchestration/trips/administration.py`: extract `_terminate_trip(db, trip, *, user_id, description)`
out of `cancel_trip`, so both cancel and incident-stop share the lock, the handover cancel, the ledger note and the realtime events
(**this is someone else's file, so coordinate**). `core/realtime.py` gets `RealtimeKind.INCIDENT_CHANGED`. Router registration (shared file).

Endpoints:
| Method | Path | Does |
|---|---|---|
| POST | `/trips/{trip_id}/incidents` | Report an incident: type, summary, reporter, channel, times, confidence, `exception_ids[]`, `parcel_ids[]` (`all_parcels: true` for a hijacking), `stop_trip: bool` |
| POST | `/incidents/{id}/updates` | Append one update (note / assign / status / confidence / link exception / add parcel / parcel finding / external action). Every one needs a non-empty note or a structured value |
| POST | `/incidents/{id}/close` | `outcome` + `reason` (required). Response carries `warnings[]` (e.g. theft reported with no CAS number) |
| POST | `/incidents/{id}/reopen` | `reason` required, appends REOPENED |

Rules:
- `stop_trip` on a CREATED/ACTIVE/EXCEPTION_HOLD trip → `_terminate_trip`, then `trip_stopped_at` + a TRIP_STOPPED update.
  On a CLOSED or CANCELLED trip it's a 409. A shortage found after delivery never stops anything.
- Hijacking defaults: `stop_trip=true` and `all_parcels=true` when the trip is live. The dispatcher can uncheck either.
- Linking an exception that's already in another incident is a 409, and the error names the other incident.
- Opening from an exception (panic) sets `reporter_role=driver` / `channel=in_app` / `confidence=suspected` and links it.
- Linking does **not** review the exception. The review stays its own act (pasted point 3).

**Tests:** `tests/integration/test_incidents_endpoints.py`:
`test_report_incident_returns_201_and_opened_update`, `test_report_incident_401_without_token`,
`test_report_incident_422_unknown_type`, `test_report_incident_404_other_org_trip`,
`test_report_hijacking_stop_trip_cancels_trip_and_ends_handover`,
`test_report_incident_stop_trip_on_closed_trip_409`, `test_link_exception_already_in_incident_409`,
`test_append_update_does_not_mutate_previous_rows`, `test_close_without_reason_422`,
`test_close_theft_reported_without_cas_succeeds_with_warning`, `test_cache_matches_replay_after_every_write`,
`test_link_exception_leaves_review_status_unchanged`. Plus `tests/integration/test_trip_admin.py`
staying green (proof the cancel refactor changed no behaviour).
**Verify:** `cd backend && pytest tests/integration/test_incidents_endpoints.py tests/integration/test_trip_admin.py -v`.

### Stage 3: Read paths + the shortage evidence bundle (backend)
**Create:** `orchestration/incidents/queries.py`, `evidence.py`, `response_guide.py` (pure).
Endpoints: `GET /incidents?status=&type=&assigned_to=me`, `GET /incidents/{id}` (facts + caches + full ledger + names),
`GET /trips/{trip_id}/incidents`, `GET /incidents/{id}/evidence`.

Evidence bundle per affected parcel (pasted point 4): barcode, consignment, delivery stop,
`pp_scan_out_at`, `pp_scan_in_at` → **"No scan recorded"** when null, never "stolen".
Plus per trip: departure seal vs arrival seal (number + condition + photo ids), consignment
expected/scanned counts, linked exceptions with their review state, last known position, route
deviations / tracker-silent windows during the leg, and receiver verification tier.

`response_guide.py` turns incident + declarations + updates into the hijacking checklist (§5).
It's pure and derived, so there's never a stored checkbox that can drift.

Driver read: add `ended_by_dispatch_at: datetime | None` to the driver trip schema
(`GET /trips/me/{id}`), set when `trip_stopped_at` is set. **It deliberately carries no incident type**,
because the phone may be in the hijacker's hands.

**Tests:** `tests/unit/test_incident_response_guide.py` (each step done or not from fixture facts),
`tests/integration/test_incidents_reads.py` (`..._missing_scan_in_reads_no_scan_recorded`,
`..._other_org_404`, `..._list_filters_by_status`, `..._driver_read_has_no_incident_type`).

### Stage 4: Audit pack + SAPS fact sheet (backend, your feature)
**Modify:** `schemas/audit_pack.py` (+`IncidentRecord`, `IncidentUpdateRecord`, `AffectedParcelRecord`;
`AuditPackManifest.incidents`), `orchestration/audit_packs/builder.py`, `analysis.py`,
`reporting/incident_sheet.py` + templates.
- Manifest `incidents[]`: facts, reporter role + channel, confidence, the timeline (who, when, what, evidence ids),
  affected parcels with their latest finding, outcome + reason, or "**open at time of issue**".
- Consignment scope: parcels / updates for other consignments are cut and listed in `redactions`.
- `summarise_incident`: prefer a recorded HIJACKING incident (anchored on `reported_occurred_at`, else `received_at`)
  over the first-critical-exception guess. That fixes NoIncidentError for a phone-reported hijacking with no panic.
- New observations: `incident.open` (attention), `incident.unresolved_parcels` (n parcels still "no scan recorded"),
  `incident.trip_stopped`, `incident.closed_outcome`, `incident.theft_reported_without_cas` (attention, §2.3),
  and `incident.report_vs_system` when confidence is still `reported` (stated as a report, not a confirmed theft).
- Documents uploaded by dispatchers (Stage 6.5) are listed in the timeline by file name, hash and uploader. They are
  NOT embedded in the pack PDF in the MVP.
- Fact sheet: an incident block with the reference, reported vs received time, reporter role, stop time, affected cargo list, the
  declaration (station / CAS / officer), and the existing TAPA suggestion.
- B1/B2 snapshot tests get regenerated (additions only, so diff them).
**Tests:** extend `tests/unit/test_audit_pack_analysis.py` + the builder tests:
`test_manifest_includes_open_incident_with_timeline`, `test_scope_cuts_other_consignment_parcels`,
`test_phone_reported_hijack_produces_incident_sheet`, `test_unresolved_parcels_observation_counts_no_scan`.

### Stage 5: Dispatcher, the complete shortage workflow (the demo priority)
**Create:** `app/(app)/incidents/page.tsx`, `app/(app)/incidents/[id]/page.tsx`,
`components/incidents/{ReportIncidentDialog,IncidentHeader,IncidentTimeline,AffectedCargoPanel,ShortageEvidencePanel,AddUpdateDialog,CloseIncidentDialog}.tsx`
(+ tests), `lib/api/incidents.ts` (typed wrapper), `frontend/shared/lib/types/incident.ts` (shared, additive, flag it).
**Modify:** `TripDetailPanel.tsx` ("Report incident" + incidents list), `exceptions/[id]/page.tsx`
("Open incident" / "Add to incident"), Sidebar ("Incidents"), realtime handler for `incident_changed`.
- `IncidentHeader` shows the three states side by side: **Trip: Closed · Exceptions: 2 of 3 reviewed · Incident: Investigating**.
- `AffectedCargoPanel`: per parcel, the finding chip ("No scan recorded" in neutral grey, not red) and an action to record a finding.
- `IncidentTimeline`: append-only, newest last, each entry showing who / when / what / evidence links. There's no edit or delete control.
- `CloseIncidentDialog`: outcome select + required reason. Unresolved parcels are listed as "will remain unresolved", which is allowed.
  Choosing `theft_reported` with no CAS declaration on the incident shows an inline warning ("No SAPS case number recorded,
  and the audit pack will say so") plus a shortcut to record it. Closing is still allowed (§2.3).
**Verify:** `cd frontend/dispatcher && npx vitest run components/incidents app/\(app\)/incidents`, then a manual walk:
seeded trip with 3 short parcels → report → assign → record 1 located, 2 confirmed missing → close `partial_recovery` → issue pack → the pack shows it.

### Stage 6: Dispatcher, the hijacking flow
**Create:** `components/incidents/HijackResponseGuide.tsx` (+ test).
- `ReportIncidentDialog`, type = Hijacking: "Stop this trip" defaults on, with a confirmation that says what stopping does
  ("the driver's app stops asking for steps; evidence already captured and anything still queued on the phone will still be recorded").
  All parcels default to affected. Vehicle(s) are shown read-only from the trip.
- Panic exception detail → "Open hijacking incident" prefills from the alert (time, position, reporter = driver, in-app).
- `HijackResponseGuide` on the incident page, in order, each step derived from the backend's `response_guide`:
  1. Trip stopped ✓ (time)
  2. Tracking company alerted → records EXTERNAL_ACTION + time
  3. Reported to SAPS → opens `DeclareIncidentDialog` **with `incident_id`** (station, CAS no., officer, time)
  4. Insurer notified + claim reference → same dialog
  5. Client notified
  6. Driver welfare check recorded
  7. Issue the insurer audit pack → existing `AuditPacksPanel` issue flow
  8. Download the SAPS fact sheet → existing `/audit-trail/incident-sheet.pdf`
  Copy says FreightProof *records* each step and does not contact SAPS or dispatch help (scope §0).
**Verify:** vitest for the guide states + a manual walk of the phone-reported hijacking with no panic.

### Stage 6.5: Incident documents, behind `INCIDENT_DOCUMENTS_ENABLED` (backend + dispatcher)
**Config (shared files, flag them):** `core/config.py` gets `INCIDENT_DOCUMENTS_ENABLED: bool = False`, using the same
`field_validator(mode="before")` bool parsing as `DRIVER_SUBSTITUTIONS_ENABLED`. `.env.example` gets
`INCIDENT_DOCUMENTS_ENABLED=` (an empty key).
**Storage:** reuse `EvidenceArtifact`. `captured_by_user_id` is already nullable, so a dispatcher upload sets it,
leaves `captured_by_driver_id` null, and stores into the evidence bucket through `storage/` with the
SHA-256 `file_hash` computed on upload. The bucket's own MIME allowlist already admits PDF and images
(see memory: evidence-bucket-mime-allowlist). There's no new table: the incident links the file through a
`kind=NOTE` update whose `artifact_id` points at it.
**Backend:** `POST /incidents/{id}/documents` (multipart: file + required note) in `api/v1/endpoints/incidents.py`.
It calls `orchestration/incidents/documents.py::attach_document`, which checks the flag first and raises
`IncidentDocumentsDisabledError` (core/exceptions.py → 503) when it's off. Size limit reuses `MAX_FILE_SIZE_BYTES`.
Rate limiting reuses the `ARTIFACT_UPLOAD` budget. A closed incident gives 409. `GET /incidents/{id}` adds
`document_upload_enabled: bool` (read from settings) plus a `documents[]` list. Downloads use a signed URL via `storage/`, scoped to the org.
**Dispatcher:** `components/incidents/AttachDocumentButton.tsx` is rendered only when `document_upload_enabled`.
Each document shows in `IncidentTimeline` with file name, uploader, time and hash. The SAPS step in `HijackResponseGuide`
offers "Attach case slip" next to the CAS fields when the flag is on.
**Tests:** `tests/integration/test_incident_documents.py`:
`test_attach_document_disabled_returns_503`, `test_attach_document_enabled_returns_201_and_hash`,
`test_attach_document_401_without_token`, `test_attach_document_404_other_org`, `test_attach_document_closed_incident_409`,
`test_attach_document_oversize_413`, `test_attach_document_writes_note_update_with_artifact_id`,
`test_incident_detail_reports_document_upload_enabled_flag`. Dispatcher: `AttachDocumentButton.test.tsx` (hidden when the flag is false).
**Verify:** `cd backend && pytest tests/integration/test_incident_documents.py -v`, then a manual check with the flag on and off.

### Stage 7: Driver PWA (yours)
**Modify:** `lib/context/TripContext.tsx`: a terminal trip with `ended_by_dispatch_at` sets
`endedByDispatchTripId` (mirrors `handedOverTripId`) instead of a silent drop.
**Create:** `components/trip/TripEndedByDispatch.tsx` (+ test). Neutral copy: "Dispatch has ended this
trip" + time + `CallDispatch`. **No mention of hijacking or incident.** Dismiss → trips list.
**Modify:** `useOfflineQueue.ts`: confirm and test that queued *exceptions* still flush to an ended trip (the backend
accepts them), and that a queued *phase step* that gets the 409 trip-terminal response is marked terminal and kept in local history,
not retried forever. Panic page: no behaviour change. Add a test that panic on a just-ended trip still sends.
`LogExceptionPageClient.tsx` is unchanged (§2.6).
**Tests:** `TripEndedByDispatch.test.tsx`, a `TripContext.test.tsx` case `ends_by_dispatch_shows_screen_not_silent_drop`,
and `useOfflineQueue` cases for the 409 terminal and exception flush.
**Verify:** `cd frontend/driver-pwa && npx vitest run`, then on device: dispatcher stops the trip mid in-transit, and the phone shows the screen on its next refetch.

### Stage 8 (after MVP): Hedera anchoring
New `BlockchainReceiptType.INCIDENT_OPENED` / `INCIDENT_CLOSED` (String column, so no enum migration).
The payload is a hash of id, trip, type, times, linked exception ids, parcel ids, outcome and closure-reason hash. **No reporter name.**
Reuses the `evidence_anchors.recording` pattern. Deferred until after the MVP (§2.4). Uploaded document hashes join the payload here.

### Stage 9: Seed + demo script
`backend/scripts/seed_incident_demo.py`: one closed trip with 3 parcels lacking scan-in (shortage
demo) and one active trip for the hijacking walk. The demo ending: *"Three parcels were missing; here is the
evidence, who investigated, what they established, and what remains unresolved."*

---

## 5. Out of scope (MVP)

- Breakdown / mechanical incidents (Tim, 20 Oct). `MECHANICAL` exceptions stay as they are.
- Auto-creating incidents from alerts. A human opens every incident. Automatic suggestions come later.
- Contacting SAPS, insurers or tracking companies from the system.
- A driver consignment picker on `cargo_damage` (§2.6).
- Embedding uploaded documents in the audit-pack PDF. They're listed by hash only.
- Vehicle deactivation after a hijack. The stolen horse is freed by the cancel like any other; flag it for fleet admin.
- Reassigning cargo to a recovery trip.

## 6. Risks

- **Cross-dev:** `administration.py` refactor, `main.py` router, `db/models/__init__.py`, `core/config.py` + `.env.example`
  (new `INCIDENT_DOCUMENTS_ENABLED` key), Sidebar, `TripDetailPanel.tsx`, `shared/lib/types`. All flagged in TASK COMPLETE.
- **Uploads:** a new dispatcher write path into the evidence bucket. Off by default, size-capped, rate-limited, org-scoped.
- **Migration:** CI never runs Alembic. Prune by hand and apply from `dev` only. Ciaran's `driver_transfer_v2` just landed, so rebase first.
- **Audit-pack snapshots:** B1/B2 need regenerating. Review that the diff contains additions only.
- **POPIA:** `reported_by_name` is personal data. It stays in PG (af-south-1) and in the dispatcher's own incident view. It is never in the audit-pack manifest (which is hashed and anchored) or its PDFs (decided 21 Oct).

---

## 7. Build log

Design corrections made while building (they supersede the sections above where they differ):
- `ParcelFinding` has no `NO_SCAN_RECORDED`. "No scan recorded" is a scan fact read from `Parcel.pp_scan_in_at`
  and shown beside the finding. A null `latest_finding` means nothing has been established yet. The values are
  `located`, `confirmed_missing`, `damage_confirmed` and `recording_error`.
- `incident_updates.sequence` (unique per incident) orders the ledger, because Postgres `now()` is the
  transaction's start time and one report writes several rows.
- The incident reference is `incident_number` per trip (INC1, INC2…, unique with `trip_id`), the same pattern as audit packs' AP1/AP2.
- `IncidentUpdateKind.DOCUMENT_ATTACHED` was added for Stage 6.5.
- The migration is hand-written (`tim_add_incidents`, revises `ciaran_driver_transfer_v2`). A DB CHECK
  makes the closed cache all-or-nothing.

| Stage | State | Evidence |
|---|---|---|
| 1 Data model + state machine | DONE 20 Oct | `test_incident_state.py` 27 passed. Migration up/down/up on a scratch PG17 DB with Supabase stubs: RLS on all 4 tables, `alembic check` reports no drift. Lockdown + trip-admin suites green (71) |
| 2 Write paths | DONE 20 Oct | `report_incident`, `append_update` (8 kinds as a discriminated union), `close_incident` (returns warnings), `reopen_incident`, `stop_trip_from_incident`. `cancel_trip` refactored onto a shared `terminate_trip` with no behaviour change (trip-admin suite green). `test_incidents_endpoints.py`: 42 passed, including the cache == replay(ledger) invariant on every write path |
| 3 Reads + evidence + guide | DONE 20 Oct | List / detail / trip list, `GET /incidents/{id}/evidence` (a slice of the audit-pack manifest), and the hijacking `response_guide` (pure, derived). The driver-read field was dropped: only dispatchers write CANCELLED, so a cancelled trip already means "ended by dispatch" |
| 4 Audit pack | DONE 20 Oct | Manifest v4 `investigations` (declared tier, consignment-scope cut + redaction). `summarise_incident` picks whichever came first: a critical exception, or a recorded hijacking (so the fact sheet works with no panic). 6 `incident.*` observations. Pack + fact-sheet templates updated. The v3-compat test is green |
| 5 Dispatcher shortage workflow | DONE 21 Oct | `/incidents` list, `/incidents/[id]` detail, report / add / close / reopen dialogs, a status strip showing the 3 states, the affected-cargo panel (scan fact vs finding), evidence panel, timeline. Entry points: trip Info tab, exception detail ("Investigation" block), sidebar |
| 6 Dispatcher hijacking flow | DONE 21 Oct | `HijackResponseGuide` (7 derived steps), stop-trip confirmation, SAPS step → `DeclareIncidentDialog` pinned to the incident, pack issue via `?panel=audit`, fact-sheet download |
| 6.5 Documents behind flag | DONE 21 Oct | `INCIDENT_DOCUMENTS_ENABLED` (default off, 503), upload + signed URL, `EvidenceArtifact` with `captured_by_user_id`. `test_incident_documents.py`: 10 passed |
| 7 Driver PWA | DONE 21 Oct | `TripContext.endedByDispatch` (pinned and unpinned paths), `TripEndedByDispatchBanner` on Home + Trips, neutral copy. The trip-stop ledger note changed to "Trip stopped by dispatch." because the driver read carries every exception. The offline queue already retains a refused (409) phase entry, so no change was needed there |
| 8 Hedera anchoring | DEFERRED (§2.4) | — |
| 9 Seed + demo | DONE 21 Oct | `scripts/seed_incident_demo.py` (local DB only). Verified: INC1 closed `partial_recovery`, 1 located / 1 confirmed missing / 1 unresolved, pack observations as designed |

Follow-ups found while building (not done):
- The driver trip read (`_driver_view`) returns every exception on the trip, dispatcher notes included. Any free-text cancel note a dispatcher types reaches the phone. Consider filtering DISPATCHER_NOTE out of the driver view.
- There is no endpoint listing a dispatcher's colleagues, so the UI offers only "Take ownership". The API already accepts any colleague's id.
- Documents are listed in the pack by hash only, not embedded.

### Independent review (21 Oct) and fixes

An independent code review covered the whole diff (read-only). Every finding below was checked against the code. The two important ones were reproduced with failing tests before being fixed.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | `stop_trip_from_incident` loaded `Trip` through `lock_incident`, then `_lock_trip`'s `FOR UPDATE` kept the stale identity-map status. A cancel landing in between let `terminate_trip` run twice (second ledger note, second TRIP_CLOSED) | Important | FIXED: `populate_existing=True` on both lock queries. Test `test_stop_trip_later_sees_a_cancel_committed_after_the_trip_was_loaded` |
| 2 | A consignment-scoped pack kept every incident, so client A's pack showed client B's shortage, reporter name and notes | Important | FIXED: in a scoped pack, a non-hijacking incident stays only if it names a visible parcel or groups an in-scope exception. Redaction note widened. Tests `test_scoped_pack_drops_another_clients_shortage`, `..._keeps_a_shortage_on_its_own_consignment` |
| 3 | `reported_by_name` is in the manifest, so it is inside `manifest_sha256`, which is anchored. This contradicts §6 "never in any hash" (driver names already take the same path) | Plan conflict | FIXED (Tim, 21 Oct: "take out the name"): removed from `InvestigationRecord` and both PDFs; kept in the DB and the dispatcher's own incident view. Test `test_reporter_name_never_enters_the_hashed_manifest` |
| 4 | The detail read counted only incident-pinned declarations, while the close warning and the pack also counted trip-level ones, so the dialog warned while the server did not | Minor | FIXED: the detail read uses `incident_id in (this, None)`. Test `test_detail_counts_a_trip_level_case_number_like_the_close_warning` |
| 5 | The upload comment claimed the flag check happens before the body is read | Minor | FIXED: comment corrected (FastAPI has already received the multipart body; the flag stops storage, not transfer) |
| 6 | Stop-trip copy said queued phone work "is still recorded", but queued phase steps are refused (409) and kept on the phone | Minor | FIXED: copy in both dialogs now says reports are still accepted and step submissions are kept on the phone, not lost |
| 7 | The seed's localhost guard was a substring check | Minor | FIXED: `make_url(...).host` |
| 8 | `GET /trips/{id}/incidents` returned 200 `[]` for another organisation's trip | Minor | FIXED: 404. Test `test_list_trip_incidents_404_for_other_org_trip` |
| 9 | The neutral "Dispatch has ended this trip" banner still tells whoever holds the phone that dispatch acted | Threat-model note | DECIDED (Tim, 21 Oct): the banner stays, and it must never say why. Confirmed: the banner, the trip-stop ledger note ("Trip stopped by dispatch.") and the phone's 409 text name no incident or reason, and tests assert it |

Unrelated flake found during the final runs: `test_trip_pp_manifest_reads.py::test_history_search_matches_manifest_number_exactly`
fails about 2.7% of runs. Its fixture's trip references are random hex (`FP-TEST-<8 hex>`), and history search substring-matches
references, so trip 690's reference sometimes contains "69". It predates this branch (fixture from FP-139/142) and was left for its owner.
Fix: build references from a digit-free alphabet.
