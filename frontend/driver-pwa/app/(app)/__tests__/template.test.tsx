import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AppTemplate from '../template'
import { markTransition, peekTransition, resetTransition } from '@/lib/navigation/transition-direction'
import { useEdgeBackHandler } from '@/lib/navigation/edge-back'
import { RESUME_SCREEN_KEY, __resetColdStartForTests, rememberScreen } from '@/lib/navigation/resume'
import { __resetCustodyContextForTests } from '@/lib/session/custody-context'

// jsdom ships no PointerEvent, so Testing Library would fall back to a bare Event and drop
// clientX — every swipe would read as "didn't move" and the negative tests below would pass
// for the wrong reason. Same polyfill as SwipeToConfirm.test.tsx.
class PointerEventPolyfill extends MouseEvent {
  public readonly pointerId: number

  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
    this.pointerId = params.pointerId ?? 0
  }
}

// @ts-expect-error — installing a polyfill onto the jsdom window, which has no PointerEvent
window.PointerEvent = PointerEventPolyfill

let mockPathname = '/trips'
const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
}))

function wrapper(): HTMLElement {
  return screen.getByText('screen').parentElement!
}

beforeEach(() => {
  resetTransition()
  mockPathname = '/trips'
  mockReplace.mockClear()
  window.localStorage.clear()
  __resetCustodyContextForTests()
  // Every test is its own launch; the suites below mount screens mid-session on purpose.
  __resetColdStartForTests()
  render(<AppTemplate><p>warm-up</p></AppTemplate>).unmount()
})

describe('AppTemplate screen transitions', () => {
  it('pushes in from the trailing edge on an ordinary drill-in', () => {
    // Arrange / Act
    render(<AppTemplate><p>screen</p></AppTemplate>)

    // Assert
    expect(wrapper()).toHaveClass('animate-push-in')
  })

  it('pops in from the leading edge after a back control', () => {
    // Arrange
    markTransition('back')

    // Act
    render(<AppTemplate><p>screen</p></AppTemplate>)

    // Assert — the screen returns along the path it left by.
    expect(wrapper()).toHaveClass('animate-pop-in')
  })

  it('swaps a tab in place, without sliding', () => {
    // Arrange
    markTransition('none')

    // Act
    render(<AppTemplate><p>screen</p></AppTemplate>)

    // Assert
    expect(wrapper()).not.toHaveClass('animate-push-in')
    expect(wrapper()).not.toHaveClass('animate-pop-in')
  })

  it('resets to a drill-in once the screen has read its direction', () => {
    // Arrange
    markTransition('back')

    // Act
    render(<AppTemplate><p>screen</p></AppTemplate>)

    // Assert — the next navigation must not inherit this one's "back".
    expect(peekTransition()).toBe('forward')
  })

  it('holds the frame viewport-tall only while it slides, then drops the slide entirely', () => {
    // The slide is a transform (compositor, no per-frame layout). A transform re-anchors
    // fixed children (LoadingScreen is fixed inset-0) to this box, so the box is held
    // viewport-tall for the slide and released on animationend.
    // Arrange
    render(<AppTemplate><p>screen</p></AppTemplate>)
    expect(wrapper()).toHaveClass('animate-push-in', 'min-h-dvh')

    // Act
    fireEvent.animationEnd(wrapper())

    // Assert
    expect(wrapper()).not.toHaveClass('animate-push-in')
    expect(wrapper()).not.toHaveClass('min-h-dvh')
  })

  it("ignores a child's animation ending — only the frame's own slide ends the slide", () => {
    render(<AppTemplate><p>screen</p></AppTemplate>)

    fireEvent.animationEnd(screen.getByText('screen'))

    expect(wrapper()).toHaveClass('animate-push-in')
  })
})

describe('AppTemplate across navigations within one mounted template', () => {
  it('reads a fresh direction for every screen, not just the first', () => {
    // Regression: Next reuses the template instance when its own child segment doesn't
    // change (/trip/in-transit → /trip/phase/…), so a direction read once at mount would
    // freeze on the first screen's value and later screens would never animate.
    // Arrange
    mockPathname = '/trip/in-transit'
    const { rerender } = render(<AppTemplate><p>screen</p></AppTemplate>)
    expect(wrapper()).toHaveClass('animate-push-in')

    // Act — a back control, then the router moves to a new pathname under the same segment.
    markTransition('back')
    mockPathname = '/trip/phase/arrival/step/2-seal-verify'
    rerender(<AppTemplate><p>screen</p></AppTemplate>)

    // Assert
    expect(wrapper()).toHaveClass('animate-pop-in')
  })
})

