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

vi.mock('@/lib/haptics', () => ({ playHaptic: vi.fn() }))

class PointerEventPolyfill extends MouseEvent {
  public readonly pointerId: number

  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
    this.pointerId = params.pointerId ?? 0
  }
}

// @ts-expect-error — installing a polyfill onto the jsdom window, which has no PointerEvent
window.PointerEvent = PointerEventPolyfill

const TRACK_WIDTH_PX = 400
const MAX_TRAVEL_PX = TRACK_WIDTH_PX - 48 - 8
const SETTLE_DURATION_MS = CONFIRM_DISPATCH_MS

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: TRACK_WIDTH_PX,
  })
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
  window.localStorage.clear()
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
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={vi.fn()} />)

    swipeTo(MAX_TRAVEL_PX)

    const label = screen.getByText('Confirmed')
    expect(label).toBeInTheDocument()
    expect(label).toHaveStyle({ opacity: '1' })
  })
})

describe('SwipeToConfirm — async onConfirm', () => {
  it('surfaces a submitting state and blocks a second confirm while in flight', async () => {
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

    swipeTo(MAX_TRAVEL_PX)
    settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSubmit?.()
    })
  })

  it('re-arms once the submit settles, so a failed submit can be retried', async () => {
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
    vi.mocked(playHaptic).mockClear()
  })

  it('commits with the ✓ state and a success haptic, before handing off', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)

    swipeTo(MAX_TRAVEL_PX)

    expect(playHaptic).toHaveBeenCalledWith('confirm')
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(getTrack()).toHaveClass('bg-success')
    expect(onConfirm).not.toHaveBeenCalled()
    settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('test_names_what_just_happened_when_given_a_committed_label', () => {
    render(<SwipeToConfirm label="Swipe to Depart" committedLabel="Departed" committedHint="Opening In Transit…" onConfirm={vi.fn()} />)

    swipeTo(MAX_TRAVEL_PX)

    expect(screen.getByText('Departed')).toBeInTheDocument()
    expect(screen.queryByText('Confirmed')).toBeNull()
    expect(screen.getByText('Opening In Transit…')).toBeInTheDocument()
  })

  it('test_shows_no_hint_before_the_swipe_commits', () => {
    render(<SwipeToConfirm label="Swipe to Depart" committedLabel="Departed" committedHint="Opening In Transit…" onConfirm={vi.fn()} />)

    expect(screen.queryByText('Opening In Transit…')).toBeNull()
  })

  it('ticks once as the drag crosses the commit point, not on every move past it', () => {
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={vi.fn()} />)
    const track = getTrack()

    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.95, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.97, pointerId: 1 })

    expect(vi.mocked(playHaptic).mock.calls.filter(([m]) => m === 'threshold')).toHaveLength(1)
  })

  it('never confirms when the system cancels the touch past the commit point', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)
    const track = getTrack()

    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.95, pointerId: 1 })
    fireEvent.pointerCancel(track, { clientX: MAX_TRAVEL_PX * 0.95, pointerId: 1 })
    settle()

    expect(onConfirm).not.toHaveBeenCalled()
    expect(playHaptic).not.toHaveBeenCalledWith('confirm')
    expect(getTrack()).toHaveAttribute('aria-valuenow', '0')
  })

  it('confirms a deliberate flick that is past halfway and carrying momentum', () => {
    const now = vi.spyOn(performance, 'now')
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)
    const track = getTrack()

    now.mockReturnValue(1000)
    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    now.mockReturnValue(1010)
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.2, pointerId: 1 })
    now.mockReturnValue(1040)
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.6, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: MAX_TRAVEL_PX * 0.6, pointerId: 1 })
    settle()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    now.mockRestore()
  })

  it('never confirms a fast twitch that has not reached halfway', () => {
    const now = vi.spyOn(performance, 'now')
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={onConfirm} />)
    const track = getTrack()

    now.mockReturnValue(1000)
    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    now.mockReturnValue(1030)
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX * 0.3, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: MAX_TRAVEL_PX * 0.3, pointerId: 1 })
    settle()

    expect(onConfirm).not.toHaveBeenCalled()
    now.mockRestore()
  })

  it('resists past the end of the track instead of following the finger off it', () => {
    render(<SwipeToConfirm label="Swipe to Confirm" onConfirm={vi.fn()} />)
    const track = getTrack()

    fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: MAX_TRAVEL_PX + 200, pointerId: 1 })

    const thumb = track.querySelector('div') as HTMLDivElement
    const travelled = Number(thumb.style.transform.match(/translateX\(([-\d.]+)px\)/)?.[1])
    expect(travelled).toBeGreaterThan(MAX_TRAVEL_PX)
    expect(travelled).toBeLessThan(MAX_TRAVEL_PX + 200)
  })

  it('hands a panic swipe off without the confirm hold, with the heavy haptic', () => {
    const onConfirm = vi.fn()
    render(<SwipeToConfirm label="Send Panic" onConfirm={onConfirm} variant="danger" />)

    swipeTo(MAX_TRAVEL_PX)
    act(() => {
      vi.advanceTimersByTime(PANIC_DISPATCH_MS)
    })

    expect(playHaptic).toHaveBeenCalledWith('panic')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('SwipeToConfirm — press reporting (overhaul 7.1b)', () => {
  it('test_reports_the_finger_down_and_lifted', () => {
    const onPressChange = vi.fn()
    render(<SwipeToConfirm label="Send Panic" variant="danger" onConfirm={vi.fn()} onPressChange={onPressChange} />)
    const track = getTrack()
    onPressChange.mockClear()

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
    render(<SwipeToConfirm label="Swipe to Submit" onConfirm={vi.fn()} disabled />)

    const track = getTrack()
    expect(track).toHaveClass('bg-fill')
    expect(track).not.toHaveClass('opacity-40')
    expect(screen.getByText('Swipe to Submit')).toHaveClass('text-surface-on-variant')
  })

  it('test_says_what_it_is_waiting_for_instead_of_the_action', () => {
    render(<SwipeToConfirm label="Swipe to Submit" waitingLabel="Add the sheet photo first" onConfirm={vi.fn()} disabled />)

    expect(screen.getByText('Add the sheet photo first')).toBeInTheDocument()
    expect(screen.queryByText('Swipe to Submit')).toBeNull()
    expect(getTrack()).toHaveAccessibleName('Swipe to Submit')
  })

  it('test_shows_the_action_again_once_ready', () => {
    render(<SwipeToConfirm label="Swipe to Submit" waitingLabel="Add the sheet photo first" onConfirm={vi.fn()} />)

    expect(screen.getByText('Swipe to Submit')).toBeInTheDocument()
    expect(screen.queryByText('Add the sheet photo first')).toBeNull()
  })
})
