import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TopBar } from './TopBar'

describe('TopBar', () => {
  it('renders the title and its page actions without a forensic switch', () => {
    render(<TopBar title="Exceptions"><button type="button">Export</button></TopBar>)

    expect(screen.getByText('Exceptions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
