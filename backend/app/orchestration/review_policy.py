"""Compatibility facade: the review-status policy now lives in app.orchestration.exceptions.review_policy.

New code imports from the module that owns the name; tests must patch the module that looks a
name up, never this one (check B8).
"""

from app.orchestration.exceptions.review_policy import (
    AuthoredReviewFields,
    dispatcher_authored_review,
    initial_review_status,
)

__all__ = [
    "AuthoredReviewFields",
    "dispatcher_authored_review",
    "initial_review_status",
]
