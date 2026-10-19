"""Pure custody derivation (FP-83 C1): who holds a trip, derived from completed links only.

No database. The DB helpers in orchestration/substitutions/access.py must agree with
derive_custody; that agreement is asserted in tests/integration/test_driver_substitution_models.py.
"""

import random
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.orchestration.substitutions.access import (
    CompletedCustodyLink,
    CurrentCustody,
    CustodyChainError,
    derive_custody,
)

_T0 = datetime(2026, 10, 19, 8, 0, tzinfo=UTC)


def _chain(
    drivers: list[uuid.UUID], *, same_instant: bool = False,
) -> list[CompletedCustodyLink]:
    """Links for drivers[0] -> drivers[1] -> ..., sequence 1..n, each pointing at the last."""
    links: list[CompletedCustodyLink] = []
    for index in range(1, len(drivers)):
        links.append(CompletedCustodyLink(
            id=uuid.uuid4(),
            sequence_number=index,
            previous_substitution_id=links[-1].id if links else None,
            outgoing_driver_id=drivers[index - 1],
            incoming_driver_id=drivers[index],
            effective_at=_T0 if same_instant else _T0 + timedelta(hours=index),
        ))
    return links


def test_no_amendments_resolves_the_original_driver_at_sequence_zero() -> None:
    original = uuid.uuid4()

    result = derive_custody(original, [])

    assert result == CurrentCustody(driver_id=original, sequence=0, substitution_id=None)


def test_one_substitution_resolves_the_incoming_driver() -> None:
    original, incoming = uuid.uuid4(), uuid.uuid4()
    (link,) = _chain([original, incoming])

    result = derive_custody(original, [link])

    assert (result.driver_id, result.sequence, result.substitution_id) == (incoming, 1, link.id)


def test_returning_driver_has_a_new_custody_sequence() -> None:
    original_driver_id, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    links = _chain([original_driver_id, b, c, original_driver_id])
    third_link = links[2]

    result = derive_custody(original_driver_id, links)

    assert result.driver_id == original_driver_id
    assert result.sequence == 3
    assert result.substitution_id == third_link.id


def test_input_order_does_not_change_the_result() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    links = _chain([a, b, c, a])
    shuffled = random.Random(7).sample(links, k=len(links))

    assert derive_custody(a, shuffled) == derive_custody(a, links)


def test_timestamp_ties_cannot_change_sequence_order() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    links = _chain([a, b, c], same_instant=True)

    forward = derive_custody(a, links)
    backward = derive_custody(a, list(reversed(links)))

    assert forward == backward
    assert (forward.driver_id, forward.sequence, forward.substitution_id) == (c, 2, links[1].id)


def test_contradictory_timestamps_do_not_reorder_custody() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    first, second = _chain([a, b, c])
    # The later handover claims an earlier instant; sequence, not time, is the order.
    second = CompletedCustodyLink(
        id=second.id, sequence_number=second.sequence_number,
        previous_substitution_id=second.previous_substitution_id,
        outgoing_driver_id=second.outgoing_driver_id, incoming_driver_id=second.incoming_driver_id,
        effective_at=first.effective_at - timedelta(days=1),
    )

    result = derive_custody(a, [first, second])

    assert (result.driver_id, result.sequence, result.substitution_id) == (c, 2, second.id)


def test_broken_previous_link_raises_rather_than_repairing() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    first, second = _chain([a, b, c])
    second = CompletedCustodyLink(
        id=second.id, sequence_number=2, previous_substitution_id=uuid.uuid4(),
        outgoing_driver_id=b, incoming_driver_id=c, effective_at=second.effective_at,
    )

    with pytest.raises(CustodyChainError, match="previous"):
        derive_custody(a, [first, second])


def test_first_link_that_names_a_previous_link_raises() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    (link,) = _chain([a, b])
    orphaned = CompletedCustodyLink(
        id=link.id, sequence_number=1, previous_substitution_id=uuid.uuid4(),
        outgoing_driver_id=a, incoming_driver_id=b, effective_at=link.effective_at,
    )

    with pytest.raises(CustodyChainError, match="previous"):
        derive_custody(a, [orphaned])


def test_outgoing_driver_who_does_not_continue_the_chain_raises() -> None:
    a, b, c, stranger = (uuid.uuid4() for _ in range(4))
    first, second = _chain([a, b, c])
    second = CompletedCustodyLink(
        id=second.id, sequence_number=2, previous_substitution_id=first.id,
        outgoing_driver_id=stranger, incoming_driver_id=c, effective_at=second.effective_at,
    )

    with pytest.raises(CustodyChainError, match="outgoing"):
        derive_custody(a, [first, second])


def test_first_outgoing_driver_must_be_the_trips_original_driver() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    links = _chain([a, b])

    with pytest.raises(CustodyChainError, match="outgoing"):
        derive_custody(uuid.uuid4(), links)


@pytest.mark.parametrize("numbers", [[2], [1, 3], [1, 1], [0]])
def test_sequence_numbers_that_are_not_one_to_n_raise(numbers: list[int]) -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    links = [
        CompletedCustodyLink(
            id=uuid.uuid4(), sequence_number=number, previous_substitution_id=None,
            outgoing_driver_id=a, incoming_driver_id=b, effective_at=_T0,
        )
        for number in numbers
    ]

    with pytest.raises(CustodyChainError, match="sequence"):
        derive_custody(a, links)
