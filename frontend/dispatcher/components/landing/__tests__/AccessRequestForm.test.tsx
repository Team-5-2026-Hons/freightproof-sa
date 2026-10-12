import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AccessRequestForm } from '../AccessRequestForm'

async function fillValid(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Full name'), 'Thandi Mokoena')
  await user.type(screen.getByLabelText('Work email'), 'thandi@carrier.co.za')
  await user.type(screen.getByLabelText('Company'), 'Carrier & Sons')
  await user.type(screen.getByLabelText('Your role'), 'Operations manager')
  await user.selectOptions(screen.getByLabelText('Fleet size'), '11–50 trucks')
}

describe('AccessRequestForm', () => {
  it('submit_empty_form_shows_inline_errors_and_focuses_the_first', async () => {
    const user = userEvent.setup()
    const openMailto = vi.fn()
    render(<AccessRequestForm openMailto={openMailto} />)

    await user.click(screen.getByRole('button', { name: /continue in email/i }))

    expect(openMailto).not.toHaveBeenCalled()
    expect(screen.getByText('Enter your name.')).toBeInTheDocument()
    expect(screen.getByText('Choose your fleet size.')).toBeInTheDocument()
    const name = screen.getByLabelText('Full name')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Enter your name.')
    expect(name).toHaveFocus()
  })

  it('error_clears_as_soon_as_the_field_is_fixed', async () => {
    const user = userEvent.setup()
    render(<AccessRequestForm openMailto={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /continue in email/i }))
    await user.type(screen.getByLabelText('Full name'), 'T')

    expect(screen.queryByText('Enter your name.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'false')
  })

  it('submit_valid_form_hands_off_a_mailto_and_confirms', async () => {
    const user = userEvent.setup()
    const openMailto = vi.fn()
    render(<AccessRequestForm openMailto={openMailto} />)

    await fillValid(user)
    await user.click(screen.getByRole('button', { name: /continue in email/i }))

    expect(openMailto).toHaveBeenCalledTimes(1)
    const url = openMailto.mock.calls[0][0] as string
    expect(url.startsWith('mailto:freightproof@gmail.com?')).toBe(true)
    expect(decodeURIComponent(url)).toContain('Company: Carrier & Sons')
    expect(screen.getByRole('status')).toHaveTextContent('Your email is ready to send')
    expect(screen.getByRole('status')).toHaveTextContent('thandi@carrier.co.za')
  })

  it('edit_after_hand_off_keeps_what_was_typed', async () => {
    const user = userEvent.setup()
    render(<AccessRequestForm openMailto={vi.fn()} />)

    await fillValid(user)
    await user.click(screen.getByRole('button', { name: /continue in email/i }))
    await user.click(screen.getByRole('button', { name: 'Edit the request' }))

    expect(screen.getByLabelText('Company')).toHaveValue('Carrier & Sons')
  })
})
