import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Sidebar } from '../Sidebar'
import { SidebarCollapseProvider } from '@/lib/context/SidebarCollapseContext'
import { ROUTES } from '@/lib/constants/routes'

// The collapse behaviour is route-driven (auto-collapse on trip detail), so
// usePathname is mocked at the module boundary with a controllable return value —
// the same approach ConfirmationDetail.test.tsx uses for useAuth.
const mockUsePathname = vi.fn(() => '/')
vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      organization_id: 'org-1',
      email: 'jane@freightproof.test',
      full_name: 'Jane Dispatcher',
      is_active: true,
      role: 'dispatcher',
    },
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}))

// LiveBadge pulls in RealtimeProvider, whose module graph reaches the real Supabase
// client (lib/api/client -> lib/supabase/client), which throws at import time without
// env vars configured for the test runner. Mock it at the module boundary — this suite
// is about sidebar collapse behaviour, not the realtime connection status.
vi.mock('@/lib/realtime/RealtimeProvider', () => ({
  useRealtimeStatus: () => 'live',
}))

const SIDEBAR_COLLAPSE_STORAGE_KEY = 'fp.sidebarCollapsed'

function renderSidebar() {
  return render(
    <SidebarCollapseProvider>
      <Sidebar mobileOpen={false} onMobileClose={vi.fn()} />
    </SidebarCollapseProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  mockUsePathname.mockReturnValue('/')
})

describe('Sidebar collapse', () => {
  it('toggling collapses and expands, hiding and restoring label text', async () => {
    const user = userEvent.setup()
    renderSidebar()

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    const collapseButton = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true')

    await user.click(collapseButton)

    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
    const expandButton = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(expandButton).toHaveAttribute('aria-expanded', 'false')

    await user.click(expandButton)

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('writes the toggle to localStorage and reads it back on remount', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)).toBe('true')
    unmount()

    renderSidebar()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('collapses automatically when navigating to a trip detail page', () => {
    mockUsePathname.mockReturnValue('/')
    const { rerender } = renderSidebar()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()

    mockUsePathname.mockReturnValue(ROUTES.tripDetail('trip-123'))
    rerender(
      <SidebarCollapseProvider>
        <Sidebar mobileOpen={false} onMobileClose={vi.fn()} />
      </SidebarCollapseProvider>,
    )

    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('does not auto-collapse for the create-trip route', () => {
    mockUsePathname.mockReturnValue(ROUTES.tripNew)
    renderSidebar()

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
  })

  it('lets a manual expand on a trip detail page win for that visit without touching the saved preference', async () => {
    const user = userEvent.setup()
    mockUsePathname.mockReturnValue(ROUTES.tripDetail('trip-123'))
    const { rerender } = renderSidebar()

    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)).toBeNull()

    // Navigating away reverts to the untouched (default expanded) preference.
    mockUsePathname.mockReturnValue('/')
    rerender(
      <SidebarCollapseProvider>
        <Sidebar mobileOpen={false} onMobileClose={vi.fn()} />
      </SidebarCollapseProvider>,
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('keeps the saved preference intact through a route-driven auto-collapse', async () => {
    const user = userEvent.setup()
    mockUsePathname.mockReturnValue('/')
    const { rerender } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)).toBe('true')

    mockUsePathname.mockReturnValue(ROUTES.tripDetail('trip-123'))
    rerender(
      <SidebarCollapseProvider>
        <Sidebar mobileOpen={false} onMobileClose={vi.fn()} />
      </SidebarCollapseProvider>,
    )
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)).toBe('true')

    mockUsePathname.mockReturnValue('/')
    rerender(
      <SidebarCollapseProvider>
        <Sidebar mobileOpen={false} onMobileClose={vi.fn()} />
      </SidebarCollapseProvider>,
    )
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)).toBe('true')
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('does not crash when localStorage throws', async () => {
    const user = userEvent.setup()
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => renderSidebar()).not.toThrow()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalled()

    getItemSpy.mockRestore()
    setItemSpy.mockRestore()
    warnSpy.mockRestore()
  })
})
