// frontend/receiver/components/Swipe.test.tsx
//
// Covers the drag-completion threshold and the double-fire guard described in the
// component's own comments — both are safety properties for a single-use capability
// token, not incidental behaviour. See vitest.setup.ts for the jsdom polyfills (jsdom
// implements neither ResizeObserver nor the Pointer Events API) that make the drag
// math exercisable here at all.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Swipe } from './Swipe'
import { setMockTrackClientWidthPx } from '../vitest.setup'

// With the mock track width from vitest.setup.ts (300px) and the component's own
// THUMB_SIZE_PX (56) / TRACK_PADDING_PX (4) constants, maxOffset works out to 236px.
// jsdom's getBoundingClientRect() always returns a zeroed rect, so a pointer's clientX
// alone determines the resulting offset once TRACK_PADDING_PX and half the thumb width
// are subtracted (see Swipe.tsx's handlePointerMove).
const COMPLETING_CLIENT_X = 250 // → offset 218 of 236 (~92%), over the 90% threshold
const PARTIAL_CLIENT_X = 100 // → offset 68 of 236 (~29%), well under the threshold

async function dragTrack(track: HTMLElement, clientX: number): Promise<void> {
  fireEvent.pointerDown(track, { pointerId: 1 })
  fireEvent.pointerMove(track, { pointerId: 1, clientX })
  fireEvent.pointerUp(track, { pointerId: 1 })
}

afterEach(() => {
  setMockTrackClientWidthPx(300)
})

describe('Swipe', () => {
  it('does not fire on a partial swipe', async () => {
    const onConfirm = vi.fn()
    render(<Swipe label="Swipe to confirm" onConfirm={onConfirm} />)
    const track = screen.getByRole('button', { name: 'Swipe to confirm' })

    await dragTrack(track, PARTIAL_CLIENT_X)

    // Nothing here is scheduled asynchronously on the partial path (only the settle-back
    // snap, which never calls onConfirm), so there is nothing to wait for.
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('fires once on a completed swipe', async () => {
    const onConfirm = vi.fn()
    render(<Swipe label="Swipe to confirm" onConfirm={onConfirm} />)
    const track = screen.getByRole('button', { name: 'Swipe to confirm' })

    await dragTrack(track, COMPLETING_CLIENT_X)

    // fire() dispatches after SETTLE_DURATION_MS, once the thumb has visually snapped
    // to the end of the track.
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('does not fire twice when a keyboard activation follows a completed drag', async () => {
    const onConfirm = vi.fn()
    render(<Swipe label="Swipe to confirm" onConfirm={onConfirm} />)
    const track = screen.getByRole('button', { name: 'Swipe to confirm' })

    await dragTrack(track, COMPLETING_CLIENT_X)
    // Fired before the drag's own settle-triggered fire() has run — hasFiredRef must
    // stop whichever of the two arrives second, since the token is single-use.
    fireEvent.keyDown(track, { key: 'Enter' })

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('fires via Enter', () => {
    const onConfirm = vi.fn()
    render(<Swipe label="Swipe to confirm" onConfirm={onConfirm} />)
    const track = screen.getByRole('button', { name: 'Swipe to confirm' })

    fireEvent.keyDown(track, { key: 'Enter' })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('fires via Space', () => {
    const onConfirm = vi.fn()
    render(<Swipe label="Swipe to confirm" onConfirm={onConfirm} />)
    const track = screen.getByRole('button', { name: 'Swipe to confirm' })

    fireEvent.keyDown(track, { key: ' ' })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all when disabled', async () => {
    const onConfirm = vi.fn()
    render(<Swipe label="Swipe to confirm" disabled onConfirm={onConfirm} />)
    const track = screen.getByRole('button', { name: 'Swipe to confirm' })

    await dragTrack(track, COMPLETING_CLIENT_X)
    fireEvent.keyDown(track, { key: 'Enter' })
    fireEvent.keyDown(track, { key: ' ' })

    expect(onConfirm).not.toHaveBeenCalled()
  })
})
