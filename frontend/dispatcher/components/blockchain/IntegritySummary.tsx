'use client'

import { useState, useCallback } from 'react'
import type { VerifyResult } from '@shared/lib/types/blockchain'
import type { Trip } from '@shared/lib/types/trip'
import { anchorTally } from '@/lib/phase/derive'
import { VerifyButton } from './VerifyButton'
import { ForensicOnly } from './ForensicOnly'
import { fmtFull } from '@shared/lib/utils/datetime'

export function IntegritySummary({ trip }: { trip: Trip }) {
  const tally = anchorTally(trip.phases)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const onResult = useCallback((_result: VerifyResult, at: string) => setCheckedAt(at), [])
  return <section aria-label="Record integrity" className="mx-auto mb-6 w-full max-w-4xl px-4 md:px-6">
    <div className="rounded-lg border border-outline-v/30 bg-surf-low p-4">
      <h2 className="text-sm font-bold text-on-surf">Record integrity</h2>
      <p className="mt-1 text-xs text-on-surf-v">This check covers committed trip details only.</p>
      <ForensicOnly><p className="mt-1 text-xs text-on-surf-v">Verify pickup and delivery receipts on the timeline. Evidence bytes are covered when the receipt supports them.</p></ForensicOnly>
      {tally.failed > 0 && <p className="mt-2 text-sm font-semibold text-warn">{tally.failed} failed anchors — receipts still owed</p>}
      <ForensicOnly><p className="mt-2 text-xs text-on-surf-v">{tally.anchored} of {tally.owed} phase receipts anchored</p></ForensicOnly>
      <VerifyButton subjectType="trip" subjectId={trip.id} autoVerify onResult={onResult} />
      {checkedAt && <p className="mt-2 text-xs text-on-surf-v">Checked {fmtFull(checkedAt)}</p>}
    </div>
  </section>
}
