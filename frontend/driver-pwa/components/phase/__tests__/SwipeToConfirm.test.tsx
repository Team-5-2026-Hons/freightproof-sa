// frontend/driver-pwa/components/phase/__tests__/SwipeToConfirm.test.tsx
//
// SwipeToConfirm replaced HoldButton as the confirm gesture for every irreversible driver
// action. The safety property under test is the one both designs exist to protect:
// confirming a phase writes an immutable ledger row and can anchor to Hedera, so it must
// never be reachable by a single accidental input, and never fire twice for one intent.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SwipeToConfirm } from '../SwipeToConfirm'
import { PREF_TAP_TO_CONFIRM } from '@/lib/constants/preferences'

// jsdom ships no PointerEvent constructor, so Testing Library falls back to a bare Event
// and silently drops clientX — every drag would then compute as NaN and read as "didn't
// move", making the negative assertions below pass for entirely the wrong reason. This
// minimal polyfill over MouseEvent (which does carry clientX) is what makes the drag tests
// actually exercise the drag.
class PointerEventPolyfill extends MouseEvent {
  public readonly pointerId: number

  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
    this.pointerId = params.pointerId ?? 0
  }
}

// @ts-expect-error — installing a polyfill onto the jsdom window, which has no PointerEvent
window.PointerEvent = PointerEventPolyfill

// Mirrors the component's own constants. Track width 400 - thumb 48 - padding (4 * 2) = 344.
const TRACK_WIDTH_PX = 400
const MAX_TRAVEL_PX = TRACK_WIDTH_PX - 48 - 8
const SETTLE_DURATION_MS = 180

// jsdom reports offsetWidth as 0 for everything, which would leave the component's travel
// distance at 0 and make every drag look like a no-op. Stubbing it is what lets the real
// drag maths run under test rather than testing a degenerate case.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: TRACK_WIDTH_PX,
  })
  // jsdom implements none of the Pointer Capture API; the component calls all three.
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
  window.localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  window.localStorage.clear()
})

function getTrack() {
  return screen.getByRole('slider')
}

/** Drag the thumb `toX` pixels from the start and release. */
function swipeTo(toX: number) {
  const track = getTrack()
  fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
  fireEvent.pointerMove(track, { clientX: toX, pointerId: 1 })
  fireEvent.pointerUp(track, { clientX: toX, pointerId: 1 })
}

/** Let the settle flourish elapse so onConfirm is actually dispatched. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(SETTLE_DURATION_MS)
  })
}

/**
 * As settle(), but also flushes the microtask queue inside the same act scope — needed
 * whenever onConfirm returns a promise, since its .then continuation calls setState and
 * fake timers never run microtasks.
 */
async function settleAsync() {
  await act(async () => {
    vi.advanceTimersByTime(SETTLE_DURATION_MS)
  })
}

describe('SwipeToConfirm — the drag gesture', () => {
  it('fires onConfirm exactly once when dragged past the threshold', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={onConfirm} />)

    swipeTo(MAX_TRAVEL_PX)
    settle()

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire onConfirm on a short drag — the thumb springs back instead', () => {
    // ~29% of the track. The whole point of the threshold: a driver brushing the control
    // while climbing into the cab must not submit a phase.
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={onConfirm} />)

    swipeTo(100)
    settle()

    expect(onConfirm).not.toHaveBeenCalled()
    expect(getTrack()).toHaveAttribute('aria-valuenow', '0')
  })

  it('does not fire just below the completion threshold', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={onConfirm} />)

    // 85% — past halfway, still short of the 90% threshold.
    swipeTo(Math.floor(MAX_TRAVEL_PX * 0.85))
    settle()

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows a hint after an incomplete swipe so the gesture is discoverable', () => {
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={vi.fn()} />)

    swipeTo(60)

    expect(screen.getByRole('status')).toHaveTextContent(/swipe all the way across/i)
  })
})

describe('SwipeToConfirm — disabled', () => {
  it('cannot be confirmed while disabled', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={onConfirm} disabled />)

    swipeTo(MAX_TRAVEL_PX)
    settle()

    expect(onConfirm).not.toHaveBeenCalled()
    expect(getTrack()).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('SwipeToConfirm — after a completed swipe', () => {
  it('stays latched after a synchronous confirm, so the track cannot be swiped a second time', () => {
    // Every synchronous caller navigates (router.push to the next step) and this control
    // stays mounted until that route change commits. It used to re-enable itself the
    // instant onConfirm returned, handing back a live track whose thumb was parked at the
    // far end and whose label had faded out — a blank strip the driver could swipe again,
    // firing a duplicate confirm into an in-flight navigation.
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={onConfirm} />)

    swipeTo(MAX_TRAVEL_PX)
    settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)

    swipeTo(MAX_TRAVEL_PX)
    settle()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(getTrack()).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps its status label readable instead of leaving a blank track', () => {
    // The label fades as the thumb covers it; at the end of the track that fraction is 0,
    // which rendered "Confirmed"/"Submitting…" invisible and left the driver staring at
    // an apparently empty control for the whole submit.
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={vi.fn()} />)

    swipeTo(MAX_TRAVEL_PX)

    const label = screen.getByText('Confirmed')
    expect(label).toBeInTheDocument()
    expect(label).toHaveStyle({ opacity: '1' })
  })
})

describe('SwipeToConfirm — async onConfirm', () => {
  it('surfaces a submitting state and blocks a second confirm while in flight', async () => {
    // A duplicate submit here is a duplicate ledger write — the server dedupes on the
    // addressed row, but the client must not rely on that to avoid sending it twice.
    let resolveSubmit: (() => void) | undefined
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve
        }),
    )

    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={onConfirm} />)

    swipeTo(MAX_TRAVEL_PX)
    settle()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')

    // A second full swipe while the first is still in flight must be ignored.
    swipeTo(MAX_TRAVEL_PX)
    settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSubmit?.()
    })
  })

  it('re-arms once the submit settles, so a failed submit can be retried', async () => {
    // submitAndAdvance catches its own errors: on a terminal failure it toasts and leaves
    // the driver on this screen with their draft intact, resolving exactly as a success
    // does. A control that stayed latched there would strand them with no way to retry.
    const onConfirm = vi.fn(() => Promise.resolve())
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={onConfirm} />)

    swipeTo(MAX_TRAVEL_PX)
    await settleAsync()
    expect(onConfirm).toHaveBeenCalledTimes(1)

    expect(getTrack()).toHaveAttribute('aria-disabled', 'false')
    expect(getTrack()).toHaveAttribute('aria-valuenow', '0')

    swipeTo(MAX_TRAVEL_PX)
    await settleAsync()
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})

describe('SwipeToConfirm — keyboard path', () => {
  it('requires two presses, so one stray keypress cannot submit', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={onConfirm} />)

    fireEvent.keyDown(getTrack(), { key: 'Enter' })
    settle()
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.keyDown(getTrack(), { key: 'Enter' })
    settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('is reachable by keyboard at all — the control is focusable when enabled', () => {
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={vi.fn()} />)

    expect(getTrack()).toHaveAttribute('tabindex', '0')
  })
})

describe('SwipeToConfirm — tap-to-confirm accessibility preference', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREF_TAP_TO_CONFIRM, 'true')
  })

  it('renders a plain button rather than a drag track', () => {
    // Someone who enabled this pref has told us a drag is the barrier, so presenting a
    // drag affordance at all would be the wrong answer.
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={vi.fn()} />)

    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('still requires two taps — the safety property survives the accessible path', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to confirm" onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button'))
    settle()
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button'))
    settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
