import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LoadingDetail } from '../LoadingDetail'
import { makePhase } from './testFixtures'

describe('LoadingDetail', () => {
  it('shows the stamped count once the phase is resolved', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', parcel_count_origin: 2 }}
        expectedCount={3}
        liveScannedOutCount={null}
      />,
    )

    expect(screen.getByText('Scanned onto truck')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('flags a short scan once resolved', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', parcel_count_origin: 2 }}
        expectedCount={3}
        liveScannedOutCount={null}
      />,
    )

    expect(screen.getByText(/1 not scanned/i)).toBeInTheDocument()
  })

  it('shows no verdict when there is no manifest baseline', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', parcel_count_origin: null }}
        expectedCount={null}
        liveScannedOutCount={null}
      />,
    )

    expect(screen.queryByText(/not scanned/i)).not.toBeInTheDocument()
  })

  // Regression guard for the live/stamped distinction: while the phase is still open,
  // the panel must show the LIVE scanned_out_count, not the (not-yet-final) stamped
  // parcel_count_origin, and must label it differently so a viewer can tell the two
  // apart on screen.
  it('shows the live count, distinctly labelled, while the phase is unresolved', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'in_progress', parcel_count_origin: null }}
        expectedCount={3}
        liveScannedOutCount={2}
      />,
    )

    expect(screen.getByText('Scanned onto truck (in progress)')).toBeInTheDocument()
    expect(screen.queryByText('Scanned onto truck')).not.toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('ignores a stray stamped figure while unresolved and reads the live count instead', () => {
    render(
      <LoadingDetail
        // parcel_count_origin should never be non-null on an unresolved row in practice,
        // but the component must still prefer the live figure if it somehow is.
        phase={{ ...makePhase('loading'), status: 'in_progress', parcel_count_origin: 9 }}
        expectedCount={3}
        liveScannedOutCount={1}
      />,
    )

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('9')).not.toBeInTheDocument()
  })
})
