// Every sentence the trip page's "i" popovers say, in one place so a copy change is one edit and a
// test can pin it (the same approach as act-wording.ts).
//
// Honesty rules that shape the wording:
//  - Say what is recorded, never what happened to the cargo.
//  - A missing record is a gap in the record, not proof of anything.
//  - Positions are the vehicle's and the phone's, not the parcel's.

export interface TripHelpEntry {
  /** The button's and the panel's accessible name. */
  label: string
  /** The bold first line: what this section is. */
  question: string
  basis: string
  note?: string
  footnote?: string
}

export const TRIP_HELP = {
  header: {
    label: "About this trip's header",
    question: 'What the header shows',
    basis: 'The trip reference, manifest, route and status, then the driver, vehicle, schedule and cargo. Driver and vehicle names open a preview.',
    note: '“Need review” counts exceptions no dispatcher has reviewed yet. Select it to jump to the first one.',
    footnote: 'Schedule compares planned and recorded times. Cargo shows the parcels the manifest booked, with the counts recorded at a stop beneath.',
  },
  timeline: {
    label: 'How to read the timeline',
    question: 'How to read the timeline',
    basis: 'Each numbered card is one phase of the trip’s plan, in order. Its mark shows done, current, flagged or not started, and its verdict line gives the reasons.',
    note: 'Open a card for its zones. Recorded lists what was submitted. Checked compares it with the plan, such as a vehicle position against the facility boundary; positions are not parcel GPS.',
    footnote: 'Times name their clock: the driver’s phone or system recorded. A phase with nothing recorded is a gap in the record, not proof of what happened. Minimised keeps each card’s header and verdict.',
  },
  info: {
    label: 'About the Info tab',
    question: 'What the Info tab holds',
    basis: 'Schedule & seal compares planned and recorded times and gives the last departure seal number. Route lists the stops in order; select one to preview it. Driver & custody summarises who has driven and each handover; open one for its evidence.',
    note: 'Incidents lists the reports on this trip, with the police details a dispatcher enters after an event beneath them. Audit packs are sealed, shareable records of this trip for an insurer, loss adjuster, client or SAPS; each fact in one is labelled Anchored, Corroborated, Recorded or Declared so nothing claims more than the evidence supports.',
    footnote: 'Not recorded means no record exists yet, not that nothing happened.',
  },
  cargo: {
    label: 'About the Cargo tab',
    question: 'What the Cargo tab shows',
    basis: 'The waybills on this trip and their parcels, from the trip’s manifest.',
    note: 'Scanned out and in count parcels with a scan recorded against their barcode. A dash means no scan is recorded yet; it does not mean the parcel is missing.',
    footnote: 'Locked at creation is the manifest as it stood when the trip was created. Pulled is when the parcel system was last read.',
  },
  exceptions: {
    label: 'About the Exceptions tab',
    question: 'What the Exceptions tab shows',
    basis: 'Every exception recorded on this trip. An exception is a finding the system recorded, such as a position outside the boundary or a seal that differs. It does not say what happened to the cargo.',
    note: 'Unreviewed need a dispatcher’s review. Reviewed have been looked at, with the outcome entered. Recorded were logged and nothing is owed.',
    footnote: 'Show in timeline jumps to the record’s place. Review warnings signs off eligible records together; critical ones are always reviewed singly.',
  },
} as const satisfies Record<string, TripHelpEntry>

export type TripHelpTopic = keyof typeof TRIP_HELP
