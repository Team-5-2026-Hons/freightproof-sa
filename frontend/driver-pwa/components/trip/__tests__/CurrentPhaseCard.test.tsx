// frontend/driver-pwa/components/trip/__tests__/CurrentPhaseCard.test.tsx
//
// Replaces CurrentHandshakeCard.test.tsx — the component now takes a real
// PhaseDescriptor (sequence_number/phase_type/stop_sequence) instead of a bare
// handshakeNumber prop, so the number shown is the phase's own plan position rather
// than a bounded 1-5 handshake ordinal.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CurrentPhaseCard } from '../CurrentPhaseCard'
import { makePhase } from '@/components/phase/__tests__/testFixtures'

describe('CurrentPhaseCard', () => {
  it('renders the phase sequence number and name', () => {
    render(<CurrentPhaseCard phase={makePhase('loading', { sequence_number: 2 })} onSelect={vi.fn()} />)

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    render(<CurrentPhaseCard phase={makePhase('departure', { sequence_number: 3 })} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  // Cross-dock disambiguation (parent plan): a phase_type can occur more than once in
  // one trip's plan, so the sequence number alone isn't enough for a driver to place
  // which occurrence they're on — stop_sequence must appear too.
  it('shows the stop number to disambiguate a repeated phase type on a cross-dock plan', () => {
    render(
      <CurrentPhaseCard
        phase={makePhase('unloading', { sequence_number: 9, stop_sequence: 3 })}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('Stop 3')).toBeInTheDocument()
  })

  it('omits the stop label when stop_sequence is null (trip_creation)', () => {
    render(
      <CurrentPhaseCard
        phase={makePhase('trip_creation', { sequence_number: 0, stop_sequence: null })}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.queryByText(/^Stop /)).not.toBeInTheDocument()
  })
})
