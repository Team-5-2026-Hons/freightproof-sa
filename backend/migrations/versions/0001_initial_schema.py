"""Initial schema: all 19 FreightProof SA tables.

Revision ID: 0001
Revises:
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------ #
    # 1. organizations                                                      #
    # ------------------------------------------------------------------ #
    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("org_type", sa.String(50), nullable=False),
        sa.Column("contact_email", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------ #
    # 2. precincts, users, drivers, vehicles                               #
    # ------------------------------------------------------------------ #
    op.create_table(
        "precincts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("principal_organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("latitude", sa.Numeric(10, 7), nullable=False),
        sa.Column("longitude", sa.Numeric(10, 7), nullable=False),
        sa.Column("geofence_radius_metres", sa.Integer(), server_default="200", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["principal_organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )

    op.create_table(
        "drivers",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("id_number", sa.String(13), nullable=False),
        sa.Column("phone_number", sa.String(20), nullable=False),
        sa.Column("license_number", sa.String(50), nullable=False),
        sa.Column("idvs_status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("idvs_last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "vehicles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registration", sa.String(50), nullable=False),
        sa.Column("vehicle_type", sa.String(20), nullable=False),
        sa.Column("pulsit_device_id", sa.String(100), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "pulsit_device_id", name="uq_vehicles_org_pulsit"),
    )

    # ------------------------------------------------------------------ #
    # 3. trip_templates                                                     #
    # ------------------------------------------------------------------ #
    op.create_table(
        "trip_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("operator_organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("default_origin_precinct_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("default_destination_precinct_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["client_organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["default_destination_precinct_id"], ["precincts.id"]),
        sa.ForeignKeyConstraint(["default_origin_precinct_id"], ["precincts.id"]),
        sa.ForeignKeyConstraint(["operator_organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------ #
    # 4. evidence_artifacts — trip_id added via ALTER in step 13           #
    # ------------------------------------------------------------------ #
    op.create_table(
        "evidence_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("artifact_type", sa.String(20), nullable=False),
        sa.Column("s3_key", sa.String(500), nullable=False),
        sa.Column("s3_bucket", sa.String(255), nullable=False),
        sa.Column("file_hash", sa.String(64), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("captured_by_driver_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("captured_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("captured_lat", sa.Numeric(10, 7), nullable=True),
        sa.Column("captured_lng", sa.Numeric(10, 7), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["captured_by_driver_id"], ["drivers.id"]),
        sa.ForeignKeyConstraint(["captured_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------ #
    # 5. blockchain_receipts — trip_id added via ALTER in step 13          #
    # ------------------------------------------------------------------ #
    op.create_table(
        "blockchain_receipts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("receipt_type", sa.String(30), nullable=False),
        sa.Column("data_hash", sa.String(64), nullable=False),
        sa.Column("hedera_topic_id", sa.String(100), nullable=True),
        sa.Column("hedera_tx_id", sa.String(200), nullable=True),
        sa.Column("hedera_sequence_number", sa.BigInteger(), nullable=True),
        sa.Column("hedera_consensus_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------ #
    # 6. merkle_batches — trip_id added via ALTER in step 13               #
    # ------------------------------------------------------------------ #
    op.create_table(
        "merkle_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("batch_type", sa.String(20), nullable=False),
        sa.Column("merkle_root", sa.String(64), nullable=True),
        sa.Column("leaf_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("blockchain_receipt_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["blockchain_receipt_id"], ["blockchain_receipts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------ #
    # 7. trips                                                              #
    # ------------------------------------------------------------------ #
    op.create_table(
        "trips",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_reference", sa.String(50), nullable=False),
        sa.Column("order_number", sa.String(100), nullable=False),
        sa.Column("operator_organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("driver_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("horse_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("origin_precinct_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("destination_precinct_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pulsit_trip_reference_id", sa.String(100), nullable=True),
        sa.Column("template_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(30), server_default="created", nullable=False),
        sa.Column("journey_lock_hash", sa.String(64), nullable=True),
        sa.Column("idvs_check_status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("idvs_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("planned_departure_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("planned_arrival_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_departure_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_arrival_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["client_organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["destination_precinct_id"], ["precincts.id"]),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"]),
        sa.ForeignKeyConstraint(["horse_id"], ["vehicles.id"]),
        sa.ForeignKeyConstraint(["operator_organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["origin_precinct_id"], ["precincts.id"]),
        sa.ForeignKeyConstraint(["template_id"], ["trip_templates.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trip_reference"),
    )

    # ------------------------------------------------------------------ #
    # 8. trip_trailers, consignments, parcels                              #
    # ------------------------------------------------------------------ #
    op.create_table(
        "trip_trailers",
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trailer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pulsit_device_id_snapshot", sa.String(100), nullable=False),
        sa.ForeignKeyConstraint(["trailer_id"], ["vehicles.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"]),
        sa.PrimaryKeyConstraint("trip_id", "trailer_id"),
    )

    op.create_table(
        "consignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("parcel_perfect_reference", sa.String(100), nullable=False),
        sa.Column("client_organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("origin_precinct_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("destination_precinct_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("declared_value", sa.Numeric(15, 2), nullable=True),
        sa.Column("parcel_count_expected", sa.Integer(), nullable=True),
        sa.Column("slot_time_origin", sa.DateTime(timezone=True), nullable=True),
        sa.Column("slot_time_destination", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pp_raw_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["client_organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["destination_precinct_id"], ["precincts.id"]),
        sa.ForeignKeyConstraint(["origin_precinct_id"], ["precincts.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "parcels",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("consignment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("barcode", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("delivery_stop", sa.String(100), nullable=True),
        sa.Column("pp_scan_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pp_scan_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["consignment_id"], ["consignments.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------ #
    # 9. handshake_events — deferred artifact/receipt FKs added in step 13 #
    # ------------------------------------------------------------------ #
    op.create_table(
        "handshake_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("handshake_type", sa.String(30), nullable=False),
        sa.Column("sequence_number", sa.SmallInteger(), nullable=False),
        sa.Column("status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("dispatcher_override_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("dispatcher_override_note", sa.Text(), nullable=True),
        sa.Column("driver_phone_lat", sa.Numeric(10, 7), nullable=True),
        sa.Column("driver_phone_lng", sa.Numeric(10, 7), nullable=True),
        sa.Column("horse_gps_lat", sa.Numeric(10, 7), nullable=True),
        sa.Column("horse_gps_lng", sa.Numeric(10, 7), nullable=True),
        sa.Column("pulsit_geofence_confirmed", sa.Boolean(), nullable=True),
        sa.Column("seal_number", sa.String(100), nullable=True),
        sa.Column("seal_photo_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("waybill_photo_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("gate_photo_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("pod_photo_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("parcel_manifest_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("parcel_count_origin", sa.Integer(), nullable=True),
        sa.Column("parcel_count_destination", sa.Integer(), nullable=True),
        sa.Column("driver_visual_count", sa.Integer(), nullable=True),
        sa.Column("event_hash", sa.String(64), nullable=True),
        sa.Column("blockchain_receipt_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["dispatcher_override_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trip_id", "handshake_type", name="uq_handshake_events_trip_type"),
    )

    # ------------------------------------------------------------------ #
    # 10. merkle_batch_leaves                                               #
    # ------------------------------------------------------------------ #
    op.create_table(
        "merkle_batch_leaves",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("leaf_index", sa.Integer(), nullable=False),
        sa.Column("leaf_hash", sa.String(64), nullable=False),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["merkle_batches.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_id", "leaf_index", name="uq_merkle_batch_leaves_batch_index"),
    )

    # ------------------------------------------------------------------ #
    # 11. checkpoints, exceptions, trailer_gps_snapshots                   #
    # ------------------------------------------------------------------ #
    op.create_table(
        "checkpoints",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("checkpoint_type", sa.String(50), nullable=False),
        sa.Column("driver_phone_lat", sa.Numeric(10, 7), nullable=True),
        sa.Column("driver_phone_lng", sa.Numeric(10, 7), nullable=True),
        sa.Column("horse_gps_lat", sa.Numeric(10, 7), nullable=True),
        sa.Column("horse_gps_lng", sa.Numeric(10, 7), nullable=True),
        sa.Column("selfie_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("cargo_photo_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("is_deviation", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("merkle_batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["cargo_photo_artifact_id"], ["evidence_artifacts.id"]),
        sa.ForeignKeyConstraint(["merkle_batch_id"], ["merkle_batches.id"]),
        sa.ForeignKeyConstraint(["selfie_artifact_id"], ["evidence_artifacts.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "exceptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("handshake_event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("checkpoint_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("exception_type", sa.String(50), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("supporting_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("resolved_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolver_note", sa.Text(), nullable=True),
        sa.Column("merkle_batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["checkpoint_id"], ["checkpoints.id"]),
        sa.ForeignKeyConstraint(["handshake_event_id"], ["handshake_events.id"]),
        sa.ForeignKeyConstraint(["merkle_batch_id"], ["merkle_batches.id"]),
        sa.ForeignKeyConstraint(["resolved_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["supporting_artifact_id"], ["evidence_artifacts.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "trailer_gps_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("handshake_event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trailer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pulsit_device_id", sa.String(100), nullable=False),
        sa.Column("lat", sa.Numeric(10, 7), nullable=False),
        sa.Column("lng", sa.Numeric(10, 7), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["handshake_event_id"], ["handshake_events.id"]),
        sa.ForeignKeyConstraint(["trailer_id"], ["vehicles.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------ #
    # 12. sla_configs                                                       #
    # ------------------------------------------------------------------ #
    op.create_table(
        "sla_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("operator_organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("origin_precinct_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("destination_precinct_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("max_pickup_overrun_minutes", sa.Integer(), nullable=True),
        sa.Column("max_delivery_overrun_minutes", sa.Integer(), nullable=True),
        sa.Column("max_checkpoint_interval_minutes", sa.Integer(), server_default="15", nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["client_organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["destination_precinct_id"], ["precincts.id"]),
        sa.ForeignKeyConstraint(["operator_organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["origin_precinct_id"], ["precincts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------ #
    # 13. ALTER TABLE — add deferred FKs (use_alter=True in models)        #
    # ------------------------------------------------------------------ #
    op.add_column("evidence_artifacts", sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False))
    op.create_foreign_key(
        "fk_evidence_artifacts_trip_id", "evidence_artifacts", "trips", ["trip_id"], ["id"]
    )

    op.add_column("blockchain_receipts", sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False))
    op.create_foreign_key(
        "fk_blockchain_receipts_trip_id", "blockchain_receipts", "trips", ["trip_id"], ["id"]
    )

    op.add_column("merkle_batches", sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False))
    op.create_foreign_key(
        "fk_merkle_batches_trip_id", "merkle_batches", "trips", ["trip_id"], ["id"]
    )

    op.create_foreign_key(
        "fk_handshake_seal_photo", "handshake_events", "evidence_artifacts",
        ["seal_photo_artifact_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_handshake_waybill_photo", "handshake_events", "evidence_artifacts",
        ["waybill_photo_artifact_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_handshake_gate_photo", "handshake_events", "evidence_artifacts",
        ["gate_photo_artifact_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_handshake_pod_photo", "handshake_events", "evidence_artifacts",
        ["pod_photo_artifact_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_handshake_blockchain_receipt", "handshake_events", "blockchain_receipts",
        ["blockchain_receipt_id"], ["id"],
    )

    # ------------------------------------------------------------------ #
    # 14. Indexes                                                           #
    # ------------------------------------------------------------------ #
    op.create_index("ix_trips_driver_id", "trips", ["driver_id"])
    op.create_index("ix_trips_status", "trips", ["status"])
    op.create_index("ix_trips_order_number", "trips", ["order_number"])
    op.create_index("ix_trips_created_at_desc", "trips", [sa.text("created_at DESC")])
    op.create_index("ix_handshake_events_trip_sequence", "handshake_events", ["trip_id", "sequence_number"])
    op.create_index("ix_exceptions_trip_resolved", "exceptions", ["trip_id", "resolved"])
    op.create_index("ix_exceptions_severity", "exceptions", ["severity"])
    op.create_index("ix_checkpoints_trip_created", "checkpoints", ["trip_id", "created_at"])
    op.create_index("ix_parcels_consignment_id", "parcels", ["consignment_id"])
    op.create_index("ix_parcels_barcode", "parcels", ["barcode"])
    op.create_index("ix_blockchain_receipts_trip_type", "blockchain_receipts", ["trip_id", "receipt_type"])
    op.create_index("ix_blockchain_receipts_hedera_tx", "blockchain_receipts", ["hedera_tx_id"])

    # ------------------------------------------------------------------ #
    # 15. updated_at trigger function + per-table triggers                 #
    # ------------------------------------------------------------------ #
    op.execute("""
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)

    for _table in [
        "users", "drivers", "consignments", "parcels", "trips",
        "handshake_events", "exceptions", "blockchain_receipts", "merkle_batches",
    ]:
        op.execute(f"""
        CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON {_table}
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        """)


