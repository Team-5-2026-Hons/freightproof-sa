'use client'

import { Card } from '@/components/ui/Card'
import { Switch } from '@/components/ui/Switch'
import { useForensicMode } from '@/lib/context/ForensicModeContext'

export function ForensicSection() {
  const { canViewForensics, forensicOn, toggle } = useForensicMode()

  // Self-hides for non-admins as a second line of defence: the registry already keeps this
  // section out of their list, but a switch they cannot use must never render.
  if (!canViewForensics) return null

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-6">
        <p className="text-sm text-on-surf-v">
          Shows blockchain receipts, journey lock comparisons and the audit trail alongside
          trip and exception records. Applies on this browser only.
        </p>
        <Switch checked={forensicOn} onCheckedChange={() => toggle()} ariaLabel="Forensic mode" />
      </div>
    </Card>
  )
}
