'use client'

import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { TripCreatedDetail } from '@/components/domain/TripCreatedDetail'
import { ActivationDetail } from '@/components/domain/ActivationDetail'
import { LoadingDetail } from '@/components/domain/LoadingDetail'
import { DepartureDetail } from '@/components/domain/DepartureDetail'
import { UnloadingDetail } from '@/components/domain/UnloadingDetail'
import { ConfirmationDetail } from '@/components/domain/ConfirmationDetail'
import { InTransitTimeline } from '@/components/domain/InTransitTimeline'
import { PhaseOverrideAction } from '@/components/domain/PhaseOverrideAction'
import { countAtStop, precinctAtPhase, precinctLabel } from '@/lib/phase/trip-detail'
import { originScannedCount } from '@/lib/phase/derive'

interface Props {
  trip: Trip; phase: PhaseDescriptor; precincts: Precinct[]
  artifactsById: Map<string, EvidenceArtifactWithUrl>; artifactLoading: boolean
  artifactError: string | null; onRetryArtifacts: () => void; onChanged: () => void
}
export function PhaseEvidence({ trip, phase, precincts, onChanged, ...evidence }: Props) {
  const precinct = precinctAtPhase(trip, phase, precincts)
  const shared = { phase, ...evidence }
  let content
  switch (phase.phase_type) {
    case 'trip_creation': content = <TripCreatedDetail trip={trip} />; break
    case 'activation': content = <ActivationDetail {...shared} trip={trip} precinct={precinct} />; break
    case 'loading': content = <LoadingDetail {...shared} expectedCount={countAtStop(trip, phase, 'out', 'expected')} liveScannedOutCount={countAtStop(trip, phase, 'out', 'scanned')} precinct={precinct} />; break
    case 'departure': content = <DepartureDetail {...shared} precinct={precinct} />; break
    case 'unloading': content = <UnloadingDetail {...shared} allPhases={trip.phases} scannedInCount={countAtStop(trip, phase, 'in', 'scanned')} expectedAtStopCount={countAtStop(trip, phase, 'in', 'expected')} precinct={precinct}
      sealException={trip.exceptions.find(e => e.phase_event_id === phase.phase_event_id && (e.exception_type === 'seal_mismatch' || e.exception_type === 'seal_unverified'))} />; break
    case 'confirmation': content = <ConfirmationDetail {...shared} precinct={precinct} originScannedCount={originScannedCount(trip.phases)} />; break
    case 'in_transit': {
      const stops = [...trip.stops].sort((a, b) => a.sequence - b.sequence)
      const nextStop = stops[stops.findIndex(s => s.id === phase.trip_stop_id) + 1]
      // Exception summaries stay outside disclosure; the journey only owns movement.
      content = <InTransitTimeline phase={phase} allPhases={trip.phases} exceptions={[]} artifactsById={evidence.artifactsById} originName={precinctLabel(precinct)} destinationName={precinctLabel(precincts.find(p => p.id === nextStop?.precinct_id))} />
      break
    }
  }
  return <>{content}{phase.phase_type !== 'trip_creation' && <PhaseOverrideAction phase={phase} tripId={trip.id} tripStatus={trip.status} onOverridden={onChanged} />}</>
}
