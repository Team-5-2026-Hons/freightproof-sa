import { Ic } from '@/components/ui/Ic'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { InfoRow } from '@/components/ui/InfoRow'
import type { Vehicle } from '@shared/lib/types/vehicle'

interface VehicleCardProps {
  vehicle: Vehicle
  onClick: () => void
}

export function VehicleCard({ vehicle, onClick }: VehicleCardProps) {
  const typeLabel = vehicle.vehicle_type === 'horse' ? 'Horse' : 'Trailer'
  const subtitle = [typeLabel, vehicle.make, vehicle.model, vehicle.year ? String(vehicle.year) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card onClick={onClick} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Ic n="truck" s={16} className="text-on-surf-v shrink-0" />
          <span className="font-[700] tabular-nums tracking-[0.05em] text-[15px] text-on-surf truncate">
            {vehicle.registration}
          </span>
        </div>
        <Chip type={vehicle.is_active ? 'complete' : 'pending'} label={vehicle.is_active ? 'Active' : 'Inactive'} />
      </div>

      {/* Same field + treatment as the detail page's TopBar sub (type · make · model · year) */}
      <div className="text-[11px] font-[500] tracking-[0.03em] text-sec tabular-nums mt-[2px] truncate">
        {subtitle || '—'}
      </div>

      <div className="bg-surf-low rounded-lg p-[10px_12px]">
        <InfoRow label="Pulsit device" value={vehicle.pulsit_device_id} mono />
        <InfoRow label="VIN" value={vehicle.vin_number ?? '—'} mono={!!vehicle.vin_number} />
        {vehicle.vehicle_type === 'trailer' ? (
          <InfoRow
            label="Length"
            value={vehicle.length_m != null ? `${vehicle.length_m} m` : '—'}
            mono={vehicle.length_m != null}
          />
        ) : (
          <InfoRow
            label="GVM"
            value={vehicle.gross_vehicle_mass_kg != null ? `${vehicle.gross_vehicle_mass_kg.toLocaleString()} kg` : '—'}
            mono={vehicle.gross_vehicle_mass_kg != null}
          />
        )}
        <InfoRow
          label="Licence disc expiry"
          value={vehicle.licence_disc_expiry ?? '—'}
          mono={!!vehicle.licence_disc_expiry}
        />
      </div>
    </Card>
  )
}
