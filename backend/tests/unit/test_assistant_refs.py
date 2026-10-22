"""Short record tags for one conversation (assistant spec §4): the model never sees a database id."""

import uuid

from app.orchestration.assistant.refs import RefBook
from app.schemas.assistant import RecordRef


def _record(kind: str, label: str) -> RecordRef:
    return RecordRef.model_validate({"kind": kind, "id": uuid.uuid4(), "label": label})


def test_tag_numbers_each_kind_separately_and_reuses_a_tag() -> None:
    book = RefBook()
    tim, sipho, truck = _record("driver", "Tim Giltig"), _record("driver", "Sipho"), _record("vehicle", "CA 1")

    tags = [book.tag(tim), book.tag(sipho), book.tag(truck), book.tag(tim)]

    assert tags == ["d1", "d2", "v1", "d1"]
    assert book.records() == [tim, sipho, truck]


def test_lookup_needs_the_right_kind_and_ignores_case() -> None:
    book = RefBook()
    tim = _record("driver", "Tim Giltig")
    book.tag(tim)

    assert book.lookup(" D1 ", "driver") == tim.id
    assert book.lookup("d1", "vehicle") is None
    assert book.lookup("d9", "driver") is None
