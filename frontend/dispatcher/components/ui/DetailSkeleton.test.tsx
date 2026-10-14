import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { InfoRowsSkeleton, SplitDetailSkeleton, TimelineSkeleton } from './DetailSkeleton'
import { DETAIL_PANEL_DEFAULT_W } from '@/lib/hooks/useResizablePanel'

describe('InfoRowsSkeleton', () => {
  it('draws one row per fact and hides itself from assistive tech', () => {
    const { container } = render(<InfoRowsSkeleton rows={4} />)

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('aria-hidden')
    expect(root.children).toHaveLength(4)
  })

  it('varies the value widths so the rows do not read as one repeated bar', () => {
    const { container } = render(<InfoRowsSkeleton rows={5} />)

    const valueWidths = [...container.querySelectorAll('div > div:last-child')].map(bar => bar.className.match(/\bw-\d+\b/)?.[0])
    expect(new Set(valueWidths).size).toBeGreaterThan(1)
  })
})

describe('TimelineSkeleton', () => {
  it('draws the requested number of event cards', () => {
    const { container } = render(<TimelineSkeleton items={3} />)

    expect(container.querySelectorAll('li')).toHaveLength(3)
  })
})

describe('SplitDetailSkeleton', () => {
  it('announces what is loading and marks itself busy', () => {
    render(<SplitDetailSkeleton label="Loading vehicle" />)

    expect(screen.getByRole('status', { name: 'Loading vehicle' })).toHaveAttribute('aria-busy', 'true')
  })

  it('holds the info column at the real default width, so the page does not shift when data lands', () => {
    render(<SplitDetailSkeleton label="Loading vehicle" />)

    const infoColumn = screen.getByRole('status').firstElementChild as HTMLElement
    expect(infoColumn.style.width).toBe(`${DETAIL_PANEL_DEFAULT_W}px`)
  })

  it('shows no text at all: every fact is still in flight and a placeholder must not read as data', () => {
    render(<SplitDetailSkeleton label="Loading vehicle" />)

    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})
