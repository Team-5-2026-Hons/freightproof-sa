import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PackError } from '@/lib/api'
import { PasswordGate } from './PasswordGate'

const verifyPassword = vi.fn()
const storageBlocked = vi.fn(() => false)
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  verifyPassword: (token: string, password: string) => verifyPassword(token, password),
  storageBlocked: () => storageBlocked(),
}))

const HINT = 'j***@santam.example'

beforeEach(() => {
  verifyPassword.mockReset()
  storageBlocked.mockReset()
  storageBlocked.mockReturnValue(false)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PasswordGate', () => {
  it('shows the masked inbox and never calls verify on its own — nothing is sent from here', () => {
    // Act
    render(<PasswordGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Assert
    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(verifyPassword).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Open pack' })).toBeDisabled()
  })

  it('enables Open pack once a password is typed, and submits it', async () => {
    // Arrange
    const user = userEvent.setup()
    const onVerified = vi.fn()
    verifyPassword.mockResolvedValue(undefined)
    render(<PasswordGate token="tok" emailHint={HINT} onVerified={onVerified} />)

    // Act
    await user.type(screen.getByLabelText('Password'), 'sWordf1sh')
    await user.click(screen.getByRole('button', { name: 'Open pack' }))

    // Assert
    expect(verifyPassword).toHaveBeenCalledWith('tok', 'sWordf1sh')
    expect(onVerified).toHaveBeenCalled()
  })

  it('shows the server’s reason for a wrong password and lets the recipient retry', async () => {
    // Arrange
    const user = userEvent.setup()
    const onVerified = vi.fn()
    verifyPassword.mockRejectedValue(new PackError(400, 'That password is not right. Check the email and try again.'))
    render(<PasswordGate token="tok" emailHint={HINT} onVerified={onVerified} />)
    await user.type(screen.getByLabelText('Password'), 'wrong-one')

    // Act
    await user.click(screen.getByRole('button', { name: 'Open pack' }))

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not right')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('shows the lockout message and lets the field be retried later', async () => {
    // Arrange
    const user = userEvent.setup()
    verifyPassword.mockRejectedValue(new PackError(400, 'Too many wrong attempts. Try again in a few minutes.'))
    render(<PasswordGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)
    await user.type(screen.getByLabelText('Password'), 'wrong-one')

    // Act
    await user.click(screen.getByRole('button', { name: 'Open pack' }))

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many wrong attempts')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('tells the recipient once the browser is known to block site storage', () => {
    // Arrange
    storageBlocked.mockReturnValue(true)

    // Act
    render(<PasswordGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Assert
    expect(screen.getByText('This browser blocks site storage, so you may be asked for a code again next time.')).toBeInTheDocument()
  })

  it('says nothing about storage when it works', () => {
    // Act
    render(<PasswordGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Assert
    expect(screen.queryByText(/blocks site storage/)).not.toBeInTheDocument()
  })

  it('gives Open pack a 44 px tap target', () => {
    // Act
    render(<PasswordGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Assert
    expect(screen.getByRole('button', { name: 'Open pack' })).toHaveClass('min-h-11')
  })
})
