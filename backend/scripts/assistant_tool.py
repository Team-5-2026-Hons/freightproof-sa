"""Run one dispatcher-assistant tool against the database and print what it returns (dev only).

No model is called and nothing costs money. It shows exactly what the model would be sent (the trimmed
result) and the cards the dispatcher would see, so a tool can be checked against the pages by hand
(spec §9, Stages 2–3).

Usage (from backend/, run as a module so `app` is importable):

    python -m scripts.assistant_tool --list-orgs
    python -m scripts.assistant_tool trips '{"status_group": "active"}' --org <organisation id>
    python -m scripts.assistant_tool crew_bookings '{"driver_name": "Tim", "when": {"preset": "now"}}' --org <id>

Fields left out of the JSON are sent as null (yes/no fields as false, lists as empty), as the model's strict schema
would, so a quick check needs only the fields that matter. It reads DATABASE_URL like the backend does and only ever reads:
the session is rolled back at the end.
"""

import argparse
import asyncio
import json
import sys
import uuid
from datetime import UTC, datetime
from typing import cast

from pydantic import TypeAdapter
from sqlalchemy import select

from app.core.rate_limit import get_redis
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.session import AsyncSessionLocal
from app.orchestration.assistant.refs import RefBook
from app.orchestration.assistant.tools import TOOLS_BY_NAME, run_tool
from app.orchestration.assistant.tools_base import ToolContext
from app.schemas.assistant import AssistantCard

_CARDS = TypeAdapter(list[AssistantCard])
JsonObject = dict[str, object]


def _with_nulls(arguments: JsonObject, schema: JsonObject, defs: JsonObject) -> JsonObject:
    """Every property the schema has, null where the caller left it out (nested objects too)."""
    filled: JsonObject = {}
    properties = cast(dict[str, JsonObject], schema.get("properties", {}))
    for name, spec in properties.items():
        value = arguments.get(name)
        ref = _ref_of(spec)
        if isinstance(value, dict) and ref is not None:
            value = _with_nulls(cast(JsonObject, value), cast(JsonObject, defs[ref]), defs)
        if value is None and spec.get("type") == "boolean":
            # A yes/no the caller didn't mention means no.
            value = False
        if value is None and spec.get("type") == "array":
            # A list the caller didn't mention is empty.
            value = []
        filled[name] = value
    return filled


def _ref_of(spec: JsonObject) -> str | None:
    """The $defs name a property points at, directly or as one branch of "X or null"."""
    for branch in [spec, *cast(list[JsonObject], spec.get("anyOf", []))]:
        ref = branch.get("$ref")
        if isinstance(ref, str):
            return ref.rsplit("/", 1)[-1]
    return None


async def _list_orgs() -> None:
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(Organization.id, Organization.name).where(Organization.org_type == OrganizationType.OPERATOR),
        )
        for org_id, name in rows.all():
            print(f"{org_id}  {name}")


async def _run(tool_name: str, arguments: JsonObject, organization_id: uuid.UUID) -> None:
    tool = TOOLS_BY_NAME[tool_name]
    schema = tool.input_schema()
    filled = _with_nulls(arguments, schema, cast(JsonObject, schema.get("$defs", {})))
    try:
        async with AsyncSessionLocal() as db:
            context = ToolContext(db=db, organization_id=organization_id, now=datetime.now(UTC), refs=RefBook())
            outcome = await run_tool(context, name=tool_name, arguments=filled)
            await db.rollback()
    finally:
        # route_time may have opened the shared Redis client; close it before asyncio.run closes the loop.
        await get_redis().aclose()
    if outcome.error is not None:
        print(f"ERROR (the model would be told): {outcome.error}")
        return
    print("== What the model is sent")
    print(json.dumps(outcome.result, indent=2))
    print("== Cards the dispatcher sees")
    print(_CARDS.dump_json(list(outcome.cards), indent=2).decode())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("tool", nargs="?", choices=sorted(TOOLS_BY_NAME))
    parser.add_argument("arguments", nargs="?", default="{}", help="The tool's input as JSON.")
    parser.add_argument("--org", type=uuid.UUID, help="The operator organisation to run as.")
    parser.add_argument("--list-orgs", action="store_true", help="List operator organisations and exit.")
    args = parser.parse_args()
    if args.list_orgs:
        asyncio.run(_list_orgs())
        return
    if args.tool is None or args.org is None:
        parser.error("give a tool and --org (see --list-orgs)")
    try:
        arguments = json.loads(args.arguments)
    except json.JSONDecodeError as exc:
        sys.exit(f"The arguments aren't valid JSON: {exc}")
    asyncio.run(_run(args.tool, arguments, args.org))


if __name__ == "__main__":
    main()
