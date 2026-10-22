'use client'

import { useCallback, useEffect, useState } from 'react'
import { Archive } from 'lucide-react'
import { useOfflineQueue, refreshOfflineQueueCounts } from '@/lib/hooks/useOfflineQueue'
import { useToast } from '@/lib/hooks/useToast'
import {
  discardRetainedItem,
  exportRetainedItem,
  listRetainedEvidence,
  retryRetainedItem,
  type RetainedEvidenceSnapshot,
  type RetainedItem,
} from '@/lib/offline/retained-evidence'
import { sendLateEvidence, type LateEvidenceOutcome } from '@/lib/offline/late-evidence-sync'
import { formatDateTime } from '@/lib/utils/format-time'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { StatusBanner } from '@/components/ui/StatusBanner'

const EXPORT_MIME = 'application/json'

// The browser's own download, so the driver can hand the file to dispatch. No upload, no
// third party: the bytes leave the app only where the driver saves them.
function downloadJson(filename: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: EXPORT_MIME }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function lateOutcomeMessage(outcome: LateEvidenceOutcome): { kind: 'success' | 'error'; title: string; body: string } {
  switch (outcome.kind) {
    case 'receipt':
      return { kind: 'success', title: 'Sent as late evidence', body: 'Dispatch will review it. It does not change the trip’s phases.' }
    case 'already-recorded':
      return { kind: 'success', title: 'Already on record', body: 'The server already holds this capture from you.' }
    case 'transient':
      return { kind: 'error', title: 'Not sent yet', body: 'No connection to the server. It is still kept here — try again shortly.' }
    case 'refused':
      return { kind: 'error', title: 'Not accepted', body: outcome.reason }
    case 'not-eligible':
      return { kind: 'error', title: 'Cannot send this', body: outcome.reason }
    case 'not-saved':
      return { kind: 'error', title: 'Not sent', body: 'This phone could not save the request safely. Free some space and try again.' }
  }
}

interface ItemRowProps {
  item: RetainedItem
  onChanged: () => Promise<void>
}

function ItemRow({ item, onChanged }: ItemRowProps) {
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  // Discard is the only irreversible action on this screen, so it takes a second,
  // differently worded tap with the consequence stated.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
      await onChanged()
    }
  }

  const sendLate = () => run(async () => {
    if (item.late === null) return
    notify(lateOutcomeMessage(await sendLateEvidence(item.late)))
  })

  const retry = () => run(async () => {
    await retryRetainedItem(item.ref)
  })

  const exportItem = () => run(async () => {
    try {
      downloadJson(`freightproof-retained-${Date.now()}.json`, await exportRetainedItem(item.ref))
    } catch (err: unknown) {
      console.error('Could not export a retained item', err)
      notify({ kind: 'error', title: 'Export failed', body: 'Nothing was changed. Try again.' })
    }
  })

  const discard = () => run(async () => {
    setConfirmingDiscard(false)
    await discardRetainedItem(item.ref)
  })

  return (
    <li className="flex flex-col gap-2 px-5 py-4">
      <div>
        <p className="text-headline text-surface-on">{item.title}</p>
        <p className="text-subhead text-surface-on-variant">
          {item.capturedAt !== null ? `Captured ${formatDateTime(item.capturedAt)}` : 'Capture time not recorded'}
          {item.quarantined && ' · capturer not recorded'}
        </p>
        <p className="mt-1 text-subhead text-surface-on">{item.reason}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {confirmingDiscard ? (
          <>
            <Button variant="destructive" size="sm" loading={busy} onClick={() => void discard()}>
              Delete from this phone for good?
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmingDiscard(false)}>Keep</Button>
          </>
        ) : (
          <>
            {item.late !== null && (
              <Button variant="primary" size="sm" loading={busy} onClick={() => void sendLate()}>Send as late evidence</Button>
            )}
            {item.canRetry && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void retry()}>Try again</Button>
            )}
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void exportItem()}>Export</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmingDiscard(true)}>Discard</Button>
          </>
        )}
      </div>
    </li>
  )
}

const EMPTY_SNAPSHOT: RetainedEvidenceSnapshot = { items: [], heldForOtherAccounts: 0, receipts: [] }

/**
 * Review screen for captures this phone is keeping: refused by the server, quarantined
 * (capturer unknown) or retained drafts. Every action is explicit; nothing here is sent or
 * deleted without the driver choosing it, and a quarantined item is never presented as theirs.
 */
export function RetainedEvidenceList() {
  const { flush } = useOfflineQueue()
  const [snapshot, setSnapshot] = useState<RetainedEvidenceSnapshot>(EMPTY_SNAPSHOT)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    setSnapshot(await listRetainedEvidence())
    setLoaded(true)
    await refreshOfflineQueueCounts()
  }, [])

  useEffect(() => { void reload() }, [reload])

  // A retried item goes back to pending; send it now rather than waiting for the next trigger.
  const afterChange = useCallback(async () => {
    await flush()
    await reload()
  }, [flush, reload])

  if (!loaded) return null

  const { items, heldForOtherAccounts, receipts } = snapshot

  if (items.length === 0 && heldForOtherAccounts === 0 && receipts.length === 0) {
    return (
      <EmptyState
        icon={<Archive strokeWidth={1.5} aria-hidden />}
        title="Nothing kept for review"
        body="Nothing on this phone is waiting for your decision."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6 pb-6">
      {heldForOtherAccounts > 0 && (
        <StatusBanner tone="neutral" title="Kept for another driver" className="mx-4 mt-4">
          {`${heldForOtherAccounts} ${heldForOtherAccounts === 1 ? 'capture belongs' : 'captures belong'} to another driver account that used this phone. ${heldForOtherAccounts === 1 ? 'It is' : 'They are'} kept, and only that driver can send ${heldForOtherAccounts === 1 ? 'it' : 'them'}.`}
        </StatusBanner>
      )}

      {items.length > 0 && (
        <section aria-labelledby="retained-items">
          <SectionHeading id="retained-items" title="Needs your decision" />
          <ul className="divide-y divide-hairline">
            {items.map((item) => (
              <ItemRow key={item.ref.origin === 'queue-backup' ? 'queue-backup' : `${item.ref.origin}:${item.ref.id}`} item={item} onChanged={afterChange} />
            ))}
          </ul>
        </section>
      )}

      {receipts.length > 0 && (
        <section aria-labelledby="late-receipts">
          <SectionHeading id="late-receipts" title="Sent as late evidence" />
          <ul>
            {receipts.map((progress) => progress.receipt !== null && (
              <li key={progress.sourceId} className="px-5 py-2 text-body text-surface-on">
                Received {formatDateTime(progress.receipt.received_at)}
                <span className="block text-subhead text-surface-on-variant">
                  {progress.receipt.status === 'acknowledged' ? 'Reviewed by dispatch' : 'Waiting for dispatch to review'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
