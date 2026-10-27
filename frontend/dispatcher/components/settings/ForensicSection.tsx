'use client'

import { Card } from '@/components/ui/Card'
import { Switch } from '@/components/ui/Switch'
import { useForensicMode } from '@/lib/context/ForensicModeContext'

export function ForensicSection() {
  const { canViewForensics, forensicOn, toggle } = useForensicMode()

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
