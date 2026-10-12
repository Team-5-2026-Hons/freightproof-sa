import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AppTemplate from '../template'
import { markTransition, peekTransition, resetTransition } from '@/lib/navigation/transition-direction'

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

  it('moves the screen with `left` on a relative box, never a transform', () => {
    // A transform would re-anchor fixed children (LoadingScreen is fixed inset-0) to the
    // sliding box while the animation runs.
    render(<AppTemplate><p>screen</p></AppTemplate>)

    expect(wrapper()).toHaveClass('relative')
    expect(wrapper().className).not.toMatch(/translate/)
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
