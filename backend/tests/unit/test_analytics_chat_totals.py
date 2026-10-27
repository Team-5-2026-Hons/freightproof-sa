"""The server-worked totals at the top of each chat tool's result (totals.py, spec B37): each
total must equal the sum of the rows it summarises, and each rate must follow the page's rule."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.orchestration.analytics_chat.totals import (
    activity_totals,
    cost_totals,
    evidence_totals,
    on_time_totals,
    problems_totals,
    patterns_totals,
    review_totals,
    right_now_totals,
    routes_totals,
    top,
)
from app.schemas.cost_analytics import CostResponse
from app.schemas.fleet_analytics import (
    ActivityResponse,
    EvidenceResponse,
    FleetTilesResponse,
    OnTimeResponse,
    PatternsResponse,
    ProblemsResponse,
    ReviewResponse,
    RoutesResponse,
)

_PERIOD = {"start": "2026-08-03", "end": "2026-10-20", "grain": "week"}
_WEEK_A, _WEEK_B = date(2026, 9, 28).isoformat(), date(2026, 10, 12).isoformat()


def _theft(start: str, total: int, by_type: dict[str, int]) -> dict[str, Any]:
    return {"bucket_start": start, "is_partial": False, "total_count": total, "by_type": by_type}


def _problems(per_trip: list[dict[str, Any]], theft: list[dict[str, Any]] | None = None) -> ProblemsResponse:
    return ProblemsResponse.model_validate({
        "period": _PERIOD, "per_trip": per_trip, "theft_signals": theft or [],
        "by_type": [], "by_step": [], "risky_times": [],
    })


def _week(start: str, trips: int, info: int, warning: int, critical: int) -> dict[str, Any]:
    return {"bucket_start": start, "is_partial": False, "trip_count": trips,
            "info_count": info, "warning_count": warning, "critical_count": critical}


def test_problems_totals_count_every_severity_the_20_oct_case() -> None:
    response = _problems([_week(_WEEK_A, 1, 0, 16, 0), _week(_WEEK_B, 1, 0, 17, 1)])

    totals = problems_totals(response)

    assert totals["problems"] == 34
    assert (totals["warning"], totals["critical"], totals["info"], totals["closed_trips"]) == (33, 1, 0, 2)
    assert totals["warning_per_100_trips"] == 1650.0
    assert totals["critical_per_100_trips"] == 50.0


def test_problems_totals_equal_the_sum_of_their_rows() -> None:
    rows = [_week(_WEEK_A, 3, 2, 5, 1), _week(_WEEK_B, 4, 1, 7, 2), _week("2026-10-19", 0, 0, 0, 0)]
    theft = [_theft(_WEEK_A, 1, {"seal_mismatch": 1, "panic_button": 0}), _theft(_WEEK_B, 2, {"seal_mismatch": 1, "panic_button": 1})]

    totals = problems_totals(_problems(rows, theft))

    assert totals["closed_trips"] == sum(r["trip_count"] for r in rows)
    assert totals["problems"] == sum(r["info_count"] + r["warning_count"] + r["critical_count"] for r in rows)
    assert totals["theft_signals"] == 3
    assert totals["theft_signals_by_type"] == {"seal_mismatch": 2, "panic_button": 1}


def test_problems_rates_are_none_without_trips() -> None:
    totals = problems_totals(_problems([_week(_WEEK_A, 0, 0, 0, 0)]))

    assert (totals["warning_per_100_trips"], totals["critical_per_100_trips"]) == (None, None)


def test_activity_totals_sum_trips_and_cancellations() -> None:
    response = ActivityResponse.model_validate({
        "period": _PERIOD,
        "trips": [
            {"bucket_start": _WEEK_A, "is_partial": False, "loaded_count": 2, "empty_count": 1},
            {"bucket_start": _WEEK_B, "is_partial": False, "loaded_count": 1, "empty_count": 0},
        ],
        "cancellations": [
            {"bucket_start": _WEEK_A, "is_partial": False, "cancelled_count": 0, "ended_count": 1},
            {"bucket_start": _WEEK_B, "is_partial": False, "cancelled_count": 4, "ended_count": 6},
        ],
        "cancelled_trips": [],
    })

    totals = activity_totals(response)

    assert (totals["closed_trips"], totals["loaded_trips"], totals["empty_trips"]) == (4, 3, 1)
    assert (totals["cancelled_trips"], totals["trips_ended"]) == (4, 7)
    assert totals["cancelled_percent"] == 57.1


def _punctuality(start: str, deps: int, on_deps: int, arrs: int, on_arrs: int) -> dict[str, Any]:
    return {"bucket_start": start, "is_partial": False, "departures_with_plan": deps, "on_time_departures": on_deps,
            "arrivals_with_plan": arrs, "on_time_arrivals": on_arrs}


def _on_time(punctuality: list[dict[str, Any]]) -> OnTimeResponse:
    return OnTimeResponse.model_validate({
        "period": _PERIOD, "punctuality": punctuality, "lateness": {"departures": [], "arrivals": []},
        "plan_spread": {"bands": [], "early_count": 0, "over_count": 0, "on_plan_count": 0,
                        "median_early_minutes": None, "median_over_minutes": None},
    })


def test_on_time_totals_pool_the_buckets_before_dividing() -> None:
    totals = on_time_totals(_on_time([_punctuality(_WEEK_A, 1, 0, 1, 1), _punctuality(_WEEK_B, 3, 1, 3, 0)]))

    assert (totals["arrivals_with_plan"], totals["on_time_arrivals"]) == (4, 1)
    assert totals["on_time_arrival_percent"] == 25.0
    assert totals["on_time_departure_percent"] == 25.0


def test_on_time_rates_are_none_without_plans() -> None:
    totals = on_time_totals(_on_time([_punctuality(_WEEK_A, 0, 0, 0, 0)]))

    assert (totals["on_time_departure_percent"], totals["on_time_arrival_percent"]) == (None, None)


def test_evidence_agreement_leaves_unwitnessed_out_like_the_page() -> None:
    response = EvidenceResponse.model_validate({
        "period": _PERIOD,
        "tracker": [
            {"bucket_start": _WEEK_A, "is_partial": False, "confirmed_count": 3, "mismatch_count": 1, "unwitnessed_count": 5},
            {"bucket_start": _WEEK_B, "is_partial": False, "confirmed_count": 0, "mismatch_count": 0, "unwitnessed_count": 2},
        ],
        "overrides": [{"bucket_start": _WEEK_A, "is_partial": False, "phase_count": 10, "override_count": 2}],
        "receiver_signoff": [{"bucket_start": _WEEK_A, "is_partial": False, "confirmation_count": 0, "receiver_scan_count": 0}],
        "signoff_flags": {"same_phone_count": 0, "rejected_attempt_count": 0},
    })

    totals = evidence_totals(response)

    assert (totals["tracker_confirmed"], totals["tracker_mismatch"], totals["tracker_unwitnessed"]) == (3, 1, 7)
    assert totals["tracker_agreement_percent"] == 75.0
    assert totals["override_percent"] == 20.0
    assert totals["receiver_scan_percent"] is None


def test_review_totals_sum_waiting_reviewed_and_outcomes() -> None:
    response = ReviewResponse.model_validate({
        "period": _PERIOD,
        "waiting_by_age": [{"band": "under_1h", "count": 0}, {"band": "over_3d", "count": 1}],
        "queue": [],
        "time_to_review": [
            {"bucket_start": _WEEK_A, "is_partial": False, "reviewed_count": 2, "median_hours": 3.0, "mean_hours": 4.0},
            {"bucket_start": _WEEK_B, "is_partial": False, "reviewed_count": 1, "median_hours": 1.0, "mean_hours": 1.0},
        ],
        "outcomes": [{"outcome": "no_action_required", "count": 2}, {"outcome": "evidence_verified", "count": 1}],
    })

    totals = review_totals(response)

    assert totals == {"critical_waiting_now": 1, "critical_reviewed_in_period": 3, "reviews_concluded_in_period": 3}


def test_routes_totals_sum_lanes_and_sites() -> None:
    lane = {"origin_precinct_id": "a2f10a52-8e4c-47bc-b60a-8e881fe57cbb", "origin_name": "Cape Town Depot (Epping)",
            "destination_precinct_id": "20eed781-8446-4ba3-9c29-507587265725", "destination_name": "Johannesburg Depot (Linbro)",
            "driving_minutes": {"sample_count": 0, "mean": None, "minimum": None, "maximum": None, "median": None, "p90": None}}
    response = RoutesResponse.model_validate({
        "period": {**_PERIOD, "grain": None},
        "sites": [
            {"precinct_id": lane["origin_precinct_id"], "precinct_name": "Cape Town Depot (Epping)", "pickup_count": 3, "delivery_count": 0},
            {"precinct_id": lane["destination_precinct_id"], "precinct_name": "Johannesburg Depot (Linbro)", "pickup_count": 0, "delivery_count": 3},
        ],
        "lanes": [{**lane, "trip_count": 3, "problem_count": 34}],
    })

    totals = routes_totals(response)

    assert {key: totals[key] for key in ("lanes", "trips_on_lanes", "problems_on_lanes", "sites", "pickups", "deliveries")} == {
        "lanes": 1, "trips_on_lanes": 3, "problems_on_lanes": 34, "sites": 2, "pickups": 3, "deliveries": 3,
    }




def test_top_lists_every_tie() -> None:
    assert top([("11:00", 0.05), ("12:00", 0.05), ("19:00", 0.05), ("08:00", 0.0)]) == {"value": 0.05, "of": ["11:00", "12:00", "19:00"]}


def test_top_is_none_when_nothing_happened() -> None:
    assert top([("a", 0), ("b", 0)]) is None
    assert top([]) is None
    assert top([("a", None)]) is None


def test_top_lowest_counts_zero_but_skips_no_data() -> None:
    assert top([("week 1", 0.0), ("week 2", None), ("week 3", 0.5)], lowest=True) == {"value": 0.0, "of": ["week 1"]}


def _pattern_set(hour_counts: dict[int, int], days: int) -> dict[str, Any]:
    def bars(keys: range, counts: dict[int, int]) -> list[dict[str, int]]:
        return [{"key": key, "event_count": counts.get(key, 0), "day_count": days} for key in keys]
    return {"hour_of_day": bars(range(24), hour_counts), "weekday": bars(range(7), {}),
            "day_of_month": bars(range(1, 32), {}), "month_of_year": bars(range(1, 13), {})}


def test_patterns_busiest_hour_is_the_three_way_tie_the_page_shows() -> None:
    response = PatternsResponse.model_validate({
        "period": {**_PERIOD, "grain": None},
        "departures": _pattern_set({11: 1, 12: 1, 19: 1}, 21),
        "arrivals": _pattern_set({}, 21),
    })

    totals = patterns_totals(response)

    assert totals["departures"]["total"] == 3  # type: ignore[index]
    assert totals["departures"]["busiest_hour"] == {"value": 1 / 21, "of": ["11:00–12:00", "12:00–13:00", "19:00–20:00"]}  # type: ignore[index]
    assert totals["arrivals"]["busiest_hour"] is None  # type: ignore[index]


def test_problems_leaders_step_type_across_sources_and_time_of_day() -> None:
    response = ProblemsResponse.model_validate({
        "period": _PERIOD,
        "per_trip": [_week(_WEEK_A, 1, 0, 16, 0), _week(_WEEK_B, 1, 0, 17, 1)],
        "theft_signals": [],
        "by_type": [
            {"exception_type": "gps_mismatch", "source": "system", "count": 6},
            {"exception_type": "mechanical", "source": "driver", "count": 4},
            {"exception_type": "mechanical", "source": "system", "count": 3},
        ],
        "by_step": [{"step": "arrival", "count": 7}, {"step": "unloading", "count": 6}, {"step": "loading", "count": 4}],
        "risky_times": [
            {"block": "night", "driving_minutes": 0, "driving_share": 0, "road_problem_count": 0, "road_problem_share": 0},
            {"block": "evening", "driving_minutes": 1, "driving_share": 1, "road_problem_count": 2, "road_problem_share": 1},
        ],
    })

    totals = problems_totals(response)

    assert totals["most_problems_in"] == {"value": 18, "of": [_WEEK_B]}
    assert totals["most_common_type"] == {"value": 7, "of": ["mechanical"]}
    assert totals["step_with_most_problems"] == {"value": 7, "of": ["arrival"]}
    assert totals["riskiest_time_of_day"] == {"value": 2, "of": ["evening"]}


def test_on_time_lowest_and_highest_skip_weeks_with_no_plan() -> None:
    totals = on_time_totals(_on_time([
        _punctuality(_WEEK_A, 1, 0, 1, 1), _punctuality(_WEEK_B, 1, 0, 1, 0), _punctuality("2026-10-19", 0, 0, 0, 0),
    ]))

    assert totals["lowest_on_time_arrival_percent_in"] == {"value": 0.0, "of": [_WEEK_B]}
    assert totals["highest_on_time_arrival_percent_in"] == {"value": 100.0, "of": [_WEEK_A]}


def test_routes_lane_leaders_by_problems_and_per_trip() -> None:
    def lane(origin: str, destination: str, trips: int, problems: int) -> dict[str, Any]:
        return {"origin_precinct_id": "a2f10a52-8e4c-47bc-b60a-8e881fe57cbb", "origin_name": origin,
                "destination_precinct_id": "20eed781-8446-4ba3-9c29-507587265725", "destination_name": destination,
                "trip_count": trips, "problem_count": problems,
                "driving_minutes": {"sample_count": 0, "mean": None, "minimum": None, "maximum": None, "median": None, "p90": None}}
    response = RoutesResponse.model_validate({
        "period": {**_PERIOD, "grain": None}, "sites": [],
        "lanes": [lane("Cape Town", "Johannesburg", 10, 5), lane("Durban", "Johannesburg", 2, 8)],
    })

    totals = routes_totals(response)

    assert totals["lane_with_most_problems"] == {"value": 8, "of": ["Durban → Johannesburg"]}
    assert totals["lane_with_most_problems_per_trip"] == {"value": 4.0, "of": ["Durban → Johannesburg"]}
    assert totals["busiest_site"] is None


def test_evidence_lowest_agreement_skips_unchecked_weeks() -> None:
    response = EvidenceResponse.model_validate({
        "period": _PERIOD,
        "tracker": [
            {"bucket_start": _WEEK_A, "is_partial": False, "confirmed_count": 1, "mismatch_count": 1, "unwitnessed_count": 0},
            {"bucket_start": _WEEK_B, "is_partial": True, "confirmed_count": 0, "mismatch_count": 0, "unwitnessed_count": 3},
        ],
        "overrides": [], "receiver_signoff": [], "signoff_flags": {"same_phone_count": 0, "rejected_attempt_count": 0},
    })

    assert evidence_totals(response)["lowest_tracker_agreement_percent_in"] == {"value": 50.0, "of": [_WEEK_A]}


def _cost(buckets: list[dict[str, Any]]) -> CostResponse:
    rates = {"diesel_price_per_litre": 33.29, "litres_per_100km": 53, "fuel_per_km": 17.64, "running_cost_per_km": 15.1,
             "driver_cost_per_hour": 155, "delay_cost_per_hour": 1100, "fixed_cost_per_trip": 0, "road_factor": 1.15,
             "is_default": True, "updated_at": None, "updated_by_name": None}
    return CostResponse.model_validate({
        "period": _PERIOD, "rates": rates,
        "operating": {"fuel": 0, "running": 0, "driver": 0, "fixed": 0, "total": 0, "trips_costed": 0, "trips_not_costed": 0,
                      "distance_km": 0, "legs_routed": 0, "legs_estimated": 0},
        "delay": {"cost": 0, "late_hours": 0, "problem_trips": 0, "late_problem_trips": 0, "lateness_unknown": 0},
        "exposure": {"under_review": 0, "reviewed": 0, "total": 0, "trips": 0, "consignments_without_value": 0, "trips_without_consignments": 0},
        "buckets": buckets, "lanes": [],
    })


def test_cost_leaders_add_the_parts_of_each_week() -> None:
    def week(start: str, fuel: float, delay: float, partial: bool = False) -> dict[str, Any]:
        return {"start": start, "is_partial": partial, "fuel": fuel, "running": 10.0, "driver": 5.0, "fixed": 0.0,
                "delay_cost": delay, "value_under_review": 0.0, "value_reviewed": 0.0}

    totals = cost_totals(_cost([week(_WEEK_A, 100.1, 0.0), week(_WEEK_B, 50.2, 305780.5, partial=True)]))

    assert totals["costliest_in"] == {"value": 115.1, "of": [_WEEK_A]}
    assert totals["highest_delay_cost_in"] == {"value": 305780.5, "of": [f"{_WEEK_B} (partial)"]}
    assert totals["most_value_exposed_in"] is None
    assert totals["costliest_lane"] is None


def _tiles(oldest: datetime | None) -> FleetTilesResponse:
    bands = {"expired": 0, "within_30_days": 0, "within_90_days": 0, "within_180_days": 0, "no_date": 0}
    return FleetTilesResponse.model_validate({
        "live_trips": 4, "critical_waiting": {"count": 0 if oldest is None else 1, "oldest_created_at": oldest},
        "licence_expiry": {"drivers": bands, "vehicle_discs": bands}, "unused_vehicles": {"window_days": 30, "vehicles": []},
        "all_time_start": "2026-09-29",
    })


def test_right_now_age_is_ready_to_say_in_days_and_hours() -> None:
    oldest = datetime(2026, 10, 14, 17, 59, tzinfo=UTC)
    now = oldest + timedelta(days=5, hours=17, minutes=16)

    totals = right_now_totals(_tiles(oldest), now)

    assert totals["oldest_critical_waiting"] == {
        "since": oldest.isoformat(), "days": 5, "hours": 17, "as_words": "5 days 17 hours", "total_hours": 137,
    }


def test_right_now_age_says_one_day_and_one_hour_in_the_singular() -> None:
    oldest = datetime(2026, 10, 14, 17, 59, tzinfo=UTC)

    totals = right_now_totals(_tiles(oldest), oldest + timedelta(days=1, hours=1, minutes=5))

    assert totals["oldest_critical_waiting"]["as_words"] == "1 day 1 hour"  # type: ignore[index]


def test_right_now_age_is_none_when_nothing_waits() -> None:
    assert right_now_totals(_tiles(None), datetime(2026, 10, 20, tzinfo=UTC)) == {"oldest_critical_waiting": None}
