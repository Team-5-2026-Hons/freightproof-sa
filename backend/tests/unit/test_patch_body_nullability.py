"""PATCH bodies must not accept a null for a column the database declares NOT NULL.

These services apply their PATCH bodies with model_dump(exclude_unset=True), which
deliberately preserves an explicitly-supplied null so a nullable column can be cleared.
That same behaviour sends None to a NOT NULL column, where it becomes a NotNullViolation
at flush and a 500 on a well-formed request.

The rule is encoded in the annotations (Optional[X] means nullable, a bare
X = Field(default=None) means omissible-but-not-nullable), so what needs guarding is
DRIFT: a column whose nullability changes, or a new field added to a PATCH body without
the distinction being thought about. Rather than restate the expected sets here — a
second list that would go stale exactly as silently — each expectation is derived from
the SQLAlchemy column definition, which is the thing the database actually enforces.

Behavioural, not introspective: each field is probed by validating {field: None} and
observing whether it is rejected. That is what a client experiences, and it stays
correct regardless of how the annotation is spelled.
"""

import pytest
from pydantic import BaseModel, ValidationError

from app.db.models import Base
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.vehicles import Vehicle
from app.schemas.organisations import PrecinctUpdateBody
from app.schemas.people import DriverUpdateBody
from app.schemas.vehicles import VehicleUpdateBody

# (PATCH body, mapped model). Every body applied via model_dump(exclude_unset=True)
# belongs here — if a fourth resource gains a PATCH endpoint, add it.
_PATCH_BODIES = [
    pytest.param(PrecinctUpdateBody, Precinct, id="precinct"),
    pytest.param(VehicleUpdateBody, Vehicle, id="vehicle"),
    pytest.param(DriverUpdateBody, Driver, id="driver"),
]


def _accepts_null(body: type[BaseModel], field: str) -> bool:
    """True if `body` validates an explicit null for `field`."""
    try:
        body.model_validate({field: None})
    except ValidationError:
        return False
    return True


@pytest.mark.parametrize(("body", "model"), _PATCH_BODIES)
def test_patch_schema_nullability_matches_the_model(
    body: type[BaseModel], model: type[Base]
) -> None:
    columns = {c.name: c.nullable for c in model.__table__.columns}

    mismatches = [
        f"{field}: schema allows null={_accepts_null(body, field)}, "
        f"column nullable={columns[field]}"
        for field in body.model_fields
        if field in columns and _accepts_null(body, field) != columns[field]
    ]

    assert mismatches == [], (
        f"{body.__name__} disagrees with {model.__name__} about which fields may be "
        f"nulled. A NOT NULL column declared Optional lets an explicit null through "
        f"validation and 500s at flush; a nullable column declared non-Optional makes "
        f"it impossible to clear. Mismatches: {mismatches}"
    )


@pytest.mark.parametrize(("body", "model"), _PATCH_BODIES)
def test_every_patch_field_is_still_omissible(body: type[BaseModel], model: type) -> None:
    """The fix must not have made any field required — PATCH is partial by definition."""
    instance = body.model_validate({})

    assert instance.model_dump(exclude_unset=True) == {}


@pytest.mark.parametrize(
    "field", ["name", "latitude", "longitude", "geofence_radius_metres", "is_shared"]
)
def test_precinct_patch_rejects_an_explicit_null_on_a_not_null_column(field: str) -> None:
    with pytest.raises(ValidationError) as exc_info:
        PrecinctUpdateBody.model_validate({field: None})

    # The error must name the offending field, not the model: the dispatcher client
    # renders detail[0].msg, and a model-level error tells the user nothing actionable.
    assert exc_info.value.errors()[0]["loc"] == (field,)


def test_precinct_patch_still_allows_clearing_the_address() -> None:
    """address is the one nullable column — an explicit null is a deliberate clear.

    Guards against someone "fixing" the null problem by switching the service to
    exclude_none, which would silently make clearing an address impossible.
    """
    body = PrecinctUpdateBody.model_validate({"address": None})

    assert body.model_dump(exclude_unset=True) == {"address": None}


def test_precinct_patch_still_enforces_field_bounds() -> None:
    """Dropping Optional must not have dropped the constraints carried alongside it."""
    with pytest.raises(ValidationError):
        PrecinctUpdateBody.model_validate({"latitude": 91.0})

    with pytest.raises(ValidationError):
        PrecinctUpdateBody.model_validate({"geofence_radius_metres": 10})
