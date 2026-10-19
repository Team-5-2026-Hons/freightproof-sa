import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsLayout } from './SettingsLayout'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ROUTES } from '@/lib/constants/routes'

const mockState = vi.hoisted(() => ({
  role: 'dispatcher' as 'dispatcher' | 'admin_dispatcher',
  query: '',
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockState.query),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      organization_id: 'org-1',
      organization_name: 'Linbro Express',
      email: 'jane@freightproof.test',
      full_name: 'Jane Dispatcher',
      is_active: true,
      role: mockState.role,
    },
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}))

function renderLayout() {
  return render(
    <ToastProvider>
      <ForensicModeProvider>
        <SettingsLayout />
      </ForensicModeProvider>
    </ToastProvider>,
  )
}

function sectionNav() {
  return screen.getByRole('navigation', { name: 'Settings sections' })
}

beforeEach(() => {
  window.localStorage.clear()
  mockState.role = 'dispatcher'
  mockState.query = ''
})

describe('SettingsLayout section list', () => {
  it('lists Account and Display for a regular dispatcher, without Forensic view', () => {
    renderLayout()

    const links = within(sectionNav()).getAllByRole('link').map(link => link.textContent)
    expect(links).toEqual(['Account', 'Display'])
  })

  it('adds Forensic view for an admin dispatcher', () => {
    mockState.role = 'admin_dispatcher'
    renderLayout()

    const links = within(sectionNav()).getAllByRole('link').map(link => link.textContent)
    expect(links).toEqual(['Account', 'Display', 'Forensic view'])
  })

  it('links each entry to its own addressable section', () => {
    renderLayout()

    expect(within(sectionNav()).getByRole('link', { name: 'Display' }))
      .toHaveAttribute('href', ROUTES.settingsSection('display'))
  })
})

describe('SettingsLayout open section', () => {
  it('opens Account when the URL names no section', () => {
    renderLayout()

    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(within(sectionNav()).getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Jane Dispatcher')).toBeInTheDocument()
  })

  it('opens the section a deep link names and marks only it as current', () => {
    mockState.query = 'section=display'
    renderLayout()

    expect(screen.getByRole('heading', { name: 'Display' })).toBeInTheDocument()
    expect(screen.getByLabelText('Landing page')).toBeInTheDocument()
    expect(within(sectionNav()).getByRole('link', { name: 'Display' })).toHaveAttribute('aria-current', 'page')
    expect(within(sectionNav()).getByRole('link', { name: 'Account' })).not.toHaveAttribute('aria-current')
  })

  it('opens the forensic section for an admin', () => {
    mockState.role = 'admin_dispatcher'
    mockState.query = 'section=forensic'
    renderLayout()

    expect(screen.getByRole('heading', { name: 'Forensic view' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Forensic mode' })).toBeInTheDocument()
  })

  it('falls back to Account when a regular dispatcher follows an admin link', () => {
    mockState.query = 'section=forensic'
    renderLayout()

    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Forensic mode' })).not.toBeInTheDocument()
  })

  it('falls back to Account for an unknown section', () => {
    mockState.query = 'section=nonsense'
    renderLayout()

    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
  })
})
