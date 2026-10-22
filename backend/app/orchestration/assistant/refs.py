"""Short tags for the records one conversation has shown (assistant spec §4).

The model never sees a database id. Each record a tool returns gets a tag ("d1" for the first driver,
"t2" for the second trip), and the model passes a tag back to mean exactly that record: "him" and "the
first horse" become `driver_ref: "d1"` and `vehicle_ref: "v1"`, never a new name search that could
land on the other Tim. Tags are short, so the model copies them without slips, and they mean nothing
outside the request that issued them.

A RefBook lives for one request. The service seeds it from the refs the browser sends back with the
conversation; tools add to it as they return records. A tag the book doesn't know is not found; and
every id read from the book is re-loaded scoped to the caller's organisation by the resolver, so a
forged ref can't reach another organisation's records.

Pure: no database, no I/O.
"""

import uuid
from dataclasses import dataclass, field

from app.orchestration.assistant.resolve import EntityKind
from app.schemas.assistant import RecordRef

_PREFIX: dict[EntityKind, str] = {"driver": "d", "vehicle": "v", "trip": "t", "precinct": "p"}


@dataclass
class RefBook:
    _tags: dict[uuid.UUID, str] = field(default_factory=dict)
    _records: dict[str, RecordRef] = field(default_factory=dict)
    _counts: dict[EntityKind, int] = field(default_factory=dict)

    def tag(self, record: RecordRef) -> str:
        """The record's tag, issuing the next one for its kind if it has none yet."""
        existing = self._tags.get(record.id)
        if existing is not None:
            return existing
        count = self._counts.get(record.kind, 0) + 1
        self._counts[record.kind] = count
        tag = f"{_PREFIX[record.kind]}{count}"
        self._tags[record.id] = tag
        self._records[tag] = record
        return tag

    def lookup(self, tag: str, kind: EntityKind) -> uuid.UUID | None:
        """The id behind `tag`, or None if the tag is unknown or names another kind of record."""
        record = self._records.get(tag.strip().lower())
        return record.id if record is not None and record.kind == kind else None

    def records(self) -> list[RecordRef]:
        """Every record tagged so far, in the order they were tagged."""
        return list(self._records.values())
