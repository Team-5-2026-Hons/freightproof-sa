"""The assistant's tool menu and the one way to run a tool (assistant spec §5).

Every tool is read-only and runs for the organisation in its ToolContext, which the service takes
from the caller's token: no tool input has a field for it. A call the model got wrong (unknown
tool, bad input) comes back as an error outcome it can correct, never an exception.
"""

from collections.abc import Mapping

from pydantic import ValidationError

from app.orchestration.assistant.tools_actions import ACTION_TOOLS
from app.orchestration.assistant.tools_base import AssistantTool, ToolContext, ToolOutcome
from app.orchestration.assistant.tools_crew import CREW_TOOLS
from app.orchestration.assistant.tools_documents import DOCUMENT_TOOLS
from app.orchestration.assistant.tools_fleet import FLEET_TOOLS
from app.orchestration.assistant.tools_history import HISTORY_TOOLS
from app.orchestration.assistant.tools_incidents import INCIDENT_TOOLS
from app.orchestration.assistant.tools_parcels import PARCEL_TOOLS
from app.orchestration.assistant.tools_roster import ROSTER_TOOLS
from app.orchestration.assistant.tools_route import ROUTE_TOOLS
from app.orchestration.assistant.tools_trips import TRIP_TOOLS

# A fixed order: the tool list is part of the model's cached prompt prefix.
TOOLS: tuple[AssistantTool, ...] = (*TRIP_TOOLS, *INCIDENT_TOOLS, *CREW_TOOLS, *HISTORY_TOOLS, *FLEET_TOOLS, *DOCUMENT_TOOLS, *ROSTER_TOOLS, *ROUTE_TOOLS, *PARCEL_TOOLS, *ACTION_TOOLS)
TOOLS_BY_NAME: dict[str, AssistantTool] = {tool.name: tool for tool in TOOLS}
# Enough to name each wrong field; a model that got more wrong than this should start again.
MAX_REPORTED_INPUT_ERRORS = 5


def _invalid_input_message(exc: ValidationError) -> str:
    problems = [
        f"{'.'.join(str(part) for part in error['loc']) or 'input'}: {error['msg']}"
        for error in exc.errors()[:MAX_REPORTED_INPUT_ERRORS]
    ]
    return "Invalid input. " + "; ".join(problems)


async def run_tool(context: ToolContext, *, name: str, arguments: Mapping[str, object]) -> ToolOutcome:
    """Run one tool call for the context's organisation. Never raises for the model's mistakes."""
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return ToolOutcome.failed(f"Unknown tool: {name}")
    try:
        inputs = tool.input_model.model_validate(arguments)
    except ValidationError as exc:
        return ToolOutcome.failed(_invalid_input_message(exc))
    return await tool.runner(context, inputs)
