"""Wire shapes for the receiver QR handover (FP-155).

Split across two audiences with very different trust levels. HandoverTokenResponse and
HandoverStatusResponse are read by the DRIVER's authenticated app. HandoverScanResponse
and HandoverConfirmRequest are read and written by an ANONYMOUS browser, so everything in
them is either public-by-nature or supplied by the receiver about themselves.

Nothing here carries the browser-binding secret. That half of the credential travels only
as an HttpOnly cookie, which means no JavaScript on the receiver's page can read it and
no screenshot of the page can leak it — the point of the binding is that it is the one
part of the exchange the receiver cannot forward even if they want to.
"""

import base64
import binascii
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# A rendered attestation is a few tens of KB of PNG. The cap is on the DECODED bytes and
# exists so an anonymous caller cannot spend our Storage bill or our memory; the real
# ceiling is still artifact_service.MAX_FILE_SIZE_BYTES, which this sits well under.
# Base64 inflates by 4/3, so the encoded field is bounded separately — that bound rejects
# an oversized body at validation, before anything is decoded.
MAX_SIGNATURE_BYTES = 512 * 1024
MAX_SIGNATURE_B64_CHARS = (MAX_SIGNATURE_BYTES * 4) // 3 + 4

_PNG_DATA_URL_PREFIX = "data:image/png;base64,"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class HandoverTokenResponse(BaseModel):
    """One frame of the driver's rotating QR.

    `scan_url` is None exactly when `receiver_opened` is True: once a receiver has the
    link open there is no new code to show, because issuing one would retire the code
    they are holding. The driver's step reads that pair as "stop rotating and tell the
    driver the receiver has it", not as an error.
    """

    scan_url: Optional[str] = None
    expires_at: datetime
    # Echoed from settings rather than hard-coded in the app, so the rotation cadence is a
    # server-side decision and an already-installed APK follows a change to it.
    rotate_after_seconds: int
    receiver_opened: bool = False


class HandoverStatusResponse(BaseModel):
    """What the driver's step polls while waiting for the receiver to scan."""

    confirmed: bool
    confirmed_at: Optional[datetime] = None
    # True once the receiver's browser has loaded the page but before they have swiped.
    # Display only — it tells the driver the scan worked so they are not left staring at
    # a code wondering whether anything happened.
    receiver_opened: bool = False
    # The artifact the driver then submits as pod_signature_artifact_id. Null until the
    # receiver has confirmed — the step must not let the driver past while it is null,
    # because ConfirmationCompleteRequest requires it and would 422.
    signature_artifact_id: Optional[UUID] = None


class HandoverScanResponse(BaseModel):
    """What a receiver is shown before they confirm anything.

    Scoped hard. A stranger holding a token sees what they need in order to know they are
    confirming the right delivery, and nothing else: no driver name, no phone number, no
    addresses beyond the destination they are standing in, no other stop on the trip. The
    token is unguessable, but "unguessable" is not a reason to hand a scanner the trip's
    contents.
    """

    trip_reference: str
    destination_name: str
    waybill_references: list[str]
    expires_at: datetime
    # Null until the receiver consents. Non-null tells a returning browser what already
    # happened, so the page can resume without remembering anything itself — which matters
    # because the vendor redirect lands in a fresh page load with no client state.
    verification: Optional["HandoverVerificationState"] = None


class HandoverConfirmRequest(BaseModel):
    receiver_name: str = Field(min_length=1, max_length=120)
    # Advisory shape only, never validated as an SA ID. A receiver may legitimately
    # present a passport or a company registration number, and a mistyped digit is itself
    # part of the record of what was produced at the door — the same reasoning the
    # driver-side PodSignature step applied to the field this replaces.
    receiver_id_number: str = Field(min_length=1, max_length=60)
    signature_png_base64: str = Field(max_length=MAX_SIGNATURE_B64_CHARS)
    receiver_lat: Optional[Decimal] = None
    receiver_lng: Optional[Decimal] = None
    receiver_accuracy_m: Optional[Decimal] = None

    @field_validator("signature_png_base64")
    @classmethod
    def validate_png(cls, v: str) -> str:
        """Accept a bare base64 payload or a full data URL, and prove it decodes to a PNG.

        Decoding here rather than in the endpoint means a malformed body is a 422 from the
        schema, which is where every other bad request in this codebase is decided — and
        the endpoint never has to hold a half-validated blob. The magic-number check is
        not a security control (resolve_mime_type re-derives the type from the bytes and
        is what actually decides); it is here so a client sending the wrong thing gets a
        useful 422 instead of a confusing failure three layers down.
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

    POPIA s27(1)(a) is the exemption this feature relies on to process biometrics at all,
    and that exemption is only as good as proof of WHAT was agreed to. The client sends the
    exact wording it displayed; the server stores its SHA-256, never the text.

    `consent_text` is bounded so an anonymous caller cannot post a novel into an
    unauthenticated route.
    """

    consent_text: str = Field(min_length=1, max_length=4000)
    # False when the receiver says they have no ID document on them. Not a refusal — it
    # routes them to the selfie-only tier, which still confirms the delivery.
    has_document: bool = True


class HandoverVerifyResponse(BaseModel):
    """Where to send the receiver next, or why we are not sending them anywhere.

    `session_url` is None on every degradation path — quota spent, vendor unreachable, no
    document. The client reads that as "go straight to signing at a lower tier", never as
    an error, because the delivery must remain confirmable.
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
