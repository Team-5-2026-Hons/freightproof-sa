// app/error.test.tsx
//
// The last-resort screen: it has to offer a retry, and it must never print the error, whose
// message could quote the capability-token URL.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorPage from './error'
import NotFound from './not-found'

describe('ErrorPage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('offers "Try again", which calls reset', async () => {
    const reset = vi.fn()
    render(<ErrorPage error={new Error('boom')} reset={reset} />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('does not show the error message, and logs only its name and digest', () => {
    const error = Object.assign(new Error('failed at /h/secret-capability-token'), { digest: 'abc123' })

    render(<ErrorPage error={error} reset={vi.fn()} />)

    expect(screen.queryByText(/secret-capability-token/)).not.toBeInTheDocument()
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('secret-capability-token')
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), 'Error', 'abc123')
  })
})

describe('NotFound', () => {
  afterEach(() => {
    cleanup()
  })

  it('says the page does not exist and links nowhere', () => {
    render(<NotFound />)

    expect(screen.getByRole('heading', { name: /this page doesn.t exist/i })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
