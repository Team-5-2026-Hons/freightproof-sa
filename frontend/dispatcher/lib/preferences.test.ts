import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTES } from '@/lib/constants/routes'
import {
  DEFAULT_PREFERENCES,
  landingHref,
  readPreferences,
  writePreferences,
} from './preferences'

const STORAGE_KEY = 'fp.preferences.v1'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readPreferences', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES)
  })

  it('reads back what writePreferences stored', () => {
    writePreferences({ landingPage: 'exceptions', rowsPerPage: 50 })

    expect(readPreferences()).toEqual({ landingPage: 'exceptions', rowsPerPage: 50 })
  })

  it('falls back per field, keeping the valid one', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ landingPage: 'history', rowsPerPage: 7 }))

    expect(readPreferences()).toEqual({ landingPage: 'history', rowsPerPage: DEFAULT_PREFERENCES.rowsPerPage })
  })

  it.each([
    ['not JSON', '{nope'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"exceptions"'],
  ])('uses the defaults when the stored value is %s', (_label, raw) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.localStorage.setItem(STORAGE_KEY, raw)

    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES)
  })

  it('rejects a landing page that is no longer offered', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ landingPage: 'sla', rowsPerPage: 25 }))

    expect(readPreferences().landingPage).toBe(DEFAULT_PREFERENCES.landingPage)
  })

  it('does not throw when storage is blocked', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })

    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES)
    expect(warn).toHaveBeenCalled()
  })
})

describe('writePreferences', () => {
  it('changes only the field it was given', () => {
    writePreferences({ rowsPerPage: 100 })
    writePreferences({ landingPage: 'history' })

    expect(readPreferences()).toEqual({ landingPage: 'history', rowsPerPage: 100 })
  })

  it('returns the new value even when storage rejects the write', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })

    expect(writePreferences({ rowsPerPage: 10 }).rowsPerPage).toBe(10)
    expect(warn).toHaveBeenCalled()
  })
})

describe('landingHref', () => {
  it.each([
    ['dashboard', ROUTES.home],
    ['exceptions', ROUTES.exceptions],
    ['history', ROUTES.history],
  ] as const)('maps %s to its route', (id, href) => {
    expect(landingHref(id)).toBe(href)
  })
})
