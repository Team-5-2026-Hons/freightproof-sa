"""Fixture-backed Parcel Perfect client, selected when PP_USE_MOCK is set."""

import copy
import logging
from datetime import UTC, date, datetime
from typing import Any, Optional

from app.core.config import settings
from app.integrations.mock_state import build_key, get_mock_state_store
from app.integrations.parcel_perfect.errors import PPManifestNotFoundError, PPUnsupportedError, PPWaybillNotFoundError
from app.integrations.parcel_perfect.manifest_fixtures import MOCK_MANIFEST_HEADERS, _build_header
from app.integrations.parcel_perfect.models import PPManifestHeader, PPManifestResponse, PPTrack, PPWaybillResponse
from app.integrations.parcel_perfect.timestamps import pp_timezone
from app.integrations.parcel_perfect.waybill_fixtures import MOCK_WAYBILLS

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Mock client
# ---------------------------------------------------------------------------


# Redis key kind for staged PP waybill overrides, distinct from staged scan state.
_PP_KEY_KIND = "pp"

# Redis key kind for staged manifest-header overrides (FP-281).
_PP_MANIFEST_KEY_KIND = "pp-manifest"
# Header fields a demo may stage; each is an ISO-8601 UTC string, or None to clear.
_STAGEABLE_HEADER_FIELDS = ("closed_at", "planned_departure_at", "expected_arrival_at")


def _operations_today() -> date:
    """Today in PP's timezone. A function so tests can pin it."""
    return datetime.now(pp_timezone()).date()


