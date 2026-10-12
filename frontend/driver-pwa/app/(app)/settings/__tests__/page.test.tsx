import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mutable through getters so each test can configure the support line, the way
// NEXT_PUBLIC_SUPPORT_PHONE would be set (or not) in .env.local.
let mockPhone: string | null = null
vi.mock('@/lib/constants/app', () => ({
  APP_VERSION: '0.1.0',
  get SUPPORT_PHONE() { return mockPhone },
  SUPPORT_EMAIL: 'support@freightproof.co.za',
}))

import SettingsPage from '../page'

beforeEach(() => {
  mockPhone = null
})

describe('Settings — support contacts (audit M6)', () => {
  it('hides the call row while no support number is configured, rather than show a fake one', () => {
    // Arrange / Act
    render(<SettingsPage />)

    // Assert
    expect(screen.queryByRole('link', { name: /call support/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /email support/i })).toHaveAttribute(
      'href',
      'mailto:support@freightproof.co.za',
    )
  })

  it('offers a tappable call row once the number is configured', () => {
    // Arrange
    mockPhone = '+27 21 555 0100'

    // Act
    render(<SettingsPage />)

    // Assert — the dialler gets the number without its spaces.
    expect(screen.getByRole('link', { name: /call support/i })).toHaveAttribute('href', 'tel:+27215550100')
  })

  it('groups settings under one header each, iOS inset-grouped style (audit M7)', () => {
    // Arrange / Act
    render(<SettingsPage />)

    // Assert
    for (const title of ['Support', 'Appearance', 'Accessibility', 'About']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
  })
})
