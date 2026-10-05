import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TimestampWithIcon } from './TimestampWithIcon'

describe('TimestampWithIcon', () => {
  it('shows the time then the day in SAST, from the shared helper', () => {
    render(<TimestampWithIcon timestamp="2026-09-05T14:30:00Z" />)

    expect(screen.getByText('16:30 SAST · 05 Sep 2026')).toBeInTheDocument()
  })

  it('shows a dash for an unreadable timestamp', () => {
    render(<TimestampWithIcon timestamp="garbage" />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
