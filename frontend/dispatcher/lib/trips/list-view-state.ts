import type { UrlListCodec } from '@/lib/hooks/useUrlListState'

export const TRIP_TABS = ['all', 'created', 'active'] as const
export type TripTab = typeof TRIP_TABS[number]

/** What the Active Trips list keeps in its URL, so a visit to a trip and back finds it as left. */
export interface TripListView {
  tab: TripTab
  q: string
}

const DEFAULT_TAB: TripTab = 'all'

function parseTab(value: string | null): TripTab {
  return TRIP_TABS.find(tab => tab === value) ?? DEFAULT_TAB
}

export function parseTripListView(params: URLSearchParams): TripListView {
  return { tab: parseTab(params.get('tab')), q: params.get('q') ?? '' }
}

export function serializeTripListView(view: TripListView): string {
  const params = new URLSearchParams()
  if (view.tab !== DEFAULT_TAB) params.set('tab', view.tab)
  if (view.q) params.set('q', view.q)
  return params.toString()
}

export const TRIP_LIST_CODEC: UrlListCodec<TripListView> = { parse: parseTripListView, serialize: serializeTripListView }
