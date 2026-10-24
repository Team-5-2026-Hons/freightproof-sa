"""The precinct read rule, shared by every path that picks a precinct for a trip."""

import uuid

from sqlalchemy import ColumnElement, or_

from app.db.models.organisations import Precinct


def visible_to(operator_organization_id: uuid.UUID) -> ColumnElement[bool]:
    """The precinct read rule (SEC-PRECINCT-1, as in fleet.precincts.list_precincts):
    a dispatcher sees their own organisation's precincts plus any marked is_shared. A
    manifest must neither reveal a depot the dispatcher cannot see nor route a trip into
    one, so both the hub lookup and the dispatcher's own pick apply it — and so does
    direct trip creation, which would otherwise copy any precinct id it was handed."""
    return or_(
        Precinct.principal_organization_id == operator_organization_id,
        Precinct.is_shared.is_(True),
    )
