// User-facing copy for the fleet Analytics page (fleet analytics spec). Kept beside the
// components rather than in shared/lib/constants/copy.ts, which both apps import: these
// strings are dispatcher-only. Same arrangement as components/analytics/copy.ts.

import type { Grain } from '@shared/lib/types/fleet-analytics'

const GRAIN_PLURAL: Record<Grain, string> = { week: 'weeks', month: 'months', year: 'years' }

export const FLEET_COPY = {
  // Spec §3, verbatim. Trends and tiles follow different time rules, so the page says so once.
  scopeNote:
    'Trends count closed trips, grouped by the day they first departed (South African time). Tiles show right now.',

  controls: {
    viewBy: 'View by',
    period: 'Period',
    from: 'From',
    to: 'To',
    grainLabels: { week: 'Week', month: 'Month', year: 'Year' } satisfies Record<Grain, string>,
    presets: {
      last_4_weeks: 'Last 4 weeks',
      last_12_weeks: 'Last 12 weeks',
      last_26_weeks: 'Last 26 weeks',
      last_3_months: 'Last 3 months',
      last_6_months: 'Last 6 months',
      last_12_months: 'Last 12 months',
      this_year: 'This year',
      last_3_years: 'Last 3 years',
      all_time: 'All time',
      custom: 'Custom range…',
    },
    tooManyBuckets: {
      week: 'Too many weeks for this period — choose Month',
      month: 'Too many months for this period — choose Year',
      year: 'Too many years for this period',
    } satisfies Record<Grain, string>,
    grainSwitched: (chosen: Grain, shown: Grain): string =>
      `Showing by ${shown}: too many ${GRAIN_PLURAL[chosen]} for this period.`,
    // The Departures | Arrivals switch's accessible name; it has no visible caption.
    eventsLabel: 'Show departures or arrivals',
    events: { departures: 'Departures', arrivals: 'Arrivals' },
  },

  tiles: {
    ariaLabel: 'Headline numbers, right now',
    needsAttention: 'Needs attention',
    loadError: "Couldn't load the headline numbers.",
    retry: 'Retry',
    liveTrips: { label: 'Live trips', sub: 'Created, underway or on hold' },
    criticalWaiting: {
      label: 'Critical Exceptions Waiting',
      none: 'Nothing waiting for review',
      oldest: (age: string): string => `Oldest waiting ${age}`,
    },
    parcels: {
      label: 'Parcels complete',
      sub: (complete: number, loaded: number, days: number): string =>
        `${complete} of ${loaded} loaded trips with every parcel accounted for · last ${days} days`,
    },
    receipts: {
      label: 'Receipts owed',
      failed: (count: number): string => `${count} failed`,
      noneFailed: 'None failed',
    },
    licences: {
      label: 'Licences & discs',
      caption: 'Driver licences and vehicle licence discs by how soon they expire',
      record: 'Record',
      drivers: 'Drivers',
      discs: 'Discs',
      bands: {
        expired: 'Expired',
        within_30_days: '≤ 30 d',
        within_90_days: '31–90 d',
        within_180_days: '91–180 d',
        no_date: 'No date',
      },
    },
    unused: {
      label: 'Unused vehicles',
      none: (days: number): string => `Every vehicle ran in the last ${days} days`,
      trucks: (count: number): string => `${count} ${count === 1 ? 'truck' : 'trucks'}`,
      trailers: (count: number): string => `${count} ${count === 1 ? 'trailer' : 'trailers'}`,
      more: (count: number): string => `+${count} more`,
    },
  },

  activity: {
    // Y-axis headings, worded as in spec §7.7's table.
    axis: { trips: 'Trips', cancelledTrips: 'Cancelled trips', avgPerDay: 'Avg per day' },
    trips: {
      title: 'Trips over time',
      question: 'Are we getting busier?',
      basis: (count: number): string =>
        `Closed trips, by the day they first departed · ${count} ${count === 1 ? 'trip' : 'trips'}`,
      empty: 'No closed trips departed in this period.',
      loaded: 'Loaded',
      emptyRun: 'Empty run',
      trips: 'trips',
      loadedLower: 'loaded',
      emptyLower: 'empty',
      total: 'Total',
    },
    cancellations: {
      title: 'Cancellations over time',
      question: 'How often are trips abandoned?',
      basis: (cancelled: number, ended: number): string =>
        `${cancelled} cancelled out of ${ended} trips that ended, by the day they ended`,
      empty: 'No trips ended in this period.',
      cancelled: 'cancelled',
      outOf: (ended: number, rate: string): string => `out of ${ended} trips that ended (${rate})`,
      columns: { cancelled: 'Cancelled', ended: 'Ended', rate: 'Cancelled share' },
      listTitle: 'Cancelled trips',
      listHint: 'Open a trip to read why it was cancelled.',
      listEmpty: 'No trips were cancelled in this period.',
      reference: 'Trip',
      cancelledOn: 'Cancelled on',
    },
    patterns: {
      title: 'Busy patterns',
      question: (eventNoun: string): string => `Average ${eventNoun} a day`,
      intro: 'When are we busiest? Averages per day in South African time, over this section’s own period.',
      period: 'Pattern period',
      basis: (count: number, eventNoun: string): string => `Based on ${count} ${eventNoun}`,
      empty: (eventNoun: string): string => `No ${eventNoun} in this period.`,
      monthNeedsYear: 'Needs a full year of history to compare months fairly.',
      perDay: (average: string): string => `${average} a day`,
      onAverage: 'on average',
      over: (events: number, eventNoun: string, days: number): string =>
        `${events} ${eventNoun} over ${days} ${days === 1 ? 'day' : 'days'}`,
      dayOfMonth: (day: number): string => `Day ${day}`,
      dimensions: {
        hour_of_day: { title: 'By hour of day', column: 'Hour' },
        weekday: { title: 'By weekday', column: 'Weekday' },
        day_of_month: { title: 'By day of month', column: 'Date' },
        month_of_year: { title: 'By month of year', column: 'Month' },
      },
      table: { events: 'Events', days: 'Days', average: 'Average a day' },
    },
  },

  onTime: {
    // Y-axis headings, worded as in spec §7.7's table.
    axis: { onTime: '% on time', trips: 'Trips' },
    punctuality: {
      title: 'On-time departures and arrivals',
      question: 'Are we getting more punctual?',
      basis: (departures: number, arrivals: number): string =>
        `Closed trips by the day they first departed · ${departures} departures and ${arrivals} arrivals with a planned time. On time means on or before the plan.`,
      note: 'Left late and arrived late → a problem at the dock. Left on time but arrived late → a problem on the road.',
      empty: 'No closed trip in this period had a planned departure or arrival.',
      departures: 'Departures',
      arrivals: 'Arrivals',
      departuresOnTime: 'Departures on time',
      arrivalsOnTime: 'Arrivals on time',
      countOf: (onTime: number, total: number, noun: string): string => `${onTime} of ${total} ${noun}`,
      noPlan: (noun: string): string => `no ${noun} with a plan`,
    },
    lateness: {
      title: 'How late is late',
      question: 'A little late often, or very late sometimes?',
      basis: (count: number, noun: string): string =>
        `${count} ${noun} with a planned time, over the whole period. On time means on or before the plan; early means more than 15 minutes ahead of it.`,
      empty: (noun: string): string => `No ${noun} with a planned time in this period.`,
      band: 'How late',
      trips: 'Trips',
      bands: {
        early: 'Early',
        on_time: 'On time',
        late_1_15: '1–15 min late',
        late_15_60: '15–60 min',
        late_60_180: '1–3 h',
        late_over_180: '3 h+',
      },
    },
    spread: {
      title: 'Plans vs reality',
      question: 'Are our planned times realistic?',
      basis: (count: number): string =>
        `${count} closed trips with a planned departure and arrival, over the whole period (View by doesn't change it)`,
      note: 'Faster than planned usually means the plan was too generous — it is not a measure of driving speed.',
      empty: 'No closed trip in this period had a full plan to compare with.',
      early: (count: number, typical: string | null): string =>
        `${count} finished early${typical === null ? '' : ` (typically ${typical})`}`,
      over: (count: number, typical: string | null): string =>
        `${count} ran over${typical === null ? '' : ` (typically ${typical})`}`,
      finishedEarly: '← Finished early',
      ranOver: 'Ran over →',
      // Under the middle axis (D24): trips exactly on plan are named there, not drawn.
      onPlan: 'On plan',
      onPlanCount: (count: number): string => `On plan · ${count} ${count === 1 ? 'trip' : 'trips'}`,
      legend: { early: 'Finished early', over: 'Ran over' },
      bands: {
        early_over_180: '3 h+', early_60_180: '1–3 h', early_15_60: '15–60 min', early_0_15: '0–15 min',
        on_plan: 'On plan',
        over_0_15: '0–15 min', over_15_60: '15–60 min', over_60_180: '1–3 h', over_over_180: '3 h+',
      },
      trips: (count: number): string => `${count} ${count === 1 ? 'trip' : 'trips'}`,
      finishedBand: (band: string): string => `finished ${band} early`,
      ranBand: (band: string): string => `ran ${band} over`,
      exactlyOnPlan: 'exactly on plan',
      columns: { band: 'Off plan by', trips: 'Trips' },
      tableEarly: (band: string): string => `${band} early`,
      tableOver: (band: string): string => `${band} over`,
    },
  },

  problems: {
    // Spec §5.3's tab note, so a total lower than the driver pages is never a mystery (D10).
    tabNote:
      'Dispatcher notes (recorded automatically for every cancellation and override) are not counted as problems, so totals can be lower than on driver pages.',
    axis: {
      theftSigns: 'Theft signs',
      problems: 'Problems',
      share: '% of total',
    },
    noTrips: 'No closed trips departed in this period.',
    // D25: the bars count problems. A rate per 100 trips read "400 per 100" on two trips, so
    // the rate lives in the tooltip and the table, where the trip count sits beside it.
    perTrip: {
      title: 'Problems over time',
      question: 'Are things getting better or worse?',
      basis: (problems: number, trips: number): string =>
        `${problems} warning and critical problems on ${trips} closed trips, by the day they first departed. Hover a bar for the rate per trip.`,
      warning: 'Warning',
      critical: 'Critical',
      info: 'Info',
      trips: 'Trips',
      perTrip: 'Per trip',
      tooltip: (problems: number, trips: number, rate: string): string =>
        `${problems} ${problems === 1 ? 'problem' : 'problems'} across ${trips} ${trips === 1 ? 'trip' : 'trips'} (${rate} per trip)`,
    },
    theft: {
      title: 'Theft warning signs',
      question: 'Is theft risk going up?',
      basis: (count: number): string =>
        `${count} seal, parcel, waybill, panic or receiver ID signs on closed trips. A seal that could not be checked is a paperwork gap, not a theft sign, so it is left out.`,
      total: 'Theft signs',
      lower: 'theft signs',
    },
    byType: {
      title: 'Most common problems',
      question: 'Which problems happen most?',
      basis: (count: number): string => `${count} problems on closed trips in this period, by type and who raised them`,
      empty: 'No problems were recorded on closed trips in this period.',
      type: 'Problem',
      total: 'Total',
      sources: { system: 'System', driver: 'Driver', dispatcher: 'Dispatcher' },
    },
    byStep: {
      title: 'Where in the trip',
      question: 'At which step do problems happen?',
      basis: (count: number): string => `${count} problems on closed trips, by the trip step they were raised at`,
      empty: 'No problems were recorded on closed trips in this period.',
      step: 'Step',
      steps: {
        trip_creation: 'Trip creation',
        activation: 'Activation',
        loading: 'Loading',
        departure: 'Waiting to leave',
        in_transit: 'Driving',
        unloading: 'Unloading',
        confirmation: 'Sign-off',
        unlinked: 'Not linked to a step',
      } as Record<string, string>,
    },
    risky: {
      title: 'Risky times of day',
      question: 'Is any time of day riskier than its share of driving?',
      basis: (hours: string, problems: number): string =>
        `${hours} of driving and ${problems} problems raised while driving, by South African time of day`,
      note: "If a block's problem share is much taller than its driving share, that time of day is riskier.",
      // D21: shown with the table, where the times can be read one by one.
      caveat:
        'A problem counts in the block when the server received it. A report sent from a phone with no signal may arrive later than it happened.',
      empty: 'No driving legs or problems raised while driving in this period.',
      drivingShare: 'Share of driving time',
      problemShare: 'Share of problems while driving',
      columns: { block: 'Time of day', driving: 'Driving time', drivingShare: 'Driving share', problems: 'Problems', problemShare: 'Problem share' },
      blocks: { night: 'Night 00–06', morning: 'Morning 06–12', afternoon: 'Afternoon 12–18', evening: 'Evening 18–24' },
    },
  },

  review: {
    // The rest of the page counts closed trips; this tab can't, because a review happens
    // whatever the trip's status (spec §5.4). Said once, at the top of the tab.
    tabNote:
      'Review figures cover every critical problem, on open and closed trips alike. Reviews recorded by the old system, before outcomes existed, are left out.',
    axis: { waiting: 'Problems waiting', hours: 'Hours', reviews: 'Reviews' },
    openQueue: 'Open the review queue',
    waitingNow: {
      title: 'Waiting now, by age',
      question: 'How long have critical problems been waiting for review?',
      basis: (count: number): string => `${count} critical problems waiting for review right now`,
      band: 'Waiting',
      bands: { under_1h: 'Under 1 h', '1h_to_24h': '1–24 h', '1d_to_3d': '1–3 days', over_3d: 'Over 3 days' },
      lower: 'waiting',
    },
    queue: {
      title: 'Is the pile growing?',
      question: 'Are critical problems being reviewed as fast as they arrive?',
      basis: 'Critical problems still waiting for review at the end of each period (or now, for one still running)',
      waiting: 'waiting at the end',
      column: 'Waiting at the end',
    },
    speed: {
      title: 'How fast critical problems get reviewed',
      question: 'How long does a critical problem wait for a dispatcher?',
      basis: (count: number): string => `${count} critical problems reviewed in this period, by the day they were reviewed`,
      empty: 'No critical problems were reviewed in this period.',
      median: 'typical wait (median)',
      mean: (value: string, count: number): string => `average ${value} over ${count} reviews`,
      columns: { reviewed: 'Reviewed', median: 'Typical wait', mean: 'Average wait' },
    },
    outcomes: {
      title: 'What reviews concluded',
      question: 'What do dispatchers find when they review?',
      basis: (count: number): string => `${count} reviews of any severity concluded in this period`,
      note: 'A large "data discrepancy" share means automatic checks are raising false alarms.',
      empty: 'No reviews were concluded in this period.',
      // The donut's centre (D25): every review ends in exactly one outcome.
      centre: (count: number): string => `${count} ${count === 1 ? 'review' : 'reviews'}`,
      legendValue: (count: number, share: string): string => `${count} · ${share}`,
      share: 'Share',
      outcome: 'Outcome',
      labels: {
        no_action_required: 'No action needed',
        handled_externally: 'Handled elsewhere',
        evidence_verified: 'Evidence confirmed',
        data_discrepancy: 'Data discrepancy',
        referred_for_follow_up: 'Referred for follow-up',
      },
    },
  },

  evidence: {
    axis: { checks: 'Checks', overridden: '% of steps overridden', scanned: '% scanned by receiver' },
    tracker: {
      title: 'Tracker agreement',
      question: "Does the truck's tracker agree with where the driver said they were?",
      basis: (checked: number, unwitnessed: number): string =>
        `${checked} stop steps on closed trips checked against the tracker, and ${unwitnessed} with no tracker reading`,
      agreement: (rate: string, confirmed: number, checked: number): string =>
        `Agreement ${rate} (${confirmed} of ${checked} checked)`,
      empty: 'No tracker checks at stops in this period.',
      confirmed: 'Confirmed',
      unwitnessed: 'Unwitnessed',
      mismatch: 'Mismatch',
      columns: { agreement: 'Agreement' },
    },
    overrides: {
      title: 'Overrides over time',
      question: 'How often does a dispatcher complete a step for the driver?',
      basis: (overridden: number, steps: number): string =>
        `${overridden} of ${steps} steps on closed trips were overridden by a dispatcher`,
      note: "An override skips the driver's photos, seal and tracker check — the weakest evidence we hold.",
      empty: 'No closed trips departed in this period.',
      lower: 'of steps overridden',
      columns: { steps: 'Steps', overridden: 'Overridden', share: 'Share' },
    },
    signoff: {
      title: 'Receiver sign-off',
      question: 'How often does the receiver confirm the delivery on their own phone?',
      basis: (scans: number, confirmations: number): string =>
        `${scans} of ${confirmations} sign-offs on closed trips were scanned by the receiver`,
      live: 'Receiver QR sign-off went live on 13 Sep 2026.',
      flags: (samePhone: number, rejected: number): string =>
        `This period: ${samePhone} confirmed from the driver's own phone · ${rejected} rejected scan attempts`,
      empty: 'No sign-offs on closed trips in this period.',
      lower: 'scanned by the receiver',
      columns: { signoffs: 'Sign-offs', scans: 'Receiver scans', share: 'Share' },
    },
  },

  routes: {
    axis: {
      sites: 'Pickups and deliveries',
      minutes: 'Minutes',
      problemsPerTrip: 'Problems per trip',
      tripsOnLane: 'Trips on the lane',
    },
    unknownSite: 'Unknown site',
    lane: (origin: string, destination: string): string => `${origin} → ${destination}`,
    sites: {
      title: 'Busiest sites',
      question: 'Which sites see the most of our trucks?',
      basis: (count: number): string => `${count} pickups and deliveries on closed trips in this period`,
      empty: 'No pickups or deliveries on closed trips in this period.',
      pickups: 'Pickups',
      deliveries: 'Deliveries',
      site: 'Site',
      total: 'Total',
      showAll: (count: number): string => `Show all ${count}`,
      showTop: (count: number): string => `Show top ${count}`,
    },
    laneTimes: {
      title: 'Driving time per lane',
      question: 'How long does each route take, on a normal day and a bad one?',
      basis: (count: number): string =>
        `${count} closed trips with a recorded arrival, timed from first departure to final arrival`,
      empty: 'No closed trips with a recorded arrival in this period.',
      typical: 'Typical (median)',
      badDay: 'Bad day (90th percentile)',
      lane: 'Lane',
      trips: 'Trips',
      tooFew: 'too few trips',
      fadedNote: 'Faded lanes have fewer than 5 trips, too few to compare fairly.',
    },
    laneRisk: {
      title: 'Lane risk',
      question: 'Which lanes are both busy and risky?',
      basis: (count: number): string =>
        `${count} lanes with closed trips in this period. Problems leave out dispatcher notes.`,
      note: 'The two faint lines mark the average lane: trips across, problems per trip up. Top-right = busy and risky.',
      // Written in the chart's top-right corner (D25).
      corner: 'Busy and risky',
      empty: 'No closed trips on a known lane in this period.',
      problems: 'Problems',
      perTrip: 'Problems per trip',
      trips: 'Trips',
      tooltip: (trips: number, problems: number): string => `${trips} trips · ${problems} problems`,
    },
    incidents: {
      title: 'Incident map',
      question: 'Where do problems happen?',
      basis: (count: number): string =>
        `${count} reports with a location in this period, any trip status. Dispatcher notes are left out.`,
      empty:
        'No reports with a location in this period. Today only panic-button reports send a location; more report types will appear once the driver app sends one with every report.',
      unlocated: (count: number): string =>
        `${count} ${count === 1 ? 'report' : 'reports'} in this period had no location.`,
      mapUnavailable: 'Map unavailable — every pin is listed in the table below.',
      // D25: the table shows ten at a time, and a row finds its pin on the map.
      loadMore: (count: number): string => `Load ${count} more`,
      showing: (shown: number, total: number): string => `Showing ${shown} of ${total}`,
      rowHint: 'Click a row to find it on the map.',
      open: 'Open',
      columns: { date: 'Date', problem: 'Problem', severity: 'Severity', trip: 'Trip', open: 'Report' },
      severities: { info: 'Info', warning: 'Warning', critical: 'Critical' },
    },
  },

  chart: {
    aboutChart: (title: string): string => `About this chart: ${title}`,
    // The last line of every time-axis card's "i" popover (spec §7.7 item 6).
    partialFootnote: 'Faded: a part week, month or year at either end of the period, or one still running.',
    showTable: 'Show table',
    showChart: 'Show chart',
    retry: 'Retry',
    loadError: "Couldn't load this chart.",
    notEnoughTitle: 'Not enough data yet',
    lowSample: (count: number): string => `Based on only ${count} trips — read with care`,
  },
} as const
