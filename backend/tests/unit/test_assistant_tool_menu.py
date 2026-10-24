"""The assistant's tool menu (spec §5.1): strict schemas, and no way to name an organisation."""

import pytest

from app.orchestration.assistant.tools import TOOLS
from app.orchestration.assistant.tools_base import AssistantTool, JsonObject


def _objects(schema: JsonObject) -> list[JsonObject]:
    defs = schema.get("$defs", {})
    assert isinstance(defs, dict)
    return [schema, *defs.values()]


@pytest.mark.parametrize("tool", TOOLS, ids=lambda tool: tool.name)
def test_every_tool_schema_is_strict(tool: AssistantTool) -> None:
    for obj in _objects(tool.input_schema()):
        properties = obj.get("properties", {})
        assert isinstance(properties, dict)

        required = obj.get("required", [])
        assert isinstance(required, list)

        assert obj.get("additionalProperties") is False, obj.get("title")
        assert set(required) == set(properties), obj.get("title")


@pytest.mark.parametrize("tool", TOOLS, ids=lambda tool: tool.name)
def test_no_tool_input_names_an_organisation(tool: AssistantTool) -> None:
    names: set[str] = set()
    for obj in _objects(tool.input_schema()):
        properties = obj.get("properties", {})
        assert isinstance(properties, dict)
        names.update(properties)

    assert not {name for name in names if "org" in name}


def test_tool_names_are_unique_and_described() -> None:
    names = [tool.name for tool in TOOLS]

    assert len(names) == len(set(names))
    assert all(tool.description for tool in TOOLS)
