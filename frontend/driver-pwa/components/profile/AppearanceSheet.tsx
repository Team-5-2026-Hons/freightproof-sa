'use client'

import { Drawer } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { ThemeSelect } from '@/components/settings/ThemeSelect'

interface AppearanceSheetProps {
  open: boolean
  onClose: () => void
}

/**
 * Appearance as a sheet off a single Profile row (overhaul 10.2), instead of a segmented
 * control taking a whole group on the screen — it is changed rarely (HIG settings.md:
 * "Put general, infrequently changed settings in your custom settings area"). Kept at
 * all because Tim chose to (14 Oct): a phone left on auto-dark still needs a readable
 * screen in daylight. The choice applies the moment it is tapped; Done only closes.
 */
export function AppearanceSheet({ open, onClose }: AppearanceSheetProps) {
  return (
    <Drawer open={open} onClose={onClose} side="bottom" title="Appearance">
      <div className="flex flex-col gap-4">
        <ThemeSelect />
        <p className="text-subhead text-surface-on-variant">
          System follows your phone, including its switch at sunset.
        </p>
        <Button size="pill" onClick={onClose}>Done</Button>
      </div>
    </Drawer>
  )
}
