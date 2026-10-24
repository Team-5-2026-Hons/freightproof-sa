// Field length ceilings for what the receiver types. They mirror the backend's
// MAX_RECEIVER_NAME_LENGTH / MAX_RECEIVER_ID_NUMBER_LENGTH in backend/app/schemas/handover.py:
// the API answers anything longer with a 422, which a stranger on a warehouse floor cannot
// act on, so the inputs stop accepting characters at the same point instead. Change them
// there first; this file only follows.

export const MAX_RECEIVER_NAME_LENGTH = 120
export const MAX_RECEIVER_ID_NUMBER_LENGTH = 60
