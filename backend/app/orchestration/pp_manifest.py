"""Pure helpers for PP manifests (FP-281, spec §8–§10).

No I/O: everything is a function of a PPManifestResponse, so it is unit-tested without
a database. pp_manifest_service holds the parts that read the database.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.crypto.hashing import PPManifestKey, compute_snapshot_sha256
from app.integrations.parcel_perfect import PPManifestResponse
from app.orchestration.consignment_service import serialise_waybill

# Weights are shown to two decimals, like the PP portal.
_WEIGHT_DECIMALS = 2


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value is not None else None


def manifest_snapshot(manifest: PPManifestResponse) -> dict[str, Any]:
    """The JSON stored on H0 and hashed into the journey lock (spec §7.3, §9).

    Waybills are sorted by number so PP's response order cannot change the hash, and
    each uses serialise_waybill — the same shape consignment sync stores — so the
    snapshot and the consignment rows describe a waybill identically.
    """
    header = manifest.header
    return {
        "header": {
            "manifest_number": header.manifest_number,
            "issuer_account": header.issuer_account,
            "issuer_name": header.issuer_name,
            "origin_hub": header.origin_hub,
            "destination_hub": header.destination_hub,
            "created_at": _iso(header.created_at),
            "closed_at": _iso(header.closed_at),
            "planned_departure_at": _iso(header.planned_departure_at),
            "expected_arrival_at": _iso(header.expected_arrival_at),
            "client_reference": header.client_reference,
            "notes": [
                {"noted_at": _iso(note.noted_at), "operator": note.operator, "text": note.text}
                for note in header.notes
            ],
        },
        "waybills": [
            serialise_waybill(w)
            for w in sorted(manifest.waybills, key=lambda w: w.details.waybill)
        ],
    }


def manifest_snapshot_sha256(manifest: PPManifestResponse) -> str:
    return compute_snapshot_sha256(manifest_snapshot(manifest))


def manifest_key(manifest: PPManifestResponse) -> PPManifestKey:
    header = manifest.header
    return PPManifestKey(header.issuer_account, header.origin_hub, header.manifest_number)


@dataclass(frozen=True)
class ManifestTotals:
    waybills: int
    parcels: int
    weight_kg: float


def manifest_totals(manifest: PPManifestResponse) -> ManifestTotals:
    """Computed from the waybills, never stored in the header, so they cannot disagree.
    Parcels count tracks[], the same figure consignment sync stores as expected."""
    return ManifestTotals(
        waybills=len(manifest.waybills),
        parcels=sum(len(w.tracks) for w in manifest.waybills),
        weight_kg=round(
            sum(w.details.actual_weight_kg or 0.0 for w in manifest.waybills), _WEIGHT_DECIMALS,
        ),
    )


def waybills_from_other_clients(manifest: PPManifestResponse) -> list[str]:
    """Waybills whose PP account differs from the manifest's issuer (spec §6). The trip
    takes its client from the header and each consignment from its own accnum, so any
    entry here would give one trip two conflicting clients."""
    issuer = manifest.header.issuer_account
    return sorted(w.details.waybill for w in manifest.waybills if w.details.accnum != issuer)
