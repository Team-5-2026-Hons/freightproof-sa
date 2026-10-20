"""Pure helpers behind the FP-291 emailed code: masking, hashing, code shape, email body."""

import re
import uuid

import pytest

from app.orchestration.audit_packs import email_codes
from app.orchestration.audit_packs.email_codes import CODE_DIGITS, hash_code, mask_email


@pytest.mark.parametrize("address,masked", [
    ("jane@santam.example", "j***@santam.example"),
    ("j@x.co", "j***@x.co"),
    ("no-at-sign", "***"),
])
def test_mask_email_keeps_first_letter_and_domain(address: str, masked: str) -> None:
    # Act / Assert
    assert mask_email(address) == masked


def test_hash_code_is_salted_by_pack() -> None:
    # Arrange
    first, second = uuid.uuid4(), uuid.uuid4()

    # Act / Assert
    assert hash_code(first, "123456") != hash_code(second, "123456")
    assert hash_code(first, "123456") == hash_code(first, "123456")
    assert "123456" not in hash_code(first, "123456")


def test_new_code_is_six_digits_with_leading_zeros_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    monkeypatch.setattr(email_codes.secrets, "randbelow", lambda _n: 42)

    # Act
    code = email_codes._new_code()

    # Assert
    assert code == "000042"
    assert len(code) == CODE_DIGITS


def test_new_codes_vary() -> None:
    # Act
    codes = {email_codes._new_code() for _ in range(50)}

    # Assert
    assert all(re.fullmatch(r"\d{6}", c) for c in codes)
    assert len(codes) > 1


def test_email_body_holds_code_label_and_expiry_only() -> None:
    # Act
    body = email_codes._email_body("048213", "FP-0042-AP1")

    # Assert
    assert "048213" in body
    assert "FP-0042-AP1" in body
    assert "10 minutes" in body
