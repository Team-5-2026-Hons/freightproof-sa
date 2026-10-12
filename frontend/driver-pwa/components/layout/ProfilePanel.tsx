'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { IdCard, LogOut, Phone, Truck as TruckIcon } from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/lib/hooks/useAuth'
import { useTrip } from '@/lib/hooks/useTrip'
import { ROUTES } from '@/lib/constants/routes'

interface ProfilePanelProps {
  open: boolean
  onClose: () => void
}

// Initials for the avatar disc — first letter of the first and last names.
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

function ProfileRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <span className="text-surface-on-variant">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-footnote text-surface-on-variant">{label}</span>
        <span className="block truncate text-body tabular-nums text-surface-on">{value}</span>
      </span>
    </div>
  )
}

// A bottom sheet (audit H9), not the right-hand side drawer it replaced — the Android
// navigation-drawer idiom read as foreign on iPhone, and a sheet is dismissed by the same
// downward swipe as every other sheet on the device.
export function ProfilePanel({ open, onClose }: ProfilePanelProps) {
  const { user, signOut } = useAuth()
  const { trip } = useTrip()
  const router = useRouter()
  // Logout needs confirmation: an accidental tap from the roadside costs the
  // driver a full WhatsApp-OTP round trip to sign back in.
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)

  if (!user) return null

  // The vehicle comes from the driver's real active trip (TripContext). It used to be
  // read off the mock fixtures, along with "trips completed / total trips" counts that
  // were therefore wrong for every real driver (audit M13); the counts are gone rather
  // than kept on fake data, until the trips API can back them.
  const horse = trip?.horse ?? null
  const vehicle = horse === null
    ? 'No vehicle on an active trip'
    : `${horse.registration}${horse.make ? ` · ${horse.make}` : ''}`

  async function handleLogout() {
    await signOut()
    setConfirmLogoutOpen(false)
    onClose()
    router.replace(ROUTES.login)
  }

  return (
    <Drawer open={open} onClose={onClose} side="bottom" title="Profile">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary/10 text-title-3 text-secondary"
            aria-hidden
          >
            {initialsOf(user.full_name)}
          </span>
          <p className="text-title-2 text-surface-on">{user.full_name}</p>
        </div>

        <div className="divide-y divide-outline-variant/30 overflow-hidden rounded-2xl bg-surface-container-low">
          <ProfileRow
            icon={<IdCard className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
            label="Licence"
            value={user.license_number}
          />
          <ProfileRow
            icon={<Phone className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
            label="Phone"
            value={user.phone_number}
          />
          <ProfileRow
            icon={<TruckIcon className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
            label="Vehicle"
            value={vehicle}
          />
        </div>

        {/* A destructive row in the iOS manner — red text on a plain row — rather than a
            filled pink button competing with the content above it. */}
        <button
          type="button"
          onClick={() => setConfirmLogoutOpen(true)}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-surface-container-low text-body font-semibold text-error transition-colors duration-100 active:bg-surface-container"
        >
          <LogOut className="h-5 w-5" strokeWidth={2} aria-hidden />
          Log Out
        </button>
      </div>

      <Modal
        open={confirmLogoutOpen}
        onClose={() => setConfirmLogoutOpen(false)}
        title="Log Out?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setConfirmLogoutOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="md" onClick={handleLogout}>
              Log Out
            </Button>
          </>
        }
      >
        You&rsquo;ll need a new code to sign back in.
      </Modal>
    </Drawer>
  )
}
