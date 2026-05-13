import uuid
import pytest
from app.crypto.hashing import compute_journey_lock_hash


def test_hash_is_64_hex_chars():
    result = compute_journey_lock_hash(
        trip_id=uuid.uuid4(),
        order_number="ORD-001",
        driver_id=uuid.uuid4(),
        horse_id=uuid.uuid4(),
        trailer_ids=[uuid.uuid4(), uuid.uuid4()],
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
    )
    assert isinstance(result, str)
    assert len(result) == 64
    assert all(c in "0123456789abcdef" for c in result)


def test_hash_is_deterministic():
    trip_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    driver_id = uuid.UUID("22222222-2222-2222-2222-222222222222")
    horse_id = uuid.UUID("33333333-3333-3333-3333-333333333333")
    trailer_ids = [
        uuid.UUID("44444444-4444-4444-4444-444444444444"),
        uuid.UUID("55555555-5555-5555-5555-555555555555"),
    ]
    origin_id = uuid.UUID("66666666-6666-6666-6666-666666666666")
    dest_id = uuid.UUID("77777777-7777-7777-7777-777777777777")
    kwargs = dict(
        trip_id=trip_id,
        order_number="ORD-002",
        driver_id=driver_id,
        horse_id=horse_id,
        trailer_ids=trailer_ids,
        origin_precinct_id=origin_id,
        destination_precinct_id=dest_id,
    )
    assert compute_journey_lock_hash(**kwargs) == compute_journey_lock_hash(**kwargs)
    # Pin the expected hash value to detect any changes to canonical format
    expected = "62cf116aff02586aac33e7e84649baedf6a89374fdf4d1e802e6d725d29bb254"
    assert compute_journey_lock_hash(**kwargs) == expected


def test_trailer_order_does_not_affect_hash():
    """Trailer list is sorted before hashing so insertion order is irrelevant."""
    t1 = uuid.UUID("44444444-4444-4444-4444-444444444444")
    t2 = uuid.UUID("55555555-5555-5555-5555-555555555555")
    base = dict(
        trip_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        order_number="ORD-003",
        driver_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        horse_id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        origin_precinct_id=uuid.UUID("66666666-6666-6666-6666-666666666666"),
        destination_precinct_id=uuid.UUID("77777777-7777-7777-7777-777777777777"),
    )
    h1 = compute_journey_lock_hash(**base, trailer_ids=[t1, t2])
    h2 = compute_journey_lock_hash(**base, trailer_ids=[t2, t1])
    assert h1 == h2


def test_different_inputs_produce_different_hash():
    base = dict(
        trip_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        order_number="ORD-004",
        driver_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        horse_id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        trailer_ids=[uuid.UUID("44444444-4444-4444-4444-444444444444")],
        origin_precinct_id=uuid.UUID("66666666-6666-6666-6666-666666666666"),
        destination_precinct_id=uuid.UUID("77777777-7777-7777-7777-777777777777"),
    )
    h1 = compute_journey_lock_hash(**base)
    h2 = compute_journey_lock_hash(**{**base, "order_number": "ORD-999"})
    assert h1 != h2


def test_empty_trailer_ids_raises():
    """Hash function must reject empty trailer list — every anchored trip has at least one trailer."""
    with pytest.raises(ValueError, match="trailer_ids must not be empty"):
        compute_journey_lock_hash(
            trip_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
            order_number="ORD-001",
            driver_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
            horse_id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
            trailer_ids=[],
            origin_precinct_id=uuid.UUID("66666666-6666-6666-6666-666666666666"),
            destination_precinct_id=uuid.UUID("77777777-7777-7777-7777-777777777777"),
        )
