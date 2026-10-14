'use client'

import { useId, useState } from 'react'
import { Ic } from '@/components/ui/Ic'
import { SearchSelect } from '@/components/ui/SearchSelect'
import type { CrewValues, FieldErrors } from '@/lib/trips/manifest-form'
import { MAX_TRAILERS, type TrailerCombo } from '@/lib/trips/trailer-combo'
import type { Driver } from '@shared/lib/types/driver'
import type { Vehicle } from '@shared/lib/types/vehicle'
import { cn } from '@shared/lib/utils/cn'
import { CardTitle, FieldError, FieldLabel, FormCard } from './form-parts'

// Past this many trailers, a filter box earns its space.
const TRAILER_SEARCH_THRESHOLD = 5

export interface CrewFieldsProps {
  crew: CrewValues
  onChange: (crew: CrewValues) => void
  drivers: readonly Driver[]
  horses: readonly Vehicle[]
  trailers: readonly Vehicle[]
  combo: TrailerCombo
  errors: FieldErrors
}

/** Driver, horse and trailers: LFG's decision, never taken from the manifest (spec §5). */
export function CrewFields(
  { crew, onChange, drivers, horses, trailers, combo, errors }: CrewFieldsProps,
): React.JSX.Element {
  const [trailerSearch, setTrailerSearch] = useState('')
  const driverLabelId = useId()
  const driverErrorId = useId()
  const horseLabelId = useId()
  const horseErrorId = useId()
  // Inactive vehicles cannot be put on a trip (the server answers 404), so they are not offered.
  const activeTrailers = trailers.filter(t => t.is_active)
  const driver = drivers.find(d => d.id === crew.driverId) ?? null
  const horse = horses.find(h => h.id === crew.horseId) ?? null
  const term = trailerSearch.trim().toLowerCase()
  const shownTrailers = term
    ? activeTrailers.filter(t => [t.registration, t.make ?? '', t.model ?? ''].some(field => field.toLowerCase().includes(term)))
    : activeTrailers

  function toggleTrailer(id: string): void {
    const trailerIds = crew.trailerIds.includes(id)
      ? crew.trailerIds.filter(existing => existing !== id)
      : [...crew.trailerIds, id]
    onChange({ ...crew, trailerIds })
  }

  return (
    <>
      <FormCard>
        <CardTitle icon="user">Driver</CardTitle>
        <FieldLabel id={driverLabelId} required>Assigned driver</FieldLabel>
        <SearchSelect
          options={drivers.filter(d => d.is_active).map(d => ({
            value: d.id, label: d.full_name, sublabel: `License ${d.license_number}`,
          }))}
          value={crew.driverId}
          onChange={driverId => onChange({ ...crew, driverId })}
          placeholder="Select driver…"
          searchPlaceholder="Search by name or license…"
          error={Boolean(errors.driver)}
          labelledBy={driverLabelId}
          describedBy={errors.driver ? driverErrorId : undefined}
        />
        {errors.driver && <FieldError id={driverErrorId}>{errors.driver}</FieldError>}
        {driver && (
          <div className="mt-[14px] rounded-lg border border-outline-v/20 bg-surf-low p-[12px_14px]">
            <div className="mb-[10px] text-[15px] font-[700] text-on-surf">{driver.full_name}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-[6px]">
              <MiniField label="License number" value={driver.license_number} numeric />
              <MiniField label="ID number" value={driver.id_number} numeric />
              <MiniField label="Phone" value={driver.phone_number} />
            </div>
          </div>
        )}
      </FormCard>

      <FormCard>
        <CardTitle icon="truck">Horse (truck)</CardTitle>
        <FieldLabel id={horseLabelId} required>Horse</FieldLabel>
        <SearchSelect
          options={horses.filter(h => h.is_active).map(h => ({
            value: h.id,
            label: h.registration,
            sublabel: [h.make, h.model, h.year].filter(Boolean).join(' ') || undefined,
          }))}
          value={crew.horseId}
          onChange={horseId => onChange({ ...crew, horseId })}
          placeholder="Select horse…"
          searchPlaceholder="Search by registration or make…"
          error={Boolean(errors.horse)}
          labelledBy={horseLabelId}
          describedBy={errors.horse ? horseErrorId : undefined}
        />
        {errors.horse && <FieldError id={horseErrorId}>{errors.horse}</FieldError>}
        {horse && (
          <div className="mt-[14px] rounded-lg border border-outline-v/20 bg-surf-low p-[12px_14px]">
            <div className="mb-[10px] text-[16px] font-[700] tabular-nums tracking-[0.04em] text-on-surf">{horse.registration}</div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-[6px]">
              <MiniField label="Make" value={horse.make} />
              <MiniField label="Model" value={horse.model} />
              <MiniField label="Year" value={horse.year?.toString()} numeric />
              {horse.gross_vehicle_mass_kg != null && (
                <MiniField label="GVM" value={`${horse.gross_vehicle_mass_kg.toLocaleString()} kg`} numeric />
              )}
            </div>
          </div>
        )}
      </FormCard>

      <FormCard>
        <CardTitle icon="truck">Trailers</CardTitle>
        {activeTrailers.length === 0 ? (
          <p className="text-[13px] text-on-surf-v">No active trailers in the fleet.</p>
        ) : (
          <>
            {activeTrailers.length > TRAILER_SEARCH_THRESHOLD && (
              <div className="mb-2 flex items-center gap-2 rounded-t-sm border-b border-outline-v bg-surf-low px-3 py-[8px]">
                <Ic n="search" s={13} className="shrink-0 text-on-surf-v" />
                <input
                  aria-label="Search trailers"
                  value={trailerSearch}
                  onChange={event => setTrailerSearch(event.target.value)}
                  placeholder="Search trailers…"
                  className="flex-1 bg-transparent text-[13px] text-on-surf outline-none placeholder:text-on-surf-v"
                />
              </div>
            )}
            {shownTrailers.length === 0 ? (
              <p className="py-2 text-[13px] text-on-surf-v">No trailers match your search.</p>
            ) : (
              <fieldset className="mb-3 flex flex-col overflow-hidden rounded-lg border border-outline-v/20">
                <legend className="sr-only">Trailers</legend>
                {shownTrailers.map(t => {
                  const checked = crew.trailerIds.includes(t.id)
                  const atLimit = !checked && crew.trailerIds.length >= MAX_TRAILERS
                  return (
                    <label
                      key={t.id}
                      className={cn(
                        'flex items-start gap-3 border-b border-outline-v/10 px-4 py-[10px] transition-colors duration-100 last:border-0',
                        checked ? 'cursor-pointer bg-sec-c' : atLimit ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-surf-low',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={atLimit}
                        onChange={() => toggleTrailer(t.id)}
                        className="mt-[3px] h-4 w-4 shrink-0 accent-sec"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-[600] tabular-nums tracking-[0.04em] text-on-surf">{t.registration}</span>
                          {t.length_m != null && (
                            <span className="rounded-full bg-chain-c px-[8px] py-[1px] text-[11px] font-[700] tabular-nums text-chain-onc">
                              {t.length_m} m
                            </span>
                          )}
                        </div>
                        {(t.make || t.model || t.gross_vehicle_mass_kg) && (
                          <div className="mt-[2px] text-[11px] text-on-surf-v">
                            {[t.make, t.model, t.year].filter(Boolean).join(' ')}
                            {t.gross_vehicle_mass_kg != null ? ` · ${t.gross_vehicle_mass_kg.toLocaleString()} kg GVM` : ''}
                          </div>
                        )}
                      </div>
                    </label>
                  )
                })}
              </fieldset>
            )}
            {/* role=status so a screen reader hears the verdict change as trailers are ticked. */}
            <div
              role="status"
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-3 text-[13px] font-[600]',
                combo.valid ? 'bg-ok-c text-ok-onc' : 'bg-err-c text-err-onc',
              )}
            >
              <Ic n={combo.valid ? 'check' : 'warn'} s={14} className={combo.valid ? 'text-ok' : 'text-err'} />
              {combo.message}
            </div>
            {errors.trailers && <FieldError>{errors.trailers}</FieldError>}
          </>
        )}
      </FormCard>
    </>
  )
}

function MiniField(
  { label, value, numeric = false }: { label: string; value: string | null | undefined; numeric?: boolean },
): React.JSX.Element {
  return (
    <div>
      <div className="mb-[1px] text-[10px] text-on-surf-v">{label}</div>
      <div className={cn('text-[12px] font-[500] text-on-surf', numeric && 'tabular-nums tracking-[0.04em]')}>
        {value || 'Not recorded'}
      </div>
    </div>
  )
}
