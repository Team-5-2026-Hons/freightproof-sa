'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Contrast, Hand, Mail, MapPin, Phone, RefreshCw, ShieldCheck } from 'lucide-react'
import { DriverAvatar } from '@/components/profile/DriverAvatar'
import { AppearanceSheet } from '@/components/profile/AppearanceSheet'
import { SignOutSheet } from '@/components/profile/SignOutSheet'
import { ListRow, ListSection } from '@/components/ui/ListSection'
import { Switch } from '@/components/ui/Switch'
import { useAuth } from '@/lib/hooks/useAuth'
import { useTrip } from '@/lib/hooks/useTrip'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { usePermissionStatus, type PermissionStatus } from '@/lib/hooks/usePermissionStatus'
import { useToast } from '@/lib/hooks/useToast'
import { clearDriverPhoto, setDriverPhoto, useDriverPhoto } from '@/lib/profile/driver-photo'
import { pickDriverPhoto } from '@/lib/profile/pick-driver-photo'
import { getThemePref, subscribeThemePref, DEFAULT_THEME_PREFERENCE } from '@/lib/theme'
import { getTapToConfirmPref, setTapToConfirmPref, subscribeTapToConfirmPref } from '@/lib/constants/preferences'
import { APP_VERSION, SUPPORT_EMAIL, SUPPORT_PHONE } from '@/lib/constants/app'
import { ROUTES } from '@/lib/constants/routes'
import { formatPhoneForDisplay } from '@/lib/utils/format-phone'
import { formatDate } from '@/lib/utils/format-time'
import { cn } from '@/lib/utils'

const AVATAR_PX = 104
const ICON = 'size-5'

const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const

// Identity check status as the driver should read it. Amber, not red, for "pending": it is
// a wait, not a fault. Failed is red because a trip cannot begin until it is resolved.
const IDVS = {
  verified: { text: 'ID verified', className: 'bg-success-tint text-success' },
  pending: { text: 'ID check pending', className: 'bg-attention-tint text-attention' },
  failed: { text: 'ID check failed', className: 'bg-error-tint text-error' },
} as const

const PERMISSION: Record<PermissionStatus, { text: string; className: string }> = {
  granted: { text: 'Allowed', className: 'font-semibold text-success' },
  denied: { text: 'Not allowed', className: 'font-semibold text-attention' },
  ask: { text: 'Asks when needed', className: 'text-surface-on-variant' },
}

function useTapToConfirm(): boolean {
  return useSyncExternalStore(subscribeTapToConfirmPref, getTapToConfirmPref, () => false)
}

function useThemeLabel(): string {
  const pref = useSyncExternalStore(subscribeThemePref, getThemePref, () => DEFAULT_THEME_PREFERENCE)
  return THEME_LABEL[pref]
}

function Tile({ label, value, detail }: { label: string; value: ReactNode; detail: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-fill p-3.5">
      <p className="text-footnote text-surface-on-variant">{label}</p>
      <p className="truncate text-headline tabular-nums text-surface-on">{value}</p>
      <p className="truncate text-footnote text-surface-on-variant">{detail}</p>
    </div>
  )
}

function PermissionRow({ icon, label, detail, status }: {
  icon: ReactNode; label: string; detail?: string; status: PermissionStatus | null
}) {
  // A platform that cannot report the permission shows no row rather than a guess.
  if (status === null) return null
  const { text, className } = PERMISSION[status]
  return (
    <ListRow
      icon={icon}
      value={label}
      detail={status === 'denied' ? 'Turn on in your phone’s Settings' : detail}
      trailing={<span className={className}>{text}</span>}
    />
  )
}

/**
 * Profile — who the driver is, with the app's few settings merged in (overhaul 10.1).
 * Replaces the Settings tab and the profile bottom sheet: one place for "me".
 */
