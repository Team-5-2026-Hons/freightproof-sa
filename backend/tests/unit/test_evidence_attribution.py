"""cited_attribution_error: the rule completion applies to an artifact a driver cites.

Pure logic. A cited artifact may be unattributed (older apps, queued entries) but must
never be attributed to a different phase or role than the field it is cited in.
"""

import uuid

import pytest

from app.db.models.enums import EvidenceRole
from app.orchestration.evidence.attribution import cited_attribution_error


def test_unattributed_artifact_is_accepted():
    error = cited_attribution_error(
        cited_role=EvidenceRole.SEAL_PHOTO, phase_event_id=uuid.uuid4(),
        artifact_phase_event_id=None, artifact_role=None,
    )

    assert error is None


def test_artifact_attributed_to_the_same_phase_and_role_is_accepted():
    phase_id = uuid.uuid4()

    error = cited_attribution_error(
        cited_role=EvidenceRole.SEAL_PHOTO, phase_event_id=phase_id,
        artifact_phase_event_id=phase_id, artifact_role=EvidenceRole.SEAL_PHOTO,
    )

    assert error is None


def test_artifact_attributed_to_another_phase_is_rejected():
    error = cited_attribution_error(
        cited_role=EvidenceRole.SEAL_PHOTO, phase_event_id=uuid.uuid4(),
        artifact_phase_event_id=uuid.uuid4(), artifact_role=EvidenceRole.SEAL_PHOTO,
    )

    assert error is not None
    assert "phase" in error


@pytest.mark.parametrize(
    ("cited_role", "artifact_role"),
    [
        (EvidenceRole.SEAL_PHOTO, EvidenceRole.LINEHAUL_PHOTO),
        (EvidenceRole.POD_PHOTO, EvidenceRole.POD_SIGNATURE),
        (EvidenceRole.POD_SIGNATURE, EvidenceRole.POD_PHOTO),
    ],
)
def test_artifact_attributed_to_another_role_is_rejected(cited_role, artifact_role):
    phase_id = uuid.uuid4()

    error = cited_attribution_error(
        cited_role=cited_role, phase_event_id=phase_id,
        artifact_phase_event_id=phase_id, artifact_role=artifact_role,
    )

    assert error is not None
    assert artifact_role.value in error
    assert cited_role.value in error
