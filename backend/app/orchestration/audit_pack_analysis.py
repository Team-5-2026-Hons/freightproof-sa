"""Pure analysis behind an Audit Pack: coverage gaps, stationary periods, masking, and
the rule-based Observations printed at the top of the pack.

No DB, no HTTP — every function takes already-loaded values, so each rule is unit
tested on its own and the same inputs always produce the same pack.

Observations are deterministic sentences, never an AI narrative and never a verdict:
FreightProof records what happened, it does not decide who is at fault
(docs/scope-boundaries.md §0). Wording states what the record shows.
"""

from collections.abc import Iterable, Sequence
from datetime import date, datetime, timedelta

from app.core.display import format_sast
from app.core.geo import haversine_metres
from app.schemas.audit_pack import (
    AuditPackManifest,
    CoverageGap,
    ExceptionRecord,
    IncidentSummary,
    Observation,
    PhaseRecord,
    PositionFix,
    StationaryPeriod,
    StopRecord,
)

# Longest silence between two position fixes before the pack calls it a gap. TAPA TSR
# 2023 §9.14 sets tracker reporting intervals between 5 and 60 minutes depending on
# level; 30 sits in that band and matches the level most general freight is audited at.
COVERAGE_GAP_THRESHOLD = timedelta(minutes=30)

# Two fixes this close count as "the same place". Wide enough to absorb phone GPS
# jitter in a truck stop, narrow enough that a truck crawling in traffic still moves.
STATIONARY_RADIUS_METRES = 150.0

# Shorter stops are fuel, toll plazas and traffic lights — reporting them would bury
# the stops an adjuster actually asks about (TAPA §9.21 unscheduled stops).
STATIONARY_MIN_DURATION = timedelta(minutes=20)

# Last N digits of an SA ID number left visible — enough for a reader to match it
# against the claim form, too few to reconstruct date of birth or gender.
ID_NUMBER_VISIBLE_DIGITS = 4

# TAPA TSR 2023 §9.3.1: the Buyer (client) must be told of a suspected theft within 24h.
CLIENT_NOTIFICATION_WINDOW = timedelta(hours=24)

_UNFINISHED_STATUSES = frozenset({"pending", "in_progress"})
_ANCHOR_OWED = frozenset({"pending", "failed"})
_CRITICAL = "critical"
_REVIEWED = "reviewed"


def mask_id_number(value: str) -> str:
    """Hide all but the last few characters of an identity number."""
    if len(value) <= ID_NUMBER_VISIBLE_DIGITS:
        return "*" * len(value)
    return "*" * (len(value) - ID_NUMBER_VISIBLE_DIGITS) + value[-ID_NUMBER_VISIBLE_DIGITS:]


def is_valid_on(expiry: date | None, on: date) -> bool | None:
    """Whether a licence/disc was valid on the trip date; None when never recorded,
    so an absent expiry is never printed as either valid or expired."""
    if expiry is None:
        return None
    return expiry >= on


