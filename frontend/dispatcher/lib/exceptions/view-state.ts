import type { ExceptionSeverity } from '@shared/lib/types/exception'
import { DEFAULT_EXCEPTION_SORT, EXCEPTION_SORT_KEYS, type ExceptionSort } from './queue'
export interface ExceptionHistoryNavigationState { cursorStack: (string | undefined)[]; pageIndex: number }
export interface ExceptionHistoryNavigation extends ExceptionHistoryNavigationState { onChange: (next: ExceptionHistoryNavigationState) => void }
export interface ExceptionListViewState {
  tab: 'unreviewed' | 'mine' | 'history'; q: string; severity: '' | ExceptionSeverity
  fromDate?: string; toDate?: string; group: 'none' | 'trip'; sort: ExceptionSort; navigation: ExceptionHistoryNavigationState
}
export const FIRST_HISTORY_PAGE: ExceptionHistoryNavigationState = { cursorStack: [undefined], pageIndex: 0 }
export function validExceptionDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined
}
export function parseExceptionViewState(params: URLSearchParams): ExceptionListViewState {
  const tab = params.get('tab'), severity = params.get('severity')
  let fromDate = validExceptionDate(params.get('from')), toDate = validExceptionDate(params.get('to'))
  if (fromDate && toDate && fromDate > toDate) { fromDate = undefined; toDate = undefined }
  const cursors = params.getAll('cursor').filter(Boolean)
  const index = params.get('page') ?? '0'
  const pageIndex = /^\d+$/.test(index) && Number.isSafeInteger(Number(index)) && Number(index) <= cursors.length ? Number(index) : 0
  const sortKey = EXCEPTION_SORT_KEYS.find(key => key === params.get('sort'))
  const sort: ExceptionSort = sortKey ? { key: sortKey, dir: params.get('dir') === 'asc' ? 'asc' : 'desc' } : DEFAULT_EXCEPTION_SORT
  return { tab: tab === 'mine' || tab === 'history' ? tab : 'unreviewed', q: params.get('q') ?? '', severity: severity === 'critical' || severity === 'warning' || severity === 'info' ? severity : '', fromDate, toDate, group: params.get('group') === 'trip' ? 'trip' : 'none', sort, navigation: { cursorStack: [undefined, ...cursors], pageIndex } }
}
export function serializeExceptionViewState(state: ExceptionListViewState): string {
  const params = new URLSearchParams()
  if (state.tab !== 'unreviewed') params.set('tab', state.tab)
  if (state.q) params.set('q', state.q)
  if (state.severity) params.set('severity', state.severity)
  if (state.fromDate) params.set('from', state.fromDate)
  if (state.toDate) params.set('to', state.toDate)
  if (state.group !== 'none') params.set('group', state.group)
  // The default order is omitted so an unsorted URL stays clean and equal to "no sort".
  if (state.sort.key !== DEFAULT_EXCEPTION_SORT.key || state.sort.dir !== DEFAULT_EXCEPTION_SORT.dir) {
    params.set('sort', state.sort.key); params.set('dir', state.sort.dir)
  }
  state.navigation.cursorStack.slice(1).forEach(cursor => { if (cursor) params.append('cursor', cursor) })
  if (state.navigation.pageIndex > 0) params.set('page', String(state.navigation.pageIndex))
  return params.toString()
}
