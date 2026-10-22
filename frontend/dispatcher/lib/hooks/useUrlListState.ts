'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// Same pause the Exceptions list uses before a search reaches its URL.
const SEARCH_DEBOUNCE_MS = 300

/** How a list's filters map to a query string. `serialize` leaves out anything at its default so an
 *  unfiltered list keeps a clean URL, and `parse` must refuse values it does not recognise. */
export interface UrlListCodec<S extends { q: string }> {
  parse: (params: URLSearchParams) => S
  serialize: (state: S) => string
}

export interface UrlListState<S extends { q: string }> {
  /** The filters as last committed to the URL. */
  state: S
  /** Commits filters at once, carrying whatever has been typed into the search box. */
  update: (patch: Partial<S>) => void
  /** What the search box shows: runs ahead of `state.q` while the debounce waits. */
  search: string
  setSearch: (value: string) => void
}

/**
 * Keeps a list's filters in the URL, so opening a row and coming back (or reloading) finds the list
 * as it was left. Local state still drives the page, so a click or keystroke is instant and the URL
 * follows with `router.replace`: filtering is not navigation and must not add history entries.
 * A URL change this hook did not make (a sidebar link back to the bare list) is followed.
 * Wrap the consuming page in Suspense, as `useSearchParams` requires.
 */
export function useUrlListState<S extends { q: string }>(codec: UrlListCodec<S>): UrlListState<S> {
  const router = useRouter()
  const pathname = usePathname()
  const urlKey = useSearchParams().toString()
  const [state, setState] = useState<S>(() => codec.parse(new URLSearchParams(urlKey)))
  const [search, setSearch] = useState(state.q)
  const [seenKey, setSeenKey] = useState(urlKey)
  // The query string this hook last wrote, so its own write coming back is not mistaken for navigation.
  const [writtenKey, setWrittenKey] = useState(urlKey)

  // Adjusted during render, not in an effect, so the list never paints one frame of stale filters.
  if (urlKey !== seenKey) {
    setSeenKey(urlKey)
    if (urlKey !== writtenKey) {
      const next = codec.parse(new URLSearchParams(urlKey))
      setState(next)
      setSearch(next.q)
      setWrittenKey(urlKey)
    }
  }

  const update = useCallback((patch: Partial<S>): void => {
    const next: S = { ...state, q: search, ...patch }
    const query = codec.serialize(next)
    setState(next)
    setSearch(next.q)
    setWrittenKey(query)
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [state, search, codec, router, pathname])

  useEffect(() => {
    if (search === state.q) return
    const timer = setTimeout(() => update({ q: search } as Partial<S>), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, state.q, update])

  return { state, update, search, setSearch }
}
