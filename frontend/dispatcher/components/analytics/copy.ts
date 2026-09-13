// User-facing copy for the analytics screen (FP-156). Kept beside the panels rather than
// in shared/lib/constants/copy.ts, which both apps import: these strings are
// dispatcher-only.

export const ANALYTICS_COPY = {
  // The views are live since docs/design-notes/2026-09-13-live-analytics-views.md, so the
  // old "may take a while to appear" caveat is gone. "Each time this page loads" is the
  // honest limit: an open page doesn't redraw on its own when a trip closes.
  scopeNote:
    'Closed trips only. Figures are worked out each time this page loads, so a trip appears as soon as it has closed.',

  // Verbatim from the computed_field description of confirmation_dwell_minutes_avg in
  // backend/app/schemas/analytics.py, the source of truth for this caveat. Keep in step.
  confirmationDwellCaveat:
    'Not purely driver behaviour: a slow receiver at the destination also lengthens the gap between unloading and confirmation.',

  // The streaks endpoint takes no month range (FP-153 §3a); without this line the
  // columns would read as if they covered only the selected months.
  streaksNote:
    "Streaks and trips since last incident cover each vehicle's whole history, not only the selected months.",

  // Trailer analytics, decision 3. A breakdown names its vehicle only since drivers were
  // asked "truck or trailer", so a trailer's earlier trips have no breakdowns to count and
  // read as clean. Dateless on purpose: no rollout date is hard-coded anywhere.
  trailerNote:
    'Trailer breakdowns are only counted from when drivers began naming the vehicle, so earlier trips count as clean.',

  facilityRateNote:
    'Corroboration rate is confirmed ÷ (confirmed + mismatch). Unwitnessed phases had no Pulsit reading: a coverage gap at the precinct, not counted as a failure.',

  laneNote:
    'Transit time runs from departure to arrival. Against schedule is actual minus planned transit time, so it only counts trips that had both a planned departure and a planned arrival.',

  empty: {
    title: 'No closed trips in this range',
    body: 'Only closed trips are counted. Try a wider month range.',
  },
} as const
