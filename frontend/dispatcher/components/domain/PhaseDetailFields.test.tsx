import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CopyField } from './PhaseDetailFields'

const writeText = vi.fn<(text: string) => Promise<void>>()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CopyField', () => {
  it('shows "Copied" once the clipboard accepts the value', async () => {
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CopyField label="Hash" value="abc123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await screen.findByText('✓ Copied')).toBeInTheDocument()
  })

  it('never shows "Copied" when the clipboard refuses the write', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeText.mockReset().mockRejectedValue(new Error('NotAllowedError'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CopyField label="Hash" value="abc123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(screen.queryByText('✓ Copied')).not.toBeInTheDocument()
  })
})