describe('AppTemplate left-edge swipe back', () => {
  const SCREEN_WIDTH_PX = 390

  // A screen whose back control has registered `onBack`, as SubpageHeader does.
  function ScreenWithBack({ onBack }: { onBack: () => void }) {
    useEdgeBackHandler(onBack)
    return <p>screen</p>
  }

  beforeEach(() => {
    // Reduce Motion: springs land at once, so a committed swipe navigates synchronously.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: SCREEN_WIDTH_PX })
    // jsdom implements no pointer capture.
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
    markTransition('none')
  })

  function drag(fromX: number, toX: number, end: 'up' | 'cancel' = 'up') {
    const frame = wrapper()
    fireEvent.pointerDown(frame, { clientX: fromX, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(frame, { clientX: fromX + 20, clientY: 302, pointerId: 1 })
    fireEvent.pointerMove(frame, { clientX: toX, clientY: 304, pointerId: 1 })
    if (end === 'up') fireEvent.pointerUp(frame, { clientX: toX, clientY: 304, pointerId: 1 })
    else fireEvent.pointerCancel(frame, { clientX: toX, clientY: 304, pointerId: 1 })
  }

  it('goes back when dragged from the left edge past half the screen', () => {
    // Arrange
    const onBack = vi.fn()
    render(<AppTemplate><ScreenWithBack onBack={onBack} /></AppTemplate>)

    // Act
    drag(4, SCREEN_WIDTH_PX * 0.7)

    // Assert
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('springs back without navigating on a short drag', () => {
    const onBack = vi.fn()
    render(<AppTemplate><ScreenWithBack onBack={onBack} /></AppTemplate>)

    drag(4, SCREEN_WIDTH_PX * 0.2)

    expect(onBack).not.toHaveBeenCalled()
  })

  it('ignores a drag that does not start at the edge', () => {
    const onBack = vi.fn()
    render(<AppTemplate><ScreenWithBack onBack={onBack} /></AppTemplate>)

    drag(120, SCREEN_WIDTH_PX)

    expect(onBack).not.toHaveBeenCalled()
  })

  it('never goes back when the system cancels the touch', () => {
    const onBack = vi.fn()
    render(<AppTemplate><ScreenWithBack onBack={onBack} /></AppTemplate>)

    drag(4, SCREEN_WIDTH_PX * 0.9, 'cancel')

    expect(onBack).not.toHaveBeenCalled()
  })

  it('is not armed on a screen with no back action (a tab root)', () => {
    render(<AppTemplate><p>screen</p></AppTemplate>)

    expect(wrapper()).not.toHaveClass('touch-pan-y')
  })
})

// Android recreates the WebView after the document scanner or camera; the app then starts
// on Home and the driver's step is gone. The first screen of a session puts them back.
describe('AppTemplate cold-start resume (linehaul scan drop-out)', () => {
  const STEP = '/trip/phase/loading/step/1-linehaul'

  beforeEach(() => {
    __resetColdStartForTests()
  })

  it('test_a_cold_start_on_home_replays_the_remembered_step', () => {
    // Arrange — the previous session left the driver on the linehaul step (no account in
    // this harness, so the record is bound to a null actor, as the check below is).
    rememberScreen(STEP, null)
    mockPathname = '/'
    markTransition('none')

    // Act
    render(<AppTemplate><p>screen</p></AppTemplate>)

    // Assert — replaced, not pushed: Home is never left on the back stack under the step.
    expect(mockReplace).toHaveBeenCalledWith(STEP)
    expect(window.localStorage.getItem(RESUME_SCREEN_KEY)).toBeNull()
  })

  it('test_home_within_a_session_is_just_home', () => {
    mockPathname = STEP
    render(<AppTemplate><p>step</p></AppTemplate>).unmount()
    mockPathname = '/'
    markTransition('none')

    render(<AppTemplate><p>home</p></AppTemplate>)

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('test_a_step_screen_is_remembered_and_a_tab_root_forgets_it', () => {
    mockPathname = STEP
    render(<AppTemplate><p>step</p></AppTemplate>).unmount()
    expect(window.localStorage.getItem(RESUME_SCREEN_KEY)).toContain(STEP)

    mockPathname = '/trips'
    markTransition('none')
    render(<AppTemplate><p>trips</p></AppTemplate>)

    expect(window.localStorage.getItem(RESUME_SCREEN_KEY)).toBeNull()
  })

  it('test_a_cold_start_on_a_deep_link_is_left_alone', () => {
    rememberScreen(STEP, null)
    mockPathname = '/trip/in-transit'

    render(<AppTemplate><p>screen</p></AppTemplate>)

    expect(mockReplace).not.toHaveBeenCalled()
  })
})
