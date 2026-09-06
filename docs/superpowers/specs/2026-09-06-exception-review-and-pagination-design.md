# Exception Review and Pagination Design

**Date:** 2026-09-06

**Status:** Approved for implementation planning

**Scope:** Dispatcher exception review, exception history pagination, and trip-history pagination

## Purpose

FreightProof records exceptions as evidence. An exception must never pause, resume,
reopen, or otherwise control a phase or trip. A dispatcher may assess an exception while
the trip is active or after its phase, trip, or cancellation is complete.

The current binary `resolved` model implies that every anomaly is an operational problem
that must be fixed. Replace it with an evidence-review model that distinguishes an
ordinary recorded anomaly from a critical event requiring human attention. Add bounded,
stable pagination to evidence archives without paginating the live attention queue.

## Domain Model

### Review states

`ExceptionReviewStatus` is stored as a string with exactly three values:

- `recorded`: retained as evidence; no dispatcher review is required.
- `needs_review`: a critical event requiring dispatcher assessment, but never blocking the trip.
- `reviewed`: a dispatcher recorded an assessment. The underlying exception remains unchanged.

New exceptions derive their initial state from severity in one central service helper:

- `critical` -> `needs_review`
- `warning` or `info` -> `recorded`

`recorded` and `needs_review` may transition to `reviewed`. `reviewed` is terminal and its
first review is immutable. The existing same-dispatcher retry remains idempotent; a later
review by another dispatcher returns HTTP 409.

### Review evidence

A review stores server-owned authorship and time plus dispatcher-supplied assessment:

- `reviewed_by_user_id`
- `reviewed_at`
- required `review_note`
- required `review_outcome`
- required-but-nullable `contact_method` in the API; optional choice in the UI

`ExceptionReviewOutcome` values:

- `no_action_required`
- `handled_externally`
- `evidence_verified`
- `data_discrepancy`
- `referred_for_follow_up`
- `legacy_review` (migration-only value for an older resolved record whose outcome cannot be inferred)

`ExceptionContactMethod` values are `phone`, `whatsapp`, and `in_person`. A null value
means nobody was contacted for a new review. The PATCH request must include
`contact_method`, but its value may be null; omission is a validation error. This keeps
“explicitly reviewed without contact” distinct from a forgotten field. A migrated row
with unknown historical handling is separately identifiable by `legacy_review`, so null
does not collapse new no-contact reviews into legacy uncertainty. “No contact yet” is not
a contact method because a completed review is not waiting for contact.

`legacy_review` is valid only on stored/read data. Dispatcher PATCH requests use a
separate input enum that excludes it, so clients cannot manufacture legacy evidence.

Reviewing an exception does not mutate its description, severity, source, phase link,
trip link, phase status, trip status, or evidence artifacts.

### Existing-data migration

The migration preserves every existing evidence field and maps rows deterministically:

| Existing row | New `review_status` | New outcome |
|---|---|---|
| `resolved = true` | `reviewed` | `legacy_review` |
| unresolved and critical | `needs_review` | null |
| unresolved warning/info | `recorded` | null |

Rename resolution authorship/note columns to review terminology. Rename
`resolution_method` to `contact_method`, map `phoned` to `phone`, and map
`no_contact_yet` to null. Drop `resolved` only after the status backfill. The downgrade
reconstructs `resolved = (review_status = 'reviewed')` and reverses column names.

Dispatcher and driver trip summaries rename `open_exception_count` to
`needs_review_count`. The value counts only `needs_review` exceptions. This is a semantic
contract update, not a driver-PWA pagination change; the driver PWA receives the renamed
field but does not gain a review action.

