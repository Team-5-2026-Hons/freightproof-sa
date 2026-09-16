"""Didit identity-verification client — document and live-face checks on a receiver.

SESSION CREATE AND SESSION DECISION WERE OBSERVED LIVE ON 2026-09-15. A
COMPLETED id_verifications[] ITEM AND A WEBHOOK DELIVERY WERE NOT.

Same posture as pulsit.py: built behind IDVS_USE_MOCK, must not wait on a
commercial conversation. Every guess is quarantined in `_parse_decision()`
and the `_DIDIT_*` constants; `IdvsDecision` (what callers consume) is ours
and stable. Raw vendor JSON never leaves this module.

CONFIRMED against a real session (2026-09-15): POST /v3/session/ with an
x-api-key header, body {workflow_id, vendor_data, callback}; response
carries session_id and the hosted URL under `url`. GET
/v3/session/{id}/decision/ returns feature arrays at the top level and
spells the hosted URL `session_url` (unpopulated arrays are JSON null, not
[]). Status is one of Not Started/In Progress/Approved/Declined/In
Review/Abandoned/Expired/Kyc Expired/Resubmitted.

STILL ASSUMED (vendor docs only, check first if something's off): a
COMPLETED id_verifications[] item carries last_name/document_number; a
webhook nests the decision under `decision` and signs the raw body as hex
HMAC-SHA256 in X-Signature with unix seconds in X-Timestamp.

Layering: integrations -> config, mock_state only.

Scope: answers "start a check" and "what did it say" — no tier decision, no
DB write, no exception on a DECLINED decision (a result, not an error).
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Optional, Protocol

import httpx

from app.core.config import settings
from app.integrations.mock_state import MockStateStore, build_key, get_mock_state_store

logger = logging.getLogger(__name__)

_IDVS_KEY_KIND = "idvs"
_PROVIDER_DIDIT = "didit"

# --- The quarantined guesses -------------------------------------------------
_DIDIT_SESSION_PATH = "/v3/session/"
_DIDIT_DECISION_PATH = "/v3/session/{session_id}/decision/"
_DIDIT_API_KEY_HEADER = "x-api-key"
_DIDIT_FIELD_SESSION_ID = "session_id"
# The two endpoints spell the hosted-flow URL differently (`url` on create,
# `session_url` on decision) — read in order so a future unified vendor
# response doesn't break us.
_DIDIT_FIELDS_SESSION_URL = ("url", "session_url")
_DIDIT_FIELD_STATUS = "status"
# Webhook deliveries nest the whole decision under `decision`, a sibling of
# envelope fields; the decision endpoint puts the same arrays at top level.
# _extracted_identity handles both.
_DIDIT_FIELD_DECISION = "decision"
# A plural feature ARRAY, observed as JSON null (not []) before completion,
# so every read here has to survive None.
_DIDIT_FIELD_ID_VERIFICATIONS = "id_verifications"
_DIDIT_FIELD_SURNAME = "last_name"
_DIDIT_FIELD_ID_NUMBER = "document_number"
# Where the receiver returns when the hosted flow finishes; Didit appends
# ?verificationSessionId=&status= to whatever we give it.
_DIDIT_FIELD_CALLBACK = "callback"
# -----------------------------------------------------------------------------


class IdvsError(Exception):
    """The vendor could not be reached or answered unusably."""


class IdvsUnsupportedError(IdvsError):
    """A mock-only operation was attempted while IDVS_USE_MOCK is false."""


class IdvsDecisionStatus(str, Enum):
    """Didit's session vocabulary, not ours.

    Deliberately not ReceiverVerificationStatus (what WE concluded, stored)
    — collapsing them would bury orchestration's mapping decision in a parser.
    """

    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    APPROVED    = "approved"
    DECLINED    = "declined"
    IN_REVIEW   = "in_review"
    ABANDONED   = "abandoned"
    EXPIRED     = "expired"

    @classmethod
    def from_vendor(cls, raw: str) -> "IdvsDecisionStatus":
        """Map a vendor status string, defaulting unknown values to IN_PROGRESS
        (non-terminal, so the sweeper ages it out instead of recording a
        verdict the vendor never gave)."""
        normalised = raw.strip().lower().replace(" ", "_").replace("-", "_")
        try:
            return cls(normalised)
        except ValueError:
            logger.warning("Unrecognised IDVS session status from vendor: %r", raw)
            return cls.IN_PROGRESS

    @property
    def is_terminal(self) -> bool:
        return self in {
            IdvsDecisionStatus.APPROVED,
            IdvsDecisionStatus.DECLINED,
            IdvsDecisionStatus.ABANDONED,
            IdvsDecisionStatus.EXPIRED,
        }


@dataclass(frozen=True)
class IdvsSession:
    """A started verification. `session_url` is where the receiver's browser goes."""

    session_id: str
    session_url: str


