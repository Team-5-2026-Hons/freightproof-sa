"""How times are shown to people outside the system — insurers, adjusters, SAPS.

One definition so the observations, the PDF and any later rendering agree to the
minute; raw data stays in UTC.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

DISPLAY_TIMEZONE = ZoneInfo("Africa/Johannesburg")


def format_sast(instant: datetime) -> str:
    return instant.astimezone(DISPLAY_TIMEZONE).strftime("%d %b %Y %H:%M SAST")