The existing `(trip_id, resolved)` index is replaced by
`(trip_id, review_status)`. `trip_id` must remain the leading column because trip detail,
batched counts, and duplicate suppression all lead on it. Do not replace it with a
low-cardinality `(review_status, created_at, id)` index; the organisation-scoped archive
query joins through trips and that index does not serve the join. Add another history
index only if a real PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` demonstrates a need.

Two parcel-count duplicate predicates intentionally treat both `recorded` and
`needs_review` as still active for deduplication. Their behaviour-preserving predicate is
`review_status != reviewed`. Once a row is reviewed, a later recurrence may create a new
evidence record.

## Critical-only Attention Decision

The Needs Review queue is deliberately severity-based, not type-based. With the current
severity policy it contains panic-button, seal-broken-in-transit, seal-mismatch, and an
unexplained seal-unverified event. An explained seal-unverified event is only a warning.
Delivery refusal, cargo damage, mechanical incidents, substitutions, and count mismatches
are currently warnings and therefore go directly to History.

This is intentional for the present evidence-focused scope: warnings remain visible and
searchable but do not create compulsory dispatcher administration. If one of those types
later requires mandatory review, change its canonical severity or introduce an explicit
policy mapping as a separate product decision; do not special-case it in the UI.

## API Design

### Attention queue

`GET /api/v1/exceptions/review-queue`

Returns all organisation-scoped `needs_review` rows, newest first. It is intentionally
unpaginated: this is a bounded human-work queue, and hiding a large critical backlog
behind pages would be unsafe. Its count is `items.length`.

### Paginated exception history

`GET /api/v1/exceptions/history`

Query parameters:

- `limit`: default 25, minimum 1, maximum 100
- `cursor`: opaque `(created_at, id)` cursor
- `q`: optional trip-reference/description search
- `review_status`: optional `recorded` or `reviewed`
- `severity`: optional exception severity
- `from_date` and `to_date`: optional inclusive South African calendar dates

Only `recorded` and `reviewed` rows appear. Response:

```json
{
  "items": [],
  "next_cursor": null,
  "total_items": 0
}
```

The query fetches `limit + 1` rows to determine `next_cursor`, uses
`(created_at DESC, id DESC)`, and applies all filters before both the page query and
`total_items` count. Offset pagination is prohibited.

### Exception detail

`GET /api/v1/exceptions/{exception_id}` returns exactly one organisation-scoped record,
regardless of review state or trip lifecycle. It includes trip reference/status/closed
time and phase/stop context where available. Missing and cross-organisation IDs both
return 404.

This endpoint is required because a detail permalink cannot search only the currently
loaded archive page. It also prevents downloading the organisation's entire exception
history to display one record.

### Review mutation

`PATCH /api/v1/exceptions/{exception_id}/review`

```json
{
  "review_note": "Loading photograph confirms the recorded seal.",
  "review_outcome": "evidence_verified",
  "contact_method": null
}
```

The endpoint is valid for active, closed, and cancelled trips. It performs no trip- or
phase-status check. It retains the existing row lock, organisation scoping, idempotent
same-user retry, and different-user 409 behaviour.

The previous unpaginated `GET /api/v1/exceptions` endpoint and its
`list_exceptions()` service are retired after the three dedicated read contracts exist.
No compatibility route remains; all consumers are in this repository and migrate in the
same feature.

### Realtime events

Every exception write must enqueue `exception_raised`. Add `exception_reviewed` for a
successful first review. The attention queue subscribes only to those two kinds. The
archive is not live-refetched; it is historical search and refreshes on navigation or an
explicit retry. This removes current refetches caused by unrelated phase events.

Critical raises create sticky error toasts and retain the critical eviction band. Warning
raises create ordinary warning toasts that auto-dismiss after the existing timeout; the
durable record remains in History. Review events are silent. This intentionally replaces
the old rule that made every warning a permanent error toast: warnings are evidence to
notice, while only critical exceptions are mandatory work.

## Exception Dispatcher UI

The sidebar includes Exceptions. The page has two tabs:

1. **Needs Review**: all critical `needs_review` rows, unpaginated, with prominent
   severity, type, trip, phase/stop, trip lifecycle, occurrence time, and a Review action.
2. **History**: `recorded` and `reviewed` rows with server-side search, status, severity,
   and date filters plus cursor pagination.

The top bar reports `N needs review · M history records`. Empty, initial-load failure,
and stale-background-refresh states remain visually distinct.

The detail screen contains:

- exception and review-status header;
- explicit trip lifecycle context, including “Trip closed” or “Trip cancelled”;
- phase/stop context when linked;
- immutable exception description and evidence links;
- review evidence when reviewed;
- review form when `needs_review`, and a secondary optional “Add review” action for
  `recorded` rows.

The form requires outcome and a non-blank note. Contact method is optional and initially
blank. Copy states: “Reviewing records your assessment. It does not change or reopen the
trip.” Successful action copy is “Exception reviewed.”

## Reusable Dispatcher Pagination

Create a presentation-only dispatcher `Pagination` component. It is not placed in
`frontend/shared` because the driver PWA has different mobile navigation needs.

The component receives current page number, page size, current item count, total count,
previous/next availability, loading state, and callbacks. It renders:

- `1–25 of 137`
- `Page 1`
- Previous and Next buttons with accessible labels and correct disabled states

Cursor ownership remains in each data hook. Hooks keep a stack of previously used
cursors, reset to page one whenever filters change, reject stale out-of-order responses,
and never infer a cursor from row data in the UI.

## Trip History (Implemented Last)

Add `GET /api/v1/trips/history` rather than changing `GET /api/v1/trips`. The existing
endpoint is shared by the active dashboard and trip-creation lookups and must retain its
array response.

The history endpoint returns closed and cancelled trips ordered by
`(closed_at DESC, id DESC)` with the same cursor envelope and limits. Filters are:

- search across trip reference, order number, and driver name;
- origin-or-destination precinct;
- inclusive South African close-date range.

Use `closed_at`, not `updated_at`. A migration backfills terminal legacy rows whose
`closed_at` is null from `updated_at` and adds an index supporting organisation, terminal
status, close time, and ID.

The Trip History page moves its search/date/route filters server-side and uses the shared
Pagination component. It subscribes only to `trip_closed`: on page one it silently
refreshes; on later pages it offers “New trip history available” without moving the
dispatcher unexpectedly.

South African date boundaries use `settings.OPERATIONS_UTC_OFFSET_HOURS`; no literal
`+02:00` or duplicated timezone constant is introduced.

## Error and Security Rules

- Both list and detail queries are scoped through the trip's operator organisation.
- Invalid/tampered cursors return 422 and never fall back silently to page one.
- Search terms are parameters and wildcard characters are escaped by SQLAlchemy helpers.
- Review note contents never enter logs or realtime payloads.
- Realtime messages remain thin IDs/kind/severity and contain no PII.
- A failed background refresh keeps already loaded rows visible with a stale-data warning.

## Verification

Backend tests cover migration mapping logic, state assignment, closed/cancelled review,
organisation scoping, cursor stability, filters/counts, malformed cursors, concurrency,
and realtime invariants. Dispatcher tests cover the pagination component, cursor-stack
hooks, filter reset, stale-request rejection, queue/history states, closed-trip review,
and trip-history adoption. Run focused suites after each stage, then full backend and
dispatcher suites, Ruff, mypy, TypeScript, lint, and production build.

## Out of Scope

- Any trip hold, phase hold, automatic trip reopening, or operational response workflow.
- Assigning exception owners, SLAs, or escalation deadlines.
- Editing or deleting a completed review.
- Pagination in the driver PWA, drivers, vehicles, or precincts.
- Sending phone calls, WhatsApp messages, or notifications to external people.
- UI mockups; these may be produced separately for feedback before implementation.
