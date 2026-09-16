// User-facing copy for the analytics summaries on the vehicle, driver and precinct detail
// pages (FP-156), and the one note the fleet page reuses. Kept here rather than in
// shared/lib/constants/copy.ts, which both apps import: these strings are dispatcher-only.

export const ANALYTICS_COPY = {
  // Verbatim from the computed_field description of confirmation_dwell_minutes_avg in
  // backend/app/schemas/analytics.py, the source of truth for this caveat. Keep in step.
  confirmationDwellCaveat:
    'Not purely driver behaviour: a slow receiver at the destination also lengthens the gap between unloading and confirmation.',

  // Trailer analytics, decision 3. A breakdown names its vehicle only since drivers were
  // asked "truck or trailer", so a trailer's earlier trips have no breakdowns to count and
  // read as clean. Dateless on purpose: no rollout date is hard-coded anywhere.
  trailerNote:
    'Trailer breakdowns are only counted from when drivers began naming the vehicle, so earlier trips count as clean.',

  facilityRateNote:
    'Corroboration rate is confirmed ÷ (confirmed + mismatch). Unwitnessed phases had no Pulsit reading: a coverage gap at the precinct, not counted as a failure.',

  empty: {
    title: 'No closed trips in this range',
    body: 'Only closed trips are counted. Try a wider month range.',
  },
} as const
