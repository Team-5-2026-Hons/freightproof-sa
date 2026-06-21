'use client'

// Global forensic-mode control — the single UI surface for toggling FP-115's
// forensic view. Mounted once (TopBar, Task 3) rather than duplicated per
// page, so every call site gets the same admin-gated control for free.

import { Switch } from '@/components/ui/Switch'
import { useForensicMode } from '@/lib/context/ForensicModeContext'

export function ForensicControls() {
  const { canViewForensics, forensicOn, toggle } = useForensicMode()

  // Self-hides for regular dispatchers rather than relying on every caller to
  // check the role first — this is the single gate (mirrors ForensicOnly's
  // pattern), so mounting it globally in TopBar can never leak the control
  // to non-admins.
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
