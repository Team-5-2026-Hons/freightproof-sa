"""Pure helpers behind the FP-291 mailed viewer password: masking, hashing, the email body."""

import uuid
from datetime import UTC, datetime

import pytest

from app.orchestration.audit_packs.viewer_password import (
    PASSWORD_BYTES,
    generate_password,
    hash_password,
    issue_email_body,
    mask_email,
)


@pytest.mark.parametrize("address,masked", [
    ("jane@santam.example", "j***@santam.example"),
    ("j@x.co", "j***@x.co"),
    ("no-at-sign", "***"),
])
def test_mask_email_keeps_first_letter_and_domain(address: str, masked: str) -> None:
    assert mask_email(address) == masked


def test_hash_password_is_salted_by_pack() -> None:
    first, second = uuid.uuid4(), uuid.uuid4()

    assert hash_password(first, "s3cret-pass") != hash_password(second, "s3cret-pass")
    assert hash_password(first, "s3cret-pass") == hash_password(first, "s3cret-pass")
    assert "s3cret-pass" not in hash_password(first, "s3cret-pass")


def test_generated_passwords_vary_and_are_long_enough() -> None:
    passwords = {generate_password() for _ in range(50)}

    assert len(passwords) > 1
    assert all(len(p) >= PASSWORD_BYTES for p in passwords)


def test_issue_email_body_holds_link_password_label_and_expiry_only() -> None:
    expires_at = datetime(2026, 11, 24, tzinfo=UTC)

    body = issue_email_body(
        password="abc123", label="FP-0042-AP1",
        share_url="https://portal.example/p/token123", expires_at=expires_at,
    )

    assert "abc123" in body
    assert "FP-0042-AP1" in body
    assert "https://portal.example/p/token123" in body
    assert "2026-11-24" in body
