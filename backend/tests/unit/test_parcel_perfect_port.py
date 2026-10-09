"""The real and mock Parcel Perfect clients are interchangeable behind ParcelPerfectPort."""

import inspect

import pytest

from app.core.config import settings
from app.integrations.parcel_perfect import (
    MockParcelPerfectClient,
    ParcelPerfectClient,
    get_pp_client,
)
from app.integrations.parcel_perfect.port import ParcelPerfectPort

PORT_METHODS = ("get_manifest", "get_single_waybill")


def test_clients_satisfy_port_under_type_checking() -> None:
    # These assignments are the real assertion: mypy rejects either line if a client's
    # signature drifts from the port. At runtime they only prove construction works.
    mock: ParcelPerfectPort = MockParcelPerfectClient()
    real: ParcelPerfectPort = ParcelPerfectClient()

    assert mock is not None
    assert real is not None


@pytest.mark.parametrize("client_cls", [MockParcelPerfectClient, ParcelPerfectClient])
def test_client_exposes_every_port_member(client_cls: type[ParcelPerfectPort]) -> None:
    for name in PORT_METHODS:
        assert inspect.iscoroutinefunction(getattr(client_cls, name))

    assert isinstance(client_cls.supports_manifest_lookup, bool)


@pytest.mark.parametrize("client_cls", [MockParcelPerfectClient, ParcelPerfectClient])
def test_client_signatures_match_port(client_cls: type[ParcelPerfectPort]) -> None:
    for name in PORT_METHODS:
        port_params = list(inspect.signature(getattr(ParcelPerfectPort, name)).parameters)
        client_params = list(inspect.signature(getattr(client_cls, name)).parameters)

        assert client_params == port_params


@pytest.mark.parametrize(
    ("use_mock", "expected_cls"),
    [(True, MockParcelPerfectClient), (False, ParcelPerfectClient)],
)
def test_factory_selects_client_by_setting(
    monkeypatch: pytest.MonkeyPatch, use_mock: bool, expected_cls: type
) -> None:
    monkeypatch.setattr(settings, "PP_USE_MOCK", use_mock)

    client = get_pp_client()

    assert type(client) is expected_cls
