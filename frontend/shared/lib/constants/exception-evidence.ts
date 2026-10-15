/**
 * Most photos a driver can attach to one exception report. Mirrors the backend's
 * MAX_EXCEPTION_PHOTOS (schemas/transit.py): the server answers 422 above it, so the
 * client stops the driver at the limit instead of letting them find out at submit time.
 */
export const MAX_EXCEPTION_PHOTOS = 5
