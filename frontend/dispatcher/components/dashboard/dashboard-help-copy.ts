// The sentences the dashboard panels' "i" popovers say, in one place so a copy change is one edit.
// Each states what the panel lists and how its rows are ordered, so the panel face carries no
// explanatory text of its own.

import { DASHBOARD_TRIP_LIMIT, PANEL_ROW_LIMIT } from '@/lib/dashboard/attention'

export interface DashboardHelpEntry {
  label: string
  question: string
  basis: string
  note: string
  footnote: string
}

export const DASHBOARD_HELP = {
  trips: {
    label: 'About the Active trips panel',
    question: 'What this panel shows',
    basis: 'Every trip between creation and closure.',
    note: 'Trips with exceptions waiting on a dispatcher come first, worst first. The rest follow by how far along they are.',
    footnote: `Shows the first ${DASHBOARD_TRIP_LIMIT}. View all opens the searchable list.`,
  },
  exceptions: {
    label: 'About the Exceptions panel',
    question: 'What this panel shows',
    basis: 'Exceptions no dispatcher has reviewed yet. An exception is a finding the system recorded, not a statement about the cargo.',
    note: 'Most severe first, then newest. Raised is how long the exception has been waiting.',
    footnote: `Shows the first ${PANEL_ROW_LIMIT}. View all opens the review queue.`,
  },
  incidents: {
    label: 'About the Incidents panel',
    question: 'What this panel shows',
    basis: 'Incidents reported on trips that are not yet closed.',
    note: 'Newest report first. Received is how long ago the report arrived.',
    footnote: `Shows the first ${PANEL_ROW_LIMIT}. View all opens the full list, closed incidents included.`,
  },
} as const satisfies Record<string, DashboardHelpEntry>

export type DashboardHelpTopic = keyof typeof DASHBOARD_HELP
