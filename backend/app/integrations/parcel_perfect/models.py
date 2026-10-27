"""Parsed Parcel Perfect response types: the waybill and manifest dataclasses."""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional



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
    dest_address: str
    dest_town: str
    dest_person: str
    dest_contact: str
    orig_person: str
    orig_town: str
    orig_address: str
    service: str
    actual_weight_kg: Optional[float]
    freight_total: Optional[float]
    poddate: str
    failtype: Optional[str]
    client_reference: str
    accnum: str = ""
    custname: str = ""
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



@dataclass
class PPManifestNote:
    noted_at: datetime
    operator: str
    text: str


@dataclass
class PPManifestHeader:
    manifest_number: int
    issuer_account: str
    issuer_name: str
    origin_hub: str
    destination_hub: str
    created_at: datetime
    closed_at: Optional[datetime]
    planned_departure_at: Optional[datetime]
    expected_arrival_at: Optional[datetime]
    client_reference: Optional[str]
    notes: list[PPManifestNote]


@dataclass
class PPManifestResponse:
    header: PPManifestHeader
    waybills: list[PPWaybillResponse]
