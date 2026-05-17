'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar }        from '@/components/ui/TopBar'
import { Ic }            from '@/components/ui/Ic'
import { Button }        from '@/components/ui/Button'
import { StepRail }      from '@/components/ui/StepRail'
import { SearchSelect }  from '@/components/ui/SearchSelect'
import { useToast }      from '@/lib/hooks/useToast'
import { useAuth }       from '@/lib/hooks/useAuth'
import { ROUTES }        from '@/lib/constants/routes'
import { useDrivers }    from '@/lib/hooks/useDrivers'
import { useVehicles }   from '@/lib/hooks/useVehicles'
import { usePrecincts }  from '@/lib/hooks/usePrecincts'
import { COPY }          from '@shared/lib/constants/copy'
import { cn }            from '@shared/lib/utils/cn'
import { api, ApiError } from '@/lib/api/client'
import type { Trip }     from '@shared/lib/types/trip'
import type { Driver }   from '@shared/lib/types/driver'
import type { Vehicle }  from '@shared/lib/types/vehicle'

// ── Constants ────────────────────────────────────────────────────────────────

const STEP_NAMES = ['Order & Cargo', 'Crew & Vehicle', 'Route & Schedule', 'Review']


// Underline input style — Material 3 filled field look
const inp =
  'w-full bg-surf-low border-0 border-b-2 border-outline-v rounded-t-sm ' +
  'px-3 py-[10px] text-[14px] text-on-surf font-[Inter,sans-serif] ' +
  'outline-none focus:bg-sec-c focus:border-sec transition-all duration-150'

// ── Local helpers ─────────────────────────────────────────────────────────────

function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surf-lowest rounded-lg p-6 shadow-level-3 mb-4">{children}</div>
  )
}

function CardTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="text-[15px] font-[800] text-on-surf mb-[18px] flex items-center gap-2">
      <Ic n={icon as Parameters<typeof Ic>[0]['n']} s={16} className="text-sec" />
      {children}
    </div>
  )
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-[600] text-on-surf-v mb-1">{children}</div>
}

