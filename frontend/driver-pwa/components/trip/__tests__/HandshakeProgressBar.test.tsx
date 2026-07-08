import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { HandshakeProgressBar } from '../HandshakeProgressBar'
import type { HandshakeStageState } from '@/lib/utils/handshake-progress'

// A representative in-flight trip: H1-H3 done, H4 current, H5 upcoming — exercises
// the completed checkmark, current number, and upcoming number rendering paths.
const progress: Record<1 | 2 | 3 | 4 | 5, HandshakeStageState> = {
  1: 'completed',
  2: 'completed',
  3: 'completed',
  4: 'current',
  5: 'upcoming',
}

describe('HandshakeProgressBar', () => {
  it('renders all five driver-facing handshake names', () => {
    render(<HandshakeProgressBar progress={progress} />)

    expect(screen.getByText('Origin Gate-In')).toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.getByText('Origin Gate-Out')).toBeInTheDocument()
    expect(screen.getByText('Destination Gate-In')).toBeInTheDocument()
    expect(screen.getByText('Unloading')).toBeInTheDocument()
  })

  it('never shows internal handshake codes like "H4" or "H5" in the circles', () => {
    render(<HandshakeProgressBar progress={progress} />)

    expect(screen.queryByText('H4')).not.toBeInTheDocument()
    expect(screen.queryByText('H5')).not.toBeInTheDocument()
    // The un-reached steps show the plain step number instead.
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
