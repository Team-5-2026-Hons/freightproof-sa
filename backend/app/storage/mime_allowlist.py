"""What an evidence upload is allowed to be, decided from the file's own bytes.

The upload endpoint used to take `UploadFile.content_type` — a value the client writes —
and pass it straight to Storage as the object's content type. Two things follow from
that, and neither is acceptable on an evidence platform:

  * A driver's handset could store `text/html` (or SVG, which browsers execute) as
    "evidence", and the signed URL a dispatcher opens would render it as a page rather
    than show it as a photograph. That is script execution triggered by opening a piece
    of evidence.
  * More fundamentally, the artifact's recorded type would be whatever the uploader
    claimed. An evidence record whose own metadata is client-asserted is weaker evidence.

So the declared type is treated as a hint and nothing more. The bytes decide, via their
magic number, and the result is what gets stored. A file whose signature matches nothing
on the allowlist is refused — not stored as `application/octet-stream`, because an
unidentifiable file is not evidence of anything.

Deliberately hand-rolled rather than `python-magic`/`filetype`: the allowlist is five
formats, each is a fixed byte prefix, and adding a dependency (plus libmagic as a system
package in the container) to compare five constants would cost more than it explains.
"""

from typing import Callable

# Longest prefix any sniffer below inspects. Callers that stream can stop reading here.
MAGIC_PREFIX_BYTES = 16

JPEG = "image/jpeg"
PNG = "image/png"
WEBP = "image/webp"
HEIC = "image/heic"
PDF = "application/pdf"


def _is_jpeg(head: bytes) -> bool:
    # SOI marker, then the start of the first segment.
    return head.startswith(b"\xff\xd8\xff")


def _is_png(head: bytes) -> bool:
    return head.startswith(b"\x89PNG\r\n\x1a\n")


def _is_webp(head: bytes) -> bool:
    # RIFF container with a WEBP form type: "RIFF" <4-byte size> "WEBP".
    return head.startswith(b"RIFF") and head[8:12] == b"WEBP"


def _is_heic(head: bytes) -> bool:
    # ISO base media format: <4-byte box size> "ftyp" <brand>. iPhones default to HEIC,
    # so a driver photographing a seal on iOS lands here rather than on JPEG.
    if head[4:8] != b"ftyp":
        return False
    return head[8:12] in {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"}


def _is_pdf(head: bytes) -> bool:
    return head.startswith(b"%PDF-")


# Order matters only for readability — the signatures are mutually exclusive.
#
# Note what is ABSENT and why: SVG is an image to a user and a script host to a browser,
# so it is not on this list and must not be added. GIF and BMP are absent because nothing
# in the product produces them; add them only alongside a real capture path.
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

    The sniffed type wins outright — `declared` is only used to notice a disagreement
    worth mentioning in the error, and never to widen what is accepted. A client that
    labels a JPEG as a PDF gets a clear message; a client that labels an HTML page as a
    JPEG gets rejected on the bytes, which is the case that matters.
    """
    if not file_bytes:
        raise ValueError("Uploaded file is empty.")

    detected = detect_mime_type(file_bytes)
    if detected is None:
        raise ValueError(
            "Unsupported file type. Evidence must be a JPEG, PNG, WebP or HEIC image, "
            "or a PDF document."
        )

    # A mismatch is worth naming rather than silently correcting: on the honest paths it
    # means a client bug worth fixing, and staying quiet about it would hide that.
    if declared and declared.split(";")[0].strip().lower() != detected:
        raise ValueError(
            f"File content is {detected}, which does not match the declared type "
            f"{declared!r}."
        )

    return detected
