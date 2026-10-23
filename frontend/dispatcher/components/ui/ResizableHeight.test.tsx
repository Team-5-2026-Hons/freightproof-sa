import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { RESIZE_KEY_STEP_PX, ResizableHeight, nextHeight } from './ResizableHeight'

// jsdom has no PointerEvent, so fired pointer events would drop clientY. A MouseEvent
// subclass carries it, which is all the drag reads.
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    window.PointerEvent = class extends MouseEvent {} as unknown as typeof PointerEvent
  }
})

const BOUNDS = { initialHeight: 320, minHeight: 240, maxHeight: 800 }

function renderFrame() {
  render(<ResizableHeight {...BOUNDS} label="Resize map"><div>map</div></ResizableHeight>)
  const handle = screen.getByRole('separator', { name: 'Resize map' })
  const frame = handle.parentElement as HTMLElement
  return { handle, frame }
}

describe('nextHeight', () => {
  it('grows by how far the pointer moved down', () => {
    expect(nextHeight(320, 100, 240, 800)).toBe(420)
  })

  it('never shrinks below the minimum or grows past the maximum', () => {
    expect(nextHeight(320, -500, 240, 800)).toBe(240)
    expect(nextHeight(320, 900, 240, 800)).toBe(800)
  })
})

describe('ResizableHeight', () => {
  it('starts at the initial height and reports it to assistive tech', () => {
    const { handle, frame } = renderFrame()

    expect(frame.style.height).toBe('320px')
    expect(handle).toHaveAttribute('aria-valuenow', '320')
  })

  it('grows when the bottom handle is dragged down', () => {
    const { handle, frame } = renderFrame()

    fireEvent.pointerDown(handle, { clientY: 100 })
    fireEvent.pointerMove(window, { clientY: 250 })
    fireEvent.pointerUp(window)

    expect(frame.style.height).toBe('470px')
  })

  it('stops following the pointer once it is released', () => {
    const { handle, frame } = renderFrame()

    fireEvent.pointerDown(handle, { clientY: 100 })
    fireEvent.pointerUp(window)
    fireEvent.pointerMove(window, { clientY: 400 })

    expect(frame.style.height).toBe('320px')
  })

  it('resizes from the keyboard with the arrow keys', () => {
    const { handle, frame } = renderFrame()

    fireEvent.keyDown(handle, { key: 'ArrowDown' })

    expect(frame.style.height).toBe(`${320 + RESIZE_KEY_STEP_PX}px`)

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })

    expect(frame.style.height).toBe(`${320 - RESIZE_KEY_STEP_PX}px`)
  })
})
