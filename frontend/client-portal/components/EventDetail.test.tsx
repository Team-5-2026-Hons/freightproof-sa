import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildTimeline } from '@/lib/timeline'
import { makeManifest, makePhase } from '@/test/factories'
import { EventDetail } from './EventDetail'

function phaseItem(...args: Parameters<typeof makePhase>) {
  const [item] = buildTimeline(makeManifest({ phases: [makePhase(...args)] }))
  return item
}

describe('EventDetail', () => {
  it('shows a damaged arrival seal as a finding', () => {
    // Arrange
    const item = phaseItem(3, 'arrival', { seal_number: 'SEAL-001', seal_condition: 'damaged' })

    // Act
    render(<EventDetail token="t" item={item} />)

    // Assert
    expect(screen.getByText('P3 · Arrival')).toBeInTheDocument()
    expect(screen.getByText('Seal condition')).toBeInTheDocument()
    expect(screen.getByText('Damaged')).toHaveClass('text-err')
  })

  it('shows an intact arrival seal as fine', () => {
    // Arrange
    const item = phaseItem(3, 'arrival', { seal_number: 'SEAL-001', seal_condition: 'intact' })

    // Act
    render(<EventDetail token="t" item={item} />)

    // Assert
    expect(screen.getByText('Intact')).toHaveClass('text-ok')
  })

  it('omits the condition row on a pack frozen before Arrival', () => {
    // Arrange
    const item = phaseItem(3, 'unloading', { seal_number: 'SEAL-001' })

    // Act
    render(<EventDetail token="t" item={item} />)

    // Assert
    expect(screen.queryByText('Seal condition')).not.toBeInTheDocument()
  })
})
