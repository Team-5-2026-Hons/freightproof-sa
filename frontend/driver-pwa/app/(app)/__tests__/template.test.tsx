import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AppTemplate from '../template'
import { markTransition, peekTransition, resetTransition } from '@/lib/navigation/transition-direction'
import { useEdgeBackHandler } from '@/lib/navigation/edge-back'

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
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

function wrapper(): HTMLElement {
  return screen.getByText('screen').parentElement!
}

beforeEach(() => {
  resetTransition()
  mockPathname = '/trips'
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
