'use client'

import { Card } from '@/components/ui/Card'
import { AccountDetails } from '@/components/settings/AccountDetails'
import { useAuth } from '@/lib/hooks/useAuth'

export function AccountSection() {
  const { user, signOut } = useAuth()

  // The app layout renders nothing until a user exists, so this is only a type guard.
  if (!user) return null

  return (
    <Card className="p-6">
      <AccountDetails user={user} onSignOut={signOut} />
    </Card>
  )
}
