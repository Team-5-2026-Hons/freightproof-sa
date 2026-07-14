'use client'

import { useSyncExternalStore } from 'react'
import { Card } from '@/components/ui/Card'
import { Switch } from '@/components/ui/Switch'
import { APP_VERSION, SUPPORT_PHONE, SUPPORT_EMAIL } from '@/lib/constants/app'
import {
  getTapToConfirmPref,
  setTapToConfirmPref,
  subscribeTapToConfirmPref,
} from '@/lib/constants/preferences'

// localStorage isn't readable during the static export's server render;
// useSyncExternalStore hydrates against the server snapshot (false) and
// re-syncs to the stored value without a setState-in-effect.
function useTapToConfirm(): boolean {
  return useSyncExternalStore(subscribeTapToConfirmPref, getTapToConfirmPref, () => false)
}

export default function SettingsPage() {
  const tapToConfirm = useTapToConfirm()

  const toggleTapToConfirm = (checked: boolean) => {
    setTapToConfirmPref(checked)
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-surface-on">Settings</h1>

      <Card variant="section">
        <p className="text-sm font-medium text-surface-on">Support</p>
        <p className="mt-2 text-sm text-surface-on-variant">{SUPPORT_PHONE}</p>
        <p className="text-sm text-surface-on-variant">{SUPPORT_EMAIL}</p>
      </Card>

      <Card variant="section">
        <p className="text-sm font-medium text-surface-on">Accessibility</p>
        <div className="mt-3 flex items-center justify-between gap-4">
          <label htmlFor="tap-to-confirm" className="text-sm text-surface-on-variant">
            Tap to confirm instead of press and hold
          </label>
          <Switch
            id="tap-to-confirm"
            checked={tapToConfirm}
            onCheckedChange={toggleTapToConfirm}
            aria-label="Tap to confirm instead of press and hold"
          />
        </div>
        <p className="mt-2 text-xs text-surface-on-variant">
          Applies the next time a confirm button appears.
        </p>
      </Card>

      <Card variant="section">
        <p className="text-sm font-medium text-surface-on">About</p>
        <p className="mt-2 text-sm text-surface-on-variant">FreightProof Driver v{APP_VERSION}</p>
      </Card>
    </main>
  )
}
