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

  // Where each detail page's figures come from. Checked against app/analytics/{vehicle,driver,
  // facility}_metrics.py and views.py: all five analytics views became plain views in migration
  // 2026_09_13_tom_live_analytics_views, so they are worked out on every read and never stale.
  sources: {
    vehicle:
      'Closed trips this vehicle ran and the breakdowns drivers reported against it, from live database views over our trip ledger.',
    driver:
      'Closed trips this driver ran (their attested steps, planned times and exception reports), from live database views over our trip ledger.',
    precinct:
      'Tracker checks at this precinct on your organisation’s closed trips. Tracker positions come from a simulated Pulsit feed.',
  },

  empty: {
    title: 'No closed trips in this range',
    body: 'Only closed trips are counted. Try a wider month range.',
  },
} as const
