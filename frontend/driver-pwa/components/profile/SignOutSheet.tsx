'use client'

import { useState } from 'react'
import { Drawer } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'

interface SignOutSheetProps {
  open: boolean
  onClose: () => void
  /** Performs the sign-out; the sheet shows progress until it settles. */
  onConfirm: () => Promise<void> | void
}

/**
 * Confirmation before signing out (overhaul 10.3). Kept because an accidental tap from
 * the roadside costs the driver a full SMS round trip to get back in — the one place a
 * confirmation earns its interruption (HIG alerts.md: confirm destructive actions).
 */
export function SignOutSheet({ open, onClose, onConfirm }: SignOutSheetProps) {
  const [busy, setBusy] = useState(false)

  async function confirm(): Promise<void> {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onClose={onClose} side="bottom" title="Sign out?">
      <div className="flex flex-col gap-2.5">
        <p className="mb-2 text-subhead text-surface-on-variant">
          You&rsquo;ll need a new code by SMS to sign back in. Your trip stays exactly where you left it.
        </p>
        <Button variant="destructive" size="pill" loading={busy} onClick={confirm}>Sign Out</Button>
        <Button variant="fill" size="pill" onClick={onClose} disabled={busy}>Cancel</Button>
      </div>
    </Drawer>
  )
}
