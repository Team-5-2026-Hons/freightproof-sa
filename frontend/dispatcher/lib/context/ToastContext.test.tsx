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

/** Exposes the context directly so each test can call notify/clear in its own act(). */
function Probe({ onReady }: { onReady: (api: ReturnType<typeof useToast>) => void }) {
  const api = useToast()
  onReady(api)
  return null
}

function mountProbe() {
  const handle: { api: ReturnType<typeof useToast> | null } = { api: null }
  render(
    <ToastProvider>
      <Probe onReady={api => { handle.api = api }} />
    </ToastProvider>,
  )
  return handle as { api: ReturnType<typeof useToast> }
}

describe('ToastProvider — duplicate suppression', () => {
  // One outage re-raises the same error on every 60 s refetch; each used to stack another
  // sticky toast until the viewport was full of copies of one message.
  it('shows one toast for two identical notifications', () => {
    const h = mountProbe()

    act(() => {
      h.api.notify({ kind: 'error', title: 'Failed to load trips', body: 'request timed out' })
      h.api.notify({ kind: 'error', title: 'Failed to load trips', body: 'request timed out' })
    })

    expect(screen.getAllByText('Failed to load trips')).toHaveLength(1)
    expect(onScreen()).toBe(1)
  })

  it('still shows a second toast when the body differs', () => {
    const h = mountProbe()

    act(() => {
      h.api.notify({ kind: 'error', title: 'Failed to load trips', body: 'request timed out' })
      h.api.notify({ kind: 'error', title: 'Failed to load trips', body: 'server error' })
    })

    expect(screen.getAllByText('Failed to load trips')).toHaveLength(2)
  })

  it('still shows a second toast when the kind differs', () => {
    const h = mountProbe()

    act(() => {
      h.api.notify({ kind: 'error', title: 'Saved' })
      h.api.notify({ kind: 'success', title: 'Saved' })
    })

    expect(screen.getAllByText('Saved')).toHaveLength(2)
  })

  it('allows the same message again once the first has been dismissed', () => {
    const h = mountProbe()
    act(() => h.api.notify({ kind: 'error', title: 'Failed to load trips' }))
    fireEvent.click(screen.getByLabelText('Dismiss notification'))

    act(() => h.api.notify({ kind: 'error', title: 'Failed to load trips' }))

    expect(screen.getAllByText('Failed to load trips')).toHaveLength(1)
  })

  it('does not stack a second auto-dismiss timer for a repeated transient toast', () => {
    vi.useFakeTimers()
    const h = mountProbe()

    act(() => {
      h.api.notify({ kind: 'warning', title: 'Warning exception' })
      h.api.notify({ kind: 'warning', title: 'Warning exception' })
    })

    expect(vi.getTimerCount()).toBe(1)
  })
})

describe('ToastProvider — clear', () => {
  it('empties every toast on screen', () => {
    const h = mountProbe()
    act(() => {
      h.api.notify({ kind: 'error', title: 'One' })
      h.api.notify({ kind: 'error', title: 'Two' })
    })
    expect(onScreen()).toBe(2)

    act(() => h.api.clear())

    expect(onScreen()).toBe(0)
  })

  it('cancels pending auto-dismiss timers', () => {
    vi.useFakeTimers()
    const h = mountProbe()
    act(() => h.api.notify({ kind: 'warning', title: 'Warning exception' }))
    expect(vi.getTimerCount()).toBe(1)

    act(() => h.api.clear())

    expect(vi.getTimerCount()).toBe(0)
  })
})
