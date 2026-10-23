import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SLAPage from './page'

afterEach(() => {
  vi.useRealTimers()
})

describe('SLA page', () => {
  it('opens on the last 30 SAST days, ending today in SAST', () => {
    // 23:30Z on the 22nd is 01:30 SAST on the 23rd.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T23:30:00Z'))

    render(<SLAPage />)

    expect(screen.getByText('2026-09-23 to 2026-10-23')).toBeInTheDocument()
  })
})
