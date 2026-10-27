// User-facing copy for the vehicle, driver and precinct analytics summaries, plus one note
// the fleet page reuses. Dispatcher-only, so it lives here rather than shared/lib/constants/copy.ts.

export const ANALYTICS_COPY = {
  confirmationDwellCaveat:
    'Not purely driver behaviour: a slow receiver at the destination also lengthens the gap between unloading and confirmation.',

  trailerNote:
    'Trailer breakdowns are only counted from when drivers began naming the vehicle, so earlier trips count as clean.',

  facilityRateNote:
    'Corroboration rate is confirmed ÷ (confirmed + mismatch). Unwitnessed phases had no Pulsit reading: a coverage gap at the precinct, not counted as a failure.',

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
