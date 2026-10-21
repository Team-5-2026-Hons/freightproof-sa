import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { InformationButton } from './InformationButton'

const NOTES = ['First note about the figures.', 'Second note about the sources.']

describe('InformationButton', () => {
  it('hides the notes until the button is clicked', () => {
    render(<InformationButton notes={NOTES} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(NOTES[0])).not.toBeInTheDocument()
  })

  it('opens every note, in order, over a blurred backdrop', () => {
    render(<InformationButton notes={NOTES} />)

    fireEvent.click(screen.getByRole('button', { name: 'Information' }))

    const dialog = screen.getByRole('dialog', { name: 'About these figures' })
    const paragraphs = within(dialog).getAllByText(/note about the/).map((p) => p.textContent)
    expect(paragraphs).toEqual(NOTES)
    expect(dialog).toHaveClass('backdrop:backdrop-blur-sm')
  })

  it('closes again from the close button', () => {
    render(<InformationButton notes={NOTES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Information' }))

    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
