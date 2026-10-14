import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SignOutSheet } from '../SignOutSheet'

describe('SignOutSheet', () => {
  it('test_explains_the_consequence_before_signing_out', () => {
    render(<SignOutSheet open onClose={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByText(/new code by SMS/)).toBeInTheDocument()
  })

  it('test_sign_out_confirms_once', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<SignOutSheet open onClose={vi.fn()} onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
  })

  it('test_cancel_closes_without_signing_out', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<SignOutSheet open onClose={onClose} onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('test_sign_out_uses_the_solid_destructive_style', () => {
    render(<SignOutSheet open onClose={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Sign Out' })).toHaveClass('bg-error')
  })
})
