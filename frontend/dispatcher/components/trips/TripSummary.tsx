'use client'

import { useState } from 'react'
import type { Precinct } from '@shared/lib/types/precinct'
import type { Driver } from '@shared/lib/types/driver'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { BackButton } from '@/components/ui/BackButton'
import { Skeleton } from '@/components/ui/Skeleton'
import { Ic } from '@/components/ui/Ic'
import { ForensicControls } from '@/components/blockchain/ForensicControls'
import { DriverModal } from './DriverModal'
import { VehicleModal } from './VehicleModal'
import { RECORD_AFFORDANCE } from '@/components/ui/RecordLink'
import { precinctLabel, type HeaderFact, type TripHeaderFacts, type TripVehicles, type VehicleRef } from '@/lib/phase/trip-detail'
import { tripChipMeta } from '@/lib/phase/derive'

export type TripPanel = 'information' | 'manifest' | 'exceptions'
interface Props {
  facts: TripHeaderFacts
  precincts: Precinct[]
  /** Absent until the record loads: a list row knows the name and nothing else. */
  driver: Driver | null
  /** This trip's own URL, handed to the fleet pages so their Back returns here. */
  returnTo: string
  onBack: () => void
  onPanel: (panel: TripPanel) => void
}

export function TripSummary({ facts, precincts, driver, returnTo, onBack, onPanel }: Props) {
  const [driverOpen, setDriverOpen] = useState(false)
  // One shared modal instance for the horse and however many trailers there are, holding
  // which one is currently open rather than a boolean per vehicle.
  const [openVehicle, setOpenVehicle] = useState<{ vehicle: VehicleRef; role: string } | null>(null)
  const status = tripChipMeta(facts.status, facts.currentPhase)
  const route = `${precinctLabel(precincts.find(p => p.id === facts.originPrecinctId))} → ${precinctLabel(precincts.find(p => p.id === facts.destinationPrecinctId))}`

  return (
    <header className="shrink-0 border-b border-outline-v/30 bg-surf-lowest px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-start gap-3">
        <BackButton onClick={onBack} />
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="break-words text-lg font-extrabold leading-tight text-on-surf">{facts.reference}</h1>
          <p className="mt-1 text-xs text-on-surf-v">Order {facts.orderNumber}</p>
          {/* Not blue: the design system reserves --sec for links, actions and
              identifiers (trip ids, timestamps). A route is a description of two places,
              so colouring it like a link invited clicks it never answered. */}
          <p className="mt-1 text-sm font-semibold text-on-surf">{route}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip type={status.chipType} label={status.label} />
          {facts.needsReviewCount > 0 && <Chip type="exception" label={`${facts.needsReviewCount} exception${facts.needsReviewCount === 1 ? '' : 's'} need review`} />}
          <ForensicControls />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCell label="Driver">
          {driver
            ? <>
                <button type="button" onClick={() => setDriverOpen(true)} className={RECORD_AFFORDANCE}>
                  {facts.driverName}<Ic n="chev" s={12} aria-hidden />
                </button>
                {/* Always visible: reaching the driver is the most common reason to open
                    this modal, so the number should not need a click of its own. */}
                <a href={`tel:${driver.phone_number}`} className="block text-xs tabular-nums text-on-surf-v hover:text-on-surf">{driver.phone_number}</a>
              </>
            : <p className="mt-1 break-words font-semibold text-on-surf">{facts.driverName}</p>}
        </SummaryCell>
        <SummaryCell label="Vehicle">
          {facts.vehicle
            ? <VehicleLines vehicles={facts.vehicle} onOpen={(vehicle, role) => setOpenVehicle({ vehicle, role })} />
            : <Skeleton className="mt-1 h-4 w-40 max-w-full rounded-md" />}
        </SummaryCell>
        <SummaryFact fact={facts.schedule} pendingLabel="Schedule" />
        <SummaryFact fact={facts.cargo} pendingLabel="Cargo" />
      </div>
      {/* Panel triggers only exist below the dock width. Once the panel is permanent it
          owns its own switcher, and duplicating it here would give the same three views
          two competing controls. `xl:hidden` sits on the nav itself, not just its
          buttons, so the docked header does not keep this row's own `mt-4` as dead
          space above the panel column once the buttons it was spacing are gone. */}
      <nav aria-label="Trip sections" className="mt-4 flex flex-wrap gap-2 xl:hidden">
        <Button variant="secondary" size="sm" onClick={() => onPanel('information')}>Trip information</Button>
        <Button variant="secondary" size="sm" onClick={() => onPanel('manifest')}>Manifest</Button>
        <Button variant={facts.needsReviewCount ? 'primary' : 'secondary'} size="sm" onClick={() => onPanel('exceptions')}>
          {facts.exceptionsTotal === null
            ? `${facts.needsReviewCount} need review`
            : `${facts.exceptionsTotal} exceptions · ${facts.needsReviewCount} need review`}
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

function SummaryCell({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 border-l-2 border-outline-v/30 pl-3"><p className="text-xs text-on-surf-v">{label}</p>{children}</div>
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
  // Openable only once the trip record has loaded: a list row carries the registration
  // but not the fleet id, and a preview that cannot resolve is worse than plain text.
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
