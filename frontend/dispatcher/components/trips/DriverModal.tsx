'use client'

import type { Driver } from '@shared/lib/types/driver'
import { Modal } from '@/components/ui/Modal'
import { InfoRow } from '@/components/ui/InfoRow'
import { fmtFull } from '@shared/lib/utils/datetime'

interface Props {
  driver: Driver
  open: boolean
  onClose: () => void
}

/**
 * Who is driving this trip, reachable without leaving it.
 *
 * Deliberately omits the driver's SA ID number. DriverRead carries it, but this is a
 * glanceable surface opened during a live trip and an identity number is not what a
 * dispatcher needs to make contact — under POPIA that is personal data we should not
 * surface without a reason. The fleet driver record remains the place for it.
 */
export function DriverModal({ driver, open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={driver.full_name} size="md">
      <div className="px-6 py-4">
        <InfoRow label="Phone" value={driver.phone_number} href={`tel:${driver.phone_number}`} />
        <InfoRow label="Licence" value={driver.license_number} mono />
        <InfoRow label="Licence expiry" value={driver.license_expiry ? fmtFull(driver.license_expiry) : 'Not recorded'} />
        <InfoRow label="Identity check" value={driver.idvs_status === 'verified' && driver.idvs_last_verified_at
          ? `Verified · ${fmtFull(driver.idvs_last_verified_at)}`
          : driver.idvs_status} />
      </div>
    </Modal>
  )
}
