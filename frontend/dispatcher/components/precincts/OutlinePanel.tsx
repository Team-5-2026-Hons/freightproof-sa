'use client'

import React from 'react'

import { Button } from '@/components/ui/Button'
import { describeOutline } from '@/lib/map/polygon'
import type { OutlineCandidate } from '@/lib/geocode/overpass'
import type { LatLngPair } from '@shared/lib/types/precinct'

export type CandidateStatus = 'idle' | 'loading' | 'done' | 'error'

interface OutlinePanelProps {
  outline: LatLngPair[] | null
  candidates: OutlineCandidate[]
  status: CandidateStatus
  /** Which candidate the current outline started from, until the dispatcher edits it. */
  selectedId: string | null
  /** Validation message for the current outline (or for a missing one), or null. */
  error: string | null
  /** False until a pin exists — every action here works around the pin. */
  hasPin: boolean
  /** Look up the property at the pin and draw the best match (square if none). */
  onAutoFit: () => void
  onPick: (candidate: OutlineCandidate) => void
  onStartSquare: () => void
  onClear: () => void
}

// Same pressed-state treatment as ParcelSearch's result rows.
const CANDIDATE_BUTTON_CLASS =
  'w-full rounded-lg border border-outline-v/40 px-3 py-2 text-left transition-colors hover:bg-surf-low ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec ' +
  'aria-pressed:border-sec aria-pressed:bg-sec-c/30'

/**
 * The outline half of the precinct form: shapes OpenStreetMap has mapped at the pin, a
 * starter square when it has none, and the current outline's summary. Editing happens on
 * the map itself (GeofenceMap + Leaflet-Geoman); this panel only chooses where to start.
 */
export function OutlinePanel({
  outline, candidates, status, selectedId, error, hasPin, onAutoFit, onPick, onStartSquare, onClear,
}: OutlinePanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {outline !== null ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-surface-on tabular-nums">{describeOutline(outline)}</span>
          <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
        </div>
      ) : (
        <p className="text-xs text-on-surf-v">
          {hasPin
            ? 'No outline yet. Auto-fit draws one around the pin from mapped property shapes.'
            : 'Search an address or place the pin first — the outline is found around it.'}
        </p>
      )}

      {error !== null && <p className="text-xs text-error" role="alert">{error}</p>}

      <p className="text-[11px] text-on-surf-v">
        Drag the corners to the fence line on the satellite view. Click a midpoint to add a
        corner; right-click a corner to remove it.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onAutoFit} disabled={!hasPin || status === 'loading'}>
          {status === 'loading' ? 'Fitting…' : 'Auto-fit outline'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onStartSquare} disabled={!hasPin}>
          Start from a square
        </Button>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        {status === 'error' && (
          <p className="text-[11px] text-on-surf-v">
            Couldn&rsquo;t reach OpenStreetMap. Start from a square and drag it to the fence line.
          </p>
        )}
        {status === 'done' && candidates.length === 0 && (
          <p className="text-[11px] text-on-surf-v">
            Nothing is mapped at this spot. Start from a square and drag it to the fence line.
          </p>
        )}
        {candidates.length > 0 && (
          <>
            <span className="text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
              Mapped shapes (OpenStreetMap)
            </span>
            {/* A starting shape, never the fence itself: OSM maps buildings and estates,
                not property boundaries, so the dispatcher adjusts whatever is picked. */}
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={candidate.id === selectedId}
                onClick={() => onPick(candidate)}
                className={CANDIDATE_BUTTON_CLASS}
              >
                <span className="block text-sm text-on-surf">{candidate.label}</span>
                <span className="block text-[11px] text-on-surf-v tabular-nums">{candidate.detail}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
