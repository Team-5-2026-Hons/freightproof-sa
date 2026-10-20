"""Exercise the hand migration in a private schema on the disposable test database.

This proves its additive operations, not the separately required PG17 full-chain upgrade.
"""
import importlib
import uuid
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


async def test_additive_v2_migration_preserves_legacy_values_and_refuses_lossy_downgrade(db_session):
    schema = f'transfer_migration_{uuid.uuid4().hex}'
    await db_session.execute(sa.text(f'CREATE SCHEMA {schema}'))
    await db_session.execute(sa.text(f'SET LOCAL search_path TO {schema}, public'))
    await db_session.execute(sa.text('''CREATE TABLE driver_substitution_requests (
        id uuid PRIMARY KEY, exchange_label varchar(255) NOT NULL, exchange_latitude numeric(10,7) NOT NULL,
        exchange_longitude numeric(10,7) NOT NULL, exchange_instructions text NOT NULL DEFAULT '',
        expected_at timestamptz NOT NULL, is_planned boolean NOT NULL, historical jsonb NOT NULL)'''))
    await db_session.execute(sa.text('''CREATE TABLE driver_substitutions (
        id uuid PRIMARY KEY, exchange_location varchar(255) NOT NULL, is_planned boolean NOT NULL,
        historical jsonb NOT NULL)'''))
    await db_session.execute(sa.text('''CREATE TABLE driver_substitution_confirmations (id uuid PRIMARY KEY, historical jsonb NOT NULL)'''))
    record_id = uuid.uuid4()
    moment = datetime.now(UTC)
    await db_session.execute(sa.text('''INSERT INTO driver_substitution_requests VALUES
        (:id, 'Original depot', -30, 25, 'Original instructions', :moment, true, '{"hash":"old","operation":{"body":"unchanged"}}')'''), {'id': record_id, 'moment': moment})
    await db_session.execute(sa.text('''INSERT INTO driver_substitutions VALUES (:id, 'Original depot', true, '{"hash":"frozen","receipt":"owed-v1"}')'''), {'id': record_id})
    await db_session.execute(sa.text('''INSERT INTO driver_substitution_confirmations VALUES (:id, '{"role":"outgoing","body":"original-offline-body"}')'''), {'id': record_id})
    tables = ('driver_substitution_requests', 'driver_substitutions', 'driver_substitution_confirmations')
    before = {table: dict((await db_session.execute(sa.text(f'SELECT * FROM {table}'))).mappings().one()) for table in tables}
    migration = importlib.import_module('migrations.versions.2026_10_20_ciaran_driver_transfer_v2')

    def invoke(connection, action):
        with Operations.context(MigrationContext.configure(connection)):
            action()

    connection = await db_session.connection()
    await connection.run_sync(invoke, migration.upgrade)

    for table in tables:
        after = (await db_session.execute(sa.text(f'SELECT * FROM {table}'))).mappings().one()
        assert {key: after[key] for key in before[table]} == before[table]
    row = (await db_session.execute(sa.text('SELECT * FROM driver_substitution_requests'))).mappings().one()
    assert row['request_format'] == 'planned_v1' and row['reservation_start_at'] is None
    await db_session.execute(sa.text('''UPDATE driver_substitution_requests SET request_format='immediate_v2',
        reservation_start_at=:moment, exchange_label=NULL, exchange_latitude=NULL, exchange_longitude=NULL,
        exchange_instructions=NULL, expected_at=NULL, is_planned=NULL'''), {'moment': moment})
    with pytest.raises(RuntimeError, match='Cannot downgrade'):
        await connection.run_sync(invoke, migration.downgrade)
    assert (await db_session.execute(sa.text('SELECT request_format FROM driver_substitution_requests'))).scalar_one() == 'immediate_v2'
