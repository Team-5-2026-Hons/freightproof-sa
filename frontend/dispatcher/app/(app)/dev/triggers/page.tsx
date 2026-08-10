'use client'

import { DevTriggerPanel } from '@/components/dev/DevTriggerPanel'
import { PageShell } from '@/components/layout/PageShell'

/**
 * Dev trigger page — simulates the parts of the world FreightProof cannot yet
 * reach: the warehouse's scanning system and Parcel Perfect's depot functions.
 *
 * Reached by URL only, with no nav link: it is operated on a second device during
 * a demo and is not a product surface. The backend router is absent entirely
 * unless DEV_PANEL_ENABLED is set and ENVIRONMENT is not production, so every call
 * from this page 404s in a production deployment regardless of this flag.
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
      <DevTriggerPanel heading="Dev triggers — simulated warehouse and Parcel Perfect" />
    </PageShell>
  )
}
