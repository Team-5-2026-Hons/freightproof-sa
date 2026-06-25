// Field constraints for vehicle form validation.
//
// These intentionally DUPLICATE the backend Pydantic constraints in
// backend/app/schemas/vehicles.py — the backend is authoritative. If a
// backend constraint changes, this file must be updated too. The schema's
// own widths are themselves mirrored from the DB column definitions in
// backend/app/db/models/vehicles.py, so that's the ultimate source of truth
// for anything string-length-related.
//
// There is no static YEAR_MAX here — the backend computes its ceiling live
// as `current year + 1` (see _validate_year in schemas/vehicles.py) so the
// schema never needs a yearly bump. The frontend mirrors that by computing
// the ceiling where it's used (validation/vehicle.ts), not storing it here.

export const VIN_LENGTH = 17
export const VIN_PATTERN = /^[A-Za-z0-9]{17}$/

export const REGISTRATION_MAX = 50
export const PULSIT_MAX = 100
export const MAKE_MODEL_MAX = 100

export const YEAR_MIN = 1900
