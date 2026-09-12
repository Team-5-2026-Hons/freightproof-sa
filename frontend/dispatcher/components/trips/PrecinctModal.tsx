'use client'

import type { Precinct } from '@shared/lib/types/precinct'
import { Modal } from '@/components/ui/Modal'
import { InfoRow } from '@/components/ui/InfoRow'
import { LinkButton } from '@/components/ui/LinkButton'
import { Button } from '@/components/ui/Button'
import { ROUTES } from '@/lib/constants/routes'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { precinctLabel } from '@/lib/phase/trip-detail'

interface Props {
  precinct: Precinct
  open: boolean
  onClose: () => void
  /** This trip's own URL, so the precinct page's Back returns here. */
  returnTo: string
}

/** Which depot or warehouse a stop names, reachable without leaving the trip. */
export function PrecinctModal({ precinct, open, onClose, returnTo }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={precinctLabel(precinct)} size="md">
      <InfoRow label="Address" value={precinct.address ?? 'Not recorded'} />
      <InfoRow label="Coordinates" value={`${precinct.latitude}, ${precinct.longitude}`} mono />
      <InfoRow label="Geofence radius" value={`${precinct.geofence_radius_metres} m`} />
      <div className="mt-4 flex flex-col gap-2">
        <LinkButton full href={withReturnTo(ROUTES.precinctDetail(precinct.id), returnTo)} onClick={onClose}>View precinct</LinkButton>
        <Button variant="secondary" full onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}
