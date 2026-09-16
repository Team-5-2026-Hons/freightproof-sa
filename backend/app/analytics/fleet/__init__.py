"""Fleet-wide analytics for the dispatcher Analytics page.

Spec: docs/design-notes/2026-09-15-fleet-analytics-page-spec.md. Live, read-only queries over
the base tables: no views, no migration (spec D7). One module per endpoint, all built on
the shared builders in base.py and the pure arithmetic in periods.py.

Layering: imports analytics/, db/, core/ and schemas/ only. Never orchestration/ or api/:
facts that live in orchestration (which phases carry a blockchain receipt) are passed in
by app/orchestration/fleet_analytics_service.py.

Deliberately imports nothing, for the same circular-import reason as app/analytics/__init__.py.
"""