@dataclass(frozen=True)
class IdvsDecision:
    """What the vendor concluded about one session.

    `extracted_surname`/`extracted_id_number` are None whenever the vendor
    returned no document data. Callers must treat None as "nothing to
    compare", never as "did not match".
    """

    session_id: str
    status: IdvsDecisionStatus
    extracted_surname: Optional[str] = None
    extracted_id_number: Optional[str] = None
    decided_at: Optional[datetime] = None


class IdvsClient(Protocol):
    """A Protocol (matching PulsitClient/ScanFeed) so a test can pass a stub
    without inheriting anything."""

    async def create_session(self, *, reference: str, callback_url: str) -> IdvsSession:
        """Start a verification. `reference` is our own opaque handle, echoed
        back by the vendor so a webhook can be tied to a handover.

        `callback_url` is required, not optional: without it the receiver
        never returns from the vendor's hosted flow and the verification
        sits PENDING until the sweeper abandons it — a required argument
        turns that into a type error instead of a silent outage.
        """
        ...

    async def get_decision(self, session_id: str) -> IdvsDecision:
        """The authoritative result for a session, fetched server-side with
        our API key — never derived from anything a client sent us."""
        ...


class MockIdvsClient:
    """Redis-backed stub — no network. IDVS_USE_MOCK=True selects it.

    Redis, not a module-level dict, since the API and Celery worker are
    separate processes (see mock_state.py). An unstaged session returns
    APPROVED so the ordinary demo path works without staging, and a
    reviewer has to deliberately stage a failure to see one.
    """

    def __init__(self, store: Optional[MockStateStore] = None) -> None:
        self._store = store if store is not None else get_mock_state_store()

    def _key(self, session_id: str) -> str:
        return build_key(_IDVS_KEY_KIND, session_id)

    def _require_mock_mode(self) -> None:
        """Guard every staging call. Mirrors MockPulsitClient.stage_position."""
        if not settings.IDVS_USE_MOCK:
            raise IdvsUnsupportedError(
                "Cannot stage an IDVS decision while IDVS_USE_MOCK is false"
            )

    async def create_session(self, *, reference: str, callback_url: str) -> IdvsSession:
        # callback_url is accepted and ignored: the mock has no hosted flow
        # to redirect, but keeping the parameter keeps this substitutable
        # for DiditIdvsClient.
        session_id = f"mock-{uuid.uuid4().hex}"
        await self._store.set_json(
            self._key(session_id),
            {"reference": reference, "created_at": datetime.now(UTC).isoformat()},
        )
        return IdvsSession(
            session_id=session_id,
            # Our own receiver app, not a vendor domain — no hosted flow in mock mode.
            session_url=f"{settings.HANDOVER_RECEIVER_BASE_URL.rstrip('/')}/mock-idvs/{session_id}",
        )

    async def stage_decision(
        self,
        session_id: str,
        *,
        status: IdvsDecisionStatus,
        extracted_surname: Optional[str] = None,
        extracted_id_number: Optional[str] = None,
    ) -> None:
        """Stage what the vendor will 'say' about a session. Dev panel / tests only."""
        self._require_mock_mode()
        existing = await self._store.get_json(self._key(session_id)) or {}
        await self._store.set_json(
            self._key(session_id),
            {
                **existing,
                "status": status.value,
                "extracted_surname": extracted_surname,
                "extracted_id_number": extracted_id_number,
            },
        )

    async def get_decision(self, session_id: str) -> IdvsDecision:
        staged: dict[str, Any] = await self._store.get_json(self._key(session_id)) or {}
        raw_status = staged.get("status")
        return IdvsDecision(
            session_id=session_id,
            status=(
                IdvsDecisionStatus(raw_status) if raw_status else IdvsDecisionStatus.APPROVED
            ),
            extracted_surname=staged.get("extracted_surname"),
            extracted_id_number=staged.get("extracted_id_number"),
            decided_at=datetime.now(UTC),
        )


