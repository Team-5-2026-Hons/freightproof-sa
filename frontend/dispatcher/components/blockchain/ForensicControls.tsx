'use client'

// Global forensic-mode toggle, mounted once in TopBar rather than duplicated per page.

import { Switch } from '@/components/ui/Switch'
import { useForensicMode } from '@/lib/context/ForensicModeContext'

export function ForensicControls() {
  const { canViewForensics, forensicOn, toggle } = useForensicMode()

  // Self-hides for non-admins so mounting it globally in TopBar can't leak the control.
  if (!canViewForensics) return null

  return (
    <div className="flex items-center gap-[8px]">
      <span className="text-[11px] font-[600] tracking-[0.04em] text-on-surf-v">
        Forensic mode
      </span>
      <Switch checked={forensicOn} onCheckedChange={() => toggle()} ariaLabel="Forensic mode" />
    </div>
  )
}
