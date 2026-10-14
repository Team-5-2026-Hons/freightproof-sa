import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider, type Toast } from './ToastContext'
import { useToast } from '@/lib/hooks/useToast'

type Request = Omit<Toast, 'id'>

const critical = (n: number): Request =>
  ({ kind: 'error', title: `Critical exception ${n}`, priority: 'critical' })

const ordinary = (n: number): Request =>
  ({ kind: 'error', title: `Exception raised ${n}` })

const warning = (): Request =>
  ({ kind: 'warning', title: 'Warning exception' })

afterEach(() => vi.useRealTimers())

/** Emits the whole queue in one click, so eviction is exercised through the real
 *  state updater rather than by reaching into it. */
function Harness({ queue }: { queue: Request[] }) {
  const { notify } = useToast()
  return <button onClick={() => queue.forEach(t => notify(t))}>emit</button>
}

function emit(queue: Request[]): void {
  render(
    <ToastProvider>
      <Harness queue={queue} />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'emit' }))
}

function onScreen(): number {
  return screen.queryAllByLabelText('Dismiss notification').length
}

describe('ToastProvider — overflow eviction', () => {
  it('keeps a critical alert on screen when ordinary ones arrive behind it', () => {
    // The regression this exists for. Eviction used to be `slice(-MAX_TOASTS)`, which
    // drops the OLDEST unconditionally — so three routine alerts landing after a panic
    // button pushed the hijacking off the dispatcher's screen. Ranking severity in
    // ranking.ts achieves nothing if the surface it renders on then discards by age.
    emit([critical(1), ordinary(1), ordinary(2), ordinary(3)])

    expect(screen.getByText('Critical exception 1')).toBeInTheDocument()
    expect(onScreen()).toBe(3)
    // The oldest ORDINARY alert is what gives way instead.
    expect(screen.queryByText('Exception raised 1')).not.toBeInTheDocument()
    expect(screen.getByText('Exception raised 3')).toBeInTheDocument()
  })

  it('survives more ordinary alerts than the viewport can hold', () => {
    // A burst, not a trickle: the shift-change case where several trips report at once.
    emit([critical(1), ...Array.from({ length: 8 }, (_, i) => ordinary(i))])

    expect(screen.getByText('Critical exception 1')).toBeInTheDocument()
    expect(onScreen()).toBe(3)
  })

  it('evicts the oldest alert when none of them are critical', () => {
    // Age still decides within a band — priority is a tiebreak on top of the existing
    // rule, not a replacement for it.
    emit([ordinary(1), ordinary(2), ordinary(3), ordinary(4)])

    expect(screen.queryByText('Exception raised 1')).not.toBeInTheDocument()
    expect(screen.getByText('Exception raised 4')).toBeInTheDocument()
    expect(onScreen()).toBe(3)
  })

  it('stays bounded when every alert is critical', () => {
    // The list must not grow without limit just because nothing may be dropped by
    // priority. Between two hijackings the newer one is the one nobody has read yet.
    emit([critical(1), critical(2), critical(3), critical(4)])

    expect(onScreen()).toBe(3)
    expect(screen.queryByText('Critical exception 1')).not.toBeInTheDocument()
    expect(screen.getByText('Critical exception 4')).toBeInTheDocument()
  })
})

describe('ToastProvider — auto-dismiss', () => {
  it('owns exactly one timer for an auto-dismissing toast', () => {
    vi.useFakeTimers()

    emit([warning()])

    expect(vi.getTimerCount()).toBe(1)
    act(() => vi.runOnlyPendingTimers())
    expect(screen.queryByText('Warning exception')).not.toBeInTheDocument()
  })
})
