import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PackError } from '@/lib/api'
import { EmailCodeGate } from './EmailCodeGate'

const requestEmailCode = vi.fn()
const verifyEmailCode = vi.fn()
const storageBlocked = vi.fn(() => false)
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  requestEmailCode: (token: string) => requestEmailCode(token),
  verifyEmailCode: (token: string, code: string) => verifyEmailCode(token, code),
  storageBlocked: () => storageBlocked(),
}))

const HINT = 'j***@santam.example'
// The backend's two different 429 bodies (email_codes.py vs core/rate_limit.py).
const CODE_ALREADY_SENT = 'A code was sent a moment ago. Check your inbox, or try again shortly.'
const GENERIC_RATE_LIMIT = 'Too many requests. Please slow down and try again shortly.'

beforeEach(() => {
  requestEmailCode.mockReset()
  verifyEmailCode.mockReset()
  storageBlocked.mockReset()
  storageBlocked.mockReturnValue(false)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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

describe('EmailCodeGate — the two kinds of 429', () => {
  it('stays on the start screen, with the server message and a visible wait, for the generic rate limit', async () => {
    // Arrange
    const user = userEvent.setup()
    requestEmailCode.mockRejectedValue(new PackError(429, GENERIC_RATE_LIMIT))
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Act
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))

    // Assert: no code box — no code is on its way — and no instant retry either.
    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_RATE_LIMIT)
    expect(screen.queryByLabelText('6-digit code')).not.toBeInTheDocument()
    expect(screen.getByText('Try again in about a minute.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeDisabled()
  })

  it('shows the code box when the 429 says a code was already sent', async () => {
    // Arrange
    const user = userEvent.setup()
    requestEmailCode.mockRejectedValue(new PackError(429, CODE_ALREADY_SENT))
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Act
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))

    // Assert
    expect(await screen.findByLabelText('6-digit code')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(CODE_ALREADY_SENT)
  })

  it('lets the recipient who is already entering a code keep the box when a resend is rate limited', async () => {
    // Arrange
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    requestEmailCode.mockResolvedValueOnce({ email_hint: HINT }).mockRejectedValueOnce(new PackError(429, GENERIC_RATE_LIMIT))
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))
    await screen.findByLabelText('6-digit code')
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    // Act
    await user.click(screen.getByRole('button', { name: 'Send a new code' }))

    // Assert: the earlier code is still the live one, so its box stays.
    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_RATE_LIMIT)
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument()
  })
})

describe('EmailCodeGate — resend cooldown', () => {
  it('disables "Send a new code" for a minute after a code is sent, then re-enables it', async () => {
    // Arrange
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    requestEmailCode.mockResolvedValue({ email_hint: HINT })
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Act
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))
    await screen.findByLabelText('6-digit code')

    // Assert: cooling down...
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeDisabled()
    expect(screen.getByText(/ask for another code in about a minute/)).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000) })
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeDisabled()

    // ...then free after the full cooldown.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled()
    expect(screen.queryByText(/ask for another code in about a minute/)).not.toBeInTheDocument()
  })

  it('does not impose a cooldown when the code could not be sent at all (503)', async () => {
    // Arrange
    const user = userEvent.setup()
    requestEmailCode.mockRejectedValue(new PackError(503, 'We couldn’t send the code just now. Try again in a few minutes.'))
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Act
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))

    // Assert
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeEnabled()
    expect(screen.queryByText('Try again in about a minute.')).not.toBeInTheDocument()
  })

  it('does not set a timer that outlives the screen', async () => {
    // Arrange
    const user = userEvent.setup()
    const clear = vi.spyOn(window, 'clearTimeout')
    requestEmailCode.mockResolvedValue({ email_hint: HINT })
    const { unmount } = render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))
    await screen.findByLabelText('6-digit code')

    // Act
    unmount()

    // Assert
    expect(clear).toHaveBeenCalled()
  })
})

describe('EmailCodeGate — storage and tap targets', () => {
  it('tells the recipient once the browser is known to block site storage', () => {
    // Arrange
    storageBlocked.mockReturnValue(true)

    // Act
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Assert
    expect(screen.getByText('This browser blocks site storage, so you may be asked for a code again next time.')).toBeInTheDocument()
  })

  it('says nothing about storage when it works', () => {
    // Act
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)

    // Assert
    expect(screen.queryByText(/blocks site storage/)).not.toBeInTheDocument()
  })

  it('gives every button a 44 px tap target', async () => {
    // Arrange
    const user = userEvent.setup()
    requestEmailCode.mockResolvedValue({ email_hint: HINT })
    render(<EmailCodeGate token="tok" emailHint={HINT} onVerified={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Email me a code' })).toHaveClass('min-h-11')

    // Act
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))
    await screen.findByLabelText('6-digit code')

    // Assert
    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('min-h-11')
  })
})
