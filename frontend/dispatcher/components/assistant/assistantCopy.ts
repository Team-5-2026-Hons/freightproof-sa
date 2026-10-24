// Words for the dispatcher assistant's bubble and pop-up (spec §3).

import type { AssistantSpend, CrewKind, DiscState, RecordKind, RosterKind } from '@shared/lib/types/assistant'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const MINUTES_PER_HOUR = 60

export const ASSISTANT_COPY = {
  open: 'Ask FreightProof',
  minimise: 'Minimise',
  title: 'Ask FreightProof',
  newChat: 'New chat',
  note: 'Reads our records only. It never saves or changes anything.',
  starters: [
    'How many trips are active right now?',
    "What's finishing today?",
    'Which drivers and horses are free this weekend?',
    'Which trips need attention?',
  ],
  inputLabel: 'Your question',
  placeholder: 'Ask about trips, drivers, trucks or parcels',
  charCount: (used: number, max: number): string => `${used}/${max}`,
  charCountSpoken: (used: number, max: number): string => `${used} of ${max} characters`,
  send: 'Ask',
  waiting: 'Checking our records…',
  you: 'You',
  assistant: 'Assistant',
  checked: 'Checked:',
  nothingChecked: 'No records checked',
  budgetSpent: 'The AI budget for this month is used up. It resets on the 1st.',
  errorFallback: "Couldn't get an answer. Try again.",
  retry: 'Try again',
  which: (what: RecordKind): string => `Which ${RECORD_WORDS[what]}?`,
  more: (count: number): string => `and ${count} more`,
  showing: (shown: number, total: number): string => `Showing ${shown} of ${total}`,
  openDashboard: 'See them all on the Dashboard',
  openHistory: 'See them all in Trip History',
  expiryOne: 'Licence and disc dates',
  formTitle: 'The trip form will open with',
  formMode: 'Type',
  fromManifest: 'From manifest',
  emptyLeg: 'Empty leg',
  formManifest: 'Manifest',
  formDriver: 'Driver',
  formHorse: 'Horse',
  formTrailers: 'Trailers',
  formFrom: 'From',
  formTo: 'To',
  formDeparture: 'Departure',
  formArrival: 'Arrival',
  youFillIn: 'you fill in',
  manifestTime: "the manifest's time",
  none: 'none',
  nothingSaved: 'Nothing is saved until you press Create on the form.',
  allTime: 'All time',
  historyCounts: (total: number, completed: number, cancelled: number, live: number, booked: number): string =>
    `${total} ${total === 1 ? 'trip' : 'trips'}: ${completed} completed · ${cancelled} cancelled · ${live} live · ${booked} booked`,
  expiryWithin: (days: number): string => `Licences and discs expired or due within ${days} days`,
  nothingExpiring: 'None expired or due.',
  noDate: 'no date recorded',
  withoutDate: (count: number): string => `${count} with no date recorded, so not checked.`,
  moreExpiring: 'More match than shown here.',
  nothingBooked: 'Nothing booked',
  untilClosed: 'until the trip is closed',
  wasDue: (when: string): string => `was due ${when}`,
  overdue: 'Overdue',
  inactive: 'inactive',
  noIncidents: 'No open incidents.',
  noTrips: 'No trips match.',
  aboutVehicle: 'About this vehicle',
  onItsTrips: 'On all its trips',
  opening: 'Opening…',
  nothingToReview: 'nothing to review',
  breakdowns: (count: number): string => `${count} ${count === 1 ? 'breakdown' : 'breakdowns'} in the last 90 days`,
  notRecorded: 'Maintenance history is not recorded in FreightProof.',
  driving: 'Driving time',
  drivingNote: 'road time only, no stops or rest',
  pastTrips: (count: number): string => `${count} past ${count === 1 ? 'trip' : 'trips'}`,
  typical: 'middle',
  slow: 'slow',
  historyLeftOut: 'Past trips were faster than the road allows (demo or test data), so they are left out.',
  noHistory: 'No past trips on this route.',
  tookOver: (name: string): string => `took over from ${name}`,
  openParcel: 'Open in Parcels',
  openIncidents: 'See them all on the Incidents page',
  withInvestigator: (name: string): string => `with ${name}`,
  reviewQueue: 'Exceptions waiting for review',
  nothingWaiting: 'Nothing waiting for review.',
  claimed: (claimed: number, unclaimed: number): string => `${claimed} claimed · ${unclaimed} not claimed`,
  onFinishedTrips: (count: number): string => `${count} on trips already closed or cancelled`,
  openExceptions: 'Open the Exceptions page',
  deliveryConfirmed: 'Delivery confirmed',
  closed: 'Closed',
  left: 'Left',
  arrived: 'Arrived',
  parcels: (booked: number | null, out: number, scannedIn: number): string =>
    `Parcels: ${booked === null ? '' : `${booked} booked · `}${out} scanned out · ${scannedIn} scanned in`,
  lockAnchored: 'Journey lock anchored on Hedera',
  lockNotAnchored: 'Journey lock not anchored yet',
  receipts: (anchored: number, owed: number): string => `${anchored} of ${owed} phase receipts anchored`,
  receiptsFailed: (count: number): string => `${count} failed`,
  integrityNote: "Stored receipts only. The trip page's Verify button runs the live check.",
  activeInactive: (active: number, inactive: number): string => `${active} active · ${inactive} inactive`,
  activeOnly: (active: number): string => `${active} active`,
  sharedWithUs: 'shared with us',
  seeAllOn: (page: string): string => `See them all on the ${page} page`,
} as const

