"""Errors the payload rebuilds raise and verify_subject turns into a VerifyStatus."""
from __future__ import annotations


class _UnsupportedPhasePayloadVersion(ValueError):
    """The receipt cannot be reconstructed under a known canonical contract."""


class _EvidenceMissing(ValueError):
    """An evidence anchor's committed source state is absent from the current database."""