export default function ProfilePage() {
  const { user, signOut } = useAuth()
  const { trip } = useTrip()
  const { queueLength } = useOfflineQueue()
  const { notify } = useToast()
  const router = useRouter()
  const photo = useDriverPhoto(user?.id ?? null)
  const tapToConfirm = useTapToConfirm()
  const themeLabel = useThemeLabel()
  const location = usePermissionStatus('location')
  const camera = usePermissionStatus('camera')
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)

  if (!user) return null

  const idvs = IDVS[user.idvs_status]
  const horse = trip?.horse ?? null

  async function choosePhoto(): Promise<void> {
    if (!user) return
    try {
      const picked = await pickDriverPhoto()
      if (picked === null) return
      if (!setDriverPhoto(user.id, picked)) {
        notify({ kind: 'error', title: 'Photo not saved', body: 'This phone is out of storage. Free up some space and try again.' })
      }
    } catch (err) {
      console.error('Profile: could not take the profile photo', err)
      notify({ kind: 'error', title: 'Camera not available', body: 'Allow camera or photo access for FreightProof in your phone’s Settings.' })
    }
  }

  async function confirmSignOut(): Promise<void> {
    if (!user) return
    // A face is personal data (POPIA): it leaves this phone with the driver.
    clearDriverPhoto(user.id)
    await signOut()
    setSignOutOpen(false)
    router.replace(ROUTES.login)
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center px-5 pt-2">
        <div className="relative">
          <DriverAvatar name={user.full_name} photo={photo} size={AVATAR_PX} />
          <button
            type="button"
            onClick={choosePhoto}
            aria-label={photo === null ? 'Add photo' : 'Change photo'}
            className="absolute -bottom-0.5 -right-0.5 flex size-11 items-center justify-center rounded-full border-[3px] border-surface bg-primary text-primary-on transition-transform duration-100 active:scale-95"
          >
            <Camera className="size-[18px]" strokeWidth={2.25} aria-hidden />
          </button>
        </div>
        <p className="mt-3.5 text-title-1 tracking-tight text-surface-on">{user.full_name}</p>
        <p className="text-subhead tabular-nums text-surface-on-variant">{formatPhoneForDisplay(user.phone_number)}</p>
        <span className={cn('mt-2.5 inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 text-footnote font-semibold', idvs.className)}>
          <ShieldCheck className="size-3.5" strokeWidth={2.5} aria-hidden />
          {idvs.text}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2.5 px-4">
        <Tile
          label="Licence"
          value={user.license_number}
          detail={user.license_expiry === null ? 'No expiry on file' : `Expires ${formatDate(user.license_expiry)}`}
        />
        <Tile
          label="Vehicle"
          value={horse?.registration ?? 'None'}
          detail={trip === null ? 'No active trip' : `On ${trip.trip_reference}`}
        />
      </div>

      <div aria-hidden className="mt-6 h-2 bg-fill" />

      <ListSection title="Preferences" className="mt-5">
        <ListRow
          icon={<Contrast className={ICON} strokeWidth={1.9} />}
          value="Appearance"
          trailing={themeLabel}
          chevron
          onClick={() => setAppearanceOpen(true)}
        />
        <div className="flex min-h-[56px] items-center gap-4 px-5 py-2">
          <Hand className={cn(ICON, 'shrink-0 text-surface-on')} strokeWidth={1.9} aria-hidden />
          <label htmlFor="tap-to-confirm" className="min-w-0 flex-1">
            <span className="block text-body text-surface-on">Tap instead of swipe</span>
            <span className="block text-footnote text-surface-on-variant">Easier with gloves</span>
          </label>
          <Switch id="tap-to-confirm" checked={tapToConfirm} onCheckedChange={setTapToConfirmPref} />
        </div>
      </ListSection>

      <ListSection title="This phone" className="mt-5">
        <PermissionRow icon={<MapPin className={ICON} strokeWidth={1.9} />} label="Location" detail="Needed for every record" status={location} />
        <PermissionRow icon={<Camera className={ICON} strokeWidth={1.9} />} label="Camera" status={camera} />
        <ListRow
          icon={<RefreshCw className={ICON} strokeWidth={1.9} />}
          value="Waiting to send"
          detail="Records saved without signal"
          trailing={
            queueLength === 0
              ? <span className="font-semibold text-success">All sent</span>
              : <span className="font-semibold text-attention">{queueLength} waiting</span>
          }
        />
      </ListSection>

      <ListSection title="Help" className="mt-5">
        {SUPPORT_PHONE !== null && (
          <ListRow
            icon={<Phone className={ICON} strokeWidth={1.9} />}
            value="Call support"
            detail={SUPPORT_PHONE}
            href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}
          />
        )}
        <ListRow
          icon={<Mail className={ICON} strokeWidth={1.9} />}
          value="Email support"
          detail={SUPPORT_EMAIL}
          href={`mailto:${SUPPORT_EMAIL}`}
        />
      </ListSection>

      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => setSignOutOpen(true)}
          className="inline-flex min-h-11 items-center rounded-full bg-error-tint px-6 text-body font-semibold text-error transition-transform duration-100 active:scale-95"
        >
          Sign Out
        </button>
        <p className="text-footnote tabular-nums text-surface-on-variant">FreightProof Driver {APP_VERSION}</p>
      </div>

      <AppearanceSheet open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
      <SignOutSheet open={signOutOpen} onClose={() => setSignOutOpen(false)} onConfirm={confirmSignOut} />
    </div>
  )
}
