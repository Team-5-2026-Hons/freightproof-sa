"""enum_text must give the stored column text whether a row holds the enum member (still
in the session) or the plain string (freshly loaded) — str() does not."""

from app.db.models.enums import AnchorStatus, PhaseType, enum_text


def test_enum_text_member_gives_stored_value():
    assert enum_text(PhaseType.DEPARTURE) == "departure"


def test_enum_text_plain_string_is_unchanged():
    assert enum_text("departure") == "departure"


def test_enum_text_differs_from_str_on_members():
    # Guards the reason the helper exists: str() yields the qualified member name.
    assert str(AnchorStatus.ANCHORED) != enum_text(AnchorStatus.ANCHORED)
