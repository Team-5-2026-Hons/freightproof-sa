export const TRIP_PANELS = { information: 'information', manifest: 'manifest', exceptions: 'exceptions' } as const
export const LEGACY_AUDIT_PANEL = 'audit'

/** What one navigation to a trip-detail panel asks of the URL. A field left out means
 *  "keep what the URL already says"; `null` means "clear it". */
export interface TripPanelChange {
  panel: string | null
  filter?: string
  phaseId?: string | null
  exceptionId?: string | null
}

/**
 * The query string for a trip-detail panel navigation.
 *
 * One function so the three selection parameters stay consistent: `phase` and
 * `exception` only mean something on the exceptions panel, so any other panel (or none)
 * forgets both, and a stale id can never be carried onto a panel that has no use for it.
 * A trip-level exception has no phase, so opening it passes `phaseId: null` to drop any
 * phase filter that would otherwise hide it.
 */
export function buildTripPanelQuery(current: string, change: TripPanelChange): string {
  const query = new URLSearchParams(current)
  // Keep the old value readable on arrival, but never propagate it into new navigation.
  const panel = change.panel === LEGACY_AUDIT_PANEL ? TRIP_PANELS.information : change.panel
  if (panel) query.set('panel', panel)
  else query.delete('panel')
  if (change.filter) query.set('exceptions', change.filter)
  applySelection(query, 'phase', change.phaseId, panel === TRIP_PANELS.exceptions)
  applySelection(query, 'exception', change.exceptionId, panel === TRIP_PANELS.exceptions)
  return query.toString()
}

function applySelection(query: URLSearchParams, key: string, value: string | null | undefined, onExceptionsPanel: boolean): void {
  if (!onExceptionsPanel || value === null) query.delete(key)
  else if (value) query.set(key, value)
}
