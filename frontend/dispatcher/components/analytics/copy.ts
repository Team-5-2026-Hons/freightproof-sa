// User-facing copy for the vehicle, driver and precinct analytics summaries, plus one note
// the fleet page reuses. Dispatcher-only, so it lives here rather than shared/lib/constants/copy.ts.

export const ANALYTICS_COPY = {
  // Must match the computed_field description of confirmation_dwell_minutes_avg in
  // backend/app/schemas/analytics.py.
  confirmationDwellCaveat:
    'Not purely driver behaviour: a slow receiver at the destination also lengthens the gap between unloading and confirmation.',

  // Breakdowns are named to the vehicle only, so a trailer's trips before drivers named it
  // read as clean.
  trailerNote:
    'Trailer breakdowns are only counted from when drivers began naming the vehicle, so earlier trips count as clean.',

  facilityRateNote:
    'Corroboration rate is confirmed ÷ (confirmed + mismatch). Unwitnessed phases had no Pulsit reading: a coverage gap at the precinct, not counted as a failure.',

  empty: {
    title: 'No closed trips in this range',
    body: 'Only closed trips are counted. Try a wider month range.',
  },
} as const
