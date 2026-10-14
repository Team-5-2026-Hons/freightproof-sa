// frontend/driver-pwa/components/phase/__tests__/SwipeToConfirm.test.tsx
//
// SwipeToConfirm replaced HoldButton as the confirm gesture for every irreversible driver
// action. The safety property under test is the one both designs exist to protect:
// confirming a phase writes an immutable ledger row and can anchor to Hedera, so it must
// never be reachable by a single accidental input, and never fire twice for one intent.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SwipeToConfirm, CONFIRM_DISPATCH_MS, PANIC_DISPATCH_MS } from '../SwipeToConfirm'
import { PREF_TAP_TO_CONFIRM } from '@/lib/constants/preferences'
import { playHaptic } from '@/lib/haptics'

// The haptics are asserted as calls: the real plugin has no native side under jsdom.
vi.mock('@/lib/haptics', () => ({ playHaptic: vi.fn() }))

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
// The component's own export, so the test can never drift from the real delay.
const SETTLE_DURATION_MS = CONFIRM_DISPATCH_MS

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
  // Reduce Motion on: the thumb jumps straight to each spring's target instead of
  // animating over requestAnimationFrame frames, so these tests assert the gesture's
  // DECISIONS (confirm or not, once, latched) rather than animation timing. The spring
  // itself is covered in lib/motion/__tests__/spring.test.ts.
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
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
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)

    swipeTo(MAX_TRAVEL_PX)
    settle()

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire onConfirm on a short drag — the thumb springs back instead', () => {
    // ~29% of the track. The whole point of the threshold: a driver brushing the control
    // while climbing into the cab must not submit a phase.
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)

    swipeTo(100)
    settle()

    expect(onConfirm).not.toHaveBeenCalled()
    expect(getTrack()).toHaveAttribute('aria-valuenow', '0')
  })

  it('does not fire just below the completion threshold', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)

    // 85% — past halfway, still short of the 90% threshold.
    swipeTo(Math.floor(MAX_TRAVEL_PX * 0.85))
    settle()

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows a hint after an incomplete swipe so the gesture is discoverable', () => {
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={vi.fn()} />)

    swipeTo(60)

    expect(screen.getByRole('status')).toHaveTextContent(/swipe all the way across/i)
  })
})

