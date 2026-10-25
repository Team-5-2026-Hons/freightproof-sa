import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Sidebar } from '../Sidebar'
import { SidebarCollapseProvider } from '@/lib/context/SidebarCollapseContext'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { ROUTES } from '@/lib/constants/routes'

// The collapse behaviour is route-driven (auto-collapse on trip detail), so
// usePathname is mocked at the module boundary with a controllable return value —
// the same approach ConfirmationDetail.test.tsx uses for useAuth.
const mockUsePathname = vi.fn((): string => ROUTES.home)
const mockSignOut = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const mockAuth = vi.hoisted(() => ({
  role: 'dispatcher' as 'dispatcher' | 'admin_dispatcher',
}))

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
      role: mockAuth.role,
    },
    isLoading: false,
    signIn: vi.fn(),
    signOut: mockSignOut,
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
const FORENSIC_STORAGE_KEY = 'fp.forensicOn'

function renderSidebar() {
  return render(
    <ForensicModeProvider>
      <SidebarCollapseProvider>
        <Sidebar mobileOpen={false} onMobileClose={vi.fn()} />
      </SidebarCollapseProvider>
    </ForensicModeProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  mockUsePathname.mockReturnValue(ROUTES.home)
  mockAuth.role = 'dispatcher'
  mockSignOut.mockClear()
})

describe('Sidebar role-based navigation', () => {
  it.each(['dispatcher', 'admin_dispatcher'] as const)('offers parcel search to %s without the retired receipt page', (role) => {
    mockAuth.role = role
    renderSidebar()

    expect(screen.getByRole('link', { name: 'Parcel Search' })).toHaveAttribute('href', ROUTES.parcels)
    expect(screen.queryByRole('link', { name: 'Receipt Lookup' })).not.toBeInTheDocument()
    expect(screen.queryByText('Blockchain')).not.toBeInTheDocument()
  })
})

