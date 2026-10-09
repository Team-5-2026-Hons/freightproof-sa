"""Parsed Parcel Perfect response types: the waybill and manifest dataclasses."""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


# ---------------------------------------------------------------------------
# Response dataclasses (parsed from PP JSON payload)
# ---------------------------------------------------------------------------


@dataclass
class PPTrack:
    """A single parcel tracking barcode within a waybill."""

    trackno: str
    parcelno: int
    item: int


@dataclass
class PPContents:
    """One line-item of cargo contents on a waybill."""

    item: int
    description: str
    actmass: float
    pieces: int


@dataclass
class PPWaybillRef:
    """A client reference number attached to a waybill (wayrefs array)."""

    reference: str
    pageno: int


@dataclass
class PPWaybillDetails:
    """Core waybill header fields returned by getSingleWaybill.

    Extended fields (service, orig_*, freight_total, etc.) are populated from
    the full getSingleWaybill response — see raw dump in integration notes.
    poddate is non-empty string when PP has confirmed delivery; empty string
    means the consignment is still in transit or not yet collected.
    failtype is non-None when PP records a delivery failure (e.g. "not home").
    """

    waybill: str
    waydate: str
    pieces: int
    duedate: str
    declared_value: Optional[float]
    # Destination
    dest_address: str
    dest_town: str
    dest_person: str
    dest_contact: str
    # Origin — useful for pre-populating the trip creation form
    orig_person: str
    orig_town: str
    orig_address: str
    # Service and logistics
    service: str
    actual_weight_kg: Optional[float]
    freight_total: Optional[float]       # total charge incl. VAT from PP
    # POD — empty string = not yet delivered; date string = delivery confirmed
    poddate: str
    # Failure — None = no failure recorded; string = failure reason from PP
    failtype: Optional[str]
    # Client reference on the waybill
    client_reference: str
    # Customer account holding the booking — resolves the client Organization.
    accnum: str = ""
    custname: str = ""
    # PP "last manifest number"; 0/absent = not manifested → normalised to None.
    manifest: Optional[int] = None


@dataclass
class PPWaybillResponse:
    """Parsed top-level getSingleWaybill result (one entry from `results`)."""

    details: PPWaybillDetails
    contents: list[PPContents]
    tracks: list[PPTrack]
    wayrefs: list[PPWaybillRef]

    @property
    def is_delivered(self) -> bool:
        """True when PP has recorded a POD date — delivery is confirmed."""
        return bool(self.details.poddate)

    @property
    def has_delivery_failure(self) -> bool:
        """True when PP has recorded a delivery failure reason."""
        return self.details.failtype is not None


# ---------------------------------------------------------------------------
# Manifests — an ASSUMED data contract (FP-281, spec §8). PP holds manifests, but
# ecomService v28 exposes only getSingleWaybill. Every datetime here is UTC.
# ---------------------------------------------------------------------------


@dataclass
class PPManifestNote:
    noted_at: datetime
    operator: str
    text: str


@dataclass
class PPManifestHeader:
    manifest_number: int
    issuer_account: str             # PP accnum of the client (e.g. RTT)
    issuer_name: str
    origin_hub: str                 # e.g. "JNB"
    destination_hub: str            # e.g. "DUR"
    created_at: datetime
    closed_at: Optional[datetime]   # None until the client closes the manifest
    planned_departure_at: Optional[datetime]
    expected_arrival_at: Optional[datetime]
    client_reference: Optional[str]
    notes: list[PPManifestNote]


@dataclass
class PPManifestResponse:
    header: PPManifestHeader
    waybills: list[PPWaybillResponse]   # identical shape to getSingleWaybill
