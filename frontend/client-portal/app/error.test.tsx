import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ErrorPage from './error'
import NotFound from './not-found'

afterEach(() => vi.restoreAllMocks())

describe('error boundary', () => {
  it('says something went wrong and lets the reader try again', async () => {
    const user = userEvent.setup()
    const reset = vi.fn()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(<ErrorPage error={new Error('boom')} reset={reset} />)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByRole('heading', { name: 'Something went wrong displaying this pack' })).toBeInTheDocument()
    expect(reset).toHaveBeenCalledOnce()
  })

  it('logs the error it caught', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = new Error('boom')

    render(<ErrorPage error={error} reset={vi.fn()} />)

    expect(warn).toHaveBeenCalledWith(expect.any(String), error)
  })
})

describe('not-found page', () => {
  it('points the reader back to the link they were sent', () => {
    render(<NotFound />)

    expect(screen.getByRole('heading', { name: 'This page does not exist' })).toBeInTheDocument()
    expect(screen.getByText(/link the transport operator sent you/)).toBeInTheDocument()
  })
})
