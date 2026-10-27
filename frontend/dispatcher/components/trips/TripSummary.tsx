'use client'

import { useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import type { Precinct } from '@shared/lib/types/precinct'
import type { Driver } from '@shared/lib/types/driver'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { BackButton } from '@/components/ui/BackButton'
import { Skeleton } from '@/components/ui/Skeleton'
import { Ic } from '@/components/ui/Ic'
import { DriverModal } from './DriverModal'
import { VehicleModal } from './VehicleModal'
import { TripHelp } from './TripHelp'
import { RECORD_AFFORDANCE } from '@/components/ui/RecordLink'
import { precinctLabel, type HeaderFact, type TripHeaderFacts, type TripVehicles, type VehicleRef } from '@/lib/phase/trip-detail'
import { tripChipMeta } from '@/lib/phase/derive'
import { TRIP_PANELS } from '@/lib/trips/panel-query'

export { TRIP_PANELS } from '@/lib/trips/panel-query'
export type TripPanel = (typeof TRIP_PANELS)[keyof typeof TRIP_PANELS]
interface Props {
  facts: TripHeaderFacts
  precincts: Precinct[]
  driver: Driver | null
  returnTo: string
  onBack: () => void
  onPanel: (panel: TripPanel) => void
  compact?: boolean
  /** Makes the "N need review" chip a control that lands on the first unreviewed row in the
   *  timeline. Absent before the record loads, when there is no row to land on. */
  onShowFirstUnreviewed?: () => void
  transferAction?: { label: 'Transfer driver' | 'View transfer'; onClick: () => void } | null
}

export function TripSummary({ facts, precincts, driver, returnTo, onBack, onPanel, compact = false, onShowFirstUnreviewed, transferAction }: Props): React.JSX.Element {
  const [driverOpen, setDriverOpen] = useState(false)
  const [openVehicle, setOpenVehicle] = useState<{ vehicle: VehicleRef; role: string } | null>(null)
  const status = tripChipMeta(facts.status, facts.currentPhase)
  const route = `${precinctLabel(precincts.find(p => p.id === facts.originPrecinctId))} → ${precinctLabel(precincts.find(p => p.id === facts.destinationPrecinctId))}`

  return (
    <header className="shrink-0 border-b border-outline-v/30 bg-surf-lowest px-4 py-4 md:px-6">
      <div className="relative flex flex-wrap items-start gap-3">
        <BackButton onClick={onBack} />
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="break-words text-lg font-extrabold leading-tight text-on-surf">{facts.reference}</h1>
          <p className="mt-1 text-xs tabular-nums tracking-[0.03em] text-on-surf-v">{facts.manifestLabel}</p>
          <p className="mt-1 text-sm font-semibold text-on-surf">{route}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip type={status.chipType} label={status.label} />
          {facts.needsReviewCount > 0 && <NeedsReviewChip label={`${facts.needsReviewCount} exception${facts.needsReviewCount === 1 ? '' : 's'} need review`} onShow={onShowFirstUnreviewed} />}
          {compact && transferAction && <TransferAction action={transferAction} />}
          <TripHelp topic="header" />
        </div>
      </div>
      <div className={compact ? 'hidden' : 'mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4'}>
        <SummaryCell label="Driver" action={!compact && transferAction ? <TransferLink action={transferAction} /> : undefined}>
          {driver
            ? <>
                <div className="flex min-w-0 items-center">
                  <button type="button" onClick={() => setDriverOpen(true)} className={`${RECORD_AFFORDANCE} min-w-0 max-w-full truncate`} title={facts.driverName}>
                    {facts.driverName}<Ic n="chev" s={12} aria-hidden />
                  </button>
                </div>
                <a href={`tel:${driver.phone_number}`} className="block text-xs tabular-nums text-on-surf-v hover:text-on-surf">{driver.phone_number}</a>
              </>
            : <p className="mt-1 min-w-0 max-w-full break-words font-semibold text-on-surf">{facts.driverName}</p>}
        </SummaryCell>
        <SummaryCell label="Vehicle">
          {facts.vehicle
            ? <VehicleLines vehicles={facts.vehicle} onOpen={(vehicle, role) => setOpenVehicle({ vehicle, role })} />
            : <Skeleton className="mt-1 h-4 w-40 max-w-full rounded-md" />}
        </SummaryCell>
        <SummaryFact fact={facts.schedule} pendingLabel="Schedule" />
        <SummaryFact fact={facts.cargo} pendingLabel="Cargo" />
      </div>
      <nav aria-label="Trip sections" className="mt-4 flex flex-wrap gap-2 xl:hidden">
        <Button variant="secondary" size="sm" onClick={() => onPanel(TRIP_PANELS.information)}>Info</Button>
        <Button variant="secondary" size="sm" onClick={() => onPanel(TRIP_PANELS.manifest)}>Cargo</Button>
        <Button variant={facts.needsReviewCount ? 'primary' : 'secondary'} size="sm" onClick={() => onPanel(TRIP_PANELS.exceptions)}>
          {facts.exceptionsTotal === null
            ? `Exceptions · ${facts.needsReviewCount} need review`
            : `Exceptions · ${facts.exceptionsTotal} recorded · ${facts.needsReviewCount} need review`}
        </Button>
      </nav>
      {driver && <DriverModal driver={driver} open={driverOpen} onClose={() => setDriverOpen(false)} returnTo={returnTo} />}
      {openVehicle && (
        <VehicleModal
          vehicle={openVehicle.vehicle}
          role={openVehicle.role}
          open
          onClose={() => setOpenVehicle(null)}
          returnTo={returnTo}
        />
      )}
    </header>
  )
}

function TransferAction({ action }: { action: NonNullable<Props['transferAction']> }): React.JSX.Element {
  return <Button type="button" variant="secondary" size="sm" onClick={action.onClick} aria-label={action.label} title={action.label}
    iconLeft={<ArrowRightLeft size={12} aria-hidden />} className="shrink-0">
    <span className="hidden sm:inline">{action.label}</span>
  </Button>
}

/** The quiet in-cell form of the transfer action: text and icon in the link colour, no fill. */
function TransferLink({ action }: { action: NonNullable<Props['transferAction']> }): React.JSX.Element {
  return <button type="button" onClick={action.onClick}
    className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-semibold text-sec hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sec">
    <ArrowRightLeft size={12} aria-hidden />{action.label}
  </button>
}

function SummaryCell({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div className="min-w-0 border-l-2 border-outline-v/30 pl-3">
    <div className="flex items-center justify-between gap-2"><p className="text-xs text-on-surf-v">{label}</p>{action}</div>
    {children}
  </div>
}

/** Registrations alone do not say which is the truck and which is towed. */
function VehicleLines({ vehicles, onOpen }: { vehicles: TripVehicles; onOpen: (vehicle: VehicleRef, role: string) => void }) {
  return <>
    <VehicleLine role="Horse" vehicle={vehicles.horse} onOpen={onOpen} strong />
    {vehicles.trailers === null
      ? <Skeleton className="mt-1 h-3 w-24 max-w-full rounded-md" />
      : vehicles.trailers.length === 0
        ? <p className="mt-0.5 text-xs text-on-surf-v">No trailers</p>
        : vehicles.trailers.map(trailer => <VehicleLine key={trailer.registration} role="Trailer" vehicle={trailer} onOpen={onOpen} />)}
  </>
}

function VehicleLine(
  { role, vehicle, onOpen, strong = false }: { role: string; vehicle: VehicleRef; onOpen: (vehicle: VehicleRef, role: string) => void; strong?: boolean },
) {
  const size = strong ? 'text-sm' : 'text-xs'
  return <p className="flex flex-wrap items-center gap-x-1 break-words">
    <span className={`${size} text-on-surf-v`}>{role}</span>
    {vehicle.id
      ? <button type="button" onClick={() => onOpen(vehicle, role)} className={`${RECORD_AFFORDANCE} ${size} tabular-nums`}>
          {vehicle.registration}<Ic n="chev" s={12} aria-hidden />
        </button>
      : <span className={`${size} tabular-nums font-semibold text-on-surf`}>{vehicle.registration}</span>}
  </p>
}

/** A null fact is one the record has not delivered yet — shown as loading, never as an
 *  em-dash, which on this page would assert that nothing was recorded. */
function SummaryFact({ fact, pendingLabel }: { fact: HeaderFact | null; pendingLabel: string }) {
  if (!fact) return <SummaryCell label={pendingLabel}><Skeleton className="mt-1 h-4 w-40 max-w-full rounded-md" /></SummaryCell>
  return (
    <SummaryCell label={fact.label}>
      <p className="mt-1 break-words font-semibold text-on-surf">{fact.value}</p>
      {fact.note && <p className="mt-0.5 text-xs text-on-surf-v">{fact.note}</p>}
    </SummaryCell>
  )
}

const SHOW_FIRST_ACTION = 'Show the first in the timeline'

/** The header's review count. With somewhere to go it is the shortest way to the work: one press
 *  lands on the first unreviewed row, opened and focused, through the same path as "Show in
 *  timeline". The down chevron is the only visual change; the words stay the count. */
function NeedsReviewChip({ label, onShow }: { label: string; onShow?: () => void }) {
  if (!onShow) return <Chip type="exception" label={label} />
  return <button type="button" onClick={onShow} aria-label={`${label}. ${SHOW_FIRST_ACTION}`}
    className="rounded-md transition-[filter] duration-150 hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec motion-reduce:transition-none">
    <Chip type="exception">{label}<Ic n="chev" s={10} className="ml-1 rotate-90" /></Chip>
  </button>
}
