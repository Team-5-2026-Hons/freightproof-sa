'use client'

import type { VehicleRef } from '@/lib/phase/trip-detail'
import { Modal } from '@/components/ui/Modal'
import { InfoRow } from '@/components/ui/InfoRow'
import { LinkButton } from '@/components/ui/LinkButton'
import { Button } from '@/components/ui/Button'
import { ROUTES } from '@/lib/constants/routes'
import { withReturnTo } from '@/lib/navigation/returnTo'

interface Props {
  vehicle: VehicleRef
  role: string
  open: boolean
  onClose: () => void
  /** This trip's own URL, so the vehicle page's Back returns here. */
  returnTo: string
}

/**
 * Which truck or trailer this is, reachable without leaving the trip.
 *
 * Only opened once `vehicle.id` is set — see VehicleRef's own comment — so every field
 * here belongs to the loaded fleet record, never a list-row guess.
 */
export function VehicleModal({ vehicle, role, open, onClose, returnTo }: Props) {
  if (!vehicle.id) return null
  const vehicleId = vehicle.id
  return (
    <Modal open={open} onClose={onClose} title={vehicle.registration} size="md">
      <InfoRow label="Role" value={role} />
      <InfoRow label="Make" value={vehicle.make ?? 'Not recorded'} />
      <InfoRow label="Model" value={vehicle.model ?? 'Not recorded'} />
      <InfoRow label="Year" value={vehicle.year ? String(vehicle.year) : 'Not recorded'} />
      <InfoRow label="VIN" value={vehicle.vin_number ?? 'Not recorded'} mono />
      <InfoRow label="Gross vehicle mass" value={vehicle.gross_vehicle_mass_kg ? `${vehicle.gross_vehicle_mass_kg} kg` : 'Not recorded'} />
      <InfoRow label="Length" value={vehicle.length_m ? `${vehicle.length_m} m` : 'Not recorded'} />
      <div className="mt-4 flex flex-col gap-2">
        <LinkButton full href={withReturnTo(ROUTES.fleetVehicleDetail(vehicleId), returnTo)} onClick={onClose}>View vehicle</LinkButton>
        <Button variant="secondary" full onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}
