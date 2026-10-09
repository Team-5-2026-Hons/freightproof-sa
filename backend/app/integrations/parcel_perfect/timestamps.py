"""Parcel Perfect date strings: they carry no zone and are South African time."""

from datetime import UTC, datetime, timedelta, timezone

from app.core.config import settings


_PP_DATE_FORMAT = "%d.%m.%Y"
PP_DATETIME_FORMAT = f"{_PP_DATE_FORMAT} %H:%M"


def pp_timezone() -> timezone:
    """PP runs on South African time and its date strings carry no zone (spec §8).
    SAST has no daylight saving, so the configured operations offset is exact."""
    return timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))


def parse_pp_datetime(value: str) -> datetime:
    """A PP date string, read as South African time, returned in UTC."""
    local = datetime.strptime(value, PP_DATETIME_FORMAT)
    return local.replace(tzinfo=pp_timezone()).astimezone(UTC)
