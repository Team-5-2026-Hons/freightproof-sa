'use client'

import type { ReactNode } from 'react'
import { Truck } from 'lucide-react'
import type { Vehicle } from '@shared/lib/types/vehicle'
import { Drawer } from '@/components/ui/Drawer'
import { formatDate } from '@/lib/utils/format-time'

const MASS_FORMAT = new Intl.NumberFormat('en-ZA')

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline first:border-t-0">
      <span className="text-subhead text-surface-on-variant">{label}</span>
      <span className="text-right text-subhead font-semibold tabular-nums text-surface-on">{value}</span>
    </div>
  )
}

function makeModel(v: Vehicle): string | null {
  const name = [v.make, v.model].filter(Boolean).join(' ')
  if (name === '') return v.year === null ? null : String(v.year)
  return v.year === null ? name : `${name} · ${v.year}`
}

/** A plate drawn like a plate: what the driver compares against the trailer itself. */
function Plate({ registration }: { registration: string }) {
  return (
    <span className="inline-flex h-8 items-center rounded-md px-2.5 text-subhead font-extrabold tracking-wider text-surface-on ring-2 ring-inset ring-surface-on">
      {registration}
    </span>
  )
}

interface VehicleSheetProps {
  open: boolean
  onClose: () => void
  horse: Vehicle | null
  trailers: readonly Vehicle[]
}

/**
 * The truck and trailers on this trip, opened from the trip page's vehicle
 * row. Only details actually on record are shown — no rows of dashes.
 */
export function VehicleSheet({ open, onClose, horse, trailers }: VehicleSheetProps) {
  const truckDetails = horse === null ? [] : [
    ['Make & model', makeModel(horse)],
    ['Licence disc expires', horse.licence_disc_expiry && formatDate(horse.licence_disc_expiry)],
    ['Gross mass', horse.gross_vehicle_mass_kg !== null && `${MASS_FORMAT.format(horse.gross_vehicle_mass_kg)} kg`],
    ['Length', horse.length_m !== null && `${horse.length_m} m`],
  ].filter((pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1] !== '')

  return (
    <Drawer open={open} onClose={onClose} side="bottom" title="Vehicles on this trip">
      <div className="flex flex-col gap-5 pb-2">
        {horse !== null && (
          <section aria-label="Truck" className="flex flex-col gap-3">
            <div className="flex items-center gap-3.5">
              <span aria-hidden className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-on">
                <Truck className="size-6" strokeWidth={1.9} />
              </span>
              <div>
                <p className="text-footnote font-semibold text-surface-on-variant">Truck</p>
                <p className="text-title-3 tabular-nums text-surface-on">{horse.registration}</p>
              </div>
            </div>
            {truckDetails.length > 0 && (
              <div className="rounded-xl bg-fill px-4">
                {truckDetails.map(([label, value]) => <Detail key={label} label={label} value={value} />)}
              </div>
            )}
          </section>
        )}

        {trailers.length > 0 && (
          <section aria-label="Trailers" className="flex flex-col gap-1">
            <p className="text-footnote font-semibold text-surface-on-variant">Trailers · {trailers.length}</p>
            <ul>
              {trailers.map((trailer) => (
                <li key={trailer.id} className="flex min-h-[56px] items-center gap-3 border-t border-hairline first:border-t-0">
                  <Plate registration={trailer.registration} />
                  <span className="min-w-0 flex-1 truncate text-subhead text-surface-on-variant">{makeModel(trailer) ?? ''}</span>
                  {trailer.licence_disc_expiry !== null && (
                    <span className="shrink-0 text-footnote text-surface-on-variant">Disc {formatDate(trailer.licence_disc_expiry)}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Drawer>
  )
}
