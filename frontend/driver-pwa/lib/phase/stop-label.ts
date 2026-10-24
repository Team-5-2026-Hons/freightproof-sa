import type { PhaseDescriptor } from '@shared/lib/types/phase'

/**
 * A driver-facing name for the stop a phase happens at, from its position in the plan:
 * the first stop is "Origin", the last is "Destination", and anything between is
 * "Stop 2", "Stop 3"… counted the way a person counts (the origin is stop 1).
 *
 * Positional on purpose. The raw stop_sequence is 0-based, so the old "Stop 0" label told
 * a driver nothing; and the full Trip carries only precinct ids, not names, so a
 * name lookup would print a UUID fragment for any real (non-mock) precinct. Position is
 * always known and always true. Returns null for trip_creation, which has no stop.
 */
export function stopLabel(phases: readonly PhaseDescriptor[], stopSequence: number | null): string | null {
  if (stopSequence === null) return null

  const sequences = [...new Set(phases.map((p) => p.stop_sequence).filter((s): s is number => s !== null))]
    .sort((a, b) => a - b)
  if (sequences.length === 0) return null

  if (stopSequence === sequences[0]) return 'Origin'
  if (stopSequence === sequences[sequences.length - 1]) return 'Destination'

  const position = sequences.indexOf(stopSequence)
  return position === -1 ? null : `Stop ${position + 1}`
}

/**
 * Where a phase happens, as the driver experiences it. Same as stopLabel, except for an
 * in_transit leg: the ledger anchors it to the stop it DEPARTS from, which would label the
 * drive itself "Origin". The driver cares where the leg is going, so it reads "To
 * Destination" (or "To Stop 2" on a cross-dock plan).
 */
export function phaseLocation(phases: readonly PhaseDescriptor[], phase: PhaseDescriptor): string | null {
  if (phase.phase_type !== 'in_transit' || phase.stop_sequence === null) {
    return stopLabel(phases, phase.stop_sequence)
  }
  const departedFrom = phase.stop_sequence
  const next = phases
    .map((p) => p.stop_sequence)
    .filter((s): s is number => s !== null && s > departedFrom)
    .sort((a, b) => a - b)[0]
  const destination = next === undefined ? null : stopLabel(phases, next)
  return destination === null ? null : `To ${destination}`
}
