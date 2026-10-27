// Which handover items the driver has already been SHOWN this session. The handover sheet
// opens itself for anything new (a fresh arrangement, a changed version, a notice, the trip
// just handed over) and stays closed for what the driver has seen — the compact row on
// Home/Trips keeps it one tap away. sessionStorage, not localStorage: a new app session
// should show open items again, and nothing here is personal data (ids and versions only).

import type { SubstitutionNoticeRead, SubstitutionRequestRead } from '@shared/lib/types/driver-substitution'

export const SUBSTITUTION_SEEN_KEY = 'fp:substitution-seen'
const HANDED_OVER_PREFIX = 'handed-over:'

/**
 * One stable id per thing the sheet shows. A pending arrangement is keyed with its version:
 * dispatch changing it is news the driver must see again.
 */
export function attentionItemIds(
  pending: readonly Pick<SubstitutionRequestRead, 'id' | 'version'>[],
  notices: readonly Pick<SubstitutionNoticeRead, 'id'>[],
  handedOverTripId: string | null,
): string[] {
  const ids = [
    ...pending.map((request) => `${request.id}:${request.version}`),
    ...notices.map((notice) => notice.id),
  ]
  if (handedOverTripId !== null) ids.push(`${HANDED_OVER_PREFIX}${handedOverTripId}`)
  return ids
}

function readSeen(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(SUBSTITUTION_SEEN_KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch (err: unknown) {
    console.warn('substitution-attention: could not read seen items', err)
    return new Set()
  }
}

/** The ids the driver has not been shown yet this session. */
export function unseenAttentionItems(ids: readonly string[]): string[] {
  const seen = readSeen()
  return ids.filter((id) => !seen.has(id))
}

export function markAttentionSeen(ids: readonly string[]): void {
  if (ids.length === 0) return
  const seen = readSeen()
  for (const id of ids) seen.add(id)
  try {
    window.sessionStorage.setItem(SUBSTITUTION_SEEN_KEY, JSON.stringify([...seen]))
  } catch (err: unknown) {
    console.warn('substitution-attention: could not record seen items', err)
  }
}
