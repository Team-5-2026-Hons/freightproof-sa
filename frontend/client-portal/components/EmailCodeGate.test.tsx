import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PackError } from '@/lib/api'
import { EmailCodeGate } from './EmailCodeGate'

const requestEmailCode = vi.fn()
const verifyEmailCode = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  requestEmailCode: (token: string) => requestEmailCode(token),
  verifyEmailCode: (token: string, code: string) => verifyEmailCode(token, code),
}))

const HINT = 'j***@santam.example'

beforeEach(() => {
  requestEmailCode.mockReset()
  verifyEmailCode.mockReset()
})

describe('EmailCodeGate', () => {
  it('does not send a code until asked — a link preview must not spend one', () => {
    // Act
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Assert
    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(requestEmailCode).not.toHaveBeenCalled()
  })

  it('keeps Open pack disabled until six digits are entered, and drops non-digits', async () => {
    // Arrange
    const user = userEvent.setup()
    requestEmailCode.mockResolvedValue({ email_hint: HINT })
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))
    const input = await screen.findByLabelText('6-digit code')

    // Act
    await user.type(input, '04a82')

    // Assert
    expect(input).toHaveValue('0482')
    expect(screen.getByRole('button', { name: 'Open pack' })).toBeDisabled()
  })

  it('shows the server’s reason for a wrong code and lets the recipient retry', async () => {
    // Arrange
    const user = userEvent.setup()
    const onVerified = vi.fn()
    requestEmailCode.mockResolvedValue({ email_hint: HINT })
    verifyEmailCode.mockRejectedValue(new PackError(400, 'That code is not right. Check the email and try again.'))
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={onVerified} />)
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))
    await user.type(await screen.findByLabelText('6-digit code'), '000000')

    // Act
    await user.click(screen.getByRole('button', { name: 'Open pack' }))

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right')
    expect(screen.getByLabelText('6-digit code')).toHaveValue('')
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('stays on the code entry when a code was already sent moments ago (429)', async () => {
    // Arrange
    const user = userEvent.setup()
    requestEmailCode.mockRejectedValue(new PackError(429, 'A code was sent a moment ago. Check your inbox, or try again shortly.'))
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Act
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))

    // Assert
    expect(await screen.findByLabelText('6-digit code')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('A code was sent a moment ago')
  })

  it('says so when the code cannot be sent (503) and offers to try again', async () => {
    // Arrange
    const user = userEvent.setup()
    requestEmailCode.mockRejectedValue(new PackError(503, 'We couldn’t send the code just now. Try again in a few minutes.'))
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Act
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t send the code')
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeEnabled()
  })
})
