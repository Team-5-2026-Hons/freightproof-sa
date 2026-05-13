"""Domain exceptions raised by the orchestration layer.

Endpoints catch these and map them to the appropriate HTTP status codes.
Do not import FastAPI here — this module must remain framework-agnostic.
"""


class TripConflictError(Exception):
    """Raised when a trip with the given order_number is already active."""

    def __init__(self, order_number: str) -> None:
        super().__init__(
            f"An active trip already exists for order_number='{order_number}'. "
            "Cancel or close the existing trip before creating a new one."
        )
        self.order_number = order_number


class ResourceNotFoundError(Exception):
    """Raised when a required DB record does not exist or is not accessible."""

    def __init__(self, resource: str, resource_id: str) -> None:
        super().__init__(f"{resource} with id='{resource_id}' not found or inactive.")
        self.resource = resource
        self.resource_id = resource_id
