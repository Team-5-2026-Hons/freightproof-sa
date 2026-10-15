'use client'

import { useId, useState, type FormEvent } from 'react'

import { AdminOnly } from '@/components/auth/AdminOnly'
import { Button } from '@/components/ui/Button'
import { NO_DATA, fmtRandRate } from '@/lib/format/analytics'
import { useSaveCostRates } from '@/lib/hooks/useCostProfile'
import type { CostProfile } from '@shared/lib/types/cost-analytics'
import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import { cn } from '@shared/lib/utils/cn'
import { COST_COPY } from './costCopy'
import {
  changedRates,
  draftFrom,
  draftProblems,
  parseRate,
  type EditableRate,
  type RateDraft,
} from './costRates'

const COPY = COST_COPY.rates
// Consumption and the road factor are not money: one and two decimals, the precision they're stored at.
const CONSUMPTION_DECIMALS = 1
const FACTOR_DECIMALS = 2
const PER_100_KM = 100

interface RateRow {
  key: string
  label: string
  unit: string
  value: string
  origin: string
  /** The field an admin edits for this row; undefined for the derived fuel-per-km row. */
  field?: EditableRate
}

function rateRows(rates: CostProfile): RateRow[] {
  const rows = COPY.rows
  return [
    { key: 'diesel', field: 'diesel_price_per_litre', ...rows.diesel, value: `${fmtRandRate(rates.diesel_price_per_litre)} ${rows.diesel.unit}` },
    { key: 'consumption', field: 'litres_per_100km', ...rows.consumption, value: `${rates.litres_per_100km.toFixed(CONSUMPTION_DECIMALS)} ${rows.consumption.unit}` },
    { key: 'fuelPerKm', ...rows.fuelPerKm, value: `${fmtRandRate(rates.fuel_per_km)} ${rows.fuelPerKm.unit}` },
    { key: 'running', field: 'running_cost_per_km', ...rows.running, value: `${fmtRandRate(rates.running_cost_per_km)} ${rows.running.unit}` },
    { key: 'driver', field: 'driver_cost_per_hour', ...rows.driver, value: `${fmtRandRate(rates.driver_cost_per_hour)} ${rows.driver.unit}` },
    { key: 'fixed', field: 'fixed_cost_per_trip', ...rows.fixed, value: `${fmtRandRate(rates.fixed_cost_per_trip)} ${rows.fixed.unit}` },
    { key: 'delay', field: 'delay_cost_per_hour', ...rows.delay, value: `${fmtRandRate(rates.delay_cost_per_hour)} ${rows.delay.unit}` },
    { key: 'roadFactor', field: 'road_factor', ...rows.roadFactor, value: `${rows.roadFactor.unit} ${rates.road_factor.toFixed(FACTOR_DECIMALS)}` },
  ]
}

function footer(rates: CostProfile): string {
  const changed = rates.is_default || rates.updated_at === null
    ? COPY.startingRates
    : COPY.lastChanged(fmtSastDateTime(rates.updated_at) ?? rates.updated_at, rates.updated_by_name)
  return `${changed} · ${COPY.todaysRates}`
}

/** Fuel per km as the admin types, so they see what a new diesel price means before saving. */
function draftFuelPerKm(draft: RateDraft): string {
  const price = parseRate(draft.diesel_price_per_litre)
  const litres = parseRate(draft.litres_per_100km)
  if (price === null || litres === null) return NO_DATA
  return `${fmtRandRate((price * litres) / PER_100_KM)} ${COPY.rows.fuelPerKm.unit}`
}

interface RateInputProps {
  row: RateRow & { field: EditableRate }
  value: string
  problem: string | undefined
  onChange: (field: EditableRate, value: string) => void
}

