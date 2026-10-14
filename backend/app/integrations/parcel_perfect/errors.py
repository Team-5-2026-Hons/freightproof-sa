"""Exceptions raised by the Parcel Perfect clients."""


# ---------------------------------------------------------------------------
# Errors and capability flags
# ---------------------------------------------------------------------------


class PPWaybillNotFoundError(Exception):
    """Raised when PP has no waybill for the given reference."""

    def __init__(self, waybill_number: str) -> None:
        self.waybill_number = waybill_number
        super().__init__(f"Waybill {waybill_number!r} not found in Parcel Perfect")


class PPUnsupportedError(Exception):
    """Raised when a capability doesn't exist on the real PP v28 API."""


class PPManifestNotFoundError(Exception):
    """Raised when no PP manifest has the given number."""

    def __init__(self, manifest_number: int) -> None:
        super().__init__(f"Manifest {manifest_number} not found")
        self.manifest_number = manifest_number
