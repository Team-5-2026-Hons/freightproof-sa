'use client'

import type { JSX } from 'react'

import { ReceiptLookup } from '@/components/blockchain/ReceiptLookup'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { TopBar } from '@/components/ui/TopBar'
import { useForensicMode } from '@/lib/context/ForensicModeContext'

export default function ReceiptLookupPage(): JSX.Element {
  const { canViewForensics, forensicOn, toggle } = useForensicMode()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="Receipt Lookup" sub="Hedera HCS receipt evidence" />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {!canViewForensics ? (
          <div className="mx-auto max-w-3xl rounded-lg bg-surf-lowest shadow-level-3">
            <EmptyState
              icon={<Ic n="lock" s={32} />}
              title="Access restricted"
              body="Blockchain receipt lookup is available only to admin dispatchers."
            />
          </div>
        ) : !forensicOn ? (
          <div className="mx-auto max-w-3xl rounded-lg bg-surf-lowest shadow-level-3">
            <EmptyState
              icon={<Ic n="hex" s={32} />}
              title="Enable forensic mode"
              body="Turn on forensic mode to search technical blockchain receipt records."
              cta={<Button onClick={toggle}>Enable forensic mode</Button>}
            />
          </div>
        ) : (
          <ReceiptLookup />
        )}
      </div>
    </div>
  )
}
