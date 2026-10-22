import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUrlListState, type UrlListCodec } from './useUrlListState'

interface View { tab: 'all' | 'active'; q: string }

const codec: UrlListCodec<View> = {
  parse: params => ({ tab: params.get('tab') === 'active' ? 'active' : 'all', q: params.get('q') ?? '' }),
  serialize: view => {
    const params = new URLSearchParams()
    if (view.tab !== 'all') params.set('tab', view.tab)
    if (view.q) params.set('q', view.q)
    return params.toString()
  },
}

const replace = vi.fn()
const urlParams = vi.hoisted(() => ({ current: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/trips',
  useSearchParams: () => new URLSearchParams(urlParams.current),
}))

beforeEach(() => { replace.mockReset(); urlParams.current = ''; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useUrlListState', () => {
  it('starts_from_the_filters_in_the_url', () => {
    urlParams.current = 'tab=active&q=CPT'

    const { result } = renderHook(() => useUrlListState(codec))

    expect(result.current.state).toEqual({ tab: 'active', q: 'CPT' })
    expect(result.current.search).toBe('CPT')
  })

  it('writes_a_changed_filter_to_the_url_with_replace_so_history_is_not_spammed', () => {
    const { result } = renderHook(() => useUrlListState(codec))

    act(() => result.current.update({ tab: 'active' }))

    expect(result.current.state.tab).toBe('active')
    expect(replace).toHaveBeenCalledWith('/trips?tab=active', { scroll: false })
  })

  it('drops_the_query_string_when_every_filter_is_back_to_its_default', () => {
    urlParams.current = 'tab=active'
    const { result } = renderHook(() => useUrlListState(codec))

    act(() => result.current.update({ tab: 'all' }))

    expect(replace).toHaveBeenCalledWith('/trips', { scroll: false })
  })

  it('filters_on_every_keystroke_but_writes_the_url_once_typing_pauses', () => {
    const { result } = renderHook(() => useUrlListState(codec))

    act(() => result.current.setSearch('C'))
    act(() => result.current.setSearch('CP'))
    expect(result.current.search).toBe('CP')
    expect(replace).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(300) })

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/trips?q=CP', { scroll: false })
    expect(result.current.state.q).toBe('CP')
  })

  it('keeps_the_typed_search_when_the_tab_changes_before_the_debounce_fires', () => {
    const { result } = renderHook(() => useUrlListState(codec))
    act(() => result.current.setSearch('CPT'))

    act(() => result.current.update({ tab: 'active' }))

    expect(replace).toHaveBeenLastCalledWith('/trips?tab=active&q=CPT', { scroll: false })
  })

  it('follows_a_url_change_that_it_did_not_make_itself', () => {
    const { result, rerender } = renderHook(() => useUrlListState(codec))

    urlParams.current = 'tab=active&q=DBN'
    rerender()

    expect(result.current.state).toEqual({ tab: 'active', q: 'DBN' })
    expect(result.current.search).toBe('DBN')
  })
})