describe('SwipeToConfirm — disabled', () => {
  it('cannot be confirmed while disabled', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} disabled />)

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
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)

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
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={vi.fn()} />)

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

    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)

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
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)

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
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)

    fireEvent.keyDown(getTrack(), { key: 'Enter' })
    settle()
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.keyDown(getTrack(), { key: 'Enter' })
    settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('is reachable by keyboard at all — the control is focusable when enabled', () => {
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={vi.fn()} />)

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
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={vi.fn()} />)

    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('still requires two taps — the safety property survives the accessible path', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button'))
    settle()
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button'))
    settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('SwipeToConfirm — the confirm moment', () => {
  beforeEach(() => {
    // The module mock is shared by the whole file; each assertion here counts its own calls.
    vi.mocked(playHaptic).mockClear()
  })

  it('commits with the ✓ state and a success haptic, before handing off', () => {
    // Arrange
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)

    // Act
    swipeTo(MAX_TRAVEL_PX)

    // Assert — the moment is visible and felt immediately, onConfirm only after the hold.
    expect(playHaptic).toHaveBeenCalledWith('confirm')
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(getTrack()).toHaveClass('bg-success')
    expect(onConfirm).not.toHaveBeenCalled()
    settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('test_names_what_just_happened_when_given_a_committed_label', () => {
    // Arrange
    render(<SwipeToConfirm label="Swipe to Depart" committedLabel="Departed" committedHint="Opening In Transit…" onConfirm={vi.fn()} />)

    // Act
    swipeTo(MAX_TRAVEL_PX)

    // Assert — the green end state says the action in the past tense, and where it leads.
    expect(screen.getByText('Departed')).toBeInTheDocument()
    expect(screen.queryByText('Confirmed')).toBeNull()
    expect(screen.getByText('Opening In Transit…')).toBeInTheDocument()
  })

  it('test_shows_no_hint_before_the_swipe_commits', () => {
    render(<SwipeToConfirm label="Swipe to Depart" committedLabel="Departed" committedHint="Opening In Transit…" onConfirm={vi.fn()} />)

    expect(screen.queryByText('Opening In Transit…')).toBeNull()
  })

  it('ticks once as the drag crosses the commit point, not on every move past it', () => {
    // Arrange
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={vi.fn()} />)
    const track = getTrack()

    // Act
    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.95, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.97, pointerId: 1 })

    // Assert
    expect(vi.mocked(playHaptic).mock.calls.filter(([m]) => m === 'threshold')).toHaveLength(1)
  })

  it('never confirms when the system cancels the touch past the commit point', () => {
    // Arrange — Control Center, a banner or a call takes the touch at 95%.
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)
    const track = getTrack()

    // Act
    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.95, pointerId: 1 })
    fireEvent.pointerCancel(track, { clientX: MAX_TRAVEL_PX * 0.95, pointerId: 1 })
    settle()

    // Assert
    expect(onConfirm).not.toHaveBeenCalled()
    expect(playHaptic).not.toHaveBeenCalledWith('confirm')
    expect(getTrack()).toHaveAttribute('aria-valuenow', '0')
  })

  it('confirms a deliberate flick that is past halfway and carrying momentum', () => {
    // Arrange — 30ms between samples, 140px apart: ~4700px/s, projecting far past the end.
    const now = vi.spyOn(performance, 'now')
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)
    const track = getTrack()

    // Act
    now.mockReturnValue(1000)
    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    now.mockReturnValue(1010)
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.2, pointerId: 1 })
    now.mockReturnValue(1040)
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.6, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: MAX_TRAVEL_PX * 0.6, pointerId: 1 })
    settle()

    // Assert
    expect(onConfirm).toHaveBeenCalledTimes(1)
    now.mockRestore()
  })

  it('never confirms a fast twitch that has not reached halfway', () => {
    // Arrange — just as fast, but released at 30% of the track.
    const now = vi.spyOn(performance, 'now')
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)
    const track = getTrack()

    // Act
    now.mockReturnValue(1000)
    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    now.mockReturnValue(1030)
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.3, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: MAX_TRAVEL_PX * 0.3, pointerId: 1 })
    settle()

    // Assert
    expect(onConfirm).not.toHaveBeenCalled()
    now.mockRestore()
  })

  it('resists past the end of the track instead of following the finger off it', () => {
    // Arrange
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={vi.fn()} />)
    const track = getTrack()

    // Act — 200px of overshoot.
    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX + 200, pointerId: 1 })

    // Assert — the thumb moves less than the finger did past the boundary.
    const thumb = track.querySelector('div') as HTMLDivElement
    const travelled = Number(thumb.style.transform.match(/translateX\(([-\d.]+)px\)/)?.[1])
    expect(travelled).toBeGreaterThan(MAX_TRAVEL_PX)
    expect(travelled).toBeLessThan(MAX_TRAVEL_PX + 200)
  })

  it('hands a panic swipe off without the confirm hold, with the heavy haptic', () => {
    // Arrange
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Send Panic" onConfirm={onConfirm} variant="danger" />)

    // Act
    swipeTo(MAX_TRAVEL_PX)
    act(() => {
      vi.advanceTimersByTime(PANIC_DISPATCH_MS)
    })

    // Assert
    expect(playHaptic).toHaveBeenCalledWith('panic')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('SwipeToConfirm — press reporting (overhaul 7.1b)', () => {
  it('test_reports_the_finger_down_and_lifted', () => {
    // Arrange
    const onPressChange = vi.fn()
    render(<SwipeToConfirm label="Send Panic" variant="danger" onConfirm={vi.fn()} onPressChange={onPressChange} />)
    const track = getTrack()
    onPressChange.mockClear()

    // Act / Assert — down starts the pulse, a short release stops it.
    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    expect(onPressChange).toHaveBeenLastCalledWith(true)
    fireEvent.pointerUp(track, { clientX: 10, pointerId: 1 })
    expect(onPressChange).toHaveBeenLastCalledWith(false)
  })

  it('test_reports_released_when_the_system_cancels_the_touch', () => {
    const onPressChange = vi.fn()
    render(<SwipeToConfirm label="Send Panic" variant="danger" onConfirm={vi.fn()} onPressChange={onPressChange} />)
    const track = getTrack()

    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    fireEvent.pointerCancel(track, { clientX: 0, pointerId: 1 })

    expect(onPressChange).toHaveBeenLastCalledWith(false)
  })
})

describe('SwipeToConfirm — waiting state', () => {
  it('reads as waiting, not switched off, while disabled', () => {
    // Arrange / Act
    render(<SwipeToConfirm label="Swipe to Submit" onConfirm={vi.fn()} disabled />)

    // Assert — a full-strength neutral track with a legible label, never a 40% fade.
    const track = getTrack()
    expect(track).toHaveClass('bg-fill')
    expect(track).not.toHaveClass('opacity-40')
    expect(screen.getByText('Swipe to Submit')).toHaveClass('text-surface-on-variant')
  })

  it('test_says_what_it_is_waiting_for_instead_of_the_action', () => {
    // Arrange / Act
    render(<SwipeToConfirm label="Swipe to Submit" waitingLabel="Add the sheet photo first" onConfirm={vi.fn()} disabled />)

    // Assert — the track names the missing thing; the slider keeps its action as its name.
    expect(screen.getByText('Add the sheet photo first')).toBeInTheDocument()
    expect(screen.queryByText('Swipe to Submit')).toBeNull()
    expect(getTrack()).toHaveAccessibleName('Swipe to Submit')
  })

  it('test_shows_the_action_again_once_ready', () => {
    // Arrange / Act
    render(<SwipeToConfirm label="Swipe to Submit" waitingLabel="Add the sheet photo first" onConfirm={vi.fn()} />)

    // Assert
    expect(screen.getByText('Swipe to Submit')).toBeInTheDocument()
    expect(screen.queryByText('Add the sheet photo first')).toBeNull()
  })
})
