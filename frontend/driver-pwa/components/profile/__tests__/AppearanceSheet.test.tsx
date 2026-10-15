import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AppearanceSheet } from '../AppearanceSheet'
import { PREF_THEME } from '@/lib/theme'

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AppearanceSheet', () => {
  it('test_offers_the_three_appearances_as_radios', () => {
    render(<AppearanceSheet open onClose={vi.fn()} />)

    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument()
  })

  it('test_applies_a_choice_immediately', () => {
    render(<AppearanceSheet open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(window.localStorage.getItem(PREF_THEME)).toBe('dark')
  })

  it('test_done_closes_the_sheet', () => {
    const onClose = vi.fn()
    render(<AppearanceSheet open onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
