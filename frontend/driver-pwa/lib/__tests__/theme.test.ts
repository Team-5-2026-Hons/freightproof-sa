// frontend/driver-pwa/lib/__tests__/theme.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DARK_CLASS,
  DEFAULT_THEME_PREFERENCE,
  PREF_THEME,
  THEME_INIT_SCRIPT,
  applyTheme,
  getThemePref,
  resolveTheme,
  setThemePref,
  subscribeThemePref,
} from '../theme'

// jsdom ships no matchMedia — every test that touches 'system' has to say what the
// device is claiming, so the OS half of the resolution is never left to chance.
function mockPrefersDark(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove(DARK_CLASS)
  mockPrefersDark(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getThemePref', () => {
  it('defaults to following the device when nothing is stored', () => {
    expect(getThemePref()).toBe(DEFAULT_THEME_PREFERENCE)
    expect(DEFAULT_THEME_PREFERENCE).toBe('system')
  })

  it('returns a stored preference', () => {
    window.localStorage.setItem(PREF_THEME, 'dark')

    expect(getThemePref()).toBe('dark')
  })

  it('falls back to the default for an unrecognised stored value', () => {
    window.localStorage.setItem(PREF_THEME, 'midnight')

    expect(getThemePref()).toBe(DEFAULT_THEME_PREFERENCE)
  })

  it('falls back to the default when localStorage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(getThemePref()).toBe(DEFAULT_THEME_PREFERENCE)
    expect(getItem).toHaveBeenCalled()
  })
})

describe('resolveTheme', () => {
  it('returns an explicit choice unchanged', () => {
    mockPrefersDark(true)

    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('resolves "system" against the device', () => {
    mockPrefersDark(true)
    expect(resolveTheme('system')).toBe('dark')

    mockPrefersDark(false)
    expect(resolveTheme('system')).toBe('light')
  })

  it('resolves "system" to light where matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)

    expect(resolveTheme('system')).toBe('light')
  })
})

describe('applyTheme', () => {
  it('adds the dark class for a dark preference', () => {
    applyTheme('dark')

    expect(document.documentElement).toHaveClass(DARK_CLASS)
  })

  it('removes the dark class for a light preference', () => {
    document.documentElement.classList.add(DARK_CLASS)

    applyTheme('light')

    expect(document.documentElement).not.toHaveClass(DARK_CLASS)
  })

  it('follows the device for a system preference', () => {
    mockPrefersDark(true)

    applyTheme('system')

    expect(document.documentElement).toHaveClass(DARK_CLASS)
  })
})

describe('setThemePref', () => {
  it('persists the choice, applies it, and notifies subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeThemePref(listener)

    setThemePref('dark')

    expect(window.localStorage.getItem(PREF_THEME)).toBe('dark')
    expect(document.documentElement).toHaveClass(DARK_CLASS)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('still applies the theme for the session when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    setThemePref('dark')

    expect(document.documentElement).toHaveClass(DARK_CLASS)
  })

  it('stops notifying an unsubscribed listener', () => {
    const listener = vi.fn()

    subscribeThemePref(listener)()
    setThemePref('light')

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('THEME_INIT_SCRIPT', () => {
  it('applies the stored theme before React runs', () => {
    window.localStorage.setItem(PREF_THEME, 'dark')

    // Runs the pre-paint script exactly as the browser would from app/layout.tsx.
    new Function(THEME_INIT_SCRIPT)()

    expect(document.documentElement).toHaveClass(DARK_CLASS)
  })

  it('follows the device when nothing is stored', () => {
    mockPrefersDark(true)

    new Function(THEME_INIT_SCRIPT)()

    expect(document.documentElement).toHaveClass(DARK_CLASS)
  })

  it('leaves an explicit light choice alone on a dark device', () => {
    mockPrefersDark(true)
    window.localStorage.setItem(PREF_THEME, 'light')

    new Function(THEME_INIT_SCRIPT)()

    expect(document.documentElement).not.toHaveClass(DARK_CLASS)
  })

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => new Function(THEME_INIT_SCRIPT)()).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })
})
