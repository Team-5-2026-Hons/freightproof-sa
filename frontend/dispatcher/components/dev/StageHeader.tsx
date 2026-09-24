import type { DemoStage } from '@/lib/dev/demo-stage'
import type { DevTripSummary } from '@/lib/types/dev'

interface StageHeaderProps {
  trip: DevTripSummary
  stage: DemoStage
}

/** Where the chosen trip is, in one line the presenter can read off the projector. */
export function StageHeader({ trip, stage }: StageHeaderProps): React.ReactElement {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">
        {trip.trip_reference} · {trip.driver_full_name ?? 'no driver'}
      </p>
      <p className="text-lg font-semibold" data-testid="demo-stage-headline">{stage.headline}</p>
    </div>
  )
}
