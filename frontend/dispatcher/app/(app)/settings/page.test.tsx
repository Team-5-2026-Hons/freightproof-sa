import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { ToastProvider } from '@/lib/context/ToastContext'
import { readPreferences } from '@/lib/preferences'

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

function renderSettings() {
  return render(
    <ToastProvider>
      <ForensicModeProvider>
        <SettingsPage />
      </ForensicModeProvider>
    </ToastProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  mockState.role = 'dispatcher'
  mockState.query = ''
})

describe('SettingsPage', () => {
  it('opens on the account with its title bar', () => {
    renderSettings()

    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Jane Dispatcher')).toBeInTheDocument()
    expect(screen.getByText('Linbro Express')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument()
  })
})

describe('SettingsPage forensic view', () => {
  it('lets an admin switch forensic mode on and persists it', async () => {
    const user = userEvent.setup()
    mockState.role = 'admin_dispatcher'
    mockState.query = 'section=forensic'
    renderSettings()

    const toggle = screen.getByRole('switch', { name: 'Forensic mode' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(window.localStorage.getItem('fp.forensicOn')).toBe('true')
  })

  it('gives a regular dispatcher no forensic control, even by deep link', () => {
    mockState.query = 'section=forensic'
    renderSettings()

    expect(screen.queryByRole('switch', { name: 'Forensic mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Forensic view' })).not.toBeInTheDocument()
  })
})

describe('SettingsPage display preferences', () => {
  beforeEach(() => {
    mockState.query = 'section=display'
  })

  it('saves the landing page a dispatcher picks', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.selectOptions(screen.getByLabelText('Landing page'), 'exceptions')

    expect(readPreferences().landingPage).toBe('exceptions')
  })

  it('saves rows per page and keeps the landing page already chosen', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.selectOptions(screen.getByLabelText('Landing page'), 'history')
    await user.selectOptions(screen.getByLabelText('Rows per page'), '50')

    expect(readPreferences()).toEqual({ landingPage: 'history', rowsPerPage: 50 })
  })

  it('shows the stored choices on arrival', () => {
    window.localStorage.setItem('fp.preferences.v1', JSON.stringify({ landingPage: 'history', rowsPerPage: 100 }))
    renderSettings()

    expect(screen.getByLabelText('Landing page')).toHaveValue('history')
    expect(screen.getByLabelText('Rows per page')).toHaveValue('100')
  })

  it('resets saved column widths and says how many tables were cleared', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('table-widths:v1:history', '{"a":300}')
    window.localStorage.setItem('table-widths:v1:exceptions', '{"a":300}')
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Reset column widths' }))

    expect(window.localStorage.getItem('table-widths:v1:history')).toBeNull()
    expect(await screen.findByText('Column widths reset on 2 tables')).toBeInTheDocument()
  })

  it('says so when there was nothing to reset', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Reset column widths' }))

    expect(await screen.findByText('No saved column widths to reset')).toBeInTheDocument()
  })
})
