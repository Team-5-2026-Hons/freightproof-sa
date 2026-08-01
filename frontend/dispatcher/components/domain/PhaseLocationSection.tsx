import { CoordFix, Field, Section } from './PhaseDetailFields'
import { geofenceOffsetMetres, separationMetres, toCoords } from '@/lib/phase/geo'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  // The precinct this phase is anchored to. Undefined when the stop or precinct cannot be
  // resolved — distances are then omitted rather than computed against a guess.
  precinct: Precinct | undefined
  title?: string
}

/**
 * Where the driver's phone and the truck each were when this phase completed.
 *
 * Shared by activation, departure and confirmation. All three ask the same question, so
 * they ask it in the same words — and a fix to the geofence display lands in one place.
 */
export function PhaseLocationSection({ phase, precinct, title = 'Observed location' }: Props) {
  const driverFix = toCoords(phase.driver_phone_lat, phase.driver_phone_lng)
  const horseFix  = toCoords(phase.horse_gps_lat, phase.horse_gps_lng)

  // Precinct.latitude/longitude/geofence_radius_metres are declared `number` (non-nullable)
  // on the shared type — confirmed against frontend/shared/lib/types/precinct.ts, which
  // mirrors the backend PrecinctRead schema. No string/Decimal coercion is needed here;
  // the only "missing" case is the precinct itself being unresolved.
  const fence = precinct
    ? { lat: precinct.latitude, lng: precinct.longitude, radiusMetres: precinct.geofence_radius_metres }
    : null

  const separation = separationMetres(driverFix, horseFix)

  return (
    <Section title={title}>
      <CoordFix
        label="Driver phone"
        lat={phase.driver_phone_lat}
        lng={phase.driver_phone_lng}
        offsetMetres={geofenceOffsetMetres(driverFix, fence)}
      />
      <CoordFix
        label="Horse GPS"
        lat={phase.horse_gps_lat}
        lng={phase.horse_gps_lng}
        offsetMetres={geofenceOffsetMetres(horseFix, fence)}
      />
      {/* The gap between the two fixes is evidence, not a diagnostic: a driver at the gate
          while the truck sits kilometres away is exactly what this platform records. */}
      <Field
        label="Driver / vehicle separation"
        value={separation === null ? 'Not computable' : `${Math.round(separation)} m`}
      />
      <Field
        label="Pulsit geofence"
        value={
          phase.pulsit_geofence_confirmed === null ? 'Awaiting Pulsit'
          : phase.pulsit_geofence_confirmed ? 'Confirmed ✓'
          : 'Mismatch ✗'
        }
      />
    </Section>
  )
}
