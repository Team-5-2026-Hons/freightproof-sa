'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar }   from '@/components/ui/TopBar'
import { Ic }       from '@/components/ui/Ic'
import { Button }   from '@/components/ui/Button'
import { StepRail } from '@/components/ui/StepRail'
import { useToast }     from '@/lib/hooks/useToast'
import { ROUTES }       from '@/lib/constants/routes'
import { useDrivers }   from '@/lib/hooks/useDrivers'
import { useVehicles }  from '@/lib/hooks/useVehicles'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { COPY } from '@shared/lib/constants/copy'
import { cn } from '@shared/lib/utils/cn'

// ── Constants ────────────────────────────────────────────────────────────────

const SEC = '#0051d5'
const STEP_NAMES = ['Order & Cargo', 'Crew & Vehicle', 'Route & Schedule', 'Review']
const HANDLING_OPTIONS = ['Hazmat', 'Fragile', 'Temperature-controlled', 'Oversized'] as const

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
      <Ic n={icon as Parameters<typeof Ic>[0]['n']} s={16} c={SEC} />
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TripNewPage() {
  const router = useRouter()
  const { notify } = useToast()

  const drivers   = useDrivers()
  const { horses, trailers } = useVehicles()
  const precincts = usePrecincts()

  const [step, setStep]           = useState(1)  // 1–4
  const [loading, setLoading]     = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  // Step 1 — Order & Cargo
  const [orderNumber, setOrderNumber] = useState('')
  const [commodity,   setCommodity]   = useState('')
  const [weightKg,    setWeightKg]    = useState('')
  const [unitCount,   setUnitCount]   = useState('')
  const [handling,    setHandling]    = useState<string[]>([])

  // Step 2 — Crew & Vehicle
  const [driverId,   setDriverId]   = useState('')
  const [horseId,    setHorseId]    = useState('')
  const [trailerIds, setTrailerIds] = useState<string[]>([])

  // Step 3 — Route & Schedule
  const [originId,         setOriginId]         = useState('')
  const [destId,           setDestId]           = useState('')
  const [plannedDeparture, setPlannedDeparture] = useState('')
  const [expectedArrival,  setExpectedArrival]  = useState('')
  const [showReceiver,     setShowReceiver]     = useState(false)
  const [receiverName,     setReceiverName]     = useState('')
  const [receiverContact,  setReceiverContact]  = useState('')

  // Cross-field validation
  const sameLocation         = !!originId && originId === destId
  const arrivalNotAfterDepart = !!plannedDeparture && !!expectedArrival
    && new Date(expectedArrival) <= new Date(plannedDeparture)

  // stepValid[N] → whether step N passes validation (1-indexed, index 0 unused)
  const stepValid = [
    true,
    !!(orderNumber && commodity && weightKg && unitCount),
    !!(driverId && horseId),
    !!(originId && destId && !sameLocation && plannedDeparture && expectedArrival && !arrivalNotAfterDepart),
    true,
  ]

  const toggleHandling = (opt: string) =>
    setHandling(prev => prev.includes(opt) ? prev.filter(h => h !== opt) : [...prev, opt])

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
    await new Promise(r => setTimeout(r, 800))
    notify({ kind: 'success', title: COPY.toast.tripCreated })
    router.push(ROUTES.home)
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
                <div>
                  <Lbl>Special handling (optional)</Lbl>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {HANDLING_OPTIONS.map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => toggleHandling(opt)}
                        className={cn(
                          'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors duration-150',
                          handling.includes(opt)
                            ? 'bg-sec text-white'
                            : 'bg-surf-high text-on-surf-v border border-outline-v/30 hover:bg-outline-v/20',
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </FormCard>
            </>
          )}

          {/* ── Step 2: Crew & Vehicle ─────────────────────────────────────── */}
          {step === 2 && (
            <FormCard>
              <CardTitle icon="user">Driver & Vehicle</CardTitle>

              <div className="mb-[14px]">
                <Lbl>Assigned Driver *</Lbl>
                <select
                  value={driverId}
                  onChange={e => setDriverId(e.target.value)}
                  className={inp}
                >
                  <option value="">Select driver…</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>{d.full_name}</option>
                  ))}
                </select>
              </div>

              <div className="mb-[14px]">
                <Lbl>Horse (truck) *</Lbl>
                <select
                  value={horseId}
                  onChange={e => setHorseId(e.target.value)}
                  className={inp}
                >
                  <option value="">Select horse…</option>
                  {horses.map(h => (
                    <option key={h.id} value={h.id}>{h.registration}</option>
                  ))}
                </select>
              </div>

              <div>
                <Lbl>Trailers (optional)</Lbl>
                {trailers.length === 0 ? (
                  <p className="text-[13px] text-on-surf-v py-2">No trailers registered.</p>
                ) : (
                  <div className="flex flex-col mt-1">
                    {trailers.map(t => (
                      <label
                        key={t.id}
                        className="flex items-center gap-3 px-3 py-[10px] bg-surf-low border-b border-outline-v/20 cursor-pointer hover:bg-sec-c transition-colors duration-150 last:border-0"
                      >
                        <input
                          type="checkbox"
                          checked={trailerIds.includes(t.id)}
                          onChange={() => toggleTrailer(t.id)}
                          className="w-4 h-4 accent-sec"
                        />
                        <span className="text-[14px] font-[500] text-on-surf tabular-nums tracking-[0.04em]">
                          {t.registration}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </FormCard>
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
                  <Ic n={showReceiver ? 'chev' : 'plus'} s={14} c={SEC} className={showReceiver ? 'rotate-90' : ''} />
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
                  {handling.length > 0 && (
                    <div className="flex items-start gap-3 pt-2 border-t border-outline-v/10 mt-1">
                      <span className="text-[11px] text-on-surf-v w-24 shrink-0 pt-px">Handling</span>
                      <div className="flex flex-wrap gap-1.5">
                        {handling.map(h => (
                          <span
                            key={h}
                            className="px-2 py-0.5 rounded-sm text-[11px] font-[600] bg-surf-high text-on-surf"
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
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
                className="w-[280px] shrink-0 rounded-lg shadow-level-5 p-[22px]"
                style={{ background: '#1b1b1c' }}
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

                <Button full loading={loading} onClick={handleSubmit}>
                  Create Trip + Lock to Blockchain
                </Button>
              </div>
            </div>
          )}

          {/* Error banner */}
          {showErrors && !stepValid[step] && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-err-c mt-4">
              <Ic n="warn" s={14} c="#ba1a1a" />
              <span className="text-[13px] font-[600] text-err-onc">
                Please complete all required fields before continuing.
              </span>
            </div>
          )}

        </div>
      </div>

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
