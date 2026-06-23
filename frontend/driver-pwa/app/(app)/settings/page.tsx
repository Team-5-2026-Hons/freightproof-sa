'use client'

import { Card } from '@/components/ui/Card'
import { APP_VERSION, SUPPORT_PHONE, SUPPORT_EMAIL } from '@/lib/constants/app'

export default function SettingsPage() {
  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-surface-on">Settings</h1>

      <Card variant="section">
        <p className="text-sm font-medium text-surface-on">Support</p>
        <p className="mt-2 text-sm text-surface-on-variant">{SUPPORT_PHONE}</p>
        <p className="text-sm text-surface-on-variant">{SUPPORT_EMAIL}</p>
      </Card>

      <Card variant="section">
        <p className="text-sm font-medium text-surface-on">About</p>
        <p className="mt-2 text-sm text-surface-on-variant">FreightProof Driver v{APP_VERSION}</p>
      </Card>
    </main>
  )
}
