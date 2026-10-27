// Every word the public landing page and legal pages say, in one place — so the copy can
// be reviewed (and the company particulars filled in) without reading layout code.

/** Where access requests and legal queries go. Public by design: it is printed on the page. */
export const CONTACT_EMAIL = 'freightproof@gmail.com'

export const COMPANY = {
  tradingName: 'FreightProof SA',
  legalName: 'FreightProof SA (Pty) Ltd',
  legalStatus: 'Private company incorporated in the Republic of South Africa',
  registrationNumber: '[Company registration number]',
  vatNumber: '[VAT number, if registered]',
  physicalAddress: '[Registered physical address], Cape Town, Western Cape, South Africa',
  postalAddress: '[Postal address]',
  phone: '[Telephone number]',
  email: CONTACT_EMAIL,
  website: '[Website address]',
  directors: ['Ciaran Formby', 'Tim Gultig', 'Chiko Kasongo', 'Tom Davis'],
  informationOfficer: '[Name of Information Officer]',
} as const

export const LEGAL_LAST_UPDATED = '12 October 2026'

export interface TeamMember {
  name: string
  role: string
}

export const TEAM: readonly TeamMember[] = [
  { name: 'Ciaran Formby', role: 'Co-founder' },
  { name: 'Tim Gultig', role: 'Co-founder' },
  { name: 'Chiko Kasongo', role: 'Co-founder' },
  { name: 'Tom Davis', role: 'Co-founder' },
]

export interface JourneyStop {
  id: string
  phase: 'trip_creation' | 'activation' | 'loading' | 'departure' | 'in_transit' | 'unloading' | 'confirmation'
  title: string
  body: string
  sealed: string
}

export const JOURNEY: readonly JourneyStop[] = [
  {
    id: 'trip-creation',
    phase: 'trip_creation',
    title: 'The trip is locked before the truck moves',
    body: 'The dispatcher commits the driver, horse, trailers, consignments, route and precincts. FreightProof fingerprints that commitment, so any later change has to be recorded as an exception.',
    sealed: 'Journey lock',
  },
  {
    id: 'activation',
    phase: 'activation',
    title: 'The right driver, at the right gate',
    body: 'The driver signs in on a company device at the origin precinct. Their phone position is checked against the precinct boundary, and a mismatch is recorded, not waved through.',
    sealed: 'Driver and location',
  },
  {
    id: 'loading',
    phase: 'loading',
    title: 'Counted, signed and sealed',
    body: 'The driver confirms the unit count from the linehaul document without ever seeing what’s inside. The seal number and the signed waybill are recorded alongside it.',
    sealed: 'Pickup receipt',
  },
  {
    id: 'departure',
    phase: 'departure',
    title: 'Out of the gate with an intact seal',
    body: 'Departure fixes the combination of driver, vehicle, cargo and seal. From here, anything that doesn’t match is an exception on the record.',
    sealed: 'Departure',
  },
  {
    id: 'in-transit',
    phase: 'in_transit',
    title: 'The long road, still on the record',
    body: 'Deviations and incidents on the road are logged against the trip with their time and position, exactly where they happened.',
    sealed: 'Transit log',
  },
  {
    id: 'unloading',
    phase: 'unloading',
    title: 'Arrival is the proof',
    body: 'At the destination, the seal is checked against the one recorded at pickup and the counts are reconciled. A broken or swapped seal is the strongest signal there is.',
    sealed: 'Delivery receipt',
  },
  {
    id: 'confirmation',
    phase: 'confirmation',
    title: 'The receiver closes the chain',
    body: 'The receiver confirms delivery with a one-time PIN. No app and no account are needed. The trip’s evidence chain is complete.',
    sealed: 'Chain closed',
  },
]

export interface SourcedFact {
  figure: string
  statement: string
  source: string
  href: string
}

export const FACTS: readonly SourcedFact[] = [
  {
    figure: '1,976',
    statement: 'truck hijackings recorded by SAPS in 2023/24. That’s more than five every day, and up more than 50% in a decade.',
    source: 'ISS Today, Dec 2024',
    href: 'https://issafrica.org/iss-today/south-africa-s-armed-robbery-problem-drives-kidnapping',
  },
  {
    figure: '420',
    statement: 'trucks hijacked in the second quarter of 2025 alone.',
    source: 'SAPS crime statistics, via Aon, Feb 2026',
    href: 'https://aon.co.za/insights/sa-s-cargo-risks-and-hijacking-surge/',
  },
  {
    figure: 'R577m',
    statement: 'in reported losses across 2,670 cargo-theft incidents in 18 months, and that counts only the incidents that were reported.',
    source: 'TAPA EMEA, to June 2022, via Aon',
    href: 'https://aon.co.za/insights/sa-s-cargo-risks-and-hijacking-surge/',
  },
]

export const SECTIONS = {
  journey: 'how-it-works',
  why: 'why',
  about: 'about',
  access: 'request-access',
} as const
