'use client'

import { useState } from 'react'

/** When `data` last arrived. A failed refresh leaves the old value in place, so this keeps
 *  saying when what is on screen was actually read.
 *
 *  Keyed on the reference: useAsyncData builds a new array for every successful response and
 *  keeps the old one on failure, so a changed reference means a fresh read. A caller that
 *  rebuilds `data` on every render would restamp it each time. */
export function useLastLoadedAt(data: unknown): Date {
  // Adjusted during render (as Disclosure does) so the stamp never lags a frame behind the rows.
  const [stamped, setStamped] = useState(() => ({ data, at: new Date() }))
  if (stamped.data !== data) setStamped({ data, at: new Date() })
  return stamped.at
}
