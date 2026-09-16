'use client'

import type { Driver } from '@shared/lib/types/driver'
import { Modal } from '@/components/ui/Modal'
import { InfoRow } from '@/components/ui/InfoRow'
import { LinkButton } from '@/components/ui/LinkButton'
import { Button } from '@/components/ui/Button'
import { fmtFull } from '@shared/lib/utils/datetime'
import { ROUTES } from '@/lib/constants/routes'
import { withReturnTo } from '@/lib/navigation/returnTo'

interface Props {
  driver: Driver
  open: boolean
  onClose: () => void
  /** This trip's own URL, so the driver page's Back returns here. */
  returnTo: string
}

/**
 * Who is driving this trip, reachable without leaving it. Deliberately omits the
 * driver's SA ID number — POPIA personal data with no reason to surface here; the fleet
 * driver record is the place for it.
 */
export function DriverModal({ driver, open, onClose, returnTo }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={driver.full_name} size="md">
      <InfoRow label="Phone" value={driver.phone_number} href={`tel:${driver.phone_number}`} />
      <InfoRow label="Licence" value={driver.license_number} mono />
      <InfoRow label="Licence expiry" value={driver.license_expiry ? fmtFull(driver.license_expiry) : 'Not recorded'} />
      <InfoRow label="Identity check" value={driver.idvs_status === 'verified' && driver.idvs_last_verified_at
        ? `Verified · ${fmtFull(driver.idvs_last_verified_at)}`
        : driver.idvs_status} />
      <div className="mt-4 flex flex-col gap-2">
        <LinkButton full href={withReturnTo(ROUTES.fleetDriverDetail(driver.id), returnTo)} onClick={onClose}>View driver</LinkButton>
        <Button variant="secondary" full onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}
