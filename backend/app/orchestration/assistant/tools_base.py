"""What every assistant tool shares (spec §5): its context, its outcome, and finding a record.

A tool never raises for the model's mistakes. Unknown records, bad inputs and "which one?" all come
back as a ToolOutcome the model reads on its next turn: an `error` it can correct, or a result asking
it to put a choice to the dispatcher (with a choice card for the buttons).

The organisation is never a tool input: ToolContext carries it from the caller's token.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import VehicleType
from app.orchestration.assistant.refs import RefBook
from app.orchestration.assistant.resolve import (
    Candidate,
    EntityKind,
    Resolution,
    resolve_driver,
    resolve_precinct,
    resolve_trip,
    resolve_vehicle,
)
from app.orchestration.assistant.results import CHOOSE_INSTRUCTION, NeedsChoice, Option, Result
from app.orchestration.trips.availability import format_when
from app.schemas.assistant import AssistantAction, AssistantCard, ChooseCard, RecordRef

JsonObject = dict[str, object]


@dataclass(frozen=True)
class ToolContext:
    db: AsyncSession
    organization_id: uuid.UUID
    now: datetime
    refs: RefBook


@dataclass(frozen=True)
class ToolOutcome:
    """Exactly one of `result` and `error` is set. Cards go under the answer."""

    result: JsonObject | None = None
    error: str | None = None
    cards: tuple[AssistantCard, ...] = ()
    actions: tuple[AssistantAction, ...] = ()

    @classmethod
    def failed(cls, message: str) -> "ToolOutcome":
        return cls(error=message)

    @classmethod
    def done(cls, result: Result, *cards: AssistantCard, actions: tuple[AssistantAction, ...] = ()) -> "ToolOutcome":
        return cls(result=result.model_dump(mode="json", exclude_none=True), cards=cards, actions=actions)


class ToolInput(BaseModel):
    """Every tool input rejects unknown fields, so a stray "organization_id" can't sneak in."""

    model_config = ConfigDict(extra="forbid", frozen=True)


ToolRunner = Callable[[ToolContext, ToolInput], Awaitable[ToolOutcome]]


@dataclass(frozen=True)
class AssistantTool:
    name: str
    description: str
    input_model: type[ToolInput]
    runner: ToolRunner

    def input_schema(self) -> JsonObject:
        return self.input_model.model_json_schema()


def expect[InputT: ToolInput](raw: ToolInput, model: type[InputT]) -> InputT:
    """Narrow a runner's input to its own model (run_tool validated it with that model)."""
    if not isinstance(raw, model):
        raise TypeError(f"{model.__name__} expected, got {type(raw).__name__}")
    return raw


def when_text(start: datetime, end: datetime | None) -> str:
    """"Wed 21 Oct, 00:00 to Thu 22 Oct, 00:00", or one moment."""
    return format_when(start) if end is None else f"{format_when(start)} to {format_when(end)}"


def record_of(candidate: Candidate) -> RecordRef:
    return RecordRef(
        kind=candidate.kind, id=candidate.id, label=candidate.label,
        detail=candidate.detail, is_active=candidate.is_active,
    )


def _choice(context: ToolContext, resolution: Resolution, what: EntityKind) -> ToolOutcome:
    records = [record_of(candidate) for candidate in resolution.candidates]
    options = [
        Option(ref=context.refs.tag(record), label=record.label, detail=record.detail, active=record.is_active)
        for record in records
    ]
    choice = NeedsChoice(
        what=what, typed=resolution.query, options=options, more=resolution.more, instruction=CHOOSE_INSTRUCTION,
    )
    card = ChooseCard(what=what, typed=resolution.query, options=records, more=resolution.more)
    return ToolOutcome.done(choice, card)


async def find(
    context: ToolContext,
    what: EntityKind,
    *,
    name: str | None,
    ref: str | None,
    vehicle_type: VehicleType | None = None,
) -> Candidate | ToolOutcome | None:
    """The one record `name` or `ref` means; a ToolOutcome to send back instead (not found, or a
    choice to put to the dispatcher); or None when neither was given. A ref wins over a name."""
    if ref is None and name is None:
        return None
    ref_id = context.refs.lookup(ref, what) if ref is not None else None
    if ref is not None and ref_id is None:
        return ToolOutcome.failed(f"Unknown {what}_ref {ref!r}: use a ref from an earlier result, or the name.")
    resolution = await _resolve(context, what, name=None if ref_id else name, ref=ref_id, vehicle_type=vehicle_type)
    if resolution.status == "found" and resolution.match is not None:
        return resolution.match
    if resolution.status == "ambiguous":
        return _choice(context, resolution, what)
    return ToolOutcome.failed(
        f"No {what} matching {resolution.query!r} in this fleet. Tell the dispatcher, and ask them to check the "
        "spelling. Don't guess another record."
    )


async def _resolve(
    context: ToolContext,
    what: EntityKind,
    *,
    name: str | None,
    ref: uuid.UUID | None,
    vehicle_type: VehicleType | None,
) -> Resolution:
    db, org = context.db, context.organization_id
    match what:
        case "driver":
            return await resolve_driver(db, organization_id=org, text=name, ref=ref)
        case "vehicle":
            return await resolve_vehicle(db, organization_id=org, text=name, ref=ref, vehicle_type=vehicle_type)
        case "precinct":
            return await resolve_precinct(db, organization_id=org, text=name, ref=ref)
        case "trip":
            return await resolve_trip(db, organization_id=org, text=name, ref=ref)
