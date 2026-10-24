"""Words the dispatcher typed → one exact record, or the candidates to choose from (spec §7.1, D2b).

"Tim", "tim giltg", "ca123456", "Joburg", "AB12CD34": the model passes what was typed, and this module
finds the record in the caller's organisation. It never guesses between two: two Tims come back as
candidates, and the assistant asks. A record id from an earlier answer (a "ref", spec §4) is
re-loaded scoped to the organisation, so an id from another organisation is simply not found.

Matching, in order, stopping at the first step that finds anything:
  1. exact, ignoring case, spaces and punctuation;
  2. every typed word starts a word of the name ("Tim" → "Tim Giltig", "Timothy Nkosi");
  3. close spelling (difflib ratio ≥ FUZZY_MATCH_MIN), per word and for the whole name; a typed word
     that starts a name word counts as a full word match, so "Tim Giltig" finds "Timothy Gultig".
Codes (registrations, trip references) skip step 2 and instead match a typed fragment of at least
MIN_FRAGMENT_CHARS ("123456" → "CA 123-456"; a trip's 8-character suffix, spec B2). Trip references
are random, so they never match by close spelling. Depots also match their Parcel Perfect hub code
and their address, with the common city nicknames expanded ("Joburg" → Johannesburg), because a
dispatcher says the city and the depot's name may not contain it.

Layering: the pure matcher has no I/O (unit-tested); the loaders read db/ only, scoped exactly as the
pages are (precincts: the organisation's own plus shared ones, as `fleet.precincts.list_precincts`).
"""

import re
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Literal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import TripStatus, VehicleType
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle

EntityKind = Literal["driver", "vehicle", "precinct", "trip"]
ResolutionStatus = Literal["found", "ambiguous", "not_found"]

# A choice card with more buttons than this stops being a choice; the rest are counted, not shown.
MAX_CANDIDATES = 5
# 0.8 accepts one or two slips in a name ("Giltg" for "Giltig" is 0.91) and refuses different
# names that merely share letters ("Tim Giltig" vs "Tom Gilbert" is 0.67).
FUZZY_MATCH_MIN = 0.8
# Shorter fragments of a plate or reference match too much ("12" is in half the fleet).
MIN_FRAGMENT_CHARS = 4
# What dispatchers call the cities our depots are in. Lower case, normalised.
CITY_NICKNAMES: dict[str, str] = {
    "joburg": "johannesburg", "jozi": "johannesburg", "jhb": "johannesburg", "jnb": "johannesburg",
    "cpt": "cape town", "kaapstad": "cape town",
    "dbn": "durban", "pta": "pretoria", "tshwane": "pretoria",
    "pe": "gqeberha", "port elizabeth": "gqeberha", "pmb": "pietermaritzburg", "bloem": "bloemfontein",
}


@dataclass(frozen=True)
class Candidate:
    kind: EntityKind
    id: uuid.UUID
    # What the dispatcher recognises: a driver's full name, a registration, a depot name, a reference.
    label: str
    is_active: bool = True
    # One extra fact to tell candidates apart: vehicle type, depot hub code, trip status.
    detail: str | None = None


@dataclass(frozen=True)
class Resolution:
    query: str
    # found: exactly one · ambiguous: 2..MAX_CANDIDATES · not_found: none.
    candidates: tuple[Candidate, ...]
    # Candidates past MAX_CANDIDATES that matched too, counted for "and 3 more".
    more: int = 0

    @property
    def status(self) -> ResolutionStatus:
        if not self.candidates:
            return "not_found"
        return "found" if len(self.candidates) == 1 else "ambiguous"

    @property
    def match(self) -> Candidate | None:
        return self.candidates[0] if self.status == "found" else None


def normalise_name(text: str) -> str:
    """Lower case, words only: "Tim  Giltig!" → "tim giltig"."""
    return " ".join(re.findall(r"[^\W_]+", text.casefold()))


def normalise_code(text: str) -> str:
    """Upper case, letters and digits only: "ca 123-456" → "CA123456"."""
    return re.sub(r"[^0-9A-Z]", "", text.upper())


