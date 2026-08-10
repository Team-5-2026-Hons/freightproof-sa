import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProfilePanel } from '../ProfilePanel'
import { ROUTES } from '@/lib/constants/routes'

// Referenced from mock factories via closures that only run at render time,
// so plain module-level declarations are safe (same pattern as the panic page tests).
const mockSignOut = vi.fn()
const mockRouterReplace = vi.fn()

const mockUser = {
  id: 'a3f1c9d2-7b64-4e0a-9c11-2f8d5e6a1b23',
  full_name: 'Sipho Dlamini',
  license_number: 'DL-998877',
  phone_number: '+27 82 000 0000',
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, signOut: mockSignOut }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockSignOut.mockResolvedValue(undefined)
})

function renderPanel() {
  render(<ProfilePanel open onClose={vi.fn()} />)
}

// Modal now rebuilds on Radix Dialog, whose Content carries role="dialog" — same
// role the parent Drawer's Content uses, so the two are disambiguated by their
// Radix-wired accessible name (from DialogPrimitive.Title) rather than by tag.
function getConfirmDialog(): HTMLElement {
  return screen.getByRole('dialog', { name: /log out\?/i })
}

describe('ProfilePanel logout confirmation', () => {
  it('opens a confirmation modal instead of signing out immediately', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /log out/i }))

    expect(screen.getByText(/new OTP to sign back in/i)).toBeInTheDocument()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('cancel dismisses the modal without signing out', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /log out/i }))

    fireEvent.click(within(getConfirmDialog()).getByRole('button', { name: /cancel/i }))

    expect(screen.queryByText(/new OTP to sign back in/i)).not.toBeInTheDocument()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('confirming signs out and redirects to login', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /log out/i }))

    // handleLogout awaits signOut() before closing the modal and redirecting —
    // async act flushes those post-resolve state updates.
    await act(async () => {
      fireEvent.click(within(getConfirmDialog()).getByRole('button', { name: /log out/i }))
    })

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.login)
  })
})
