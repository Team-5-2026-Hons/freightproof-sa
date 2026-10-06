'use client'

import { useId } from 'react'
import { SearchSelect } from '@/components/ui/SearchSelect'
import type { FieldErrors } from '@/lib/trips/manifest-form'
import type { Precinct } from '@shared/lib/types/precinct'
import { FieldError, FieldLabel, FromManifestTag } from './form-parts'

/** One end of the route: decided by the manifest, or chosen by the dispatcher. */
export type RouteEnd =
  | { kind: 'fixed'; name: string; hubCode: string }
  | { kind: 'pick'; value: string; options: readonly Precinct[]; hubCode: string | null }

export interface RouteFieldsProps {
  origin: RouteEnd
  destination: RouteEnd
  onPick: (end: 'origin' | 'destination', precinctId: string) => void
  errors: FieldErrors
}

export function RouteFields({ origin, destination, onPick, errors }: RouteFieldsProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <RouteEndField label="Origin precinct" end={origin} onPick={id => onPick('origin', id)} error={errors.origin} />
      <RouteEndField label="Destination precinct" end={destination} onPick={id => onPick('destination', id)} error={errors.destination} />
    </div>
  )
}

function RouteEndField(
  { label, end, onPick, error }: { label: string; end: RouteEnd; onPick: (precinctId: string) => void; error?: string },
): React.JSX.Element {
  const labelId = useId()
  const noteId = useId()
  if (end.kind === 'fixed') {
    return (
      <div className="min-w-0 flex-1">
        <FieldLabel>{label}</FieldLabel>
        {/* Read-only and visibly so: the manifest decides this end, not the dispatcher. */}
        <p className="rounded-t-sm border-b-2 border-outline-v/40 bg-surf-low px-3 py-[10px] text-[14px] font-[600] text-on-surf">
          {end.name}
        </p>
        <p className="mt-1">
          <FromManifestTag>From manifest · hub {end.hubCode}</FromManifestTag>
        </p>
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1">
      <FieldLabel id={labelId} required>{label}</FieldLabel>
      <SearchSelect
        options={end.options.map(p => ({ value: p.id, label: p.name, sublabel: p.address ?? undefined }))}
        value={end.value}
        onChange={onPick}
        placeholder={`Select ${label.toLowerCase()}…`}
        searchPlaceholder="Search precincts…"
        error={Boolean(error)}
        labelledBy={labelId}
        describedBy={error || end.hubCode ? noteId : undefined}
      />
      {error
        ? <FieldError id={noteId}>{error}</FieldError>
        : end.hubCode && (
          <p id={noteId} className="mt-1 text-[11px] leading-relaxed text-on-surf-v">
            Hub <span className="tabular-nums tracking-[0.03em]">{end.hubCode}</span> isn&apos;t linked. Choose the depot.
          </p>
        )}
      {end.options.length === 0 && (
        <p className="mt-1 text-[11px] font-[500] text-err">No precincts are available to choose from.</p>
      )}
    </div>
  )
}