def downgrade() -> None:
    # Drop triggers first
    for _table in [
        "merkle_batches", "blockchain_receipts", "exceptions", "handshake_events",
        "trips", "parcels", "consignments", "drivers", "users",
    ]:
        op.execute(f"DROP TRIGGER IF EXISTS set_updated_at ON {_table};")

    # Drop indexes
    for _idx in [
        "ix_blockchain_receipts_hedera_tx", "ix_blockchain_receipts_trip_type",
        "ix_parcels_barcode", "ix_parcels_consignment_id",
        "ix_checkpoints_trip_created", "ix_exceptions_severity",
        "ix_exceptions_trip_resolved", "ix_handshake_events_trip_sequence",
        "ix_trips_created_at_desc", "ix_trips_order_number",
        "ix_trips_status", "ix_trips_driver_id",
    ]:
        op.drop_index(_idx)

    # Drop deferred FK constraints before dropping columns
    op.drop_constraint("fk_handshake_blockchain_receipt", "handshake_events", type_="foreignkey")
    op.drop_constraint("fk_handshake_pod_photo", "handshake_events", type_="foreignkey")
    op.drop_constraint("fk_handshake_gate_photo", "handshake_events", type_="foreignkey")
    op.drop_constraint("fk_handshake_waybill_photo", "handshake_events", type_="foreignkey")
    op.drop_constraint("fk_handshake_seal_photo", "handshake_events", type_="foreignkey")

    op.drop_constraint("fk_merkle_batches_trip_id", "merkle_batches", type_="foreignkey")
    op.drop_column("merkle_batches", "trip_id")

    op.drop_constraint("fk_blockchain_receipts_trip_id", "blockchain_receipts", type_="foreignkey")
    op.drop_column("blockchain_receipts", "trip_id")

    op.drop_constraint("fk_evidence_artifacts_trip_id", "evidence_artifacts", type_="foreignkey")
    op.drop_column("evidence_artifacts", "trip_id")

    # Drop tables in strict reverse creation order
    op.drop_table("sla_configs")
    op.drop_table("trailer_gps_snapshots")
    op.drop_table("exceptions")
    op.drop_table("checkpoints")
    op.drop_table("merkle_batch_leaves")
    op.drop_table("handshake_events")
    op.drop_table("parcels")
    op.drop_table("consignments")
    op.drop_table("trip_trailers")
    op.drop_table("trips")
    op.drop_table("merkle_batches")
    op.drop_table("blockchain_receipts")
    op.drop_table("evidence_artifacts")
    op.drop_table("trip_templates")
    op.drop_table("vehicles")
    op.drop_table("drivers")
    op.drop_table("users")
    op.drop_table("precincts")
    op.drop_table("organizations")

    op.execute("DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE")
