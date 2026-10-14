"""Unit tests for evidence upload type checking (app/storage/mime_allowlist.py).

The endpoint used to store whatever content type the client declared. That let a handset
store `text/html` as "evidence" — which the dispatcher's browser would then RENDER when
they opened the signed URL — and it meant an evidence record's own type was an uploader's
assertion rather than a fact about the file.
"""

import pytest

from app.storage.mime_allowlist import (
    HEIC, JPEG, PDF, PNG, WEBP, detect_mime_type, resolve_mime_type,
)

# Minimal byte prefixes — each is the real signature plus filler, which is all the
# sniffers inspect.
_JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 20
_PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
_WEBP_BYTES = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 20
_HEIC_BYTES = b"\x00\x00\x00\x20" + b"ftyp" + b"heic" + b"\x00" * 20
_PDF_BYTES = b"%PDF-1.7\n" + b"\x00" * 20


@pytest.mark.parametrize(
    ("file_bytes", "expected"),
    [
        (_JPEG_BYTES, JPEG),
        (_PNG_BYTES, PNG),
        (_WEBP_BYTES, WEBP),
        (_HEIC_BYTES, HEIC),
        (_PDF_BYTES, PDF),
    ],
)
def test_each_allowed_format_is_recognised(file_bytes: bytes, expected: str) -> None:
    assert detect_mime_type(file_bytes) == expected


def test_html_disguised_as_a_photo_is_refused() -> None:
    """The attack this module exists for: a driver's handset uploads a page, labels it as
    an image, and the dispatcher's browser executes it when they open the evidence."""
    html = b"<html><script>alert(document.cookie)</script></html>"

    with pytest.raises(ValueError, match="Unsupported file type"):
        resolve_mime_type(html, JPEG)


def test_svg_is_refused_even_though_it_is_an_image() -> None:
    """SVG is a picture to a person and a script host to a browser. Its absence from the
    allowlist is deliberate, so this test fails loudly if anyone adds it."""
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

    with pytest.raises(ValueError, match="Unsupported file type"):
        resolve_mime_type(svg, "image/svg+xml")


def test_the_sniffed_type_is_what_gets_stored() -> None:
    """The declared type is a hint. The bytes decide, so an artifact's recorded type is a
    fact about the file rather than something its uploader asserted."""
    assert resolve_mime_type(_JPEG_BYTES, JPEG) == JPEG


def test_a_declared_type_that_contradicts_the_bytes_is_refused() -> None:
    with pytest.raises(ValueError, match="does not match the declared type"):
        resolve_mime_type(_PDF_BYTES, JPEG)


def test_a_charset_suffix_on_the_declared_type_still_matches() -> None:
    """Browsers append parameters (`image/jpeg; charset=binary`). Treating that as a
    mismatch would reject perfectly ordinary uploads."""
    assert resolve_mime_type(_JPEG_BYTES, "image/jpeg; charset=binary") == JPEG


def test_a_missing_declared_type_falls_back_to_the_bytes() -> None:
    """A client that sends no Content-Type is not an attacker — the bytes are still
    authoritative, so there is nothing to disagree with."""
    assert resolve_mime_type(_PNG_BYTES, None) == PNG


def test_an_empty_upload_is_refused() -> None:
    with pytest.raises(ValueError, match="empty"):
        resolve_mime_type(b"", JPEG)


def test_unrecognisable_bytes_are_refused_rather_than_stored_as_octet_stream() -> None:
    """A file nothing can identify is not evidence of anything, so it does not get to be
    stored under a generic type."""
    assert detect_mime_type(b"\x00\x01\x02\x03not a real format") is None
