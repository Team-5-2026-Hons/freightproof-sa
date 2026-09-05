import { formatSeparation, separationMetres, toCoords } from '@/lib/phase/geo'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

export interface PositionDisagreementProps {
  phase: PhaseDescriptor
}

// Matches PhaseLocationSection's own vocabulary for these two states, so the same gap in
// the record reads the same way whichever card a dispatcher opens it from.
const NO_FIX_RECORDED = 'No fix recorded'
const NOT_COMPUTABLE  = 'Not computable'

/**
 * The measured gap behind a `gps_mismatch` exception: what the driver's phone reported,
 * and what the tracker bolted to the vehicle reported, independently of each other.
 *
 * Deliberately takes no precinct/geofence prop. The separation between the two sources is
 * well-defined whether or not a precinct can be resolved for this phase, so this component
 * reports only what the two sources measured against EACH OTHER — never against a boundary
 * it cannot name. That keeps it renderable for every phase a `gps_mismatch` can land on,
 * including ones with no stop to anchor a geofence to.
 *
 * Reports a fact, not a verdict: it states a measured distance between two independent
 * sources and leaves what that distance means to the dispatcher reading it.
 */
export function PositionDisagreement({ phase }: PositionDisagreementProps) {
  const driverFix  = toCoords(phase.driver_phone_lat, phase.driver_phone_lng)
  const trackerFix = toCoords(phase.horse_gps_lat, phase.horse_gps_lng)
  const separation = separationMetres(driverFix, trackerFix)

  return (
    <div className="mt-[8px] pt-[8px] border-t border-warn/20 flex flex-wrap items-start gap-x-5 gap-y-2">
      <PositionFix label="Driver phone" lat={phase.driver_phone_lat} lng={phase.driver_phone_lng} />
      <PositionFix label="Vehicle tracker" lat={phase.horse_gps_lat} lng={phase.horse_gps_lng} />
      <div>
        <div className="text-[10px] text-on-surf-v mb-[1px]">Driver / vehicle separation</div>
        <div className="text-[12px] font-[500] text-on-surf tabular-nums">
          {separation === null ? NOT_COMPUTABLE : formatSeparation(separation)}
        </div>
      </div>
    </div>
  )
}

/** One source's fix, or a plain statement that it reported none — never a blank field. */
function PositionFix({
  label, lat, lng,
}: {
  label: string
  lat: number | null
  lng: number | null
}) {
  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
      <div className="font-mono text-[12px] tracking-[0.04em] text-on-surf tabular-nums">
        {lat === null || lng === null ? NO_FIX_RECORDED : `${lat.toFixed(6)}, ${lng.toFixed(6)}`}
      </div>
    </div>
  )
}