def _whole_minutes(delta: timedelta) -> int:
    return int(delta.total_seconds() // 60)


def find_coverage_gaps(
    fix_times: Iterable[datetime],
    *,
    window_start: datetime | None,
    window_end: datetime | None,
    threshold: timedelta = COVERAGE_GAP_THRESHOLD,
) -> list[CoverageGap]:
    """Silences longer than `threshold` inside the trip window, including before the
    first fix and after the last — an insurer challenges exactly those stretches."""
    if window_start is None or window_end is None or window_end <= window_start:
        return []

    inside = sorted(t for t in fix_times if window_start <= t <= window_end)
    boundaries = [window_start, *inside, window_end]

    gaps: list[CoverageGap] = []
    for start, end in zip(boundaries, boundaries[1:]):
        if end - start > threshold:
            gaps.append(CoverageGap(start=start, end=end, minutes=_whole_minutes(end - start)))
    return gaps


def _inside_any_stop(lat: float, lng: float, stops: Sequence[StopRecord]) -> bool:
    return any(
        haversine_metres(lat, lng, stop.lat, stop.lng) <= stop.geofence_radius_metres
        for stop in stops
    )


def _timed(fixes: Iterable[PositionFix]) -> list[tuple[datetime, PositionFix]]:
    """Fixes with a known time — an untimed fix can't be placed on a timeline."""
    return [(f.recorded_at, f) for f in fixes if f.recorded_at is not None]


def find_stationary_periods(
    fixes: Sequence[PositionFix],
    *,
    stops: Sequence[StopRecord],
    radius_metres: float = STATIONARY_RADIUS_METRES,
    min_duration: timedelta = STATIONARY_MIN_DURATION,
    max_bridge: timedelta = COVERAGE_GAP_THRESHOLD,
) -> list[StationaryPeriod]:
    """Runs of fixes that stay within `radius_metres` of the run's first fix for at
    least `min_duration`, outside every precinct on the route.

    A run never spans a coverage gap: two fixes at the same spot an hour apart say
    nothing about the hour between them, so claiming a stop there would be invented.
    """
    timed = sorted(_timed(fixes), key=lambda pair: pair[0])

    periods: list[StationaryPeriod] = []
    run: list[tuple[datetime, PositionFix]] = []

    def close_run() -> None:
        if len(run) < 2:
            return
        (start, anchor), (end, _) = run[0], run[-1]
        if end - start < min_duration or _inside_any_stop(anchor.lat, anchor.lng, stops):
            return
        periods.append(StationaryPeriod(
            start=start, end=end, minutes=_whole_minutes(end - start), lat=anchor.lat, lng=anchor.lng,
        ))

    for at, fix in timed:
        if run:
            (_, anchor), (previous_at, _) = run[0], run[-1]
            close = haversine_metres(anchor.lat, anchor.lng, fix.lat, fix.lng) <= radius_metres
            if close and at - previous_at <= max_bridge:
                run.append((at, fix))
                continue
            close_run()
        run = [(at, fix)]
    close_run()
    return periods


def last_fix_before(fixes: Iterable[PositionFix], instant: datetime) -> PositionFix | None:
    """The most recent fix at or before `instant` — "last known position"."""
    candidates = [(at, fix) for at, fix in _timed(fixes) if at <= instant]
    latest = max(candidates, key=lambda pair: pair[0], default=None)
    return latest[1] if latest is not None else None


def summarise_incident(
    exceptions: Sequence[ExceptionRecord], *, fixes: Iterable[PositionFix],
) -> IncidentSummary | None:
    """Key times for the incident page, anchored on the FIRST critical exception —
    later ones are usually consequences of it (a panic, then a broken seal)."""
    critical = sorted((e for e in exceptions if e.severity == _CRITICAL), key=lambda e: e.raised_at)
    if not critical:
        return None
    first = critical[0]
    reviews = [e.reviewed_at for e in critical if e.reviewed_at is not None]
    first_review = min(reviews, default=None)
    return IncidentSummary(
        exception_ids=[e.exception_id for e in critical],
        first_exception_type=first.exception_type,
        first_raised_at=first.raised_at,
        position=first.position,
        last_known_position=last_fix_before(fixes, first.raised_at),
        first_reviewed_at=first_review,
        minutes_to_first_review=_whole_minutes(first_review - first.raised_at) if first_review else None,
    )


# ── Observations ──────────────────────────────────────────────────────────────


def _phase_label(phase: PhaseRecord) -> str:
    return f"P{phase.sequence_number} {phase.phase_type.replace('_', ' ').title()}"


def _normalized_seal(value: str | None) -> str:
    return (value or "").strip().upper()


def _observe_custody(manifest: AuditPackManifest) -> list[Observation]:
    phases = manifest.phases
    if not phases:
        return []
    done = [p for p in phases if p.status not in _UNFINISHED_STATUSES]
    pending = [p for p in phases if p.status in _UNFINISHED_STATUSES]
    observations = [Observation(
        code="custody.completeness",
        level="info" if not pending else "attention",
        text=f"{len(done)} of {len(phases)} phases resolved; {len(pending)} pending.",
        evidence_ids=[p.phase_event_id for p in pending],
    )]

    if manifest.trip.status != "closed" and pending:
        completed = [(p.completed_at, p) for p in phases if p.completed_at is not None]
        latest = max(completed, key=lambda pair: pair[1].sequence_number, default=None)
        last = latest[1] if latest is not None else None
        where = (
            f"last completed phase {_phase_label(latest[1])} at {format_sast(latest[0])}"
            if latest is not None else "no phase completed"
        )
        observations.append(Observation(
            code="trip.incomplete", level="attention",
            text=(f"Trip did not complete: status {manifest.trip.status}, {where}, "
                  f"{len(pending)} phases pending."),
            evidence_ids=[last.phase_event_id] if last is not None else [],
        ))

    for phase in phases:
        if phase.overridden_by_dispatcher:
            note = phase.override_note or "no note recorded"
            observations.append(Observation(
                code="custody.override", level="attention",
                text=f"{_phase_label(phase)} was resolved by dispatcher override ({note}).",
                evidence_ids=[phase.phase_event_id],
            ))
    return observations


def _observe_anchors(manifest: AuditPackManifest) -> list[Observation]:
    owed = [p for p in manifest.phases if p.anchor_status in _ANCHOR_OWED]
    anchored = [p for p in manifest.phases if p.anchor_status == "anchored"]
    observations: list[Observation] = []
    if anchored or owed:
        failed = sum(1 for p in owed if p.anchor_status == "failed")
        observations.append(Observation(
            code="anchors.status",
            level="attention" if owed else "info",
            text=(f"{len(anchored)} phase anchors recorded on Hedera; "
                  f"{len(owed) - failed} pending, {failed} failed (retry owed)."),
            evidence_ids=[p.phase_event_id for p in owed],
        ))
    observations.extend(
        Observation(
            code="anchors.receipt_integrity", level="attention",
            text=(f"Stored payload for receipt {record.hedera_tx_id or record.receipt_id} no longer "
                  "hashes to the value anchored on Hedera."),
            evidence_ids=[record.receipt_id],
        )
        for record in manifest.anchored_records
        if not record.payload_matches_hash
    )
    for phase in manifest.phases:
        mismatched = [f.name for f in phase.anchored_fields if not f.matches_anchor]
        if mismatched:
            observations.append(Observation(
                code="anchors.field_mismatch", level="attention",
                text=(f"{_phase_label(phase)}: current value of {', '.join(mismatched)} "
                      "differs from the value anchored on Hedera."),
                evidence_ids=[phase.phase_event_id],
            ))
    return observations


def _observe_seals(phases: Sequence[PhaseRecord]) -> list[Observation]:
    """Pair every unloading with the departure before it — a multi-stop trip has one
    seal per leg, so a trip-wide single comparison would be wrong."""
    ordered = sorted(phases, key=lambda p: p.sequence_number)
    observations: list[Observation] = []
    departure: PhaseRecord | None = None
    for phase in ordered:
        if phase.phase_type == "departure":
            departure = phase
            continue
        if phase.phase_type != "unloading" or phase.status in _UNFINISHED_STATUSES:
            continue
        applied = _normalized_seal(departure.seal_number if departure else None)
        found = _normalized_seal(phase.seal_number)
        ids = [p.phase_event_id for p in (departure, phase) if p is not None]
        if not applied or not found:
            observations.append(Observation(
                code="seal.continuity", level="attention",
                text=(f"Seal continuity at {_phase_label(phase)} cannot be verified: "
                      f"departure seal {applied or 'not recorded'}, "
                      f"destination seal {found or 'not recorded'}."),
                evidence_ids=ids,
            ))
        elif applied == found:
            observations.append(Observation(
                code="seal.continuity", level="info",
                text=(f"Seal {applied} applied at departure matched at {_phase_label(phase)}. "
                      "The destination reading is recorded, not anchored."),
                evidence_ids=ids,
            ))
        else:
            observations.append(Observation(
                code="seal.continuity", level="attention",
                text=f"Seal applied at departure was {applied}; seal found at {_phase_label(phase)} was {found}.",
                evidence_ids=ids,
            ))
    return observations


def _sum_known(values: Iterable[int | None]) -> int | None:
    known = [v for v in values if v is not None]
    return sum(known) if known else None


def _observe_counts(phases: Sequence[PhaseRecord]) -> list[Observation]:
    loaded = _sum_known(p.parcel_count_origin for p in phases if p.phase_type == "loading")
    confirmations = [p for p in phases if p.phase_type == "confirmation"]
    received = _sum_known(p.parcel_count_destination for p in confirmations)
    seen = _sum_known(p.driver_visual_count for p in confirmations)
    if loaded is None or received is None:
        return []
    matched = loaded == received and (seen is None or seen == received)
    seen_text = f", driver counted {seen}" if seen is not None else ""
    return [Observation(
        code="counts.reconciliation",
        level="info" if matched else "attention",
        text=f"Parcels scanned out {loaded}; scanned in {received}{seen_text}.",
        evidence_ids=[p.phase_event_id for p in phases if p.phase_type in ("loading", "confirmation")],
    )]


def _observe_location_agreement(phases: Sequence[PhaseRecord]) -> list[Observation]:
    assessed = [(p, p.location_assessment) for p in phases if p.location_assessment is not None]
    if not assessed:
        return []
    verdicts = [assessment.proximity for _, assessment in assessed]
    within = verdicts.count("within_limit")
    separated = [p for p, assessment in assessed if assessment.proximity == "separated"]
    unverified = verdicts.count("unverified")
    return [Observation(
        code="location.agreement",
        level="attention" if separated else "info",
        text=(f"Driver phone and vehicle tracker agreed at {within} of {len(assessed)} "
              f"assessed handshakes; {len(separated)} separated, {unverified} could not be checked."),
        evidence_ids=[p.phase_event_id for p in separated],
    )]


def _observe_location_coverage(manifest: AuditPackManifest) -> list[Observation]:
    coverage = manifest.location_coverage
    observations = [
        Observation(
            code="location.gap", level="attention",
            text=(f"No position recorded between {format_sast(gap.start)} and "
                  f"{format_sast(gap.end)} ({gap.minutes} min)."),
            evidence_ids=[],
        )
        for gap in coverage.gaps
    ]
    observations.extend(
        Observation(
            code="location.stationary", level="attention",
            text=(f"Stationary for {period.minutes} min outside any route precinct, "
                  f"{format_sast(period.start)} to {format_sast(period.end)} "
                  f"near {period.lat:.4f}, {period.lng:.4f}."),
            evidence_ids=[],
        )
        for period in coverage.stationary_periods
    )
    return observations


def _observe_exception(exception: ExceptionRecord) -> Observation | None:
    label = exception.exception_type.replace("_", " ")
    if exception.review_status == _REVIEWED and exception.reviewed_at is not None:
        minutes = _whole_minutes(exception.reviewed_at - exception.raised_at)
        method = f" by {exception.contact_method}" if exception.contact_method else ""
        outcome = exception.review_outcome.replace("_", " ") if exception.review_outcome else "no outcome"
        return Observation(
            code="exceptions.response", level="info",
            text=(f"{label.capitalize()} raised {format_sast(exception.raised_at)} was reviewed "
                  f"{minutes} min later{method}; outcome: {outcome}."),
            evidence_ids=[exception.exception_id],
        )
    if exception.severity == _CRITICAL:
        return Observation(
            code="exceptions.unreviewed", level="attention",
            text=f"Critical {label} raised {format_sast(exception.raised_at)} has no recorded review.",
            evidence_ids=[exception.exception_id],
        )
    return None


def _observe_exceptions(exceptions: Sequence[ExceptionRecord]) -> list[Observation]:
    observations = [o for o in (_observe_exception(e) for e in exceptions) if o is not None]
    critical = [e for e in exceptions if e.severity == _CRITICAL]
    if exceptions:
        observations.insert(0, Observation(
            code="exceptions.summary",
            level="attention" if critical else "info",
            text=f"{len(exceptions)} exceptions recorded, {len(critical)} critical.",
            evidence_ids=[e.exception_id for e in critical],
        ))
    return observations


def _observe_people_and_records(manifest: AuditPackManifest) -> list[Observation]:
    driver = manifest.driver
    observations = [Observation(
        code="identity.driver",
        level="info" if driver.trip_idvs_status == "verified" else "attention",
        text=f"Driver identity check for this trip: {driver.trip_idvs_status}.",
        evidence_ids=[],
    )]
    observations.extend(
        Observation(
            code="identity.substitution", level="attention",
            text=(f"Driver changed from {s.original_driver_name} to {s.substituting_driver_name} "
                  f"at {s.exchange_location}, {format_sast(s.substitution_at)} "
                  f"({'planned' if s.is_planned else 'unplanned'})."),
            evidence_ids=[s.substitution_id],
        )
        for s in driver.substitutions
    )
    observations.extend(
        Observation(
            code="records.changed_during_trip", level="attention",
            text=(f"{change.subject.capitalize()} record changed during the trip "
                  f"({', '.join(change.changed_fields) or change.event_type}) at {format_sast(change.changed_at)}."),
            evidence_ids=[change.subject_id],
        )
        for change in manifest.record_changes
    )
    return observations


def _after(instant: datetime, reference: datetime) -> str:
    minutes = _whole_minutes(instant - reference)
    if minutes < 0:
        return f"{-minutes} min before"
    hours, rest = divmod(minutes, 60)
    return f"{hours} h {rest} min after" if hours else f"{rest} min after"


def _observe_notifications(manifest: AuditPackManifest) -> list[Observation]:
    """Police and notification facts, which only the operator can supply. Every sentence
    says 'Declared' so no reader mistakes them for something FreightProof captured."""
    incident = manifest.incident
    if incident is None:
        return []
    ids = [d.declaration_id for d in manifest.declarations]
    if not manifest.declarations:
        return [Observation(
            code="notifications.undeclared", level="attention",
            text=("No police report or notification times have been declared for this incident; "
                  "a claim will need the SAPS station and case number."),
            evidence_ids=list(incident.exception_ids),
        )]

    facts = manifest.latest_declared_facts()
    start = incident.first_raised_at
    observations: list[Observation] = []
    reported = facts.get("reported_to_saps_at")
    if reported is not None or facts.get("saps_cas_number"):
        case = facts.get("saps_cas_number") or "no case number declared"
        station = facts.get("saps_station") or "station not declared"
        when = f"{_after(reported, start)} the first critical event" if reported is not None else "time not declared"
        observations.append(Observation(
            code="notifications.saps", level="info",
            text=f"Declared: reported to SAPS {when} ({station}, CAS {case}).",
            evidence_ids=ids,
        ))
    client = facts.get("client_notified_at")
    if client is not None:
        late = client - start > CLIENT_NOTIFICATION_WINDOW
        observations.append(Observation(
            code="notifications.client", level="attention" if late else "info",
            text=(f"Declared: client notified {_after(client, start)} the first critical event"
                  + ("; later than the 24 hours TAPA TSR 9.3.1 expects." if late else ".")),
            evidence_ids=ids,
        ))
    for field, who in (("insurer_notified_at", "insurer"), ("tracking_company_notified_at", "tracking company")):
        told = facts.get(field)
        if told is not None:
            observations.append(Observation(
                code=f"notifications.{field.split('_')[0]}", level="info",
                text=f"Declared: {who} notified {_after(told, start)} the first critical event.",
                evidence_ids=ids,
            ))
    return observations


def derive_observations(manifest: AuditPackManifest) -> list[Observation]:
    """Every rule, in the order the pack prints them: custody first, because an
    adjuster's first question is whether the chain is whole."""
    return [
        *_observe_custody(manifest),
        *_observe_anchors(manifest),
        *_observe_seals(manifest.phases),
        *_observe_counts(manifest.phases),
        *_observe_location_agreement(manifest.phases),
        *_observe_location_coverage(manifest),
        *_observe_exceptions(manifest.exceptions),
        *_observe_notifications(manifest),
        *_observe_people_and_records(manifest),
    ]
