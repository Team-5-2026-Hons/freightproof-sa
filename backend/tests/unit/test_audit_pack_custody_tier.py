"""WI-07: the audit pack's substitution tier follows the anchor's status, and a driver row that
cannot be found renders as "Unknown driver" instead of raising.

Pure over `substitution_records`, which takes the rows and a drivers map directly.

Legacy rule, from migrations/versions/2026_10_19_ciaran_driver_substitutions.py: that migration
added `driver_substitutions.anchor_status` as a NULLABLE column and backfilled nothing, while
`blockchain_receipt_id` pre-dates it. So a NULL status on a row WITH a linked receipt is a
genuinely anchored legacy row and keeps "anchored"; a NULL status with no receipt was never anchored.
"""

import uuid
from datetime import UTC, datetime

import pytest

from app.db.models.enums import AnchorStatus
from app.db.models.people import Driver
from app.db.models.trips import DriverSubstitution
from app.orchestration.audit_packs.custody import CustodyFacts, substitution_records

_AT = datetime(2026, 10, 1, 8, 0, tzinfo=UTC)


def _driver(name: str) -> Driver:
    return Driver(id=uuid.uuid4(), full_name=name)


def _row(
    original: Driver, incoming: Driver, *, anchor_status: str | None, receipt_id: uuid.UUID | None,
) -> DriverSubstitution:
    return DriverSubstitution(
        id=uuid.uuid4(), trip_id=uuid.uuid4(), sequence_number=1,
        original_driver_id=original.id, substituting_driver_id=incoming.id,
        substitution_at=_AT, anchor_status=anchor_status, blockchain_receipt_id=receipt_id,
    )


def _tier(anchor_status: str | None, *, with_receipt: bool) -> str:
    out, inc = _driver("Out"), _driver("In")
    row = _row(out, inc, anchor_status=anchor_status, receipt_id=uuid.uuid4() if with_receipt else None)
    [record] = substitution_records([row], CustodyFacts(), {out.id: out, inc.id: inc})
    return record.tier


def test_an_anchored_substitution_with_its_receipt_is_anchored() -> None:
    assert _tier(AnchorStatus.ANCHORED.value, with_receipt=True) == "anchored"


@pytest.mark.parametrize("status", [AnchorStatus.PENDING.value, AnchorStatus.FAILED.value])
def test_a_linked_receipt_does_not_make_an_unanchored_substitution_anchored(status: str) -> None:
    assert _tier(status, with_receipt=True) == "recorded"


@pytest.mark.parametrize("status", [AnchorStatus.PENDING.value, AnchorStatus.FAILED.value, None])
def test_a_substitution_with_no_receipt_is_recorded(status: str | None) -> None:
    assert _tier(status, with_receipt=False) == "recorded"


def test_a_legacy_substitution_with_no_status_but_a_receipt_stays_anchored() -> None:
    assert _tier(None, with_receipt=True) == "anchored"


def test_a_missing_driver_row_renders_unknown_driver_instead_of_raising() -> None:
    out, inc = _driver("Out"), _driver("In")
    row = _row(out, inc, anchor_status=AnchorStatus.PENDING.value, receipt_id=None)

    [record] = substitution_records([row], CustodyFacts(), {})

    assert record.original_driver_name == "Unknown driver"
    assert record.substituting_driver_name == "Unknown driver"


def test_a_present_driver_keeps_their_name_when_the_other_is_missing() -> None:
    out, inc = _driver("Out"), _driver("In")
    row = _row(out, inc, anchor_status=AnchorStatus.PENDING.value, receipt_id=None)

    [record] = substitution_records([row], CustodyFacts(), {out.id: out})

    assert record.original_driver_name == "Out"
    assert record.substituting_driver_name == "Unknown driver"
