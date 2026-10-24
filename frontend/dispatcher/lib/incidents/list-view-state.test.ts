import { describe, expect, it } from 'vitest'
import { parseIncidentListView, serializeIncidentListView } from './list-view-state'

describe('incident list view state', () => {
  it('reads_every_filter_from_the_query', () => {
    expect(parseIncidentListView(new URLSearchParams('status=investigating&type=hijacking&owner=mine&q=FP-1')))
      .toEqual({ status: 'investigating', type: 'hijacking', owner: 'mine', q: 'FP-1' })
  })

  it('falls_back_to_the_defaults_for_values_it_does_not_know', () => {
    expect(parseIncidentListView(new URLSearchParams('status=bogus&type=nope&owner=everyone')))
      .toEqual({ status: 'all', type: 'all', owner: 'anyone', q: '' })
  })

  it('leaves_defaults_out_of_the_query', () => {
    expect(serializeIncidentListView({ status: 'all', type: 'all', owner: 'anyone', q: '' })).toBe('')
    expect(serializeIncidentListView({ status: 'closed', type: 'all', owner: 'unassigned', q: '' })).toBe('status=closed&owner=unassigned')
  })
})
