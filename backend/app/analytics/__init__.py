"""FP-153 analytics read layer — query functions over the analytics materialized views.

One module per grain (driver_metrics, vehicle_metrics, lane_metrics, facility_metrics).
Each takes an organisation and an inclusive month range, sums the raw monthly
ingredients across that range, and derives every rate or percentile exactly once.

Deliberately imports nothing: app.schemas.analytics imports app.analytics.stats, and an
eager import of the grain modules here would turn that into a circular import.
"""
