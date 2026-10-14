import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Chip, type ChipType } from './Chip'

const ALL_TYPES: readonly ChipType[] = ['transit', 'loading', 'complete', 'exception', 'critical', 'pending']

describe('Chip', () => {
  it.each(ALL_TYPES)('renders the %s type as a solid-fill pill, not a dot', type => {
    render(<Chip type={type} label="Status" />)

    const chip = screen.getByText('Status')
    // No dot: colour already carries the signal via the fill itself, so a second
    // coloured shape beside the label would just repeat the same fact.
    expect(chip.querySelector('span')).not.toBeInTheDocument()
  })

  it('accepts children as an alternative to label', () => {
    render(<Chip type="critical"><strong>Custom</strong></Chip>)

    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('prefers label over children when both are given', () => {
    render(<Chip type="pending" label="Label wins">Ignored children</Chip>)

    expect(screen.getByText('Label wins')).toBeInTheDocument()
    expect(screen.queryByText('Ignored children')).not.toBeInTheDocument()
  })

  it('merges a caller className alongside its own', () => {
    render(<Chip type="complete" label="Status" className="mt-2" />)

    expect(screen.getByText('Status')).toHaveClass('mt-2', 'rounded-md')
  })
})
