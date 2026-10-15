// Every string on the Cost tab (FP-294). Kept apart from copy.ts, which already holds the six
// other tabs. Wording follows spec §5 (docs/design-notes/2026-10-15-fp294-cost-analytics-spec.md):
// every figure says whether it is an estimate or comes from waybills.

import type { DistanceSource } from '@shared/lib/types/cost-analytics'

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

export const COST_COPY = {
  tabNote: 'Estimates use your cost rates below. Cargo values come from Parcel Perfect waybills.',
  noTrips: 'No closed trips departed in this period.',
  kind: {
    estimate: 'Estimate',
    waybill: 'From waybills',
  },
  axis: {
    rand: 'Rand',
  },

  headline: {
    title: 'Cost at a glance',
    question: 'What did this period cost us, what did problems add, and how much cargo was exposed?',
    source:
      'Operating and delay cost are estimated from your cost rates (shown at the bottom of this tab). '
      + 'Cargo value is the declared value on Parcel Perfect waybills. Closed trips only.',
    note: 'Delay cost is shown beside operating cost, never added to it: the driver’s late hours are already in operating cost.',
    operating: 'Operating cost',
    delay: 'Delay cost on problem trips',
    exposure: 'Cargo value exposed',
    figure: 'Figure',
    value: 'Value',
    kindColumn: 'Kind',
    detail: 'Detail',
    tripsCosted: (costed: number, notCosted: number): string =>
      notCosted === 0
        ? plural(costed, 'trip', 'trips')
        : `${plural(costed, 'trip', 'trips')} · ${notCosted} not costed (no departure or arrival time)`,
    legsEstimated: (estimated: number, total: number): string =>
      `${estimated} of ${total} legs measured as straight line × road factor`,
    lateOver: (hours: string, trips: number): string => `${hours} h late over ${plural(trips, 'problem trip', 'problem trips')}`,
    latenessUnknown: (count: number): string => `${count} without a planned or actual arrival`,
    underReview: (value: string): string => `${value} still under review`,
    noValue: (count: number): string => `${plural(count, 'consignment has', 'consignments have')} no declared value`,
    noConsignments: (count: number): string => `${plural(count, 'trip has', 'trips have')} no waybills on record`,
  },

  operating: {
    title: 'Operating cost over time',
    question: 'What did running our trips cost, and what drove it?',
    source:
      'Estimated: truck road distance between each trip’s stops (OpenRouteService), or the straight line × road factor '
      + 'where a route couldn’t be looked up, × your fuel and running rates, plus driving time (first departure to '
      + 'final arrival) × driver rate, plus the fixed rate. Closed trips only.',
    basis: (trips: number): string => `${plural(trips, 'closed trip', 'closed trips')} with a recorded arrival, by week departed`,
    fuel: 'Fuel',
    running: 'Other running',
    driver: 'Driver',
    fixed: 'Fixed',
    total: 'Total',
  },

  delay: {
    title: 'Delay cost on problem trips',
    question: 'What might lateness on trips with problems have cost us?',
    source:
      'Estimated: hours late at final arrival versus the plan, on closed trips that had at least one problem, '
      + '× your delay rate. The problem may not have caused the delay.',
    basis: (trips: number): string => `${plural(trips, 'closed trip', 'closed trips')} with at least one problem`,
    empty: 'No late trips with problems in this period.',
    cost: 'Delay cost',
  },

  value: {
    title: 'Cargo value exposed',
    question: 'How much cargo value was on trips with a sign of theft?',
    source:
      'From Parcel Perfect waybills: the declared value of every consignment on closed trips with a theft signal '
      + '(seal, count, trailer, panic or receiver-ID finding). The whole load counts, because an exception isn’t '
      + 'linked to one consignment.',
    basis: (trips: number): string => `${plural(trips, 'closed trip', 'closed trips')} with a theft signal`,
    empty: 'No trips with a theft signal in this period.',
    underReview: 'Still under review',
    reviewed: 'Reviewed',
  },

  lanes: {
    title: 'Cost by lane',
    question: 'Which routes cost the most to run?',
    source:
      'Estimated operating cost of each lane’s closed trips, from your cost rates. Delay cost and cargo value exposed '
      + 'are shown beside it, not added. A trip without a known origin and destination is on no lane.',
    basis: (shown: number, total: number): string =>
      shown === total ? plural(total, 'lane', 'lanes') : `Top ${shown} of ${total} lanes by operating cost`,
    empty: 'No closed trips on a known lane in this period.',
    unknownSite: 'Unknown site',
    lane: (origin: string, destination: string): string => `${origin} → ${destination}`,
    laneColumn: 'Lane',
    trips: 'Trips',
    operating: 'Operating cost',
    perTrip: 'Per trip',
    delay: 'Delay cost',
    value: 'Value exposed',
    distance: 'Distance',
    distanceSource: {
      road: 'By truck road route',
      estimate: 'Straight line × road factor',
      mixed: 'Partly by road, partly estimated',
    } satisfies Record<DistanceSource, string>,
    tooltipTrips: (trips: number, perTrip: string): string => `${plural(trips, 'trip', 'trips')} · ${perTrip} per trip`,
  },

  rates: {
    title: 'Cost rates',
    intro: 'Every estimate on this tab is worked out from these rates.',
    startingRates: 'Starting rates from Bruce’s figures',
    lastChanged: (when: string, name: string | null): string =>
      name === null ? `Last changed ${when}` : `Last changed ${when} by ${name}`,
    todaysRates: 'All figures use today’s rates',
    edit: 'Edit rates',
    save: 'Save',
    cancel: 'Cancel',
    saved: 'Rates saved. Figures updated.',
    saveFailed: 'Couldn’t save the rates. Try again.',
    noChanges: 'Change a rate to save.',
    derived: 'Worked out from diesel price and consumption.',
    editLabel: (label: string): string => `New ${label.toLowerCase()}`,
    rows: {
      diesel: { label: 'Diesel price', unit: '/ L', origin: 'DMPR inland 50ppm, 7 Oct 2026. Update it when the price changes.' },
      consumption: { label: 'Consumption', unit: 'L / 100 km', origin: 'Fuel ≈ half of a R20,000 JHB–DBN run (Bruce, 1 Sep 2026).' },
      fuelPerKm: { label: 'Fuel per km', unit: '/ km', origin: 'Diesel price × consumption.' },
      running: { label: 'Other running', unit: '/ km', origin: 'The rest of that run after fuel and driver: tyres, maintenance, tolls, the vehicle.' },
      driver: { label: 'Driver', unit: '/ h', origin: 'R30,000 a month ÷ 195 working hours (Bruce, 28 Jul 2026).' },
      fixed: { label: 'Fixed per trip', unit: 'per trip', origin: 'Not set from Bruce’s figures.' },
      delay: { label: 'Delay', unit: '/ h', origin: 'The driver plus the truck standing idle.' },
      roadFactor: { label: 'Road factor', unit: '×', origin: 'Only where a road route can’t be looked up (the N3’s road ÷ straight-line ratio).' },
    },
  },
} as const
