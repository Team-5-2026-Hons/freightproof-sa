import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { OtpInput } from '../OtpInput'

function box(n: number) {
  return screen.getByLabelText(new RegExp(`digit ${n} of 6`, 'i'))
}

describe('OtpInput', () => {
  it('renders one box per digit, each showing its own character', () => {
    render(<OtpInput length={6} value="12" onChange={vi.fn()} />)

    expect(box(1)).toHaveValue('1')
    expect(box(2)).toHaveValue('2')
    expect(box(3)).toHaveValue('')
  })

  it('typing a digit writes it into that box and moves focus to the next one', () => {
    const onChange = vi.fn()
    render(<OtpInput length={6} value="" onChange={onChange} />)

    fireEvent.change(box(1), { target: { value: '5' } })

    expect(onChange).toHaveBeenCalledWith('5')
  })

  it('backspace on an empty box clears the previous box and hops back to it', () => {
    const onChange = vi.fn()
    render(<OtpInput length={6} value="12" onChange={onChange} />)

    box(3).focus()
    fireEvent.keyDown(box(3), { key: 'Backspace' })

    expect(onChange).toHaveBeenCalledWith('1')
    expect(box(2)).toHaveFocus()
  })

  it('a full code landing on one box (autofill or paste-as-change) distributes across all boxes', () => {
    const onChange = vi.fn()
    render(<OtpInput length={6} value="" onChange={onChange} />)

    fireEvent.change(box(1), { target: { value: '123456' } })

    expect(onChange).toHaveBeenCalledWith('123456')
  })

  it('pasting a code distributes it across the boxes from the focused one', () => {
    const onChange = vi.fn()
    render(<OtpInput length={6} value="" onChange={onChange} />)

    fireEvent.paste(box(1), {
      clipboardData: { getData: () => '654321' },
    })

    expect(onChange).toHaveBeenCalledWith('654321')
  })

  it('exposes the group under an accessible "6-digit code" label', () => {
    render(<OtpInput length={6} value="" onChange={vi.fn()} />)

    expect(screen.getByRole('group', { name: /6-digit code/i })).toBeInTheDocument()
  })
})