function RateInput({ row, value, problem, onChange }: RateInputProps) {
  const errorId = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          name={row.field}
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(row.field, event.target.value)}
          aria-label={COPY.editLabel(row.label)}
          aria-invalid={problem !== undefined}
          aria-describedby={problem === undefined ? undefined : errorId}
          className={cn(
            'w-24 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1 text-[13px] tabular-nums text-surface-on',
            'focus:outline-none focus:ring-2 focus:ring-primary',
            problem !== undefined && 'border-error focus:ring-error',
          )}
        />
        <span className="text-[12px] text-on-surf-v">{row.unit}</span>
      </div>
      {problem !== undefined && <span id={errorId} className="text-[12px] text-error">{problem}</span>}
    </div>
  )
}

interface CostRatesCardProps {
  /** null while the cost figures (which carry their rates) are still loading or failed. */
  rates: CostProfile | null
  /** Called after a save, so the tab reloads its figures with the new rates. */
  onSaved?: () => void
  className?: string
}

/** The rates every estimate on the tab is worked out from, each with where it came from
 *  (spec D14). An admin dispatcher can edit and save them; everyone else reads them. */
export function CostRatesCard({ rates, onSaved, className }: CostRatesCardProps) {
  const titleId = useId()
  const [draft, setDraft] = useState<RateDraft | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  const saving = useSaveCostRates()
  const editing = draft !== null && rates !== null
  const problems = draft === null ? {} : draftProblems(draft)
  const update = draft === null || rates === null ? {} : changedRates(draft, rates)
  const hasProblems = Object.keys(problems).length > 0
  const hasChanges = Object.keys(update).length > 0

  function startEditing(): void {
    if (rates === null) return
    setDraft(draftFrom(rates))
    setSavedNotice(false)
    saving.clearError()
  }

  function change(field: EditableRate, value: string): void {
    setDraft((current) => (current === null ? current : { ...current, [field]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (hasProblems || !hasChanges) return
    try {
      await saving.save(update)
    } catch {
      // The hook has already kept the server's message for display; the inputs keep their values.
      return
    }
    setDraft(null)
    setSavedNotice(true)
    onSaved?.()
  }

  return (
    <section aria-labelledby={titleId} className={cn('rounded-lg bg-surf-lowest p-4 shadow-level-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={titleId} className="text-[14px] font-semibold text-on-surf">{COPY.title}</h3>
          <p className="mt-1 text-[12px] text-on-surf-v">{COPY.intro}</p>
        </div>
        {rates !== null && !editing && (
          <AdminOnly>
            <Button variant="secondary" size="sm" onClick={startEditing}>{COPY.edit}</Button>
          </AdminOnly>
        )}
      </div>
      {savedNotice && <p role="status" className="mt-2 text-[12px] font-[600] text-ok">{COPY.saved}</p>}
      {rates !== null && (
        <form onSubmit={(event) => { void submit(event) }} noValidate>
          <dl className="mt-3 divide-y divide-outline-variant/20">
            {rateRows(rates).map((row) => (
              <div key={row.key} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[10rem_11rem_1fr] sm:gap-4">
                <dt className="text-[13px] font-[600] text-on-surf">{row.label}</dt>
                <dd className="text-[13px] tabular-nums text-on-surf">
                  {editing && row.field !== undefined && draft !== null ? (
                    <RateInput row={{ ...row, field: row.field }} value={draft[row.field]} problem={problems[row.field]} onChange={change} />
                  ) : editing && draft !== null ? draftFuelPerKm(draft) : row.value}
                </dd>
                <dd className="text-[12px] text-on-surf-v">{editing && row.field === undefined ? COPY.derived : row.origin}</dd>
              </div>
            ))}
          </dl>
          {editing && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" loading={saving.isSaving} disabled={hasProblems || !hasChanges || saving.isSaving}>
                {COPY.save}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving.isSaving}>
                {COPY.cancel}
              </Button>
              {!hasChanges && !hasProblems && <span className="text-[12px] text-on-surf-v">{COPY.noChanges}</span>}
              {saving.error !== null && (
                <span role="alert" className="text-[12px] text-error">{saving.error || COPY.saveFailed}</span>
              )}
            </div>
          )}
          <p className="mt-3 text-[12px] text-on-surf-v">{footer(rates)}</p>
        </form>
      )}
    </section>
  )
}
