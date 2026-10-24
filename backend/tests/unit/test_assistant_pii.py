"""No tool result can carry personal numbers, positions or typed text (assistant spec §5.2, D1(b)).

Walks every model the model may be sent (orchestration/assistant/results.py) and every card the
dispatcher's browser gets (schemas/assistant.py), recursively, and fails on any forbidden field name.
The integration test `test_tool_results_never_carry_personal_numbers_or_typed_text` checks the values.
"""

import inspect
import types
from typing import Union, get_args, get_origin

from pydantic import BaseModel

from app.orchestration.assistant import results
from app.schemas import assistant as cards

FORBIDDEN = {
    "id_number", "phone", "phone_number", "license_number", "licence_number", "email", "lat", "lng", "latitude",
    "longitude", "gps", "gps_lat", "gps_lng", "description", "summary", "notes", "note", "comment", "message",
    "body", "review_note",
}


def _models_in(annotation: object) -> list[type[BaseModel]]:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return [annotation]
    if get_origin(annotation) in (Union, types.UnionType, list, tuple, dict) or get_args(annotation):
        return [model for arg in get_args(annotation) for model in _models_in(arg)]
    return []


def _forbidden_fields(model: type[BaseModel], seen: set[type[BaseModel]] | None = None) -> list[str]:
    seen = seen if seen is not None else set()
    if model in seen:
        return []
    seen.add(model)
    found = [f"{model.__name__}.{name}" for name in model.model_fields if name in FORBIDDEN or name.startswith("gps_")]
    for field in model.model_fields.values():
        for nested in _models_in(field.annotation):
            found.extend(_forbidden_fields(nested, seen))
    return found


def _models(module: types.ModuleType) -> list[type[BaseModel]]:
    return [
        value for _, value in inspect.getmembers(module, inspect.isclass)
        if issubclass(value, BaseModel) and value.__module__ == module.__name__
    ]


def test_results_and_cards_have_no_forbidden_fields() -> None:
    models = _models(results) + _models(cards)

    found = [name for model in models for name in _forbidden_fields(model)]

    assert models, "no models found to check"
    assert found == []


def test_the_walk_catches_a_nested_forbidden_field() -> None:
    class Inner(BaseModel):
        phone_number: str

    class Outer(BaseModel):
        rows: list[Inner] | None

    assert _forbidden_fields(Outer) == ["Inner.phone_number"]
