'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { initialsOf, roleLabel } from '@/lib/format/dispatcher-identity'
import type { DispatcherUser } from '@/lib/types/user'

// Long enough to read "Copied", short enough that a second copy is not blocked by it.
const COPIED_FLASH_MS = 1_500

// What the role means in this app, stated from the code: the forensic view is the one thing
// the admin role adds, so that is the only difference claimed.
const ROLE_DESCRIPTION: Record<DispatcherUser['role'], string> = {
  admin_dispatcher: 'Standard dispatcher access, plus the forensic view of blockchain receipts and the audit trail.',
  dispatcher: 'Standard dispatcher access. The forensic view is limited to admin dispatchers.',
}

type CopyState = 'idle' | 'copied' | 'failed'

interface CopyValueProps {
  label: string
  value: string
}

// A reference ID is read out to support or pasted into a ticket, so it gets a copy control.
// The clipboard API needs a secure context; when it refuses, the value stays selectable.
function CopyValue({ label, value }: CopyValueProps) {
  const [state, setState] = useState<CopyState>('idle')

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch (error) {
      console.warn('AccountDetails: clipboard write refused', error)
      setState('failed')
    }
    setTimeout(() => setState('idle'), COPIED_FLASH_MS)
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-on-surf-v">{label}</p>
        <p className="mt-1 break-all font-mono text-xs tracking-[0.05em] text-on-surf">{value}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={handleCopy}
        iconLeft={state === 'copied' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : null}
      </Button>
      {/* aria-label on the button hides its changing text, so the outcome is announced here. */}
      <span role="status" className="sr-only">
        {state === 'copied' ? `${label} copied` : state === 'failed' ? `Could not copy ${label}` : ''}
      </span>
    </div>
  )
}

interface DetailRowProps {
  label: string
  children: React.ReactNode
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="py-3">
      <dt className="text-xs font-bold uppercase tracking-wider text-on-surf-v">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-on-surf">{children}</dd>
    </div>
  )
}

interface AccountDetailsProps {
  user: DispatcherUser
  onSignOut: () => void
}

/** The signed-in dispatcher's account: who they are, what they can do, and the IDs support
 *  will ask for. Read-only: names and emails are managed in Supabase Auth, not here. */
export function AccountDetails({ user, onSignOut }: AccountDetailsProps) {
  return (
    <div>
      <div className="flex items-center gap-4">
        <div
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-[700] text-primary-on"
        >
          {initialsOf(user.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-on-surf">{user.full_name}</p>
          <p className="truncate text-sm text-on-surf-v">{roleLabel(user.role)}</p>
        </div>
        <Chip type={user.is_active ? 'complete' : 'pending'} label={user.is_active ? 'Active' : 'Deactivated'} />
      </div>

      <dl className="mt-4 divide-y divide-outline-v/20 border-t border-outline-v/20">
        <DetailRow label="Email">{user.email}</DetailRow>
        <DetailRow label="Organisation">{user.organization_name}</DetailRow>
        <DetailRow label="Role">
          <span className="font-normal text-on-surf-v">{ROLE_DESCRIPTION[user.role]}</span>
        </DetailRow>
      </dl>

      <div className="divide-y divide-outline-v/20 border-t border-outline-v/20">
        <CopyValue label="User ID" value={user.id} />
        <CopyValue label="Organisation ID" value={user.organization_id} />
      </div>

      <div className="mt-4 border-t border-outline-v/20 pt-6">
        <Button variant="danger" onClick={onSignOut}>Sign Out</Button>
      </div>
    </div>
  )
}
