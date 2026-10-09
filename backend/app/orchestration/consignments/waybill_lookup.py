"""Wizard-time PP lookups. Layering: orchestration → integrations only."""
from app.core.exceptions import WaybillNotFoundError
from app.integrations.parcel_perfect.errors import PPWaybillNotFoundError
from app.integrations.parcel_perfect.factory import get_pp_client
from app.integrations.parcel_perfect.models import PPWaybillResponse
from app.schemas.pp import PPCapabilities, PPWaybillSummary


def _to_summary(w: PPWaybillResponse) -> PPWaybillSummary:
    d = w.details
    return PPWaybillSummary(
        waybill=d.waybill, account_number=d.accnum, customer_name=d.custname,
        parcel_count=d.pieces, weight_kg=d.actual_weight_kg,
        declared_value=d.declared_value, dest_town=d.dest_town,
        dest_person=d.dest_person, manifest_number=d.manifest,
        is_delivered=w.is_delivered, has_delivery_failure=w.has_delivery_failure,
    )


async def get_waybill_summary(waybill_number: str) -> PPWaybillSummary:
    """Raises WaybillNotFoundError for an unknown reference; outages propagate unchanged
    (the endpoint maps them to 502)."""
    try:
        waybill = await get_pp_client().get_single_waybill(waybill_number)
    except PPWaybillNotFoundError as exc:
        # The endpoint sits above this layer and must not import the integration's types.
        raise WaybillNotFoundError(exc.waybill_number) from exc
    return _to_summary(waybill)


def get_capabilities() -> PPCapabilities:
    # Deliberately sync — reads a class attribute off the client, no I/O involved.
    return PPCapabilities(manifest_lookup=get_pp_client().supports_manifest_lookup)
