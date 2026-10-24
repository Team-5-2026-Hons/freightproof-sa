import { formatSast } from '@/lib/format'
import { notAnchoredReason } from '@/lib/anchors'
import type { AnchorAction, ExceptionAnchorRecord } from '@/lib/types'
import { TierBadge } from './TierBadge'

const ACTION_LABELS: Record<AnchorAction, string> = {
  raised: 'Raised',
  reviewed: 'Reviewed',
  cancelled: 'Trip cancelled',
}

/** Each action taken on an exception, with its own tier — a review receipt anchors the review only. */
export function ExceptionAnchorList({ anchors }: { anchors: ExceptionAnchorRecord[] }) {
  if (anchors.length === 0) return null
  return (
    <section aria-label="Record anchors" className="mt-3">
      <h4 className="mb-1 text-small font-bold">Record anchors</h4>
      <ul className="space-y-1.5">
        {anchors.map((anchor) => {
          const reason = notAnchoredReason(anchor)
          return (
            <li key={anchor.event_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
              <span className="font-semibold">{ACTION_LABELS[anchor.action]}</span>
              <span className="num text-muted">{formatSast(anchor.occurred_at)}</span>
              {reason === null ? (
                <>
                  <TierBadge tier="anchored" />
                  <span className="num break-all text-muted">{anchor.receipt_id ? `Receipt ${anchor.receipt_id}` : 'Receipt unavailable'}</span>
                </>
              ) : (
                // Plain sentence, no Anchored badge: this action is recorded, and the debt is visible.
                <span className="font-semibold text-warn">{`Recorded — ${reason}`}</span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-meta text-muted">
        A matching anchor shows the record was not changed after it was anchored. It does not prove the incident occurred as
        described, where it happened, or who is liable.
      </p>
    </section>
  )
}
