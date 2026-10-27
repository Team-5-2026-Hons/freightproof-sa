import { Ic } from '@/components/ui/Ic'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { InfoRow } from '@/components/ui/InfoRow'
import { StaticGeofenceThumbnail } from '@/components/map/StaticGeofenceThumbnail'
import { describeGeofence } from '@/lib/map/polygon'
import type { Precinct } from '@shared/lib/types/precinct'

const COORDINATE_DECIMAL_PLACES = 5

export const PRECINCT_GRID_CLASSES = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4'

interface PrecinctCardProps {
  precinct: Precinct
  isOwned: boolean
  onClick: () => void
}

export function PrecinctCard({ precinct, isOwned, onClick }: PrecinctCardProps) {
  return (
    <Card onClick={onClick} className="flex flex-col gap-3 p-0 overflow-hidden">
      <StaticGeofenceThumbnail
        latitude={precinct.latitude}
        longitude={precinct.longitude}
        radiusMetres={precinct.geofence_radius_metres}
        polygon={precinct.geofence_polygon}
        name={precinct.name}
      />

      <div className="flex flex-col gap-3 p-5 pt-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Ic n="map" s={16} className="text-on-surf-v shrink-0" />
            <span className="font-[700] tabular-nums tracking-[0.05em] text-[15px] text-on-surf truncate">
              {precinct.name}
            </span>
          </div>
          {!isOwned && <Chip type="pending" label="Shared" />}
        </div>

        <div className="text-[11px] font-[500] tracking-[0.03em] text-sec tabular-nums mt-[2px] truncate">
          {precinct.address ?? '—'}
        </div>

        <div className="bg-surf-low rounded-lg p-[10px_12px]">
          <InfoRow
            label="Coordinates"
            value={`${precinct.latitude.toFixed(COORDINATE_DECIMAL_PLACES)}, ${precinct.longitude.toFixed(COORDINATE_DECIMAL_PLACES)}`}
            mono
          />
          <InfoRow label="Geofence" value={describeGeofence(precinct)} mono />
          <InfoRow label="Sharing" value={isOwned ? 'Owned' : 'Shared with you'} />
        </div>
      </div>
    </Card>
  )
}