function ReviewRows({ rows }: { rows: { label: string; value: string; mono?: boolean }[] }) {
  return (
    <div className="flex flex-col">
      {rows.map(row => (
        <div key={row.label} className="flex items-start gap-3 py-2 border-b border-outline-v/10 last:border-0">
          <span className="text-[11px] text-on-surf-v w-24 shrink-0 pt-px">{row.label}</span>
          <span className={cn(
            'text-[13px] font-[600] text-on-surf',
            row.mono && 'tabular-nums tracking-[0.04em]',
          )}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <div className="bg-surf-lowest rounded-lg p-6 shadow-level-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
          {title}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="text-[12px] font-[600] text-sec hover:opacity-75 transition-opacity"
        >
          Edit
        </button>
      </div>
      {children}
    </div>
  )
}

function fmtDateTime(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Step 2 helpers ────────────────────────────────────────────────────────────

function MiniField({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
      <div className={cn('text-[12px] font-[500] text-on-surf', mono && 'font-mono tracking-[0.04em]')}>
        {value || '—'}
      </div>
    </div>
  )
}

function IdvsStatusChip({ status }: { status: Driver['idvs_status'] }) {
  const styles = {
    verified: 'bg-ok-c text-on-ok-c',
    pending:  'bg-surf-high text-on-surf-v',
    failed:   'bg-err-c text-on-err-c',
  }
  const labels = { verified: 'IDVS Verified', pending: 'IDVS Pending', failed: 'IDVS Failed' }
  return (
    <span className={cn('inline-flex items-center gap-[4px] rounded-full px-[8px] py-[2px] text-[10px] font-[700] shrink-0', styles[status])}>
      {status === 'verified' && <Ic n="check" s={9} />}
      {status === 'failed'   && <Ic n="warn"  s={9} />}
      {labels[status]}
    </span>
  )
}

// Trailer combination rules (South African road regs):
//   0 trailers → single unit, valid
//   1 trailer  → valid (any length)
//   2 trailers → valid only when one is 6 m and one is 12 m (combined 18 m)
//   3+ trailers → blocked
function trailerCombo(selected: Vehicle[]): { valid: boolean; message: string } {
  if (selected.length === 0) return { valid: true,  message: 'Single unit — no trailer' }
  if (selected.length === 1) {
    const t = selected[0]
    const len = t.length_m != null ? `${t.length_m} m` : 'unknown length'
    return { valid: true, message: `${t.registration} — ${len}` }
  }
  if (selected.length === 2) {
    const lengths = selected.map(t => t.length_m ?? 0).sort((a, b) => a - b)
    if (lengths[0] === 6 && lengths[1] === 12) {
      return { valid: true, message: `6 m + 12 m combination — valid` }
    }
    return {
      valid: false,
      message: `${lengths[0]} m + ${lengths[1]} m — exceeds 18 m limit`,
    }
  }
  return { valid: false, message: 'Maximum 2 trailers allowed' }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TripNewPage() {
  const router = useRouter()
  const { notify } = useToast()
  const { user } = useAuth()

  const { drivers } = useDrivers()
  const { horses, trailers } = useVehicles()
  const { precincts } = usePrecincts()

  const [step, setStep]               = useState(1)  // 1–4
  const [loading, setLoading]         = useState(false)
  const [showErrors, setShowErrors]   = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Step 1 — Order & Cargo
  const [orderNumber, setOrderNumber] = useState('')
  const [commodity,   setCommodity]   = useState('')
  const [weightKg,    setWeightKg]    = useState('')
  const [unitCount,   setUnitCount]   = useState('')

  // Step 2 — Crew & Vehicle
  const [driverId,      setDriverId]      = useState('')
  const [horseId,       setHorseId]       = useState('')
  const [trailerIds,    setTrailerIds]    = useState<string[]>([])
  const [trailerSearch, setTrailerSearch] = useState('')

  // Step 3 — Route & Schedule
  const [originId,         setOriginId]         = useState('')
  const [destId,           setDestId]           = useState('')
  const [plannedDeparture, setPlannedDeparture] = useState('')
  const [expectedArrival,  setExpectedArrival]  = useState('')
  const [showReceiver,     setShowReceiver]     = useState(false)
  const [receiverName,     setReceiverName]     = useState('')
  const [receiverContact,  setReceiverContact]  = useState('')

  // Step 2 derived values
  const selectedDriver        = drivers.find(d => d.id === driverId) ?? null
  const selectedHorse         = horses.find(h => h.id === horseId) ?? null
  const selectedTrailerObjects = trailerIds.map(id => trailers.find(t => t.id === id)).filter((t): t is Vehicle => !!t)
  const comboResult           = trailerCombo(selectedTrailerObjects)
  const filteredTrailers      = trailerSearch.trim()
    ? trailers.filter(t =>
        t.registration.toLowerCase().includes(trailerSearch.toLowerCase()) ||
        (t.make ?? '').toLowerCase().includes(trailerSearch.toLowerCase()) ||
        (t.model ?? '').toLowerCase().includes(trailerSearch.toLowerCase()),
      )
    : trailers

  // Cross-field validation
  const sameLocation          = !!originId && originId === destId
  const arrivalNotAfterDepart = !!plannedDeparture && !!expectedArrival
    && new Date(expectedArrival) <= new Date(plannedDeparture)

  // stepValid[N] → whether step N passes validation (1-indexed, index 0 unused)
  const stepValid = [
    true,
    !!(orderNumber && commodity && weightKg && unitCount),
    !!(driverId && horseId && comboResult.valid),
    !!(originId && destId && !sameLocation && plannedDeparture && expectedArrival && !arrivalNotAfterDepart),
    true,
  ]

  const toggleTrailer = (id: string) =>
    setTrailerIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])

  const handleNext = () => {
    if (!stepValid[step]) { setShowErrors(true); return }
    setShowErrors(false)
    setStep(s => s + 1)
  }

  const handleBack = () => {
    setShowErrors(false)
    setStep(s => s - 1)
  }

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await api.post<Trip>('/api/v1/trips', {
        order_number: orderNumber,
        client_organization_id: user?.organization_id,
        driver_id: driverId,
        horse_id: horseId,
        trailer_ids: trailerIds,
        origin_precinct_id: originId,
        destination_precinct_id: destId,
        planned_departure_at: plannedDeparture
          ? new Date(plannedDeparture).toISOString()
          : null,
        planned_arrival_at: expectedArrival
          ? new Date(expectedArrival).toISOString()
          : null,
      })
      notify({ kind: 'success', title: COPY.toast.tripCreated })
      router.push(ROUTES.home)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        notify({ kind: 'error', title: 'Order number already active for this operator' })
      } else if (err instanceof ApiError && err.status === 404) {
        notify({ kind: 'error', title: 'Driver or vehicle not found — check fleet data' })
      } else {
        notify({ kind: 'error', title: 'Failed to create trip. Please try again.' })
      }
    } finally {
      setLoading(false)
    }
  }

  // Derived display values
  const driverName   = drivers.find(d => d.id === driverId)?.full_name ?? '—'
  const horseName    = horses.find(h => h.id === horseId)?.registration ?? '—'
  const trailerNames = trailerIds
    .map(id => trailers.find(t => t.id === id)?.registration ?? id)
    .join(', ') || 'None'
  const originName = precincts.find(p => p.id === originId)?.name ?? '—'
  const destName   = precincts.find(p => p.id === destId)?.name ?? '—'

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Create Trip"
        sub={`Step ${step} of 4 — ${STEP_NAMES[step - 1]}`}
      />

      {/* Step rail band — sits between TopBar and form content */}
      <div className="shrink-0 bg-surf-lowest border-b border-outline-v/20 px-8 py-5">
        <div className="max-w-2xl mx-auto">
          <StepRail
            steps={STEP_NAMES}
            current={step}
            onNavigate={(s) => { setShowErrors(false); setStep(s) }}
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className={cn(
          'mx-auto px-6 py-6',
          step === 4 ? 'max-w-4xl' : 'max-w-2xl',
        )}>

          {/* ── Step 1: Order & Cargo ──────────────────────────────────────── */}
          {step === 1 && (
            <>
              <FormCard>
                <CardTitle icon="file">Order Details</CardTitle>
                <Lbl>Order Number *</Lbl>
                <input
                  value={orderNumber}
                  onChange={e => setOrderNumber(e.target.value)}
                  placeholder="e.g. FDX-JHB-DBN-8821"
                  className={inp}
                />
              </FormCard>

              <FormCard>
                <CardTitle icon="box">Cargo Details</CardTitle>
                <div className="mb-[14px]">
                  <Lbl>Commodity description *</Lbl>
                  <input
                    value={commodity}
                    onChange={e => setCommodity(e.target.value)}
                    placeholder="e.g. Steel coils"
                    className={inp}
                  />
                </div>
                <div className="flex gap-3 mb-[14px]">
                  <div className="flex-1">
                    <Lbl>Total weight (kg) *</Lbl>
                    <input
                      type="number"
                      min="0"
                      value={weightKg}
                      onChange={e => setWeightKg(e.target.value)}
                      placeholder="0"
                      className={inp}
                    />
                  </div>
                  <div className="flex-1">
                    <Lbl>Unit count *</Lbl>
                    <input
                      type="number"
                      min="1"
                      value={unitCount}
                      onChange={e => setUnitCount(e.target.value)}
                      placeholder="0"
                      className={inp}
                    />
                  </div>
                </div>
              </FormCard>
            </>
          )}

          {/* ── Step 2: Crew & Vehicle ─────────────────────────────────────── */}
          {step === 2 && (
            <>
              {/* Driver ── */}
              <FormCard>
                <CardTitle icon="user">Driver</CardTitle>
                <div className="mb-[14px]">
                  <Lbl>Assigned Driver *</Lbl>
                  <SearchSelect
                    options={drivers.filter(d => d.is_active).map(d => ({
                      value: d.id as string,
                      label: d.full_name,
                      sublabel: `License ${d.license_number}`,
                    }))}
                    value={driverId}
                    onChange={setDriverId}
                    placeholder="Select driver…"
                    searchPlaceholder="Search by name or license…"
                    error={showErrors && !driverId}
                  />
                  {showErrors && !driverId && (
                    <p className="text-[11px] text-err mt-1 font-[500]">Please select a driver.</p>
                  )}
                </div>
                {selectedDriver && (
                  <div className="rounded-lg bg-surf-low p-[12px_14px] border border-outline-v/20">
                    <div className="flex items-start justify-between gap-3 mb-[10px]">
                      <div className="text-[15px] font-[700] text-on-surf">{selectedDriver.full_name}</div>
                      <IdvsStatusChip status={selectedDriver.idvs_status} />
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-[6px]">
                      <MiniField label="License number" value={selectedDriver.license_number} mono />
                      <MiniField label="ID number"      value={selectedDriver.id_number}      mono />
                      <MiniField label="Phone"          value={selectedDriver.phone_number} />
                    </div>
                  </div>
                )}
              </FormCard>

              {/* Horse ── */}
              <FormCard>
                <CardTitle icon="truck">Horse (Truck)</CardTitle>
                <div className="mb-[14px]">
                  <Lbl>Horse *</Lbl>
                  <SearchSelect
                    options={horses.filter(h => h.is_active).map(h => ({
                      value: h.id as string,
                      label: h.registration,
                      sublabel: [h.make, h.model, h.year].filter(Boolean).join(' ') || undefined,
                    }))}
                    value={horseId}
                    onChange={setHorseId}
                    placeholder="Select horse…"
                    searchPlaceholder="Search by registration or make…"
                    error={showErrors && !horseId}
                  />
                  {showErrors && !horseId && (
                    <p className="text-[11px] text-err mt-1 font-[500]">Please select a horse.</p>
                  )}
                </div>
                {selectedHorse && (
                  <div className="rounded-lg bg-surf-low p-[12px_14px] border border-outline-v/20">
                    <div className="text-[16px] font-[700] text-on-surf tabular-nums tracking-[0.04em] mb-[10px]">
                      {selectedHorse.registration}
                    </div>
                    <div className="grid grid-cols-3 gap-x-4 gap-y-[6px]">
                      <MiniField label="Make"  value={selectedHorse.make} />
                      <MiniField label="Model" value={selectedHorse.model} />
                      <MiniField label="Year"  value={selectedHorse.year?.toString()} />
                      {selectedHorse.gross_vehicle_mass_kg != null && (
                        <MiniField
                          label="GVM"
                          value={`${selectedHorse.gross_vehicle_mass_kg.toLocaleString()} kg`}
                          mono
                        />
                      )}
                    </div>
                  </div>
                )}
              </FormCard>

              {/* Trailers ── */}
              <FormCard>
                <CardTitle icon="truck">Trailers</CardTitle>
                <p className="text-[12px] text-on-surf-v mb-4 leading-relaxed">
                  A truck can run as a single unit with no trailer, pull one trailer of any length,
                  or pull a 6 m + 12 m combination only. Any other two-trailer combination exceeds
                  the 18 m limit.
                </p>

                {trailers.length === 0 ? (
                  <p className="text-[13px] text-on-surf-v">No trailers registered in the fleet.</p>
                ) : (
                  <>
                    {/* Search filter — only shown when there are enough to warrant it */}
                    {trailers.length > 5 && (
                      <div className="flex items-center gap-2 bg-surf-low rounded-t-sm border-b border-outline-v px-3 py-[8px] mb-2">
                        <Ic n="search" s={13} className="text-on-surf-v shrink-0" />
                        <input
                          value={trailerSearch}
                          onChange={e => setTrailerSearch(e.target.value)}
                          placeholder="Search trailers…"
                          className="flex-1 bg-transparent text-[13px] text-on-surf outline-none placeholder:text-on-surf-v"
                        />
                      </div>
                    )}

                    {filteredTrailers.length === 0 ? (
                      <p className="text-[13px] text-on-surf-v py-2">No trailers match your search.</p>
                    ) : (
                      <div className="flex flex-col border border-outline-v/20 rounded-lg overflow-hidden mb-3">
                        {filteredTrailers.map(t => {
                          const checked     = trailerIds.includes(t.id as string)
                          const wouldExceed = !checked && trailerIds.length >= 2
                          return (
                            <label
                              key={t.id as string}
                              className={cn(
                                'flex items-start gap-3 px-4 py-[10px] border-b border-outline-v/10 last:border-0 transition-colors duration-100',
                                checked      ? 'bg-sec-c cursor-pointer'
                                : wouldExceed ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-surf-low cursor-pointer',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={wouldExceed}
                                onChange={() => { if (!wouldExceed) toggleTrailer(t.id as string) }}
                                className="w-4 h-4 accent-sec mt-[3px] shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[14px] font-[600] text-on-surf tabular-nums tracking-[0.04em]">
                                    {t.registration}
                                  </span>
                                  {t.length_m != null && (
                                    <span className="text-[11px] font-[700] bg-chain-c text-chain-onc rounded-full px-[8px] py-[1px] tabular-nums">
                                      {t.length_m} m
                                    </span>
                                  )}
                                </div>
                                {(t.make || t.model || t.gross_vehicle_mass_kg) && (
                                  <div className="text-[11px] text-on-surf-v mt-[2px]">
                                    {[t.make, t.model, t.year].filter(Boolean).join(' ')}
                                    {t.gross_vehicle_mass_kg != null
                                      ? ` · ${t.gross_vehicle_mass_kg.toLocaleString()} kg GVM`
                                      : ''}
                                  </div>
                                )}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}

                    {/* Combination status indicator */}
                    <div className={cn(
                      'flex items-center gap-2 rounded-lg px-[12px] py-[9px] text-[12px] font-[600]',
                      comboResult.valid ? 'bg-ok-c text-on-ok-c' : 'bg-err-c text-on-err-c',
                    )}>
                      <Ic
                        n={comboResult.valid ? 'check' : 'warn'}
                        s={13}
                        className={comboResult.valid ? 'text-ok' : 'text-err'}
                      />
                      {comboResult.message}
                    </div>

                    {showErrors && !comboResult.valid && (
                      <p className="text-[11px] text-err mt-1 font-[500]">
                        Fix the trailer combination before continuing.
                      </p>
                    )}
                  </>
                )}
              </FormCard>
            </>
          )}

          {/* ── Step 3: Route & Schedule ───────────────────────────────────── */}
          {step === 3 && (
            <FormCard>
              <CardTitle icon="map">Route & Schedule</CardTitle>

              <div className="flex gap-3 mb-[14px]">
                <div className="flex-1">
                  <Lbl>Origin Precinct *</Lbl>
                  <select
                    value={originId}
                    onChange={e => setOriginId(e.target.value)}
                    className={inp}
                  >
                    <option value="">Select origin…</option>
                    {precincts.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <Lbl>Destination Precinct *</Lbl>
                  <select
                    value={destId}
                    onChange={e => setDestId(e.target.value)}
                    className={inp}
                  >
                    <option value="">Select destination…</option>
                    {precincts.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {showErrors && sameLocation && (
                    <p className="text-[11px] text-err mt-1 font-[500]">Must differ from origin.</p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mb-[14px]">
                <div className="flex-1">
                  <Lbl>Planned Departure *</Lbl>
                  <input
                    type="datetime-local"
                    value={plannedDeparture}
                    onChange={e => setPlannedDeparture(e.target.value)}
                    className={inp}
                  />
                </div>
                <div className="flex-1">
                  <Lbl>Expected Arrival *</Lbl>
                  <input
                    type="datetime-local"
                    value={expectedArrival}
                    onChange={e => setExpectedArrival(e.target.value)}
                    className={inp}
                  />
                  {showErrors && arrivalNotAfterDepart && (
                    <p className="text-[11px] text-err mt-1 font-[500]">Must be after departure.</p>
                  )}
                </div>
              </div>

              <div className="border-t border-outline-v/20 pt-[14px]">
                <button
                  type="button"
                  onClick={() => setShowReceiver(r => !r)}
                  className="flex items-center gap-1.5 text-[13px] font-[600] text-sec hover:opacity-75 transition-opacity mb-3"
                >
                  <Ic n={showReceiver ? 'chev' : 'plus'} s={14} className={cn('text-sec', showReceiver ? 'rotate-90' : '')} />
                  {showReceiver ? 'Remove receiver contact' : 'Add receiver contact'}
                </button>
                {showReceiver && (
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Lbl>Receiver name</Lbl>
                      <input
                        value={receiverName}
                        onChange={e => setReceiverName(e.target.value)}
                        placeholder="e.g. Warehouse Manager"
                        className={inp}
                      />
                    </div>
                    <div className="flex-1">
                      <Lbl>Phone or email</Lbl>
                      <input
                        value={receiverContact}
                        onChange={e => setReceiverContact(e.target.value)}
                        placeholder="e.g. 011 555 0123"
                        className={inp}
                      />
                    </div>
                  </div>
                )}
              </div>
            </FormCard>
          )}

          {/* ── Step 4: Review & Confirm ───────────────────────────────────── */}
          {step === 4 && (
            <div className="flex gap-5 items-start">
              {/* Left: review cards */}
              <div className="flex-1 min-w-0 flex flex-col gap-4">
                <ReviewSection title="Order & Cargo" onEdit={() => setStep(1)}>
                  <ReviewRows rows={[
                    { label: 'Order',     value: orderNumber,          mono: true },
                    { label: 'Commodity', value: commodity },
                    { label: 'Weight',    value: `${weightKg} kg`,     mono: true },
                    { label: 'Units',     value: unitCount,            mono: true },
                  ]} />
                </ReviewSection>

                <ReviewSection title="Crew & Vehicle" onEdit={() => setStep(2)}>
                  <ReviewRows rows={[
                    { label: 'Driver',   value: driverName },
                    { label: 'Horse',    value: horseName,     mono: true },
                    { label: 'Trailers', value: trailerNames,  mono: trailerIds.length > 0 },
                  ]} />
                </ReviewSection>

                <ReviewSection title="Route & Schedule" onEdit={() => setStep(3)}>
                  <ReviewRows rows={[
                    { label: 'Origin',       value: originName },
                    { label: 'Destination',  value: destName },
                    { label: 'Departure',    value: fmtDateTime(plannedDeparture), mono: true },
                    { label: 'Est. arrival', value: fmtDateTime(expectedArrival),  mono: true },
                  ]} />
                </ReviewSection>

                {showReceiver && (receiverName || receiverContact) && (
                  <ReviewSection title="Receiver" onEdit={() => setStep(3)}>
                    <ReviewRows rows={[
                      { label: 'Name',    value: receiverName    || '—' },
                      { label: 'Contact', value: receiverContact || '—' },
                    ]} />
                  </ReviewSection>
                )}
              </div>

              {/* Right: dark trip summary + CTA */}
              <div
                className="w-[280px] shrink-0 rounded-lg shadow-level-5 p-[22px] bg-primary"
              >
                <div
                  className="text-[11px] font-[700] tracking-[0.1em] uppercase mb-[14px]"
                  style={{ color: 'rgba(255,255,255,0.4)' }}
                >
                  Trip Summary
                </div>

                {([
                  ['Order',     orderNumber || '—',       true],
                  ['Driver',    driverName,                false],
                  ['Horse',     horseName,                 true],
                  ['Route',     originName !== '—' && destName !== '—'
                                  ? `${originName} → ${destName}` : '—', false],
                  ['Departure', fmtDateTime(plannedDeparture), true],
                  ['Cargo',     weightKg && unitCount
                                  ? `${unitCount} units · ${weightKg} kg` : '—', false],
                ] as [string, string, boolean][]).map(([label, value, mono]) => (
                  <div
                    key={label}
                    className="flex justify-between pb-2 mb-2"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {label}
                    </span>
                    <span
                      className={cn('text-right max-w-[160px]', mono
                        ? 'text-[13px] font-[600] tabular-nums tracking-[0.05em]'
                        : 'text-[12px] font-[500]')}
                      style={{ color: 'rgba(255,255,255,0.88)' }}
                    >
                      {value}
                    </span>
                  </div>
                ))}

                <div
                  className="text-[11px] mb-4 mt-2 leading-relaxed"
                  style={{ color: 'rgba(255,255,255,0.3)' }}
                >
                  On submit: journey lock hash anchored to Hedera HCS + pre-notification sent to principal.
                </div>

                <Button full onClick={() => setShowConfirm(true)}>
                  Create Trip + Lock to Blockchain
                </Button>
              </div>
            </div>
          )}

          {/* Error banner */}
          {showErrors && !stepValid[step] && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-err-c mt-4">
              <Ic n="warn" s={14} className="text-err" />
              <span className="text-[13px] font-[600] text-err-onc">
                Please complete all required fields before continuing.
              </span>
            </div>
          )}

        </div>
      </div>

      {/* ── Confirmation modal ──────────────────────────────────────────── */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !loading && setShowConfirm(false)}
        >
          <div
            className="w-full max-w-[440px] rounded-xl bg-surf-lowest shadow-xl p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="mt-[2px] shrink-0 rounded-full bg-warn-c p-[6px]">
                <Ic n="lock" s={16} className="text-warn" />
              </div>
              <div>
                <div className="text-[16px] font-[700] text-on-surf">This action is permanent</div>
                <div className="text-[13px] text-on-surf-v mt-[4px] leading-relaxed">
                  Once created, this trip will be anchored to the Hedera blockchain and cannot be
                  deleted. A trip can only be cancelled to retain evidence. Are you sure you want
                  to proceed?
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button full loading={loading} onClick={handleSubmit}>
                Create Trip + Lock to Blockchain
              </Button>
              {loading && (
                <div className="flex items-center gap-2 rounded-lg bg-warn-c px-3 py-2 text-[12px] font-[500] text-on-warn-c">
                  <Ic n="hex" s={12} className="text-warn animate-pulse" />
                  Anchoring to Hedera testnet — approx. 4–6 seconds…
                </div>
              )}
              <Button variant="secondary" full onClick={() => setShowConfirm(false)} disabled={loading}>
                Go back and review
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom navigation strip */}
      <div className="shrink-0 flex gap-[10px] px-6 py-3 bg-surf-lowest border-t border-outline-v/20">
        <Button
          variant="secondary"
          onClick={step > 1 ? handleBack : () => router.back()}
        >
          {step > 1 ? '← Back' : 'Cancel'}
        </Button>
        {step < 4 && (
          <Button onClick={handleNext}>
            {step === 3 ? 'Review trip →' : 'Next →'}
          </Button>
        )}
      </div>
    </div>
  )
}
