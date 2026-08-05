// frontend/driver-pwa/components/settings/__tests__/ThemeSelect.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ThemeSelect } from '../ThemeSelect'
import { DARK_CLASS, PREF_THEME } from '@/lib/theme'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove(DARK_CLASS)
  // jsdom has no matchMedia; the 'system' option resolves through it.
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ThemeSelect', () => {
  it('offers System, Light and Dark as one radio group', () => {
    render(<ThemeSelect />)

    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument()
  })

  it('selects System when nothing has been chosen yet', () => {
    render(<ThemeSelect />)

    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
  })

  it('reflects a stored preference', () => {
    window.localStorage.setItem(PREF_THEME, 'dark')

    render(<ThemeSelect />)

    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
  })

  it('persists and applies the theme when a choice is made', () => {
    render(<ThemeSelect />)

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(window.localStorage.getItem(PREF_THEME)).toBe('dark')
    expect(document.documentElement).toHaveClass(DARK_CLASS)
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
  })

  it('lets an explicit Light choice override a dark device', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    render(<ThemeSelect />)
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))

    expect(document.documentElement).not.toHaveClass(DARK_CLASS)
  })

  it('meets the 44px minimum touch target on every segment', () => {
    render(<ThemeSelect />)

    for (const label of ['System', 'Light', 'Dark']) {
      // The visible segment is the input's sibling — the input itself is sr-only.
      const segment = screen.getByRole('radio', { name: label }).nextElementSibling

      expect(segment).toHaveClass('min-h-[44px]')
    }
  })
})
