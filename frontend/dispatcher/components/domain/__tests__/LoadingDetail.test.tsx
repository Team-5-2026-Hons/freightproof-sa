import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LoadingDetail } from '../LoadingDetail'
import { makePhase } from './testFixtures'

describe('LoadingDetail', () => {
  it('shows scanned against expected', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), parcel_count_origin: 2 }}
        expectedCount={3}
      />,
    )

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('flags a short scan', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), parcel_count_origin: 2 }}
        expectedCount={3}
      />,
    )

    expect(screen.getByText(/1 not scanned/i)).toBeInTheDocument()
  })

  it('shows no verdict when there is no manifest baseline', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), parcel_count_origin: null }}
        expectedCount={null}
      />,
    )

    expect(screen.queryByText(/not scanned/i)).not.toBeInTheDocument()
  })
})
