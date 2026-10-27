'use client'

import { useEffect, useState } from 'react'
import { fmtExceptionType } from '@/lib/format/exception'
import type { TripExceptionListItem } from '@shared/lib/types/exception'

export const CLAIM_HIGHLIGHT_MS = 3000

type ClaimItem = Pick<TripExceptionListItem, 'id' | 'exception_type' | 'claimed_by_user_id' | 'claimed_by_name'>

interface ClaimChanges {
  highlighted: ReadonlySet<string>
  announcement: string
}

interface State extends ClaimChanges {
  source: readonly ClaimItem[]
  claims: ReadonlyMap<string, string | null>
}

const claimsOf = (items: readonly ClaimItem[]): Map<string, string | null> => new Map(items.map(item => [item.id, item.claimed_by_user_id]))

function describe(item: ClaimItem): string {
  const title = fmtExceptionType(item.exception_type)
  return item.claimed_by_user_id === null ? `Claim released on ${title}` : `${item.claimed_by_name ?? 'A colleague'} claimed ${title}`
}

/**
 * Notices when someone else claims or releases an exception already on screen, so the list
 * can flash that row and announce it. An exception that newly appears is not a claim change
 * (the raised-exception alert covers it), and the first load flags nothing.
 */
export function useClaimChanges(items: readonly ClaimItem[]): ClaimChanges {
  const [state, setState] = useState<State>(() => ({ source: items, claims: claimsOf(items), highlighted: new Set(), announcement: '' }))

  if (items !== state.source) {
    const changed = items.filter(item => state.claims.has(item.id) && state.claims.get(item.id) !== item.claimed_by_user_id)
    setState({
      source: items,
      claims: claimsOf(items),
      highlighted: changed.length ? new Set([...state.highlighted, ...changed.map(item => item.id)]) : state.highlighted,
      announcement: changed.length ? changed.map(describe).join('. ') : state.announcement,
    })
  }

  const { highlighted } = state
  useEffect(() => {
    if (highlighted.size === 0) return
    const timer = setTimeout(() => setState(current => ({ ...current, highlighted: new Set() })), CLAIM_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlighted])

  return { highlighted: state.highlighted, announcement: state.announcement }
}
