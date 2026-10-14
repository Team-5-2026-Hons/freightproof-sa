import { act, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useRef } from 'react'
import { useRowsThatFit } from '../useRowsThatFit'

function Probe({ rowHeight, fallback }: { rowHeight: number; fallback: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const count = useRowsThatFit(ref, rowHeight, fallback)
  return <div ref={ref}>{count}</div>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useRowsThatFit', () => {
  it('test_uses_the_fallback_where_layout_cannot_be_measured', () => {
    vi.stubGlobal('ResizeObserver', undefined)

    render(<Probe rowHeight={76} fallback={2} />)

    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('test_counts_whole_rows_that_fit_the_measured_height', () => {
    let callback: ResizeObserverCallback = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) { callback = cb }
      observe() {}
      disconnect() {}
    })
    render(<Probe rowHeight={76} fallback={2} />)

    act(() => { callback([{ contentRect: { height: 330 } } as ResizeObserverEntry], {} as ResizeObserver) })

    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('test_never_reports_less_than_one_row', () => {
    let callback: ResizeObserverCallback = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) { callback = cb }
      observe() {}
      disconnect() {}
    })
    render(<Probe rowHeight={76} fallback={2} />)

    act(() => { callback([{ contentRect: { height: 20 } } as ResizeObserverEntry], {} as ResizeObserver) })

    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
