import { describe, expect, it } from 'vitest'
import { parseTripListView, serializeTripListView } from './list-view-state'

describe('trip list view state', () => {
  it('reads_the_tab_and_search_from_the_query', () => {
    expect(parseTripListView(new URLSearchParams('tab=active&q=CPT'))).toEqual({ tab: 'active', q: 'CPT' })
  })

  it('falls_back_to_all_for_a_tab_it_does_not_know', () => {
    expect(parseTripListView(new URLSearchParams('tab=bogus')).tab).toBe('all')
    expect(parseTripListView(new URLSearchParams('')).tab).toBe('all')
  })

  it('leaves_defaults_out_so_an_unfiltered_list_has_a_clean_url', () => {
    expect(serializeTripListView({ tab: 'all', q: '' })).toBe('')
    expect(serializeTripListView({ tab: 'created', q: '' })).toBe('tab=created')
    expect(serializeTripListView({ tab: 'all', q: 'DBN' })).toBe('q=DBN')
  })

  it('round_trips_a_search_with_characters_that_need_escaping', () => {
    const view = { tab: 'active' as const, q: 'a&b=c d' }

    expect(parseTripListView(new URLSearchParams(serializeTripListView(view)))).toEqual(view)
  })
})