def _result(query: str, found: Sequence[Candidate]) -> Resolution:
    unique = list({candidate.id: candidate for candidate in found}.values())
    return Resolution(query=query, candidates=tuple(unique[:MAX_CANDIDATES]), more=max(0, len(unique) - MAX_CANDIDATES))


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _word_score(typed: str, word: str) -> float:
    """A typed word that starts a name word is a full match ("Tim" for "Timothy"); otherwise its spelling ratio."""
    return 1.0 if word.startswith(typed) else _ratio(typed, word)


def _name_score(query: str, name: str) -> float:
    """The better of the whole-name ratio and the average best per-word score, so "giltg" scores against
    "giltig" rather than against "tim giltig", and "Tim Giltig" reaches "Timothy Gultig" (a short first
    name plus one slip in the surname)."""
    words = name.split()
    typed_words = query.split()
    per_word = sum(max(_word_score(typed, word) for word in words) for typed in typed_words) / len(typed_words)
    return max(_ratio(query, name), per_word)


def _starts_words(query: str, name: str) -> bool:
    words = name.split()
    return all(any(word.startswith(typed) for word in words) for typed in query.split())


def match_names(query: str, candidates: Sequence[Candidate]) -> Resolution:
    """A person's or depot's name (steps 1–3 of the module docstring)."""
    typed = normalise_name(query)
    if not typed:
        return Resolution(query=query, candidates=())
    keyed = [(candidate, normalise_name(candidate.label)) for candidate in candidates]
    keyed = [(candidate, name) for candidate, name in keyed if name]
    for step in (lambda name: name == typed, lambda name: _starts_words(typed, name)):
        hits = [candidate for candidate, name in keyed if step(name)]
        if hits:
            return _result(query, hits)
    scored = [(score, candidate) for candidate, name in keyed if (score := _name_score(typed, name)) >= FUZZY_MATCH_MIN]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return _result(query, [candidate for _, candidate in scored])


def match_codes(query: str, candidates: Sequence[Candidate], *, fuzzy: bool) -> Resolution:
    """A registration or trip reference: exact, then a fragment, then (registrations only) a slip."""
    typed = normalise_code(query)
    if not typed:
        return Resolution(query=query, candidates=())
    keyed = [(candidate, normalise_code(candidate.label)) for candidate in candidates]
    steps: list[Callable[[str], bool]] = [lambda code: code == typed]
    if len(typed) >= MIN_FRAGMENT_CHARS:
        steps.append(lambda code: typed in code)
    for step in steps:
        hits = [candidate for candidate, code in keyed if step(code)]
        if hits:
            return _result(query, hits)
    if not fuzzy:
        return Resolution(query=query, candidates=())
    scored = [(score, candidate) for candidate, code in keyed if (score := _ratio(typed, code)) >= FUZZY_MATCH_MIN]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return _result(query, [candidate for _, candidate in scored])


def expand_city(text: str) -> str:
    """"Joburg" → "johannesburg"; anything else normalised and unchanged."""
    typed = normalise_name(text)
    return CITY_NICKNAMES.get(typed, typed)


def match_precincts(query: str, candidates: Sequence[Candidate], addresses: dict[uuid.UUID, str]) -> Resolution:
    """A depot: by name, then by hub code (`detail`), then by a city (nicknames expanded) in its name or address."""
    by_name = match_names(query, candidates)
    if by_name.status != "not_found":
        return by_name
    code = normalise_code(query)
    by_code = [candidate for candidate in candidates if candidate.detail and normalise_code(candidate.detail) == code]
    if code and by_code:
        return _result(query, by_code)
    city = expand_city(query)
    if not city:
        return Resolution(query=query, candidates=())
    pattern = re.compile(rf"\b{re.escape(city)}\b")
    in_city = [
        candidate for candidate in candidates
        if pattern.search(normalise_name(candidate.label)) or pattern.search(normalise_name(addresses.get(candidate.id, "")))
    ]
    return _result(query, in_city)


