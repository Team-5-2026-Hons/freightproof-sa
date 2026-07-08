"""Parcel Perfect ecomService v28 API client.

PP uses a three-step auth flow before every fresh session:
  1. getSalt(email)              → salt
  2. MD5(password + salt)        → encrypted_password
  3. getSecureToken(email, enc.) → token_id

The token does not expire under normal use, so we cache it at module level
for the process lifetime. In mock mode the network is never touched.

PP JSON call shape (all GET):
  {PP_API_URL}?params={url-encoded JSON}&method={method}&class={class}&token_id={token}
token_id is omitted only for Auth.getSalt and Auth.getSecureToken.
"""

import hashlib
import json
import logging
import urllib.parse
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level token cache.
# Alive for the process lifetime — avoids a getSalt/getSecureToken round-trip
# on every waybill lookup. Cleared when get_single_waybill catches a ValueError,
# which triggers a one-shot re-auth retry in case the token was invalidated
# server-side (e.g. after a server restart or session expiry).
#
# Not protected by asyncio.Lock — concurrent requests may perform duplicate auth
# handshakes if _cached_token is None. In practice this wastes one round-trip;
# the resulting tokens are both valid and the last write wins. Acceptable for
# the current traffic level; add asyncio.Lock if this becomes a bottleneck.
# ---------------------------------------------------------------------------
_cached_token: Optional[str] = None

# ---------------------------------------------------------------------------
# HTTP timeout for all PP calls.
# PP's spec gives no explicit SLA; 15 s matches our Hedera bound as a safe cap.
# ---------------------------------------------------------------------------
_PP_TIMEOUT_SECONDS: float = 15.0


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
# Mock fixture
# ---------------------------------------------------------------------------

MOCK_WAYBILL_RESPONSE = PPWaybillResponse(
    details=PPWaybillDetails(
        waybill="MOCKWAY001",
        waydate="01.01.2024",
        pieces=2,
        duedate="03.01.2024",
        declared_value=1500.00,
        dest_address="1 Hertzog Boulevard",
        dest_town="CAPE TOWN",
        dest_person="Mock Receiver",
        dest_contact="0210000001",
        orig_person="Mock Shipper",
        orig_town="JOHANNESBURG",
        orig_address="1 Mock Street",
        service="ONX",
        actual_weight_kg=10.0,
        freight_total=None,
        poddate="",
        failtype=None,
        client_reference="MOCKREF001",
    ),
    contents=[
        PPContents(item=1, description="General Cargo", actmass=10.0, pieces=2),
    ],
    tracks=[
        PPTrack(trackno="MOCKWAY0010001", parcelno=1, item=1),
        PPTrack(trackno="MOCKWAY0010002", parcelno=2, item=1),
    ],
    wayrefs=[],
)


# ---------------------------------------------------------------------------
# Mock client
# ---------------------------------------------------------------------------


class MockParcelPerfectClient:
    """Drop-in stub that returns MOCK_WAYBILL_RESPONSE without any network call.

    Used when PP_USE_MOCK=True so developers and CI can work without PP credentials.
    """

    async def get_single_waybill(self, waybill_number: str) -> PPWaybillResponse:
        """Return the module-level mock fixture unconditionally."""
        logger.info("MockParcelPerfectClient.get_single_waybill waybill=%s", waybill_number)
        return MOCK_WAYBILL_RESPONSE


# ---------------------------------------------------------------------------
# Real client
# ---------------------------------------------------------------------------


