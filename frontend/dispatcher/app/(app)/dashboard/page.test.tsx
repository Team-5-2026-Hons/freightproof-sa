import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DashboardPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { fmtSastDateParts } from '@shared/lib/utils/datetime'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

const auth = vi.hoisted(() => ({
  user: { id: 'me', role: 'admin_dispatcher', organization_name: 'Linbro Express' as string | undefined },
}))
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: auth.user }),
}))

const notify = vi.fn()
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify }),
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

vi.mock('@/components/dashboard/DashboardTripsPanel', () => ({ DashboardTripsPanel: () => <section aria-label="Active trips" /> }))
// The summary panels have their own tests; stubbed here so this file's row queries stay about trips.
vi.mock('@/components/dashboard/DashboardExceptionsPanel', () => ({ DashboardExceptionsPanel: () => <section aria-label="Exceptions" /> }))
vi.mock('@/components/dashboard/DashboardIncidentsPanel', () => ({ DashboardIncidentsPanel: () => <section aria-label="Incidents" /> }))

function renderPage() {
  return render(<ForensicModeProvider><DashboardPage /></ForensicModeProvider>)
}

beforeEach(() => {
  push.mockReset()
  notify.mockReset()
})

describe('Dashboard layout', () => {
  it('shows the active-trips, exceptions and incidents panels beneath the active-trips trips', () => {
    renderPage()

    const regions = screen.getAllByRole('region').map(region => region.getAttribute('aria-label'))
    expect(regions).toEqual(['Active trips', 'Exceptions', 'Incidents'])
  })
})

describe('Dashboard subtitle', () => {
  beforeEach(() => {
  })

  it("names the signed-in dispatcher's own organisation after the SAST date", () => {
    auth.user.organization_name = 'Linbro Express'

    renderPage()

    expect(screen.getByText(/ · Linbro Express$/)).toBeInTheDocument()
  })

  it('moves to the next SAST day while the page stays open, without waiting for new data', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    // 21:59:30Z is 23:59:30 SAST on 6 Oct.
    vi.setSystemTime(new Date('2026-10-06T21:59:30Z'))
    try {
      renderPage()
      expect(screen.getByText(/^06 Oct 2026 · /)).toBeInTheDocument()

      act(() => { vi.advanceTimersByTime(60_000) })

      expect(screen.getByText(/^07 Oct 2026 · /)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops the separator when the organisation name is not known', () => {
    auth.user.organization_name = undefined

    renderPage()

    const day = fmtSastDateParts(new Date().toISOString())?.day ?? ''
    expect(screen.getByText(day)).toBeInTheDocument()
  })
})

describe('Dashboard header', () => {
  it('offers one New Trip button, in the page header, that opens the new-trip form', () => {
    renderPage()

    const buttons = screen.getAllByRole('button', { name: 'New Trip' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/trips/new')
  })
})
