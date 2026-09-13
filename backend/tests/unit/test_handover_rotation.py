"""FP-237 — the rotating series, its pause, and the one-confirmation guarantee.

The series is many capability tokens against ONE phase event. Two behaviours make it a
series rather than a pile of independent grants, and both are exercised here:

  * Issuing the next code retires the one before it, so at most one is ever live.
  * A code a receiver has actually OPENED stops the rotation, so it is not retired out
    from under them while they type. Without this the feature does not work at all —
    every real handover takes longer than one rotation interval.

The third behaviour covered here is the browser binding: opening a token mints a secret
exactly once, so a forwarded URL opened in a second browser gets nothing and cannot
confirm.

The single-token branches (unknown, wrong-trip, wrong-stop, expired, already-redeemed)
live in test_handover_service.py and are not repeated here.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.db.models.handover import HandoverCapabilityToken
from app.orchestration.handover_service import (
    expire_sibling_tokens,
    find_open_token,
    mark_token_opened,
    redeem_capability_token,
    rotate_capability_token,
    session_secret_matches,
)
from tests.unit.test_handover_service import _seed

# _seed returns plain ids, not ORM objects:
# {"trip_id", "stop_id", "other_stop_id", "other_trip_id", "phase_event_id"}.


async def _rotate(db_session, seeded, *, force: bool = False):
    return await rotate_capability_token(
        db_session,
        phase_event_id=seeded["phase_event_id"],
        trip_id=seeded["trip_id"],
        trip_stop_id=seeded["stop_id"],
        force=force,
    )


async def test_rotate_issues_a_different_token_each_call(db_session):
    seeded = await _seed(db_session, tag="rot1")

    first = await _rotate(db_session, seeded)
    second = await _rotate(db_session, seeded)

    assert first.raw_token != second.raw_token
    assert first.paused is False and second.paused is False


async def test_rotating_retires_the_previous_token(db_session):
    seeded = await _seed(db_session, tag="rot2")
    stale = await _rotate(db_session, seeded)

    await _rotate(db_session, seeded)

    result = await redeem_capability_token(
        db_session,
        trip_id=seeded["trip_id"],
        trip_stop_id=seeded["stop_id"],
        raw_token=stale.raw_token,
    )
    assert result.success is False


async def test_the_newest_token_still_redeems(db_session):
    seeded = await _seed(db_session, tag="rot3")
    await _rotate(db_session, seeded)
    current = await _rotate(db_session, seeded)

    result = await redeem_capability_token(
        db_session,
        trip_id=seeded["trip_id"],
        trip_stop_id=seeded["stop_id"],
        raw_token=current.raw_token,
    )

    assert result.success is True


async def test_rotation_pauses_once_the_receiver_opens_the_code(db_session):
    seeded = await _seed(db_session, tag="rot4")
    held = await _rotate(db_session, seeded)
    await mark_token_opened(db_session, token_id=held.token.id)

    nxt = await _rotate(db_session, seeded)

    assert nxt.paused is True
    assert nxt.raw_token is None
    assert nxt.token.id == held.token.id


async def test_an_opened_code_survives_a_rotation_and_still_redeems(db_session):
    # The regression this whole mechanism exists for: a receiver scans, then takes
    # longer than one rotation interval to type their name, and must still be able to
    # confirm the delivery at the end of it.
    seeded = await _seed(db_session, tag="rot5")
    held = await _rotate(db_session, seeded)
    await mark_token_opened(db_session, token_id=held.token.id)

    await _rotate(db_session, seeded)
    await _rotate(db_session, seeded)

    result = await redeem_capability_token(
        db_session,
        trip_id=seeded["trip_id"],
        trip_stop_id=seeded["stop_id"],
        raw_token=held.raw_token,
    )
    assert result.success is True


async def test_opening_twice_does_not_move_the_claim_forward(db_session):
    seeded = await _seed(db_session, tag="rot6")
    held = await _rotate(db_session, seeded)

    await mark_token_opened(db_session, token_id=held.token.id)
    first_opened_at = (
        await db_session.execute(
            select(HandoverCapabilityToken.opened_at).where(
                HandoverCapabilityToken.id == held.token.id
            )
        )
    ).scalar_one()
    await mark_token_opened(db_session, token_id=held.token.id)

    second_opened_at = (
        await db_session.execute(
            select(HandoverCapabilityToken.opened_at).where(
                HandoverCapabilityToken.id == held.token.id
            )
        )
    ).scalar_one()
    assert first_opened_at == second_opened_at


async def test_only_the_first_browser_to_open_gets_a_session_secret(db_session):
    # The anti-forwarding property. The receiver screenshots the URL and sends it on;
    # the second browser opens the same link and must come away with nothing.
    seeded = await _seed(db_session, tag="rot10")
    held = await _rotate(db_session, seeded)

    first_secret = await mark_token_opened(db_session, token_id=held.token.id)
    forwarded_secret = await mark_token_opened(db_session, token_id=held.token.id)

    assert first_secret is not None
    assert forwarded_secret is None


async def test_the_minted_secret_matches_and_others_do_not(db_session):
    seeded = await _seed(db_session, tag="rot11")
    held = await _rotate(db_session, seeded)
    secret = await mark_token_opened(db_session, token_id=held.token.id)
    await db_session.refresh(held.token)

    assert session_secret_matches(held.token, secret) is True
    assert session_secret_matches(held.token, "not-the-secret") is False
    assert session_secret_matches(held.token, None) is False


async def test_an_unopened_token_matches_no_secret_at_all(db_session):
    seeded = await _seed(db_session, tag="rot12")
    held = await _rotate(db_session, seeded)

    assert session_secret_matches(held.token, "anything") is False


async def test_force_retires_a_stranded_open_token_and_starts_over(db_session):
    # The escape hatch: the receiver opened the link and then lost the browser session
    # holding their cookie. The driver shows a new code rather than waiting out the grant.
    seeded = await _seed(db_session, tag="rot13")
    stranded = await _rotate(db_session, seeded)
    await mark_token_opened(db_session, token_id=stranded.token.id)

    fresh = await _rotate(db_session, seeded, force=True)

    assert fresh.paused is False
    assert fresh.raw_token is not None
    stale = await redeem_capability_token(
        db_session,
        trip_id=seeded["trip_id"],
        trip_stop_id=seeded["stop_id"],
        raw_token=stranded.raw_token,
    )
    assert stale.success is False


async def test_an_expired_open_token_does_not_pause_the_series_forever(db_session):
    # A receiver who opens the page and then walks away must not wedge the handover:
    # the open token dies at its own expiry and the rotation resumes.
    seeded = await _seed(db_session, tag="rot7")
    held = await _rotate(db_session, seeded)
    await mark_token_opened(db_session, token_id=held.token.id)
    held.token.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.flush()

    resumed = await _rotate(db_session, seeded)

    assert resumed.paused is False
    assert resumed.raw_token is not None


async def test_find_open_token_is_none_before_any_scan(db_session):
    seeded = await _seed(db_session, tag="rot8")
    await _rotate(db_session, seeded)

    assert await find_open_token(db_session, phase_event_id=seeded["phase_event_id"]) is None


async def test_expire_siblings_leaves_the_named_token_alone(db_session):
    seeded = await _seed(db_session, tag="rot9")
    keep = await _rotate(db_session, seeded)

    await expire_sibling_tokens(
        db_session, phase_event_id=seeded["phase_event_id"], keep_token_id=keep.token.id,
    )

    result = await redeem_capability_token(
        db_session,
        trip_id=seeded["trip_id"],
        trip_stop_id=seeded["stop_id"],
        raw_token=keep.raw_token,
    )
    assert result.success is True
