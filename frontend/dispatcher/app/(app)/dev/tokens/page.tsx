'use client'

import { Shield, Key } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAuth } from '@/lib/hooks/useAuth'

export default function DevTokensPage() {
  const { user, signIn, signOut } = useAuth()

  return (
    <PageShell>
      <PageHeader title="Dev Tokens" />
      
      <Card className="max-w-2xl p-6">
        <div className="flex items-center gap-3 mb-6 border-b border-outline-variant/20 pb-4">
          <Key className="w-5 h-5 text-secondary" />
          <h2 className="text-lg font-bold text-surface-on">Mock Auth State</h2>
        </div>
        
        <div className="space-y-4 mb-8">
          <div className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline-variant/30">
            <div>
              <p className="font-bold text-surface-on">Current User</p>
              <p className="text-sm text-surface-on-variant mt-0.5">
                {user ? user.email : 'No active session'}
              </p>
            </div>
            {user ? (
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-success">
                <Shield className="w-4 h-4" />
                Authenticated
              </span>
            ) : (
              <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">
                Unauthenticated
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => signIn({ email: 'dev@test.com', password: 'mock' })}
            disabled={!!user}
          >
            Force Sign In
          </Button>
          <Button
            variant="ghost"
            onClick={() => signOut()}
            disabled={!user}
          >
            Sign Out
          </Button>
        </div>
      </Card>
    </PageShell>
  )
}
