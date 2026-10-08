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
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.integrations.parcel_perfect.errors import PPUnsupportedError, PPWaybillNotFoundError
from app.integrations.parcel_perfect.models import (
    PPContents,
    PPManifestResponse,
    PPTrack,
    PPWaybillDetails,
    PPWaybillRef,
    PPWaybillResponse,
)

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
# Real client
# ---------------------------------------------------------------------------


class ParcelPerfectClient:
    """Async client for the Parcel Perfect ecomService v28 JSON API.

    Auth is performed lazily on the first call and the token is cached
    at module level for subsequent calls within the same process.
    """

    supports_manifest_lookup: bool = False

    async def get_manifest(self, manifest_number: int) -> PPManifestResponse:
        raise PPUnsupportedError(
            "PP v28 exposes no manifest lookup — an assumed data contract until PP offers one (FP-281 §8)"
        )

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
            # Customer account / name — resolves the client Organization downstream.
            accnum=details_raw.get("accnum", ""),
            custname=details_raw.get("custname", ""),
            # 0 or absent means "not yet manifested" — normalise to None.
            manifest=int(m) if (m := details_raw.get("manifest")) and int(m) > 0 else None,
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
            elif "not found" in err_str:
                # PP returned errorcode != 0 with a "not found" message — this is a
                # domain error (the waybill doesn't exist), not an auth/transport
                # failure.  Surface it as PPWaybillNotFoundError so the endpoint
                # returns 404 instead of 502.
                raise PPWaybillNotFoundError(waybill_number) from exc
            else:
                raise

        if not results:
            # Empty results with errorcode 0 is PP's "no matching waybill" signal —
            # distinguish this from genuine API/auth errors (raised above as ValueError)
            # so callers can fail closed on a real not-found without conflating it
            # with transport/auth failures.
            raise PPWaybillNotFoundError(waybill_number)

        return self._parse_waybill_response(results[0])
