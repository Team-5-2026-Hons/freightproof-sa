"""Receiver consent and custody completion on independent committed DB sessions."""
import asyncio
import uuid

import pytest
from sqlalchemy import delete, func, select

from app.core.exceptions import TripHandedOverError
from app.db.models.handover import HandoverCapabilityToken, HandoverConfirmation, HandoverTokenAttempt
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.db.models.phases import PhaseEvent
from app.db.models.trips import DriverSubstitution, Trip
from app.db.models.enums import TripStatus
from app.db.models.driver_substitutions import DriverSubstitutionRequest
from app.orchestration.substitutions import service
from app.schemas.driver_substitutions import ReplaceImmediateSubstitutionRequest
from tests.integration.test_driver_substitution_service import dispatcher, capture, driver_actor
from app.orchestration.handover.capability import issue_capability_token
from app.orchestration.handover.service import load_confirmation_target_for_write, submit_consent
from tests.integration.test_driver_substitution_concurrency import (
    _handover, sessionmaker as committed_sessions, world as committed_world,
)

sessionmaker = committed_sessions
world = committed_world


@pytest.mark.parametrize('held', [False, True])
@pytest.mark.parametrize('immediate', [False, True])
async def test_receiver_consent_races_transfer_without_retargeting(sessionmaker, world, held, immediate):
    async with sessionmaker() as db:
        trip = await db.get(Trip, world.trip_id)
        if held:
            trip.status = TripStatus.EXCEPTION_HOLD
        if immediate:
            pending = (await db.execute(select(DriverSubstitutionRequest).where(
                DriverSubstitutionRequest.trip_id == world.trip_id,
                DriverSubstitutionRequest.state == 'pending',
            ))).scalar_one()
            await service.replace_substitution(db, trip_id=world.trip_id, request_id=pending.id, actor=dispatcher(world),
                payload=ReplaceImmediateSubstitutionRequest(client_request_id=uuid.uuid4(), request_format='immediate_v2',
                    incoming_driver_id=world.b, reason='Receiver race', replacement_reason='Use v2', expected_version=pending.version))
        _, token = await issue_capability_token(
            db, phase_event_id=world.confirmation_id, trip_id=world.trip_id, trip_stop_id=(await db.get(PhaseEvent, world.confirmation_id)).trip_stop_id,
        )
        token_id, expiry = token.id, token.expires_at
        await db.commit()

    ready = asyncio.Event()

    async def consent():
        async with sessionmaker() as db:
            token = await db.get(HandoverCapabilityToken, token_id)
            await ready.wait()
            result = await submit_consent(db, token=token, consent_text='I agree', consented=True, has_document=False)
            await db.commit()
            return result.verification.id

    async def transfer():
        async with sessionmaker() as db:
            await ready.wait()
            if immediate:
                pending = (await db.execute(select(DriverSubstitutionRequest).where(
                    DriverSubstitutionRequest.trip_id == world.trip_id,
                    DriverSubstitutionRequest.state == 'pending',
                ))).scalar_one()
                await service.confirm_substitution(db, trip_id=world.trip_id, request_id=pending.id,
                    actor=await driver_actor(db, world.b), payload=capture(world, pending.version))
            else:
                await _handover(db, world)
            await db.commit()

    tasks = [asyncio.create_task(consent()), asyncio.create_task(transfer())]
    ready.set()
    try:
        verification_id, _ = await asyncio.wait_for(asyncio.gather(*tasks), timeout=10)
        async with sessionmaker() as db:
            token = await db.get(HandoverCapabilityToken, token_id)
            verification = await db.get(ReceiverIdentityVerification, verification_id)
            trip = await db.get(Trip, world.trip_id)
            assert (token.phase_event_id, token.expires_at) == (world.confirmation_id, expiry)
            assert verification.token_id == token_id and verification.consent_given_at is not None
            assert await db.scalar(select(func.count()).select_from(DriverSubstitution).where(DriverSubstitution.trip_id == world.trip_id)) == 1
            assert await db.scalar(select(func.count()).select_from(HandoverConfirmation).where(HandoverConfirmation.trip_id == world.trip_id)) == 0
            assert trip.status == (TripStatus.EXCEPTION_HOLD if held else TripStatus.ACTIVE)
            with pytest.raises(TripHandedOverError):
                await load_confirmation_target_for_write(db, trip_id=world.trip_id, phase_event_id=world.confirmation_id, driver_id=world.a, custody_sequence=0)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        async with sessionmaker() as db:
            await db.execute(delete(ReceiverIdentityVerification).where(ReceiverIdentityVerification.token_id == token_id))
            await db.execute(delete(HandoverTokenAttempt).where(HandoverTokenAttempt.token_id == token_id))
            await db.execute(delete(HandoverCapabilityToken).where(HandoverCapabilityToken.id == token_id))
            await db.commit()