def _extracted_identity(payload: dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    """Pull the surname and document number out of whichever shape we were handed.

    Two shapes reach this module and nest differently:

        decision endpoint   {"status": ..., "id_verifications": [ ... ]}
        webhook delivery    {"status": ..., "decision": {"id_verifications": [ ... ]}}

    When `decision` is present we look only inside it — falling back to the
    top level would let envelope fields impersonate document data.
    """
    block = payload.get(_DIDIT_FIELD_DECISION)
    source = block if isinstance(block, dict) else payload

    rows = source.get(_DIDIT_FIELD_ID_VERIFICATIONS)
    if not isinstance(rows, list) or not rows:
        return None, None

    first = rows[0]
    if not isinstance(first, dict):
        logger.warning("IDVS id_verifications[0] was not an object: %r", type(first))
        return None, None

    return (
        first.get(_DIDIT_FIELD_SURNAME) or None,
        first.get(_DIDIT_FIELD_ID_NUMBER) or None,
    )


def _parse_decision(payload: dict[str, Any], *, fallback_session_id: str) -> IdvsDecision:
    """Read one vendor decision object.

    THE quarantine point, along with _extracted_identity and the _DIDIT_*
    constants — the only things that should need to change when the
    vendor's shape moves.

    Tolerant by design: missing document data yields None fields rather
    than raising, since an abandoned/in-progress session legitimately has none.

    `status` is read from the top level in both shapes — a webhook carries
    it on the envelope beside `decision`, not inside it.
    """
    raw_status = payload.get(_DIDIT_FIELD_STATUS)
    surname, id_number = _extracted_identity(payload)

    return IdvsDecision(
        session_id=str(payload.get(_DIDIT_FIELD_SESSION_ID) or fallback_session_id),
        status=(
            IdvsDecisionStatus.from_vendor(str(raw_status))
            if raw_status is not None
            else IdvsDecisionStatus.IN_PROGRESS
        ),
        extracted_surname=surname,
        extracted_id_number=id_number,
        decided_at=datetime.now(UTC),
    )


class DiditIdvsClient:
    """Live Didit client. IDVS_USE_MOCK=False selects it.

    One short-lived httpx client per call, not a module-level pool — same
    event-loop-binding reason as RedisMockStateStore.
    """

    def _require_configuration(self) -> None:
        """A misconfiguration must be loud here, not a confusing failure three layers down."""
        if not settings.IDVS_API_URL or not settings.IDVS_API_KEY:
            raise IdvsError(
                "IDVS_USE_MOCK is false but IDVS_API_URL or IDVS_API_KEY is unset."
            )

    @property
    def _headers(self) -> dict[str, str]:
        return {_DIDIT_API_KEY_HEADER: settings.IDVS_API_KEY, "Accept": "application/json"}

    async def create_session(self, *, reference: str, callback_url: str) -> IdvsSession:
        self._require_configuration()
        url = settings.IDVS_API_URL.rstrip("/") + _DIDIT_SESSION_PATH
        body = {
            "workflow_id": settings.IDVS_WORKFLOW_ID,
            # Our own handle, echoed back on the webhook to tie a callback to a handover.
            "vendor_data": reference,
            # Didit appends ?verificationSessionId=&status= to this, which our
            # route ignores — the token it needs is in the path.
            _DIDIT_FIELD_CALLBACK: callback_url,
        }

        try:
            async with httpx.AsyncClient(timeout=settings.IDVS_SESSION_TIMEOUT_SECONDS) as http:
                response = await http.post(url, json=body, headers=self._headers)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            # Re-raised, never swallowed: orchestration degrades the tier on
            # IdvsError, and can only do that if told.
            logger.exception("IDVS session creation failed for reference=%s", reference)
            raise IdvsError("Could not create an IDVS session.") from exc

        session_id = payload.get(_DIDIT_FIELD_SESSION_ID)
        # First key present wins — this endpoint answers with `url`, decision
        # answers with `session_url` for the same value.
        session_url = next(
            (payload[field] for field in _DIDIT_FIELDS_SESSION_URL if payload.get(field)),
            None,
        )
        if not session_id or not session_url:
            raise IdvsError(
                "IDVS session response was missing session_id or a hosted session URL."
            )

        return IdvsSession(session_id=str(session_id), session_url=str(session_url))

    async def get_decision(self, session_id: str) -> IdvsDecision:
        self._require_configuration()
        path = _DIDIT_DECISION_PATH.format(session_id=session_id)
        url = settings.IDVS_API_URL.rstrip("/") + path

        try:
            async with httpx.AsyncClient(timeout=settings.IDVS_SESSION_TIMEOUT_SECONDS) as http:
                response = await http.get(url, headers=self._headers)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.exception("IDVS decision fetch failed for session=%s", session_id)
            raise IdvsError("Could not fetch the IDVS decision.") from exc

        return _parse_decision(payload, fallback_session_id=session_id)


def get_idvs_client() -> IdvsClient:
    """Select the mock or live client (mirrors get_pulsit_client()); flipping
    IDVS_USE_MOCK to false is the entire change once credentials arrive."""
    if settings.IDVS_USE_MOCK:
        return MockIdvsClient()
    return DiditIdvsClient()
