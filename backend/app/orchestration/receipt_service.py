"""Compatibility facade: receipt reads now live in app.orchestration.verification.receipts.

New code imports from the module that owns the name; tests must patch the module that looks a
name up, never this one (check B8).
"""

from app.orchestration.verification.receipts import list_receipts_for_subject, lookup_receipts

__all__ = [
    "list_receipts_for_subject",
    "lookup_receipts",
]
