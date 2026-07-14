'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Phone, Truck as TruckIcon } from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/lib/hooks/useAuth'
import { mockTrips } from '@shared/lib/mocks/trips'
import { tripsForDriver, categorizeTrips } from '@/lib/utils/trip-filters'
import { ROUTES } from '@/lib/constants/routes'

interface ProfilePanelProps {
  open: boolean
  onClose: () => void
}

export function ProfilePanel({ open, onClose }: ProfilePanelProps) {
  const { user, signOut } = useAuth()
  const router = useRouter()
  // Logout needs confirmation: an accidental tap from the roadside costs the
  // driver a full WhatsApp-OTP round trip to sign back in.
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)

  // Drawer keeps children mounted and toggles visibility via CSS transform (not
  // conditional rendering), so this recomputes on every re-render of whatever
  // parent holds <ProfilePanel> — memoize to avoid recomputing while closed.
  const { driverTrips, active, past, currentVehicle } = useMemo(() => {
    if (!user) {
      return { driverTrips: [], active: [], past: [], currentVehicle: null }
    }

    // TODO Iter 2 backend: replace with GET /driver/trips using authenticated session
    const driverTrips = tripsForDriver(mockTrips, user.id)
    const { active, past } = categorizeTrips(driverTrips)
    // active[0] is safe: a driver has at most one non-terminal trip in practice
    // (see trip-filters.ts). The fallback message below covers both "no active
    // trip" and "active trip with no horse assigned" as a single case.
    const currentVehicle = active[0]?.horse ?? null

    return { driverTrips, active, past, currentVehicle }
  }, [user?.id])

  if (!user) return null

  async function handleLogout() {
    await signOut()
    setConfirmLogoutOpen(false)
    onClose()
    router.replace(ROUTES.login)
  }

  return (
    <Drawer open={open} onClose={onClose} side="right" title="Driver Profile">
      <div className="flex flex-col gap-6">
        <div>
          <p className="text-lg font-bold text-surface-on">{user.full_name}</p>
          <p className="text-sm text-surface-on-variant">License {user.license_number}</p>
        </div>

        <div className="flex items-center gap-2 text-sm text-surface-on-variant">
          <Phone className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {user.phone_number}
        </div>

        <div className="flex items-center gap-2 text-sm text-surface-on-variant">
          <TruckIcon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {currentVehicle ? `${currentVehicle.registration} (${currentVehicle.make ?? 'Horse'})` : 'No vehicle assigned to an active trip'}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-2xl font-extrabold text-surface-on">{past.length}</p>
            <p className="text-xs text-surface-on-variant mt-1">Trips completed</p>
          </div>
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-2xl font-extrabold text-surface-on">{driverTrips.length}</p>
            <p className="text-xs text-surface-on-variant mt-1">Total trips</p>
          </div>
        </div>

        <Button variant="danger" size="md" iconLeft={<LogOut className="h-4 w-4" aria-hidden />} onClick={() => setConfirmLogoutOpen(true)}>
          Log out
        </Button>
      </div>

      <Modal
        open={confirmLogoutOpen}
        onClose={() => setConfirmLogoutOpen(false)}
        title="Log out?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setConfirmLogoutOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="md" onClick={handleLogout}>
              Log out
            </Button>
          </>
        }
      >
        You&rsquo;ll need a new OTP to sign back in.
      </Modal>
    </Drawer>
  )
}