describe('Sidebar create-trip action', () => {
  it('renders create trip once, outside the navigation landmark', () => {
    renderSidebar()

    const links = screen.getAllByRole('link', { name: 'Create Trip' })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', ROUTES.tripNew)
    expect(screen.getByRole('navigation', { name: 'Primary' })).not.toContainElement(links[0])
  })

  it('keeps create trip reachable from the collapsed rail', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(screen.queryByText('Create Trip')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create Trip' }))
      .toHaveAttribute('href', ROUTES.tripNew)
  })

  it('marks create trip as the current page on its route', () => {
    mockUsePathname.mockReturnValue(ROUTES.tripNew)
    renderSidebar()

    expect(screen.getByRole('link', { name: 'Create Trip' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('Sidebar active state', () => {
  it('marks only the link for the current route with aria-current', () => {
    mockUsePathname.mockReturnValue(ROUTES.history)
    renderSidebar()

    expect(screen.getByRole('link', { name: 'Trip History' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })
})

describe('Sidebar Active Trips item', () => {
  it('links to the active trips list, above Trip History', () => {
    renderSidebar()

    const links = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link').map(l => l.getAttribute('aria-label'))
    expect(screen.getByRole('link', { name: 'Active Trips' })).toHaveAttribute('href', ROUTES.trips)
    expect(links.indexOf('Active Trips')).toBeLessThan(links.indexOf('Trip History'))
  })

  it('is current on /trips', () => {
    mockUsePathname.mockReturnValue(ROUTES.trips)
    renderSidebar()

    expect(screen.getByRole('link', { name: 'Active Trips' })).toHaveAttribute('aria-current', 'page')
  })

  it.each([ROUTES.tripNew, ROUTES.tripDetail('abc')])('is not current on %s', (path) => {
    mockUsePathname.mockReturnValue(path)
    renderSidebar()

    expect(screen.getByRole('link', { name: 'Active Trips' })).not.toHaveAttribute('aria-current')
  })
})

describe('Sidebar profile footer', () => {
  it('shows initials, name and role, with the live status on its own element', () => {
    renderSidebar()

    expect(screen.getByText('JD')).toBeInTheDocument()
    expect(screen.getByText('Jane Dispatcher')).toBeInTheDocument()
    expect(screen.getByText('Dispatcher')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Live')
  })

  it('shows the admin role in words instead of a badge', () => {
    mockAuth.role = 'admin_dispatcher'
    renderSidebar()

    expect(screen.getByText('Admin Dispatcher')).toBeInTheDocument()
    expect(screen.queryByText('ADMIN')).not.toBeInTheDocument()
  })

  it('keeps the live status in the collapsed rail and drops the name', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(screen.queryByText('Jane Dispatcher')).not.toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('title', 'Live updates connected')
  })
})

describe('Sidebar forensic indicator', () => {
  const PILL = 'Forensic view is on. Open its setting'

  it('shows a pill that opens the forensic section when an admin has the mode on', () => {
    mockAuth.role = 'admin_dispatcher'
    window.localStorage.setItem(FORENSIC_STORAGE_KEY, 'true')
    renderSidebar()

    const pill = screen.getByRole('link', { name: PILL })
    expect(pill).toHaveTextContent('Forensic')
    expect(pill).toHaveAttribute('href', ROUTES.settingsSection('forensic'))
  })

  it('keeps the Settings row itself pointing at Settings, beside the pill', () => {
    mockAuth.role = 'admin_dispatcher'
    window.localStorage.setItem(FORENSIC_STORAGE_KEY, 'true')
    renderSidebar()

    const row = screen.getByRole('link', { name: 'Settings' })
    expect(row).toHaveAttribute('href', ROUTES.settings)
    // Anchors cannot nest, so the pill is a sibling of the row, not inside it.
    expect(row).not.toContainElement(screen.getByRole('link', { name: PILL }))
  })

  it('shows no pill when an admin has forensic mode off', () => {
    mockAuth.role = 'admin_dispatcher'
    renderSidebar()

    expect(screen.queryByRole('link', { name: PILL })).not.toBeInTheDocument()
  })

  it('shows no pill to a regular dispatcher even with a stale stored switch', () => {
    // A demoted admin keeps `fp.forensicOn` in their browser; the mode is no longer theirs.
    window.localStorage.setItem(FORENSIC_STORAGE_KEY, 'true')
    renderSidebar()

    expect(screen.queryByRole('link', { name: PILL })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('keeps the signal in the collapsed rail as a dot on the Settings row', async () => {
    const user = userEvent.setup()
    mockAuth.role = 'admin_dispatcher'
    window.localStorage.setItem(FORENSIC_STORAGE_KEY, 'true')
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(screen.queryByRole('link', { name: PILL })).not.toBeInTheDocument()
    const settings = screen.getByRole('link', { name: 'Settings, forensic view on' })
    expect(settings).toHaveAttribute('href', ROUTES.settings)
  })
})

describe('Sidebar navigation', () => {
  it('links a regular dispatcher to analytics', () => {
    // The analytics endpoints take any dispatcher (get_current_dispatcher, not
    // require_admin_dispatcher), so this entry is never hidden.
    renderSidebar()

    expect(screen.getByRole('link', { name: 'Analytics' }))
      .toHaveAttribute('href', ROUTES.analytics)
  })

  it('links to the exceptions queue', () => {
    // Hidden in 6071ab2 as "not yet live", when the page was mock data behind a route.
    // It is live now — FP-146 gave it a real org-scoped list, detail and resolve — and a
    // triage queue a dispatcher cannot reach from the nav is a queue nobody works.
    renderSidebar()

    expect(screen.getByRole('link', { name: 'Exceptions' }))
      .toHaveAttribute('href', ROUTES.exceptions)
  })

  it('keeps the exceptions link reachable from the collapsed rail', async () => {
    // NavLink carries an aria-label so the icon-only rail stays navigable. Asserted
    // because this is the one nav entry a dispatcher reaches for mid-incident.
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(screen.queryByText('Exceptions')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Exceptions' }))
      .toHaveAttribute('href', ROUTES.exceptions)
  })
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
    mockUsePathname.mockReturnValue(ROUTES.home)
    const { rerender } = renderSidebar()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()

    mockUsePathname.mockReturnValue(ROUTES.tripDetail('trip-123'))
    rerender(
      <ForensicModeProvider>
        <SidebarCollapseProvider>
          <Sidebar mobileOpen={false} onMobileClose={vi.fn()} />
        </SidebarCollapseProvider>
      </ForensicModeProvider>,
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
    mockUsePathname.mockReturnValue(ROUTES.home)
    rerender(
      <ForensicModeProvider>
        <SidebarCollapseProvider>
          <Sidebar mobileOpen={false} onMobileClose={vi.fn()} />
        </SidebarCollapseProvider>
      </ForensicModeProvider>,
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('keeps the saved preference intact through a route-driven auto-collapse', async () => {
    const user = userEvent.setup()
    mockUsePathname.mockReturnValue(ROUTES.home)
    const { rerender } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)).toBe('true')

    mockUsePathname.mockReturnValue(ROUTES.tripDetail('trip-123'))
    rerender(
      <ForensicModeProvider>
        <SidebarCollapseProvider>
          <Sidebar mobileOpen={false} onMobileClose={vi.fn()} />
        </SidebarCollapseProvider>
      </ForensicModeProvider>,
    )
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)).toBe('true')

    mockUsePathname.mockReturnValue(ROUTES.home)
    rerender(
      <ForensicModeProvider>
        <SidebarCollapseProvider>
          <Sidebar mobileOpen={false} onMobileClose={vi.fn()} />
        </SidebarCollapseProvider>
      </ForensicModeProvider>,
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

describe('Sidebar profile menu', () => {
  const trigger = () => screen.getByRole('button', { name: /Jane Dispatcher/ })

  it('is closed until the profile row is pressed', () => {
    renderSidebar()

    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('offers View profile, pointing at Settings > Account, and Log out', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(trigger())

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')).toHaveLength(2)
    expect(screen.getByRole('menuitem', { name: 'View profile' }))
      .toHaveAttribute('href', ROUTES.settingsSection('account'))
  })

  it('signs out straight away from Log out and closes the menu', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape, returning focus to the profile row, and on an outside click', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(trigger())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()

    await user.click(trigger())
    await user.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('is still reachable from the collapsed rail', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    await user.click(screen.getByRole('button', { name: 'Jane Dispatcher, account menu' }))

    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument()
  })
})
