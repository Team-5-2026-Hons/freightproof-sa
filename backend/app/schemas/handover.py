"""Wire shapes for the receiver QR handover (FP-155). Driver-side shapes are read by the
authenticated app; receiver-side shapes are read/written by an anonymous browser and
expose only public or receiver-supplied data. The browser-binding secret is never in
here — it travels only as an HttpOnly cookie.
"""

import base64
import binascii
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# Caps decoded bytes so an anonymous caller can't spend our Storage bill or memory
# (well under artifact_service.MAX_FILE_SIZE_BYTES). Base64 field is bounded separately
# (4/3 inflation) so an oversized body is rejected before decoding.
MAX_SIGNATURE_BYTES = 512 * 1024
MAX_SIGNATURE_B64_CHARS = (MAX_SIGNATURE_BYTES * 4) // 3 + 4

_PNG_DATA_URL_PREFIX = "data:image/png;base64,"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class HandoverTokenResponse(BaseModel):
    """One frame of the driver's rotating QR.

    `scan_url` is None exactly when `receiver_opened` is True: no new code to show once
    the receiver already holds one.
    """

    scan_url: Optional[str] = None
    expires_at: datetime
    rotate_after_seconds: int  # from settings, so an installed APK follows a cadence change
    receiver_opened: bool = False


class HandoverStatusResponse(BaseModel):
    """What the driver's step polls while waiting for the receiver to scan."""

    confirmed: bool
    confirmed_at: Optional[datetime] = None
    receiver_opened: bool = False  # display only: page loaded, receiver hasn't swiped yet
    # Submitted as pod_signature_artifact_id; null until confirmed, and
    # ConfirmationCompleteRequest requires it, so the driver step must not proceed while null.
    signature_artifact_id: Optional[UUID] = None


class HandoverScanResponse(BaseModel):
    """What a receiver is shown before they confirm anything.

    Scoped hard: no driver name, phone number, or other stop on the trip — an unguessable
    token is not a reason to hand a scanner the trip's contents.
    """

    trip_reference: str
    destination_name: str
    waybill_references: list[str]
    expires_at: datetime
    # Null until consent; non-null lets a returning browser (fresh page load, no client
    # state) resume where it left off.
    verification: Optional["HandoverVerificationState"] = None


class HandoverConfirmRequest(BaseModel):
    receiver_name: str = Field(min_length=1, max_length=120)
    # Advisory shape only, never validated as an SA ID — a passport or company reg number
    # is also legitimate, and a mistyped digit is itself part of the record.
    receiver_id_number: str = Field(min_length=1, max_length=60)
    signature_png_base64: str = Field(max_length=MAX_SIGNATURE_B64_CHARS)
    receiver_lat: Optional[Decimal] = None
    receiver_lng: Optional[Decimal] = None
    receiver_accuracy_m: Optional[Decimal] = None

    @field_validator("signature_png_base64")
    @classmethod
    def validate_png(cls, v: str) -> str:
        """Accept a bare base64 payload or a full data URL, and prove it decodes to a PNG.

        The magic-number check isn't a security control (resolve_mime_type re-derives the
        type from the bytes); it's here so a bad client gets a useful 422 instead of a
        confusing failure three layers down.
        """
        payload = v[len(_PNG_DATA_URL_PREFIX):] if v.startswith(_PNG_DATA_URL_PREFIX) else v
        try:
            decoded = base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("signature_png_base64 is not valid base64.") from exc
        if len(decoded) > MAX_SIGNATURE_BYTES:
            raise ValueError(f"Signature exceeds the {MAX_SIGNATURE_BYTES} byte limit.")
        if not decoded.startswith(_PNG_MAGIC):
            raise ValueError("signature_png_base64 is not a PNG.")
        return payload


class HandoverConfirmResponse(BaseModel):
    """Deliberately thin. The receiver has no further business with this trip."""

    confirmed_at: datetime
    trip_reference: str


class HandoverConsentRequest(BaseModel):
    """The receiver's explicit agreement to a biometric identity check.

    POPIA s27(1)(a) exemption relies on proof of what was agreed to: the client sends the
    exact wording displayed, the server stores its SHA-256, never the text.
    """

    consent_text: str = Field(min_length=1, max_length=4000)
    has_document: bool = True  # False routes to selfie-only tier, not a refusal


class HandoverVerifyResponse(BaseModel):
    """Where to send the receiver next, or why not.

    `session_url` is None on every degradation path (quota spent, vendor unreachable, no
    document); the client falls back to signing at a lower tier rather than erroring.
    """

    session_url: Optional[str] = None
    tier: str
    unverified_reason: Optional[str] = None


class HandoverVerificationState(BaseModel):
    """What the receiver's page shows about its own verification."""

    status: str
    tier: str
    unverified_reason: Optional[str] = None
    identity_match: Optional[bool] = None


HandoverScanResponse.model_rebuild()
