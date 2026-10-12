"""Every SubjectType must be decided in both halves of the subject policy.

A new SubjectType that nobody added to a registry would otherwise fall into the registry's
default branch silently: invisible to every organisation (visibility) or reported as
no_receipt (verification). These tests fail until the new member is either registered or
named in the explicit "not handled" set beside the registry, so the omission is a decision
that shows in a diff.
"""

from app.blockchain.subject_visibility import (
    NEVER_VISIBLE_SUBJECT_TYPES,
    SUBJECT_VISIBILITY_QUERIES,
)
from app.db.models.enums import SubjectType
from app.orchestration.verification.service import (
    SUBJECT_RECONSTRUCTORS,
    UNVERIFIABLE_SUBJECT_TYPES,
)

ALL_SUBJECT_TYPES = frozenset(SubjectType)


def test_every_subject_type_has_a_visibility_rule_or_is_declared_never_visible() -> None:
    decided = frozenset(SUBJECT_VISIBILITY_QUERIES) | NEVER_VISIBLE_SUBJECT_TYPES

    assert ALL_SUBJECT_TYPES - decided == frozenset()


def test_a_subject_type_is_not_both_visible_and_declared_never_visible() -> None:
    assert frozenset(SUBJECT_VISIBILITY_QUERIES) & NEVER_VISIBLE_SUBJECT_TYPES == frozenset()


def test_every_subject_type_has_a_reconstructor_or_is_declared_unverifiable() -> None:
    decided = frozenset(SUBJECT_RECONSTRUCTORS) | UNVERIFIABLE_SUBJECT_TYPES

    assert ALL_SUBJECT_TYPES - decided == frozenset()


def test_a_subject_type_is_not_both_verifiable_and_declared_unverifiable() -> None:
    assert frozenset(SUBJECT_RECONSTRUCTORS) & UNVERIFIABLE_SUBJECT_TYPES == frozenset()


def test_every_verifiable_subject_type_is_also_visible() -> None:
    """verify_visible_subject checks visibility first, so a type that can be rebuilt but is
    never visible could never actually be verified through the API."""
    assert frozenset(SUBJECT_RECONSTRUCTORS) <= frozenset(SUBJECT_VISIBILITY_QUERIES)
