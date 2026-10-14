import { describe, expect, it } from 'vitest'
import { parseExceptionViewState, serializeExceptionViewState } from './view-state'
describe('exception URL state', () => {
  it('round trips filters, mine, grouping and the exact history page', () => {
    const state = parseExceptionViewState(new URLSearchParams('tab=history&q=20%25_&severity=warning&from=2026-10-01&to=2026-10-02&group=trip&cursor=opaque&page=1'))
    expect(parseExceptionViewState(new URLSearchParams(serializeExceptionViewState(state)))).toEqual(state)
    const firstPage = { ...state, navigation: { ...state.navigation, pageIndex: 0 } }
    expect(parseExceptionViewState(new URLSearchParams(serializeExceptionViewState(firstPage)))).toEqual(firstPage)
    expect(state.navigation).toEqual({ cursorStack: [undefined, 'opaque'], pageIndex: 1 })
    expect(parseExceptionViewState(new URLSearchParams('tab=mine')).tab).toBe('mine')
  })
  it('rejects unknown values, malformed indexes, impossible dates and inverted ranges', () => {
    const state = parseExceptionViewState(new URLSearchParams('tab=evil&severity=purple&group=phase&from=2026-02-30&to=garbage&page=-1'))
    expect(state.tab).toBe('unreviewed'); expect(state.severity).toBe(''); expect(state.group).toBe('none')
    expect(state.fromDate).toBeUndefined(); expect(state.toDate).toBeUndefined(); expect(state.navigation.pageIndex).toBe(0)
    const inverted = parseExceptionViewState(new URLSearchParams('from=2026-10-02&to=2026-10-01'))
    expect(inverted.fromDate).toBeUndefined(); expect(inverted.toDate).toBeUndefined()
  })
  it('keeps the default sort out of the URL and round trips a chosen one', () => {
    const defaults = parseExceptionViewState(new URLSearchParams(''))
    expect(defaults.sort).toEqual({ key: 'raised', dir: 'desc' })
    expect(serializeExceptionViewState(defaults)).toBe('')
    const sorted = parseExceptionViewState(new URLSearchParams('sort=trip&dir=asc'))
    expect(sorted.sort).toEqual({ key: 'trip', dir: 'asc' })
    expect(parseExceptionViewState(new URLSearchParams(serializeExceptionViewState(sorted)))).toEqual(sorted)
  })
  it('falls back to the default sort for an unknown key', () => {
    expect(parseExceptionViewState(new URLSearchParams('sort=password&dir=asc')).sort).toEqual({ key: 'raised', dir: 'desc' })
  })
})
