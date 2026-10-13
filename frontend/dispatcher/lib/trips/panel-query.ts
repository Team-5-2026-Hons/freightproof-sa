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
  if (change.panel) query.set('panel', change.panel)
  else query.delete('panel')
  if (change.filter) query.set('exceptions', change.filter)
  applySelection(query, 'phase', change.phaseId, change.panel === 'exceptions')
  applySelection(query, 'exception', change.exceptionId, change.panel === 'exceptions')
  return query.toString()
}

function applySelection(query: URLSearchParams, key: string, value: string | null | undefined, onExceptionsPanel: boolean): void {
  if (!onExceptionsPanel || value === null) query.delete(key)
  else if (value) query.set(key, value)
}
