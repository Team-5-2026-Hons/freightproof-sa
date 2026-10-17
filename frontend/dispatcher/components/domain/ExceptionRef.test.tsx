import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ExceptionRef } from './ExceptionRef'

const ID = '3f9a21c4-5b6d-4e7f-8a90-b1c2d3e4f506'

it('shows the short reference derived from the id', () => {
  render(<ExceptionRef id={ID} />)

  expect(screen.getByText('EX-3F9A21C4')).toBeInTheDocument()
})

it('keeps the full id in the tooltip so a developer can still trace it', () => {
  render(<ExceptionRef id={ID} />)

  expect(screen.getByText('EX-3F9A21C4')).toHaveAttribute('title', ID)
})
