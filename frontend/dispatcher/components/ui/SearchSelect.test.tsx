import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SearchSelect, type SearchSelectOption } from './SearchSelect'

const OPTIONS: SearchSelectOption[] = [
  { value: 'free', label: 'CA 123 456' },
  { value: 'busy', label: 'CA 441 892', disabled: true, note: 'On TRP-0038 · free after Fri 16 Oct, 16:00' },
]

function open(onChange = vi.fn()): ReturnType<typeof vi.fn> {
  render(<SearchSelect options={OPTIONS} value="" onChange={onChange} placeholder="Select horse…" />)
  fireEvent.click(screen.getByRole('button', { name: 'Select horse…' }))
  return onChange
}

describe('SearchSelect', () => {
  it('still picks an ordinary option', () => {
    const onChange = open()

    fireEvent.click(screen.getByRole('button', { name: /CA 123 456/ }))

    expect(onChange).toHaveBeenCalledWith('free')
  })

  it('shows a disabled option with its note, but will not pick it', () => {
    const onChange = open()
    const busy = screen.getByRole('button', { name: /CA 441 892/ })

    fireEvent.click(busy)
    fireEvent.keyDown(busy, { key: 'Enter' })

    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveTextContent('On TRP-0038 · free after Fri 16 Oct, 16:00')
    expect(onChange).not.toHaveBeenCalled()
  })
})
