import type { ExceptionSeverity } from '@shared/lib/types/exception'
import { DEFAULT_EXCEPTION_SORT, EXCEPTION_SORT_KEYS, type ExceptionSort } from './queue'

export interface ExceptionHistoryNavigationState {
  cursorStack: (string | undefined)[]
  pageIndex: number
}

export interface ExceptionHistoryNavigation extends ExceptionHistoryNavigationState {
  onChange: (next: ExceptionHistoryNavigationState) => void
}

export type ExceptionTab = 'unreviewed' | 'mine' | 'history'

export interface ExceptionListViewState {
  tab: ExceptionTab
  q: string
  severity: '' | ExceptionSeverity
  fromDate?: string
  toDate?: string
  group: 'none' | 'trip'
  sort: ExceptionSort
  navigation: ExceptionHistoryNavigationState
}

export const FIRST_HISTORY_PAGE: ExceptionHistoryNavigationState = { cursorStack: [undefined], pageIndex: 0 }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_LENGTH = 10

export function validExceptionDate(value: string | null): string | undefined {
  if (!value || !DATE_PATTERN.test(value)) return undefined

  // Round-trips through Date so 2026-02-31 is refused rather than rolled into March.
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, DAY_LENGTH) === value ? value : undefined
}

function parseTab(value: string | null): ExceptionTab {
  return value === 'mine' || value === 'history' ? value : 'unreviewed'
}

function parseSeverity(value: string | null): '' | ExceptionSeverity {
  return value === 'critical' || value === 'warning' || value === 'info' ? value : ''
}

/** An inverted range is dropped entirely: neither end can be trusted over the other. */
function parseDateRange(params: URLSearchParams): Pick<ExceptionListViewState, 'fromDate' | 'toDate'> {
  const fromDate = validExceptionDate(params.get('from'))
  const toDate = validExceptionDate(params.get('to'))
  if (fromDate && toDate && fromDate > toDate) return { fromDate: undefined, toDate: undefined }

  return { fromDate, toDate }
}

function parseNavigation(params: URLSearchParams): ExceptionHistoryNavigationState {
  const cursors = params.getAll('cursor').filter(Boolean)
  const index = params.get('page') ?? '0'
  // A page beyond the cursors we hold cannot be reached, so it falls back to the first page.
  const reachable = /^\d+$/.test(index) && Number.isSafeInteger(Number(index)) && Number(index) <= cursors.length

  return { cursorStack: [undefined, ...cursors], pageIndex: reachable ? Number(index) : 0 }
}

function parseSort(params: URLSearchParams): ExceptionSort {
  const key = EXCEPTION_SORT_KEYS.find(candidate => candidate === params.get('sort'))
  if (!key) return DEFAULT_EXCEPTION_SORT

  return { key, dir: params.get('dir') === 'asc' ? 'asc' : 'desc' }
}

export function parseExceptionViewState(params: URLSearchParams): ExceptionListViewState {
  return {
    tab: parseTab(params.get('tab')),
    q: params.get('q') ?? '',
    severity: parseSeverity(params.get('severity')),
    ...parseDateRange(params),
    group: params.get('group') === 'trip' ? 'trip' : 'none',
    sort: parseSort(params),
    navigation: parseNavigation(params),
  }
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
    params.set('sort', state.sort.key)
    params.set('dir', state.sort.dir)
  }

  state.navigation.cursorStack.slice(1).forEach(cursor => {
    if (cursor) params.append('cursor', cursor)
  })
  if (state.navigation.pageIndex > 0) params.set('page', String(state.navigation.pageIndex))

  return params.toString()
}
