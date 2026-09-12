// User-facing copy for the analytics screen (FP-156). Kept beside the panels rather than
// in shared/lib/constants/copy.ts, which both apps import: these strings are
// dispatcher-only.

export const ANALYTICS_COPY = {
  // Confirmed wording (FP-156 spec §0.1 #4). It claims no refresh interval on purpose:
  // nothing in the repo runs Celery beat yet (spec §0 #19).
  scopeNote:
    'Closed trips only. Figures update periodically, so a recently closed trip may take a while to appear.',

  // Verbatim from the computed_field description of confirmation_dwell_minutes_avg in
  // backend/app/schemas/analytics.py, the source of truth for this caveat. Keep in step.
  confirmationDwellCaveat:
    'Not purely driver behaviour: a slow receiver at the destination also lengthens the gap between unloading and confirmation.',

  // The streaks endpoint takes no month range (FP-153 §3a); without this line the
  // columns would read as if they covered only the selected months.
  streaksNote:
    "Streaks and trips since last incident cover each vehicle's whole history, not only the selected months.",

  facilityRateNote:
    'Corroboration rate is confirmed ÷ (confirmed + mismatch). Unwitnessed phases had no Pulsit reading: a coverage gap at the precinct, not counted as a failure.',

  laneNote:
    'Transit time runs from departure to arrival. Against schedule is actual minus planned transit time, so it only counts trips that had both a planned departure and a planned arrival.',

  empty: {
    title: 'No closed trips in this range',
    body: 'Only closed trips are counted. Try a wider month range.',
  },
} as const
