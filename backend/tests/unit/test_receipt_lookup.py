"""Unit coverage for receipt lookup validation and service filtering."""

import uuid
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError
from sqlalchemy import Table
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import lookup_receipts
from app.db.models.blockchain import (
    BLOCKCHAIN_RECEIPT_DATA_HASH_INDEX,
    BLOCKCHAIN_RECEIPT_HEDERA_TX_INDEX,
    BlockchainReceipt,
)
from app.db.models.enums import BlockchainReceiptType, SubjectType
from app.schemas.blockchain import BlockchainReceiptLookupQuery

_HASH = "a1" * 32
_TX_ID = "transaction id with deliberately unrestricted syntax !@#$%"


def _receipt(subject_id: uuid.UUID) -> BlockchainReceipt:
    return BlockchainReceipt(
        id=uuid.uuid4(),
        subject_type=SubjectType.VEHICLE,
        subject_id=subject_id,
        receipt_type=BlockchainReceiptType.VEHICLE_UPDATED,
        data_hash=_HASH,
        payload_json={"field": "value"},
    )


def _db_returning(receipts: list[BlockchainReceipt]) -> AsyncMock:
    scalar_result = MagicMock()
    scalar_result.all.return_value = receipts
    result = MagicMock()
    result.scalars.return_value = scalar_result
    db = AsyncMock(spec=AsyncSession)
    db.execute.return_value = result
    return db


def test_lookup_query_trims_and_normalizes_hash() -> None:
    query = BlockchainReceiptLookupQuery(data_hash=f"  {_HASH.upper()}  ")

    assert query.data_hash == _HASH
    assert query.hedera_tx_id is None


def test_lookup_query_trims_tx_without_imposing_extra_syntax() -> None:
    query = BlockchainReceiptLookupQuery(hedera_tx_id=f"  {_TX_ID}  ")

    assert query.hedera_tx_id == _TX_ID


def test_lookup_query_applies_tx_limit_after_trimming() -> None:
    tx_id = "x" * 200

    query = BlockchainReceiptLookupQuery(hedera_tx_id=f" {tx_id} ")

    assert query.hedera_tx_id == tx_id


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"data_hash": _HASH, "hedera_tx_id": _TX_ID},
        {"data_hash": "not-a-sha256-hash"},
        {"hedera_tx_id": "   "},
        {"hedera_tx_id": "x" * 201},
    ],
)
def test_lookup_query_rejects_invalid_lookup_values(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        BlockchainReceiptLookupQuery.model_validate(payload)


@pytest.mark.asyncio
async def test_lookup_receipts_uses_hash_and_subject_filters() -> None:
    organization_id = uuid.uuid4()
    subject_id = uuid.uuid4()
    receipt = _receipt(subject_id)
    db = _db_returning([receipt])

    receipts = await lookup_receipts(
        db,
        organization_id=organization_id,
        data_hash=_HASH,
        subject_id=subject_id,
    )

    assert receipts == [receipt]
    db.execute.assert_awaited_once()
    statement = db.execute.await_args.args[0]
    sql = str(statement)
    assert "blockchain_receipts.data_hash = :data_hash_1" in sql
    assert "blockchain_receipts.subject_id = :subject_id_1" in sql
    assert "blockchain_receipts.payload_json" not in sql
    assert (
        "ORDER BY blockchain_receipts.created_at DESC, blockchain_receipts.id DESC"
        in sql
    )


@pytest.mark.asyncio
async def test_lookup_receipts_scopes_all_subject_types_in_sql() -> None:
    organization_id = uuid.uuid4()
    db = _db_returning([])

    await lookup_receipts(
        db,
        organization_id=organization_id,
        data_hash=_HASH,
    )

    statement = db.execute.await_args.args[0]
    sql = str(statement)
    assert sql.count("EXISTS (SELECT") == len(SubjectType)
    assert sql.count("= blockchain_receipts.subject_id") == len(SubjectType)
    params = statement.compile().params
    assert all(subject_type in params.values() for subject_type in SubjectType)
    assert all(
        value == organization_id
        for key, value in params.items()
        if "organization_id" in key
    )


@pytest.mark.parametrize("data_hash,tx_id", [(None, None), (_HASH, _TX_ID)])
async def test_lookup_rejects_ambiguous_criteria_without_querying(
    data_hash: str | None,
    tx_id: str | None,
) -> None:
    db = _db_returning([])

    with pytest.raises(ValueError, match="exactly one"):
        await lookup_receipts(
            db,
            organization_id=uuid.uuid4(),
            data_hash=data_hash,
            hedera_tx_id=tx_id,
        )

    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_lookup_receipts_uses_exact_tx_filter_without_subject_filter() -> None:
    db = _db_returning([])

    receipts = await lookup_receipts(
        db,
        organization_id=uuid.uuid4(),
        hedera_tx_id=_TX_ID,
    )

    assert receipts == []
    statement = db.execute.await_args.args[0]
    where_clause = str(statement).split("WHERE", maxsplit=1)[1]
    assert "blockchain_receipts.hedera_tx_id = :hedera_tx_id_1" in where_clause
    assert "blockchain_receipts.subject_id = :subject_id_1" not in where_clause


def test_receipt_lookup_indexes_match_migration_names() -> None:
    table = cast(Table, BlockchainReceipt.__table__)
    index_names = {index.name for index in table.indexes}

    assert BLOCKCHAIN_RECEIPT_DATA_HASH_INDEX in index_names
    assert BLOCKCHAIN_RECEIPT_HEDERA_TX_INDEX in index_names
