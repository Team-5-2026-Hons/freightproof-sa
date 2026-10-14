'use client'

import { DevTriggerPanel } from '@/components/dev/DevTriggerPanel'
import { PageShell } from '@/components/layout/PageShell'

/**
 * Demo panel page — simulates the warehouse, Parcel Perfect and the trackers. Reached by URL only, no nav link. Backend router is absent unless
 * DEV_PANEL_ENABLED is set and ENVIRONMENT isn't production, so this 404s in prod
 * regardless of this flag.
 */
export default function DevTriggersPage(): React.ReactElement {
  const enabled = process.env.NEXT_PUBLIC_DEV_PANEL === 'true'

  if (!enabled) {
    return (
      <PageShell>
        <p className="text-sm text-slate-500">
          The dev trigger panel is disabled. Set NEXT_PUBLIC_DEV_PANEL=true to enable it.
        </p>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <DevTriggerPanel heading="Demo panel — simulated warehouse, Parcel Perfect and trackers" />
    </PageShell>
  )
}
