"""Didit identity-verification client — document and live-face checks on a receiver.

╔══════════════════════════════════════════════════════════════════════════════╗
║  SESSION CREATE AND SESSION DECISION WERE OBSERVED LIVE ON 2026-09-15.        ║
║  A COMPLETED id_verifications[] ITEM AND A WEBHOOK DELIVERY WERE NOT.         ║
╚══════════════════════════════════════════════════════════════════════════════╝

Same posture as pulsit.py, for the same reason: the integration is built now behind
IDVS_USE_MOCK and must not wait on a commercial conversation. Every guess is quarantined
in exactly two places:

    _parse_decision()        how one decision object is read
    the _DIDIT_* constants   paths, headers and field names

`IdvsDecision` — what callers actually consume — is ours, not Didit's, and is designed
not to move. Raw vendor JSON never leaves this module.

Evidence inventory, so a reviewer can tell what is known from what is still assumed.

CONFIRMED against a real session created on the live API (2026-09-15):

  * POST /v3/session/ with an x-api-key header, body {workflow_id, vendor_data, callback}.
  * Its response carries session_id and the hosted URL under `url`.
  * GET /v3/session/{id}/decision/ returns the feature arrays at the TOP level, and
    spells the same hosted URL `session_url` here. Unpopulated arrays come back as
    JSON null, not [].
  * Status is a string among Not Started / In Progress / Approved / Declined /
    In Review / Abandoned / Expired / Kyc Expired / Resubmitted.

STILL ASSUMED, from vendor documentation only — these are what to check first when
something does not line up:

  * A COMPLETED id_verifications[] item carries last_name and document_number. The array
    itself was observed; a populated one was not, because completing a session needs a
    real document in front of a real camera.
  * A webhook delivery nests the decision under `decision`, alongside envelope fields,
    and signs the raw body as hex HMAC-SHA256 in X-Signature with unix seconds in
    X-Timestamp. No delivery has been received yet.

Layering: integrations -> config, mock_state. Never imports from api/ or orchestration/.

Scope: this module answers "start a check" and "what did the check say". It does not
decide a tier, does not write to the database, and raises no exception on a DECLINED
decision — a decline is a result, not an error, and orchestration owns what it means.
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
# The two endpoints spell the hosted-flow URL DIFFERENTLY, which is why this is a tuple
# read in order rather than a single name. Observed 2026-09-15 against a real session:
# POST /v3/session/ answers with `url` and carries no `session_url`; GET .../decision/
# answers with `session_url` and carries no `url`. Only create_session consumes this, but
# reading both means a vendor that unifies them later does not break us.
_DIDIT_FIELDS_SESSION_URL = ("url", "session_url")
_DIDIT_FIELD_STATUS = "status"
# Webhook deliveries nest the whole decision under `decision`, as a sibling of the
# envelope fields; the decision endpoint returns the same feature arrays at the top level.
# _extracted_identity below handles both, which is why this constant still exists.
_DIDIT_FIELD_DECISION = "decision"
# Extracted document data lives in a plural feature ARRAY, not a flat object — each item
# carries the node_id of the workflow step that produced it. Observed as `null` (not `[]`)
# on a session that has not completed, so every read here has to survive None.
_DIDIT_FIELD_ID_VERIFICATIONS = "id_verifications"
_DIDIT_FIELD_SURNAME = "last_name"
_DIDIT_FIELD_ID_NUMBER = "document_number"
# Where the receiver is returned to when the hosted flow finishes. Per-session, and Didit
# appends ?verificationSessionId=&status= to whatever we give it.
_DIDIT_FIELD_CALLBACK = "callback"
# -----------------------------------------------------------------------------


class IdvsError(Exception):
    """The vendor could not be reached or answered unusably."""


class IdvsUnsupportedError(IdvsError):
    """A mock-only operation was attempted while IDVS_USE_MOCK is false."""


class IdvsDecisionStatus(str, Enum):
    """Didit's session vocabulary, not ours.

    Deliberately NOT ReceiverVerificationStatus. That enum is what we store and means
    what WE concluded; this is what the vendor said. Collapsing them would bury the
    mapping — which is a judgement call orchestration owns — inside a parser.
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
        """Map a vendor status string, defaulting unknown values to IN_PROGRESS.

        Unknown rather than raising: a vendor adding a status we have not seen must not
        turn every handover into a 500. IN_PROGRESS is the safe default because it is
        non-terminal — the sweeper will age it out rather than a trip recording a verdict
        the vendor never gave.
        """
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

    `extracted_surname` and `extracted_id_number` are None whenever the vendor returned
    no document data — an abandoned session, or a workflow that captured no document.
    Callers must treat None as "nothing to compare", never as "did not match".
    """

    session_id: str
    status: IdvsDecisionStatus
    extracted_surname: Optional[str] = None
    extracted_id_number: Optional[str] = None
    decided_at: Optional[datetime] = None


class IdvsClient(Protocol):
    """A Protocol rather than a base class, matching PulsitClient and ScanFeed: it lets a
    test pass a stub without inheriting anything.
    """

    async def create_session(self, *, reference: str, callback_url: str) -> IdvsSession:
        """Start a verification. `reference` is our own opaque handle, echoed back by the
        vendor so a webhook can be tied to a handover without trusting the browser.

        `callback_url` is REQUIRED rather than optional, and deliberately so: without it
        the vendor's hosted flow ends on the vendor's own domain and the receiver never
        comes back to us. The verification then sits PENDING until the sweeper calls it
        abandoned, and the delivery confirms at a degraded tier for no reason anyone can
        see. A required argument makes that a type error instead of a silent outage.
        """
        ...

    async def get_decision(self, session_id: str) -> IdvsDecision:
        """The authoritative result for a session. Never derived from anything a client
        sent us — this call, made server-side with our API key, IS the authority.
        """
        ...


class MockIdvsClient:
    """Redis-backed stub — no network. IDVS_USE_MOCK=True selects it.

    Redis rather than a module-level dict for the reason mock_state.py exists: the API
    and the Celery worker are separate processes, so a decision staged in one would be
    invisible to the other.

    An unstaged session returns APPROVED. That default is chosen so the ordinary demo
    path — scan, verify, confirm — works with no staging at all, and a reviewer has to
    deliberately stage a failure to see one.
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
        # callback_url is accepted and ignored on purpose. The mock's session_url already
        # points back into our own app, so there is nothing for a vendor to redirect; the
        # parameter exists so this class stays substitutable for DiditIdvsClient and a
        # test that forgets the callback fails in the mock too, not only in production.
        session_id = f"mock-{uuid.uuid4().hex}"
        await self._store.set_json(
            self._key(session_id),
            {"reference": reference, "created_at": datetime.now(UTC).isoformat()},
        )
        return IdvsSession(
            session_id=session_id,
            # Points at our own receiver app rather than a vendor domain: in mock mode
            # there is no hosted flow to visit, and a dead external link would make a
            # demo look broken for a reason that has nothing to do with the feature.
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

    Two shapes reach this module and they nest differently, which is the entire reason
    this is a function rather than two dictionary lookups:

        decision endpoint   {"status": ..., "id_verifications": [ ... ]}
        webhook delivery    {"status": ..., "decision": {"id_verifications": [ ... ]}}

    When `decision` is present we look ONLY inside it. Falling back to the top level after
    an empty decision block would let envelope fields impersonate document data.

    Every step is defensive because every step has a real None case: the arrays come back
    as JSON null before a session completes (observed, not hypothesised), a declined or
    abandoned session carries no document at all, and a workflow without the ID step never
    produces one. None means "nothing to compare" everywhere upstream, never "no match".
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

    THE quarantine point. This function, _extracted_identity and the _DIDIT_* constants
    above are the only things that should need to change when the vendor's shape moves —
    every caller consumes IdvsDecision, which is ours.

    Tolerant by design: missing document data yields None extracted fields rather than
    raising, because an abandoned or in-progress session legitimately has none, and a
    parser that raises on the ordinary case would turn a normal outcome into a 500.

    `status` is read from the top level in both shapes — a webhook carries it on the
    envelope beside `decision`, not inside it.
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

    One short-lived httpx client per call rather than a module-level pool, for the reason
    RedisMockStateStore gives: a pool binds to whichever event loop first touched it,
    which breaks under Celery's asyncio.run() per task and pytest's function-scoped loops.
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
            # Our own handle, echoed back on the webhook. It is how a vendor callback is
            # tied to a handover without the browser ever naming a session.
            "vendor_data": reference,
            # Where the receiver lands when the hosted flow finishes. Didit appends
            # ?verificationSessionId=&status= to it, which our route ignores — the token
            # it needs is in the path, and nothing the vendor appends is trusted anyway.
            _DIDIT_FIELD_CALLBACK: callback_url,
        }

        try:
            async with httpx.AsyncClient(timeout=settings.IDVS_SESSION_TIMEOUT_SECONDS) as http:
                response = await http.post(url, json=body, headers=self._headers)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            # Logged and re-raised, never swallowed: orchestration degrades the tier on
            # IdvsError, and it can only do that if it is told.
            logger.exception("IDVS session creation failed for reference=%s", reference)
            raise IdvsError("Could not create an IDVS session.") from exc

        session_id = payload.get(_DIDIT_FIELD_SESSION_ID)
        # First key present wins. This endpoint was observed to answer with `url`; the
        # decision endpoint uses `session_url` for the same value, and an earlier version
        # of this client read only the latter — which made every live session creation
        # raise, degrade the tier, and send the receiver past the check without one.
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
    """Select the mock or the live client. Mirrors get_pulsit_client()'s factory shape.

    The day credentials arrive, flipping IDVS_USE_MOCK to false is the entire change.
    """
    if settings.IDVS_USE_MOCK:
        return MockIdvsClient()
    return DiditIdvsClient()
