'use client'

import { Settings as SettingsIcon } from 'lucide-react'
import { TopBar } from '@/components/ui/TopBar'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/hooks/useAuth'

export default function SettingsPage() {
  const { user, signOut } = useAuth()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Settings" />
      <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6 border-b border-outline-variant/20 pb-4">
            <SettingsIcon className="w-5 h-5 text-surface-on-variant" />
            <h2 className="text-lg font-bold text-surface-on">Account</h2>
          </div>
          
          <div className="space-y-4 mb-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Name</p>
              <p className="text-sm font-medium text-surface-on mt-1">{user?.full_name}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Email</p>
              <p className="text-sm font-medium text-surface-on mt-1">{user?.email}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Organization ID</p>
              <p className="font-mono tracking-[0.05em] text-xs text-surface-on mt-1">{user?.organization_id}</p>
            </div>
          </div>
          
          <div className="border-t border-outline-variant/20 pt-6">
            <Button
              variant="danger"
              onClick={signOut}
            >
              Sign Out
            </Button>
          </div>
        </Card>
      </div>
      </div>
    </div>
  )
}
