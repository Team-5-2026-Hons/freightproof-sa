"""Row-Level Security policies for all public tables.

Architecture note: FastAPI connects via service_role, which bypasses RLS
entirely. These policies are defence-in-depth — they block the Supabase
PostgREST Data API (anon/authenticated roles) from touching any table
directly, and make the evidence chain immutable for all non-service_role
callers. Real access control lives in FastAPI + the orchestration layer.

Role model (set in Supabase Auth app_metadata at account creation):
  dispatcher    — Load Factor dispatcher; sees all trips for their org
  driver        — assigned driver; sees only their own trips
  client_viewer — client org (e.g. FedEx); read-only on their trips

Helper functions (private schema — invisible to PostgREST):
  private.my_role()   — reads app_metadata.role from the current JWT
  private.my_org_id() — reads app_metadata.org_id from the current JWT

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-13
Author: tom
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------ #
    # Private schema + helper functions                                    #
    # ------------------------------------------------------------------ #
    op.execute("CREATE SCHEMA IF NOT EXISTS private;")

    op.execute("""
        CREATE OR REPLACE FUNCTION private.my_role()
        RETURNS text LANGUAGE sql STABLE
        AS $$ SELECT auth.jwt() -> 'app_metadata' ->> 'role' $$;
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION private.my_org_id()
        RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid $$;
    """)

    # ------------------------------------------------------------------ #
    # Enable RLS on every table                                            #
    # ------------------------------------------------------------------ #
    for table in [
        "organizations",
        "precincts",
        "users",
        "drivers",
        "vehicles",
        "trip_templates",
        "trips",
        "trip_trailers",
        "consignments",
        "parcels",
        "handshake_events",
        "trailer_gps_snapshots",
        "checkpoints",
        "exceptions",
        "evidence_artifacts",
        "blockchain_receipts",
        "merkle_batches",
        "merkle_batch_leaves",
        "driver_substitutions",
        "sla_configs",
    ]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")

    # No SELECT policies for anon/authenticated means PostgREST gets zero
    # rows from every table. service_role bypasses this — FastAPI unaffected.

    # ------------------------------------------------------------------ #
    # Reference / configuration tables — SELECT by authenticated role      #
    # ------------------------------------------------------------------ #

    # Each role sees only their own organisation.
    op.execute("""
        CREATE POLICY organizations_select ON organizations
        FOR SELECT TO authenticated
        USING (id = private.my_org_id());
    """)

    # Precincts belong to a principal org; dispatchers and drivers see those
    # precincts when their org matches.
    op.execute("""
        CREATE POLICY precincts_select ON precincts
        FOR SELECT TO authenticated
        USING (principal_organization_id = private.my_org_id());
    """)

    # Dispatchers see all colleagues in their org; every user sees their own row.
    op.execute("""
        CREATE POLICY users_select ON users
        FOR SELECT TO authenticated
        USING (
            (organization_id = private.my_org_id() AND private.my_role() = 'dispatcher')
            OR id = auth.uid()
        );
    """)

    # Dispatchers see all drivers in their org; a driver sees their own row.
    op.execute("""
        CREATE POLICY drivers_select ON drivers
        FOR SELECT TO authenticated
        USING (
            (organization_id = private.my_org_id() AND private.my_role() = 'dispatcher')
            OR id = auth.uid()
        );
    """)

    # Vehicles are fleet assets scoped to an org.
    op.execute("""
        CREATE POLICY vehicles_select ON vehicles
        FOR SELECT TO authenticated
        USING (organization_id = private.my_org_id());
    """)

    # SLA configs: dispatchers only, visible if their org is operator or client.
    op.execute("""
        CREATE POLICY sla_configs_select ON sla_configs
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND (
                operator_organization_id = private.my_org_id()
                OR client_organization_id = private.my_org_id()
            )
        );
    """)

    # Trip templates: dispatchers only.
    op.execute("""
        CREATE POLICY trip_templates_select ON trip_templates
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND (
                operator_organization_id = private.my_org_id()
                OR client_organization_id = private.my_org_id()
            )
        );
    """)

    # ------------------------------------------------------------------ #
    # Trips — three roles, different scopes                                #
    # ------------------------------------------------------------------ #

    op.execute("""
        CREATE POLICY trips_dispatcher_select ON trips
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND (
                operator_organization_id = private.my_org_id()
                OR client_organization_id = private.my_org_id()
            )
        );
    """)

    op.execute("""
        CREATE POLICY trips_driver_select ON trips
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'driver'
            AND driver_id = auth.uid()
        );
    """)

    op.execute("""
        CREATE POLICY trips_client_viewer_select ON trips
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'client_viewer'
            AND client_organization_id = private.my_org_id()
        );
    """)

    # ------------------------------------------------------------------ #
    # Trip child tables — access scoped via trip_id JOIN                   #
    # ------------------------------------------------------------------ #

    # consignments
    op.execute("""
        CREATE POLICY consignments_dispatcher_select ON consignments
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)
    op.execute("""
        CREATE POLICY consignments_driver_select ON consignments
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'driver'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id AND t.driver_id = auth.uid()
            )
        );
    """)
    op.execute("""
        CREATE POLICY consignments_client_viewer_select ON consignments
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'client_viewer'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND t.client_organization_id = private.my_org_id()
            )
        );
    """)

    # parcels (via consignment → trip)
    op.execute("""
        CREATE POLICY parcels_dispatcher_select ON parcels
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM consignments c
                JOIN trips t ON t.id = c.trip_id
                WHERE c.id = consignment_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)
    op.execute("""
        CREATE POLICY parcels_driver_select ON parcels
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'driver'
            AND EXISTS (
                SELECT 1 FROM consignments c
                JOIN trips t ON t.id = c.trip_id
                WHERE c.id = consignment_id AND t.driver_id = auth.uid()
            )
        );
    """)
    op.execute("""
        CREATE POLICY parcels_client_viewer_select ON parcels
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'client_viewer'
            AND EXISTS (
                SELECT 1 FROM consignments c
                JOIN trips t ON t.id = c.trip_id
                WHERE c.id = consignment_id
                AND t.client_organization_id = private.my_org_id()
            )
        );
    """)

    # handshake_events
    op.execute("""
        CREATE POLICY handshake_events_dispatcher_select ON handshake_events
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)
    op.execute("""
        CREATE POLICY handshake_events_driver_select ON handshake_events
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'driver'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id AND t.driver_id = auth.uid()
            )
        );
    """)
    op.execute("""
        CREATE POLICY handshake_events_client_viewer_select ON handshake_events
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'client_viewer'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND t.client_organization_id = private.my_org_id()
            )
        );
    """)

    # evidence_artifacts
    op.execute("""
        CREATE POLICY evidence_artifacts_dispatcher_select ON evidence_artifacts
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)
    op.execute("""
        CREATE POLICY evidence_artifacts_driver_select ON evidence_artifacts
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'driver'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id AND t.driver_id = auth.uid()
            )
        );
    """)
    op.execute("""
        CREATE POLICY evidence_artifacts_client_viewer_select ON evidence_artifacts
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'client_viewer'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND t.client_organization_id = private.my_org_id()
            )
        );
    """)

    # checkpoints — dispatcher + driver (client portal doesn't need GPS logs)
    op.execute("""
        CREATE POLICY checkpoints_dispatcher_select ON checkpoints
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)
    op.execute("""
        CREATE POLICY checkpoints_driver_select ON checkpoints
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'driver'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id AND t.driver_id = auth.uid()
            )
        );
    """)

    # exceptions — dispatcher + client_viewer (clients need disputed delivery evidence)
    op.execute("""
        CREATE POLICY exceptions_dispatcher_select ON exceptions
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)
    op.execute("""
        CREATE POLICY exceptions_client_viewer_select ON exceptions
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'client_viewer'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND t.client_organization_id = private.my_org_id()
            )
        );
    """)

    # blockchain_receipts + merkle_batches — dispatcher + client_viewer (audit trail)
    op.execute("""
        CREATE POLICY blockchain_receipts_select ON blockchain_receipts
        FOR SELECT TO authenticated
        USING (
            private.my_role() IN ('dispatcher', 'client_viewer')
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)
    op.execute("""
        CREATE POLICY merkle_batches_select ON merkle_batches
        FOR SELECT TO authenticated
        USING (
            private.my_role() IN ('dispatcher', 'client_viewer')
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)

    # merkle_batch_leaves — dispatcher only (forensic depth, not needed by clients)
    op.execute("""
        CREATE POLICY merkle_batch_leaves_dispatcher_select ON merkle_batch_leaves
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM merkle_batches mb
                JOIN trips t ON t.id = mb.trip_id
                WHERE mb.id = batch_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)

    # trip_trailers — dispatcher + driver
    op.execute("""
        CREATE POLICY trip_trailers_dispatcher_select ON trip_trailers
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)
    op.execute("""
        CREATE POLICY trip_trailers_driver_select ON trip_trailers
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'driver'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id AND t.driver_id = auth.uid()
            )
        );
    """)

    # trailer_gps_snapshots — dispatcher only (forensic GPS data)
    op.execute("""
        CREATE POLICY trailer_gps_snapshots_dispatcher_select ON trailer_gps_snapshots
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM handshake_events he
                JOIN trips t ON t.id = he.trip_id
                WHERE he.id = handshake_event_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)

    # driver_substitutions — dispatcher only (audit log)
    op.execute("""
        CREATE POLICY driver_substitutions_dispatcher_select ON driver_substitutions
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM trips t WHERE t.id = trip_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)

    # ------------------------------------------------------------------ #
    # Immutability guards — evidence chain tables                          #
    # USING (false) blocks UPDATE + DELETE for all non-service_role callers.
    # service_role bypasses RLS — FastAPI writes are unaffected.
    # ------------------------------------------------------------------ #

    for table in [
        "evidence_artifacts",
        "blockchain_receipts",
        "merkle_batch_leaves",
        "checkpoints",
        "trailer_gps_snapshots",
        "driver_substitutions",
    ]:
        op.execute(
            f"CREATE POLICY no_update_{table} ON {table} "
            f"FOR UPDATE TO PUBLIC USING (false);"
        )
        op.execute(
            f"CREATE POLICY no_delete_{table} ON {table} "
            f"FOR DELETE TO PUBLIC USING (false);"
        )


def downgrade() -> None:
    # Drop all policies — order mirrors upgrade in reverse.

    for table in [
        "evidence_artifacts",
        "blockchain_receipts",
        "merkle_batch_leaves",
        "checkpoints",
        "trailer_gps_snapshots",
        "driver_substitutions",
    ]:
        op.execute(f"DROP POLICY IF EXISTS no_update_{table} ON {table};")
        op.execute(f"DROP POLICY IF EXISTS no_delete_{table} ON {table};")

    named_policies = [
        ("driver_substitutions", "driver_substitutions_dispatcher_select"),
        ("trailer_gps_snapshots", "trailer_gps_snapshots_dispatcher_select"),
        ("trip_trailers", "trip_trailers_driver_select"),
        ("trip_trailers", "trip_trailers_dispatcher_select"),
        ("merkle_batch_leaves", "merkle_batch_leaves_dispatcher_select"),
        ("merkle_batches", "merkle_batches_select"),
        ("blockchain_receipts", "blockchain_receipts_select"),
        ("exceptions", "exceptions_client_viewer_select"),
        ("exceptions", "exceptions_dispatcher_select"),
        ("checkpoints", "checkpoints_driver_select"),
        ("checkpoints", "checkpoints_dispatcher_select"),
        ("evidence_artifacts", "evidence_artifacts_client_viewer_select"),
        ("evidence_artifacts", "evidence_artifacts_driver_select"),
        ("evidence_artifacts", "evidence_artifacts_dispatcher_select"),
        ("handshake_events", "handshake_events_client_viewer_select"),
        ("handshake_events", "handshake_events_driver_select"),
        ("handshake_events", "handshake_events_dispatcher_select"),
        ("parcels", "parcels_client_viewer_select"),
        ("parcels", "parcels_driver_select"),
        ("parcels", "parcels_dispatcher_select"),
        ("consignments", "consignments_client_viewer_select"),
        ("consignments", "consignments_driver_select"),
        ("consignments", "consignments_dispatcher_select"),
        ("trips", "trips_client_viewer_select"),
        ("trips", "trips_driver_select"),
        ("trips", "trips_dispatcher_select"),
        ("trip_templates", "trip_templates_select"),
        ("sla_configs", "sla_configs_select"),
        ("vehicles", "vehicles_select"),
        ("drivers", "drivers_select"),
        ("users", "users_select"),
        ("precincts", "precincts_select"),
        ("organizations", "organizations_select"),
    ]
    for table, policy in named_policies:
        op.execute(f"DROP POLICY IF EXISTS {policy} ON {table};")

    for table in [
        "organizations", "precincts", "users", "drivers", "vehicles",
        "trip_templates", "trips", "trip_trailers", "consignments", "parcels",
        "handshake_events", "trailer_gps_snapshots", "checkpoints", "exceptions",
        "evidence_artifacts", "blockchain_receipts", "merkle_batches",
        "merkle_batch_leaves", "driver_substitutions", "sla_configs",
    ]:
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

    op.execute("DROP FUNCTION IF EXISTS private.my_org_id();")
    op.execute("DROP FUNCTION IF EXISTS private.my_role();")
    # Leave private schema — other future functions may live there.
