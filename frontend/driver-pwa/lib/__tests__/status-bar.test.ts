import { describe, it, expect, vi, beforeEach } from 'vitest'

const { setStyle, isNativePlatform } = vi.hoisted(() => ({
  setStyle: vi.fn(() => Promise.resolve()),
  isNativePlatform: vi.fn(() => true),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform } }))
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle },
  Style: { Dark: 'DARK', Light: 'LIGHT' },
}))

import { setStatusBarOverride, syncStatusBarToTheme } from '@/lib/status-bar'

describe('status bar', () => {
  beforeEach(() => {
    setStatusBarOverride(null)
    syncStatusBarToTheme('light')
    setStyle.mockClear()
    isNativePlatform.mockReturnValue(true)
  })

  it('test_dark_theme_sets_light_glyphs', () => {
    syncStatusBarToTheme('dark')

    expect(setStyle).toHaveBeenLastCalledWith({ style: 'DARK' })
  })

  it('test_override_wins_over_theme_until_released', () => {
    setStatusBarOverride('dark')
    syncStatusBarToTheme('light')

    expect(setStyle).toHaveBeenLastCalledWith({ style: 'DARK' })

    setStatusBarOverride(null)

    expect(setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' })
  })

  it('test_web_is_a_no_op', () => {
    isNativePlatform.mockReturnValue(false)

    syncStatusBarToTheme('dark')

    expect(setStyle).not.toHaveBeenCalled()
  })

  it('test_plugin_rejection_is_swallowed_with_a_warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setStyle.mockReturnValueOnce(Promise.reject(new Error('not implemented')))

    syncStatusBarToTheme('dark')
    await Promise.resolve()
    await Promise.resolve()

    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
