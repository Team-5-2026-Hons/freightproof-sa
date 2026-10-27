"""What an evidence upload is allowed to be, decided from the file's own bytes.

`UploadFile.content_type` is client-asserted and untrustworthy on an
evidence platform: a client could label text/html or SVG (browser-executed)
as "evidence" and have it render as a page instead of a photo when a
dispatcher opens the signed URL. So the declared type is only a hint — the
magic-number-sniffed bytes decide, and a signature matching nothing on the
allowlist is refused outright, never stored as octet-stream.

Hand-rolled rather than `python-magic`/`filetype`: five fixed byte prefixes
don't justify a new dependency (plus libmagic in the container).
"""

from typing import Callable

MAGIC_PREFIX_BYTES = 16

JPEG = "image/jpeg"
PNG = "image/png"
WEBP = "image/webp"
HEIC = "image/heic"
PDF = "application/pdf"


def _is_jpeg(head: bytes) -> bool:
    return head.startswith(b"\xff\xd8\xff")


def _is_png(head: bytes) -> bool:
    return head.startswith(b"\x89PNG\r\n\x1a\n")


def _is_webp(head: bytes) -> bool:
    return head.startswith(b"RIFF") and head[8:12] == b"WEBP"


def _is_heic(head: bytes) -> bool:
    if head[4:8] != b"ftyp":
        return False
    return head[8:12] in {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"}


def _is_pdf(head: bytes) -> bool:
    return head.startswith(b"%PDF-")


_SNIFFERS: dict[str, Callable[[bytes], bool]] = {
    JPEG: _is_jpeg,
    PNG: _is_png,
    WEBP: _is_webp,
    HEIC: _is_heic,
    PDF: _is_pdf,
}

ALLOWED_MIME_TYPES = frozenset(_SNIFFERS)


def detect_mime_type(file_bytes: bytes) -> str | None:
    """The allowlisted type these bytes actually are, or None if they are not any of them."""
    head = file_bytes[:MAGIC_PREFIX_BYTES]
    for mime_type, matches in _SNIFFERS.items():
        if matches(head):
            return mime_type
    return None


def resolve_mime_type(file_bytes: bytes, declared: str | None) -> str:
    """Return the type to store, or raise ValueError if the upload is not allowed.

    The sniffed type wins outright — `declared` only flags a disagreement in
    the error message, never widens what's accepted.
    """
    if not file_bytes:
        raise ValueError("Uploaded file is empty.")

    detected = detect_mime_type(file_bytes)
    if detected is None:
        raise ValueError(
            "Unsupported file type. Evidence must be a JPEG, PNG, WebP or HEIC image, "
            "or a PDF document."
        )

    if declared and declared.split(";")[0].strip().lower() != detected:
        raise ValueError(
            f"File content is {detected}, which does not match the declared type "
            f"{declared!r}."
        )

    return detected
