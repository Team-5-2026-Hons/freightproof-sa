// Field constraints for vehicle and driver form validation. These intentionally DUPLICATE
// the backend Pydantic constraints in backend/app/schemas/vehicles.py, which stays
// authoritative — update both together. No static YEAR_MAX: the backend computes
// `current year + 1` live (_validate_year in schemas/vehicles.py), mirrored where it's
// used (validation/vehicle.ts) rather than stored here.

export const VIN_LENGTH = 17
export const VIN_PATTERN = /^[A-Za-z0-9]{17}$/

export const REGISTRATION_MAX = 50
export const PULSIT_MAX = 100
export const MAKE_MODEL_MAX = 100

export const YEAR_MIN = 1900

// Mirror backend/app/db/models/people.py column widths and the SA ID rule in
// backend/app/schemas/people.py.
export const SA_ID_LENGTH = 13
export const SA_ID_PATTERN = /^\d{13}$/

// SA phone: local 0XXXXXXXXX (10 chars) or international +27XXXXXXXXX (12 chars).
export const SA_PHONE_PATTERN = /^(0\d{9}|\+27\d{9})$/
// Matches any prefix of a still-valid-in-progress number, for live typing
// feedback: `0`+up to 9 digits, or `+`, `+2`, `+27`, `+27`+up to 9 digits.
export const SA_PHONE_PARTIAL = /^(0\d{0,9}|\+(2(7\d{0,9})?)?)$/
export const LOCAL_PHONE_LENGTH = 10
export const INTL_PHONE_LENGTH = 12

export const NAME_MAX = 255
export const LICENSE_MAX = 50

// Mirror backend/app/schemas/organisations.py, so the form surfaces the same problem
// before a 422 round-trip.
export const LATITUDE_MIN = -90
export const LATITUDE_MAX = 90
export const LONGITUDE_MIN = -180
export const LONGITUDE_MAX = 180

// The floor mirrors GPS_TOLERANCE_METRES (50): a geofence narrower than the GPS
// agreement tolerance makes the corroboration check meaningless. The ceiling catches a
// kilometres-for-metres unit slip.
export const GEOFENCE_RADIUS_MIN = 50
export const GEOFENCE_RADIUS_MAX = 5000
export const GEOFENCE_RADIUS_DEFAULT = 200

export const PRECINCT_NAME_MAX = 255

// Precinct.address is an unbounded Text column, so this ceiling comes from the Pydantic
// schema rather than a column width. It exists because the address is copied verbatim
// into the anchored PrecinctEvent payload; the server enforces it independently.
export const PRECINCT_ADDRESS_MAX = 500