class ParcelPerfectClient:
    """Async client for the Parcel Perfect ecomService v28 JSON API.

    Auth is performed lazily on the first call and the token is cached
    at module level for subsequent calls within the same process.
    """

    async def _make_call(
        self,
        class_name: str,
        method: str,
        params: dict[str, object],
        token: Optional[str] = None,
    ) -> list:
        """Execute a single PP JSON GET request and return the `results` list.

        `token` is omitted only for Auth.getSalt and Auth.getSecureToken — in
        those cases pass token=None and it will not be appended to the query string.

        Raises ValueError if PP returns errorcode != 0.
        Raises httpx.HTTPStatusError on non-2xx HTTP responses.
        """
        # urllib.parse.urlencode ensures special characters in param values
        # are percent-encoded — manual string building breaks on addresses, etc.
        query: dict[str, str] = {
            "params": json.dumps(params),
            "method": method,
            "class": class_name,
        }
        if token is not None:
            query["token_id"] = token

        url = f"{settings.PP_API_URL}?{urllib.parse.urlencode(query)}"

        async with httpx.AsyncClient(timeout=_PP_TIMEOUT_SECONDS) as client:
            response = await client.get(url)

        response.raise_for_status()

        # httpx's .json() returns Any — we annotate the dict keys as str but leave
        # values as Any because the PP response schema is not statically knowable here.
        body: dict[str, Any] = response.json()
        errorcode: int = body.get("errorcode", -1)
        errormessage: str = body.get("errormessage", "unknown PP error")

        if errorcode != 0:
            logger.error(
                "PP API error class=%s method=%s errorcode=%s message=%s",
                class_name,
                method,
                errorcode,
                errormessage,
            )
            raise ValueError(f"Parcel Perfect error {errorcode}: {errormessage}")

        return body.get("results", [])

    async def _get_token(self) -> str:
        """Return a valid PP token_id, running the auth flow if not yet cached.

        If PP_API_TOKEN is set in config it is used directly, skipping the
        getSalt/getSecureToken round-trip. This supports pre-issued tokens that
        PP sometimes provides alongside credentials.

        Auth steps (only when PP_API_TOKEN is empty) follow the v28 spec:
          getSalt(email) → salt
          MD5(password + salt) → encrypted_password
          getSecureToken(email, encrypted_password) → token_id
        """
        global _cached_token
        if _cached_token is not None:
            return _cached_token

        # Use the pre-issued token directly if configured — no auth round-trip needed.
        if settings.PP_API_TOKEN:
            _cached_token = settings.PP_API_TOKEN
            logger.info("PP pre-issued token loaded from config")
            return _cached_token

        email = settings.PP_API_KEY
        password = settings.PP_API_PASSWORD

        # Step 1: fetch a per-session salt tied to the account email.
        salt_results = await self._make_call(
            class_name="Auth",
            method="getSalt",
            params={"email": email},
        )
        if not salt_results:
            raise ValueError("PP getSalt returned empty results")
        salt: str = salt_results[0]["salt"]

        # Step 2: hash exactly as the v28 spec requires — MD5(password + salt).
        encrypted_password = hashlib.md5(f"{password}{salt}".encode()).hexdigest()

        # Step 3: exchange credentials for a session token.
        token_results = await self._make_call(
            class_name="Auth",
            method="getSecureToken",
            params={"email": email, "encrypted_password": encrypted_password},
        )
        if not token_results:
            raise ValueError("PP getSecureToken returned empty results")
        token: str = token_results[0]["token_id"]

        _cached_token = token
        logger.info("PP token obtained and cached for process lifetime")
        return _cached_token

    def _parse_waybill_response(self, raw: dict[str, Any]) -> PPWaybillResponse:
        """Map a single entry from PP's getSingleWaybill `results` list to PPWaybillResponse.

        PP field names are kept as-is in the dataclasses where they match the spec;
        only `declaredvalue` and dest fields are renamed for Python clarity.
        """
        details_raw: dict[str, Any] = raw.get("details", {})

        # PP returns failtype as null (None) when no failure has been recorded.
        # We preserve that distinction: None = no failure, string = failure reason.
        failtype_raw = details_raw.get("failtype")
        failtype: Optional[str] = str(failtype_raw) if failtype_raw is not None else None

        details = PPWaybillDetails(
            waybill=details_raw["waybill"],
            waydate=details_raw.get("waydate", ""),
            pieces=int(details_raw.get("pieces", 0)),
            duedate=details_raw.get("duedate", ""),
            declared_value=float(details_raw["declaredvalue"]) if details_raw.get("declaredvalue") is not None else None,
            # Destination
            dest_address=details_raw.get("destperadd1", ""),
            dest_town=details_raw.get("desttown", ""),
            dest_person=details_raw.get("destpers", ""),
            dest_contact=details_raw.get("destpertel", ""),
            # Origin
            orig_person=details_raw.get("origpers", ""),
            orig_town=details_raw.get("origtown", ""),
            orig_address=details_raw.get("origperadd1", ""),
            # Service
            service=details_raw.get("service", ""),
            actual_weight_kg=float(details_raw["actkg"]) if details_raw.get("actkg") is not None else None,
            freight_total=float(details_raw["total"]) if details_raw.get("total") is not None else None,
            # POD / failure
            poddate=details_raw.get("poddate", ""),
            failtype=failtype,
            # Client reference (first wayref, if present — also stored in wayrefs list)
            client_reference=details_raw.get("reference", ""),
        )

        contents = [
            PPContents(
                item=int(c["item"]) if c.get("item") is not None else 0,
                description=c.get("description") or "",
                actmass=float(c["actmass"]) if c.get("actmass") is not None else 0.0,
                pieces=int(c["pieces"]) if c.get("pieces") is not None else 0,
            )
            for c in raw.get("contents", [])
        ]

        tracks = [
            PPTrack(
                trackno=t["trackno"],
                parcelno=int(t["parcelno"]) if t.get("parcelno") is not None else 0,
                item=int(t["item"]) if t.get("item") is not None else 0,
            )
            for t in raw.get("tracks", [])
            if t.get("trackno")  # skip malformed entries with no barcode
        ]

        wayrefs = [
            PPWaybillRef(
                reference=r.get("reference", ""),
                pageno=int(r["pageno"]) if r.get("pageno") is not None else 0,
            )
            for r in raw.get("wayrefs", [])
        ]

        return PPWaybillResponse(details=details, contents=contents, tracks=tracks, wayrefs=wayrefs)

    async def get_single_waybill(self, waybill_number: str) -> PPWaybillResponse:
        """Fetch a waybill from Parcel Perfect and return a typed PPWaybillResponse.

        Authenticates lazily on first call. If the first attempt raises ValueError
        and a cached token exists, we clear the cache and retry once — the token may
        have been invalidated server-side (session expiry, server restart, etc.).
        """
        global _cached_token

        token = await self._get_token()
        logger.info("ParcelPerfectClient.get_single_waybill waybill=%s", waybill_number)

        try:
            results = await self._make_call(
                "Waybill", "getSingleWaybill", {"waybillno": waybill_number}, token=token
            )
        except ValueError as exc:
            err_str = str(exc).lower()
            # Only retry when the failure looks like a token/session problem.
            # Domain errors (e.g. "Waybill not found") must not trigger re-auth,
            # as that would waste two extra network calls per bad waybill number.
            is_auth_failure = any(
                kw in err_str for kw in ("token", "auth", "session", "invalid credentials")
            )
            if _cached_token is not None and is_auth_failure:
                # Token invalidated server-side; clear cache and retry once.
                logger.warning("PP auth failure detected; clearing token cache and retrying")
                _cached_token = None
                token = await self._get_token()
                results = await self._make_call(
                    "Waybill", "getSingleWaybill", {"waybillno": waybill_number}, token=token
                )
            else:
                raise

        if not results:
            raise ValueError(f"PP returned empty results for waybill {waybill_number}")

        return self._parse_waybill_response(results[0])


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_pp_client() -> ParcelPerfectClient | MockParcelPerfectClient:
    """Return the appropriate PP client based on settings.PP_USE_MOCK.

    Callers should depend on this factory rather than instantiating clients
    directly so that mock/real behaviour is controlled centrally via config.
    """
    if settings.PP_USE_MOCK:
        return MockParcelPerfectClient()
    return ParcelPerfectClient()