const RECORD_WORDS: Record<RecordKind, string> = { driver: 'driver', vehicle: 'vehicle', trip: 'trip', precinct: 'depot' }

export const CREW_GROUP_TITLES: Record<CrewKind, string> = { driver: 'Drivers', horse: 'Horses', trailer: 'Trailers' }

export const ROSTER_TITLES: Record<RosterKind, string> = {
  driver: 'Drivers', horse: 'Horses', trailer: 'Trailers', depot: 'Depots',
}

export const DISC_WORDS: Record<DiscState, string> = {
  expired: 'Disc expired', expiring: 'Disc expires soon', ok: 'Disc valid', unknown: 'No disc date recorded',
}

/** The "Checked:" line's words for each tool. */
export const TOOL_LABELS: Record<string, string> = {
  trips: 'Trips',
  trip_status: 'Trip',
  needs_attention: 'Needs attention',
  crew_bookings: 'Bookings',
  free_crew: 'Free crew',
  trip_history: 'Trip history',
  open_trip_form: 'Trip form',
  open_page: 'Page',
  analytics_redirect: 'Analytics',
  vehicle_status: 'Vehicle',
  expiring_documents: 'Licences and discs',
  route_time: 'Route time',
  parcel_lookup: 'Parcels',
  roster: 'Roster',
  incidents: 'Incidents',
}

/** "Bookings · Route time": each tool once, in the order it first ran. */
export function checkedLine(toolsUsed: string[]): string {
  return [...new Set(toolsUsed)].map((tool) => TOOL_LABELS[tool] ?? tool).join(' · ')
}

/** "17 h 40 min", "5 h", "45 min". */
export function fmtMinutes(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  const rest = Math.round(minutes - hours * MINUTES_PER_HOUR)
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** "25 min late", "1 h early", "on time": positive minutes are late. */
export function delayWords(minutes: number): string {
  if (minutes === 0) return 'on time'
  return `${fmtMinutes(Math.abs(minutes))} ${minutes > 0 ? 'late' : 'early'}`
}

/** "in transit" from "in_transit". */
export function words(value: string): string {
  return value.replace(/_/g, ' ')
}

export function spendLine(spend: AssistantSpend): string {
  return `Assistant this month: ${USD.format(spend.spent_usd)} · both chats: ${USD.format(spend.all_chats_spent_usd)} of ${USD.format(spend.budget_usd)}`
}
