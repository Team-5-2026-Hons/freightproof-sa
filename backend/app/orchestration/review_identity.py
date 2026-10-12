"""Compatibility facade: the reviewer-name helpers now live in app.orchestration.exceptions.review_identity.

New code imports from the module that owns the name; tests must patch the module that looks a
name up, never this one (check B8).
"""

from app.orchestration.exceptions.review_identity import name_of, user_names, with_reviewer_names

__all__ = [
    "name_of",
    "user_names",
    "with_reviewer_names",
]