def _check_one(text: str | None, ref: uuid.UUID | None) -> None:
    if (text is None) == (ref is None):
        raise ValueError("Give exactly one of text or ref.")


async def resolve_driver(
    db: AsyncSession, *, organization_id: uuid.UUID, text: str | None = None, ref: uuid.UUID | None = None,
) -> Resolution:
    _check_one(text, ref)
    query = select(Driver.id, Driver.full_name, Driver.is_active).where(Driver.organization_id == organization_id)
    if ref is not None:
        query = query.where(Driver.id == ref)
    rows = (await db.execute(query.order_by(Driver.full_name))).all()
    candidates = [Candidate("driver", row.id, row.full_name, row.is_active) for row in rows]
    if ref is not None:
        return Resolution(query=str(ref), candidates=tuple(candidates))
    return match_names(text or "", candidates)


async def resolve_vehicle(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    text: str | None = None,
    ref: uuid.UUID | None = None,
    vehicle_type: VehicleType | None = None,
) -> Resolution:
    """A horse or trailer by registration. `vehicle_type` narrows it ("the horse CA…")."""
    _check_one(text, ref)
    query = select(Vehicle.id, Vehicle.registration, Vehicle.is_active, Vehicle.vehicle_type).where(
        Vehicle.organization_id == organization_id,
    )
    if ref is not None:
        query = query.where(Vehicle.id == ref)
    if vehicle_type is not None:
        query = query.where(Vehicle.vehicle_type == vehicle_type)
    rows = (await db.execute(query.order_by(Vehicle.registration))).all()
    candidates = [
        Candidate("vehicle", row.id, row.registration, row.is_active, VehicleType(row.vehicle_type).value) for row in rows
    ]
    if ref is not None:
        return Resolution(query=str(ref), candidates=tuple(candidates))
    return match_codes(text or "", candidates, fuzzy=True)


async def resolve_precinct(
    db: AsyncSession, *, organization_id: uuid.UUID, text: str | None = None, ref: uuid.UUID | None = None,
) -> Resolution:
    """A depot the organisation can use: its own, or one shared with it (list_precincts' rule)."""
    _check_one(text, ref)
    query = select(Precinct.id, Precinct.name, Precinct.pp_hub_code, Precinct.address).where(
        or_(Precinct.principal_organization_id == organization_id, Precinct.is_shared.is_(True)),
    )
    if ref is not None:
        query = query.where(Precinct.id == ref)
    rows = (await db.execute(query.order_by(Precinct.name))).all()
    candidates = [Candidate("precinct", row.id, row.name, True, row.pp_hub_code) for row in rows]
    if ref is not None:
        return Resolution(query=str(ref), candidates=tuple(candidates))
    return match_precincts(text or "", candidates, {row.id: row.address or "" for row in rows})


async def resolve_trip(
    db: AsyncSession, *, organization_id: uuid.UUID, text: str | None = None, ref: uuid.UUID | None = None,
) -> Resolution:
    """A trip by reference, or its 8-character suffix (spec B2). Matched in SQL: an organisation has
    far more trips than drivers, so they are not all loaded."""
    _check_one(text, ref)
    query = select(Trip.id, Trip.trip_reference, Trip.status).where(Trip.operator_organization_id == organization_id)
    if ref is not None:
        query = query.where(Trip.id == ref)
    else:
        typed = normalise_code(text or "")
        if len(typed) < MIN_FRAGMENT_CHARS:
            return Resolution(query=text or "", candidates=())
        # The same normalisation as normalise_code, done by Postgres.
        stored = func.upper(func.regexp_replace(Trip.trip_reference, "[^A-Za-z0-9]", "", "g"))
        query = query.where(stored.contains(typed))
    rows = (await db.execute(query.order_by(Trip.created_at.desc()).limit(MAX_CANDIDATES + 1))).all()
    candidates = [Candidate("trip", row.id, row.trip_reference, True, TripStatus(row.status).value) for row in rows]
    exact = [candidate for candidate in candidates if normalise_code(candidate.label) == normalise_code(text or "")]
    return _result(text or str(ref), exact or candidates)
