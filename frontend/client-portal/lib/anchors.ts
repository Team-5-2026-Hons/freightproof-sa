import type { ExceptionAnchorRecord } from '@/lib/types'

/**
 * Why an action on an exception is NOT shown as anchored, in plain words; null when it is.
 *
 * pending and failed are debts the issuer's system still owes the ledger (the retry sweep keeps
 * working on them), so a reader must see them. An action the ledger holds but whose record has
 * since changed is also not anchored: the stored receipt no longer describes what is on file.
 */
export function notAnchoredReason(anchor: ExceptionAnchorRecord): string | null {
  if (anchor.anchor_status === 'anchored') {
    return anchor.tier === 'anchored' ? null : 'the record no longer matches its anchor'
  }
  if (anchor.anchor_status === 'pending') return 'anchoring pending'
  if (anchor.anchor_status === 'failed') return 'anchoring failed, will retry'
  return 'not anchored'
}
