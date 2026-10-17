import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountDetails } from './AccountDetails'
import type { DispatcherUser, UserId } from '@/lib/types/user'

const USER_ID = '3f1c8b2a-0d4e-4c55-9a77-1b2c3d4e5f60'
const ORG_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

function makeUser(overrides: Partial<DispatcherUser> = {}): DispatcherUser {
  return {
    id: USER_ID as UserId,
    organization_id: ORG_ID,
    organization_name: 'Linbro Express',
    email: 'jane@linbroexpress.test',
    full_name: 'Jane Dispatcher',
    is_active: true,
    role: 'dispatcher',
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AccountDetails', () => {
  it('shows who the dispatcher is, using the organisation name rather than its id', () => {
    render(<AccountDetails user={makeUser()} onSignOut={vi.fn()} />)

    expect(screen.getByText('Jane Dispatcher')).toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
    expect(screen.getByText('jane@linbroexpress.test')).toBeInTheDocument()
    expect(screen.getByText('Linbro Express')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('names the regular role and says the forensic view is not theirs', () => {
    render(<AccountDetails user={makeUser()} onSignOut={vi.fn()} />)

    expect(screen.getByText('Dispatcher')).toBeInTheDocument()
    expect(screen.getByText(/limited to admin dispatchers/)).toBeInTheDocument()
  })

  it('names the admin role and what it adds', () => {
    render(<AccountDetails user={makeUser({ role: 'admin_dispatcher' })} onSignOut={vi.fn()} />)

    expect(screen.getByText('Admin Dispatcher')).toBeInTheDocument()
    expect(screen.getByText(/plus the forensic view/)).toBeInTheDocument()
  })

  it('flags a deactivated account instead of showing it as active', () => {
    render(<AccountDetails user={makeUser({ is_active: false })} onSignOut={vi.fn()} />)

    expect(screen.getByText('Deactivated')).toBeInTheDocument()
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })

  it('shows both reference ids in full', () => {
    render(<AccountDetails user={makeUser()} onSignOut={vi.fn()} />)

    expect(screen.getByText(USER_ID)).toBeInTheDocument()
    expect(screen.getByText(ORG_ID)).toBeInTheDocument()
  })

  it('copies the user id and confirms it', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<AccountDetails user={makeUser()} onSignOut={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Copy User ID' }))

    expect(writeText).toHaveBeenCalledWith(USER_ID)
    expect(await screen.findByText('User ID copied')).toBeInTheDocument()
  })

  it('says so when the clipboard refuses, rather than claiming success', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('insecure context'))
    render(<AccountDetails user={makeUser()} onSignOut={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Copy Organisation ID' }))

    expect(await screen.findByText('Could not copy Organisation ID')).toBeInTheDocument()
    expect(screen.queryByText('Organisation ID copied')).not.toBeInTheDocument()
  })

  it('signs out from the button at the foot of the card', async () => {
    const user = userEvent.setup()
    const onSignOut = vi.fn()
    render(<AccountDetails user={makeUser()} onSignOut={onSignOut} />)

    await user.click(screen.getByRole('button', { name: 'Sign Out' }))

    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
