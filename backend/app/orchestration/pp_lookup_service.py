"""Wizard-time PP lookups. Layering: orchestration → integrations only."""
from app.integrations.parcel_perfect import PPWaybillResponse, get_pp_client
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
    return _to_summary(await get_pp_client().get_single_waybill(waybill_number))


async def get_manifest_summaries(manifest_number: int) -> list[PPWaybillSummary]:
    waybills = await get_pp_client().get_waybills_by_manifest(manifest_number)
    return [_to_summary(w) for w in waybills]


def get_capabilities() -> PPCapabilities:
    # Deliberately sync — reads a class attribute off the client, no I/O involved.
    return PPCapabilities(manifest_lookup=get_pp_client().supports_manifest_lookup)