class MockParcelPerfectClient:
    """Fixture-backed stub — no network. PP_USE_MOCK=True selects it via get_pp_client().

    Unknown references raise PPWaybillNotFoundError, matching the real client, so
    the fail-closed 422 path behaves identically in dev/CI and against live PP.

    When the dev trigger panel is enabled, a Redis-held override layer is applied
    on top of each fixture. This exists because PP waybills were verified to be
    mutable after creation (a portal edit changed 68 fields in one
    10-second poll interval, growing tracks[] from 2 to 27 barcodes), and the
    Celery poll that would observe such a change runs in a different process from
    the API — so a module-level dict mutation would be invisible to it.

    The override lookup is gated on DEV_PANEL_ENABLED so that normal operation
    never touches Redis and every existing PP test runs unchanged.
    """

    supports_manifest_lookup: bool = True

    def _override_key(self, waybill_number: str) -> str:
        return build_key(_PP_KEY_KIND, waybill_number)

    async def stage_waybill_override(
        self,
        waybill_number: str,
        *,
        manifest: Optional[int] = None,
        poddate: Optional[str] = None,
        failtype: Optional[str] = None,
        parcel_count: Optional[int] = None,
    ) -> None:
        """Stage a change to a fixture waybill, as if edited in the PP portal.

        Only supplied fields are staged; the rest of the fixture is untouched.
        Staging is additive across calls, so a manifest number set earlier survives
        a later poddate change — that is how a real waybill accumulates state.

        Raises:
            PPUnsupportedError: PP_USE_MOCK is false. Staging a fixture change
                while pointed at live PP is a bug, and silently ignoring it would
                make a demo look like it worked when nothing happened.
            PPWaybillNotFoundError: the reference is not in the fixture library.
        """
        if not settings.PP_USE_MOCK:
            raise PPUnsupportedError(
                "Cannot stage a waybill override while PP_USE_MOCK is false"
            )
        if waybill_number not in MOCK_WAYBILLS:
            raise PPWaybillNotFoundError(waybill_number)

        key = self._override_key(waybill_number)
        store = get_mock_state_store()
        current = await store.get_json(key) or {}
        staged = {
            **current,
            **{
                field: value
                for field, value in (
                    ("manifest", manifest),
                    ("poddate", poddate),
                    ("failtype", failtype),
                    ("parcel_count", parcel_count),
                )
                if value is not None
            },
        }
        await store.set_json(key, staged)
        logger.info("Staged PP override for waybill=%s fields=%s", waybill_number, sorted(staged))

    async def _apply_overrides(self, waybill: PPWaybillResponse) -> PPWaybillResponse:
        """Apply any staged override to a fixture copy. No-op when none is staged."""
        if not settings.DEV_PANEL_ENABLED:
            return waybill

        staged = await get_mock_state_store().get_json(
            self._override_key(waybill.details.waybill)
        )
        return self._apply_staged(waybill, staged) if staged else waybill

    @staticmethod
    def _apply_staged(waybill: PPWaybillResponse, staged: dict[str, Any]) -> PPWaybillResponse:
        if (manifest := staged.get("manifest")) is not None:
            waybill.details.manifest = int(manifest)
        if (poddate := staged.get("poddate")) is not None:
            waybill.details.poddate = str(poddate)
        if (failtype := staged.get("failtype")) is not None:
            waybill.details.failtype = str(failtype)
        if (parcel_count := staged.get("parcel_count")) is not None:
            # Regenerate tracks[] to the new size, keeping the fixture's barcode
            # format. This reproduces the real failure mode: the expected parcel
            # set — the baseline every reconciliation is measured against — grows
            # with no version, timestamp or audit field on the waybill.
            count = int(parcel_count)
            reference = waybill.details.waybill
            waybill.tracks = [
                PPTrack(trackno=f"{reference}{n:04d}", parcelno=n, item=1)
                for n in range(1, count + 1)
            ]
            waybill.details.pieces = count

        return waybill

    async def _waybills_with_overrides(self) -> list[PPWaybillResponse]:
        """Every fixture waybill as PP would return it now, staged edits applied. One
        batched read, not a Redis round trip per fixture."""
        # Deep copy: callers may mutate results; module-level fixtures must stay pristine.
        waybills = [copy.deepcopy(w) for w in MOCK_WAYBILLS.values()]
        if not settings.DEV_PANEL_ENABLED:
            return waybills
        staged_all = await get_mock_state_store().get_many_json(
            [self._override_key(w.details.waybill) for w in waybills]
        )
        return [
            self._apply_staged(w, staged) if staged else w
            for w, staged in zip(waybills, staged_all, strict=True)
        ]

    def _manifest_override_key(self, manifest_number: int) -> str:
        return build_key(_PP_MANIFEST_KEY_KIND, str(manifest_number))

    async def get_manifest(self, manifest_number: int) -> PPManifestResponse:
        """ASPIRATIONAL — an assumed data contract (spec §8); PP's API has no such call.

        Membership comes from each waybill's own `manifest` field, staged moves included,
        so there is one source of truth for which waybill is on which manifest.

        Raises:
            PPManifestNotFoundError: no header fixture has this number.
        """
        logger.info("MockParcelPerfectClient.get_manifest manifest=%s", manifest_number)
        fixture = MOCK_MANIFEST_HEADERS.get(manifest_number)
        if fixture is None:
            raise PPManifestNotFoundError(manifest_number)
        header = await self._apply_manifest_overrides(
            _build_header(manifest_number, fixture, _operations_today())
        )
        waybills = sorted(
            (w for w in await self._waybills_with_overrides() if w.details.manifest == manifest_number),
            key=lambda w: w.details.waybill,
        )
        return PPManifestResponse(header=header, waybills=waybills)

    async def stage_manifest_override(
        self,
        manifest_number: int,
        *,
        closed: Optional[bool] = None,
        planned_departure_at: Optional[datetime] = None,
        expected_arrival_at: Optional[datetime] = None,
    ) -> None:
        """Stage a header change, as if the client edited the manifest in PP. Supplied
        fields are staged; the rest are untouched (additive, like waybill staging).

        Raises:
            PPUnsupportedError: PP_USE_MOCK is false.
            PPManifestNotFoundError: no header fixture has this number.
        """
        if not settings.PP_USE_MOCK:
            raise PPUnsupportedError("Cannot stage a manifest override while PP_USE_MOCK is false")
        if manifest_number not in MOCK_MANIFEST_HEADERS:
            raise PPManifestNotFoundError(manifest_number)

        key = self._manifest_override_key(manifest_number)
        store = get_mock_state_store()
        staged = dict(await store.get_json(key) or {})
        if closed is not None:
            # Stored once, at staging: the snapshot must hash the same on the preview
            # and on the create that follows it.
            staged["closed_at"] = datetime.now(UTC).isoformat() if closed else None
        if planned_departure_at is not None:
            staged["planned_departure_at"] = planned_departure_at.astimezone(UTC).isoformat()
        if expected_arrival_at is not None:
            staged["expected_arrival_at"] = expected_arrival_at.astimezone(UTC).isoformat()
        await store.set_json(key, staged)
        logger.info("Staged PP manifest override manifest=%s fields=%s", manifest_number, sorted(staged))

    async def _apply_manifest_overrides(self, header: PPManifestHeader) -> PPManifestHeader:
        if not settings.DEV_PANEL_ENABLED:
            return header
        staged = await get_mock_state_store().get_json(
            self._manifest_override_key(header.manifest_number)
        )
        if not staged:
            return header
        for field_name in _STAGEABLE_HEADER_FIELDS:
            if field_name in staged:
                raw = staged[field_name]
                setattr(header, field_name, datetime.fromisoformat(raw) if raw is not None else None)
        return header

    async def get_single_waybill(self, waybill_number: str) -> PPWaybillResponse:
        """Look up the waybill in the fixture library; raise if unregistered."""
        logger.info("MockParcelPerfectClient.get_single_waybill waybill=%s", waybill_number)
        try:
            # Deep copy: callers may mutate results; module-level fixtures must stay pristine.
            waybill = copy.deepcopy(MOCK_WAYBILLS[waybill_number])
        except KeyError as exc:
            raise PPWaybillNotFoundError(waybill_number) from exc
        return await self._apply_overrides(waybill)
