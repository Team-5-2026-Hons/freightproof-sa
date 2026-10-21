// frontend/receiver/components/Swipe.test.tsx
//
// Covers the drag-completion threshold, the double-fire guard and the re-arm after a soft
// failure described in the component's own comments — all are safety properties for a
// single-use capability token, not incidental behaviour. See vitest.setup.ts for the jsdom
// polyfills (ResizeObserver, pointer capture, a measurable clientWidth) that make the drag
// math exercisable here at all.
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Swipe } from './Swipe'
import { setMockTrackClientWidthPx } from '../vitest.setup'

const LABEL = 'Swipe to confirm'

// With the mock track width from vitest.setup.ts (300px) and the component's own
// THUMB_SIZE_PX (56) / TRACK_PADDING_PX (4) constants, maxOffset works out to 236px.
const MAX_OFFSET_PX = 236

// jsdom's getBoundingClientRect() always returns a zeroed rect, so the track starts at x=0
// and the resting thumb at x=4 (the track padding). A finger landing on the thumb's centre
// grabs it 28px in, which makes the resulting offset simply `clientX - 32`.
const THUMB_REST_LEFT_PX = 4
const THUMB_WIDTH_PX = 56
const GRAB_CLIENT_X = THUMB_REST_LEFT_PX + THUMB_WIDTH_PX / 2
const COMPLETING_CLIENT_X = 250 // → offset 218 of 236 (~92%), over the 90% threshold
const PARTIAL_CLIENT_X = 100 // → offset 68 of 236 (~29%), well under the threshold
const AWAY_FROM_THUMB_CLIENT_X = 200

// Longer than the component's SETTLE_DURATION_MS (180): long enough for a scheduled fire to have run.
const PAST_SETTLE_MS = 400

const POINTER_ID = 1

const THUMB_REST_RECT = {
  left: THUMB_REST_LEFT_PX,
  right: THUMB_REST_LEFT_PX + THUMB_WIDTH_PX,
  top: 0,
  bottom: THUMB_WIDTH_PX,
  width: THUMB_WIDTH_PX,
  height: THUMB_WIDTH_PX,
  x: THUMB_REST_LEFT_PX,
  y: 0,
  toJSON: () => ({}),
} as DOMRect

function getTrack(): HTMLElement {
  return screen.getByRole('button', { name: LABEL })
}

function getThumb(): HTMLElement {
  const thumb = screen.getByTestId('swipe-thumb')
  vi.spyOn(thumb, 'getBoundingClientRect').mockReturnValue(THUMB_REST_RECT)
  return thumb
}

function thumbOffsetPx(): number {
  const match = /translateX\((-?[\d.]+)px\)/.exec(screen.getByTestId('swipe-thumb').style.transform)
  if (match === null) throw new Error('thumb has no translateX transform')
  return Number(match[1])
}

function pointerInit(clientX: number, overrides: PointerEventInit = {}): PointerEventInit {
  return { pointerId: POINTER_ID, isPrimary: true, clientX, ...overrides }
}

type PointerEventName = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel'

/**
 * fireEvent for pointer events. The PointerEvent polyfill in vitest.setup.ts keeps
 * pointerId and clientX but drops `isPrimary`, which the component now checks, so it is
 * stamped onto the event here. Like the real API, it defaults to false when not given.
 */
function firePointer(name: PointerEventName, target: Element, init: PointerEventInit): void {
  const event = createEvent[name](target, init)
  Object.defineProperty(event, 'isPrimary', { value: init.isPrimary ?? false })
  fireEvent(target, event)
}

/** A real swipe: lands on the thumb, drags, lets go. */
function dragThumb(clientX: number): void {
  firePointer('pointerDown', getThumb(), pointerInit(GRAB_CLIENT_X))
  firePointer('pointerMove', getTrack(), pointerInit(clientX))
  firePointer('pointerUp', getTrack(), pointerInit(clientX))
}

async function waitPastSettle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAST_SETTLE_MS)
  })
}

beforeEach(() => {
  setMockTrackClientWidthPx(300)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Swipe', () => {
  it('does not fire on a partial swipe', () => {
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    dragThumb(PARTIAL_CLIENT_X)

    // Nothing here is scheduled asynchronously on the partial path (only the settle-back
    // snap, which never calls onConfirm), so there is nothing to wait for.
    expect(onConfirm).not.toHaveBeenCalled()
    expect(thumbOffsetPx()).toBe(0)
  })

  it('fires once on a completed swipe', async () => {
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    dragThumb(COMPLETING_CLIENT_X)

    // fire() dispatches after SETTLE_DURATION_MS, once the thumb has visually snapped
    // to the end of the track.
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('does not fire twice when a keyboard activation follows a completed drag', async () => {
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    dragThumb(COMPLETING_CLIENT_X)
    // Fired before the drag's own settle-triggered fire() has run — hasFiredRef must
    // stop whichever of the two arrives second, since the token is single-use.
    fireEvent.keyDown(getTrack(), { key: 'Enter' })

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('fires via Enter', () => {
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    fireEvent.keyDown(getTrack(), { key: 'Enter' })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('fires via Space', () => {
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    fireEvent.keyDown(getTrack(), { key: ' ' })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all when disabled', () => {
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} disabled onConfirm={onConfirm} />)

    dragThumb(COMPLETING_CLIENT_X)
    fireEvent.keyDown(getTrack(), { key: 'Enter' })
    fireEvent.keyDown(getTrack(), { key: ' ' })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delivery without swiping' }))

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('snaps the thumb back to the start when it becomes disabled at the far end', async () => {
    vi.useFakeTimers()
    const { rerender } = render(<Swipe label={LABEL} onConfirm={vi.fn()} />)
    dragThumb(COMPLETING_CLIENT_X)
    expect(thumbOffsetPx()).toBe(MAX_OFFSET_PX)

    rerender(<Swipe label={LABEL} disabled onConfirm={vi.fn()} />)
    await waitPastSettle()

    expect(thumbOffsetPx()).toBe(0)
  })
})

describe('Swipe drag origin', () => {
  it('ignores a press on the track away from the thumb: it neither moves nor fires', async () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)
    const track = getTrack()

    // Pointer lands on the bare track, then slides all the way across.
    firePointer('pointerDown', track, pointerInit(AWAY_FROM_THUMB_CLIENT_X))
    firePointer('pointerMove', track, pointerInit(COMPLETING_CLIENT_X))
    // Checked mid-gesture: after the release the thumb would spring back whatever happened.
    expect(thumbOffsetPx()).toBe(0)
    firePointer('pointerUp', track, pointerInit(COMPLETING_CLIENT_X))
    await waitPastSettle()

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not teleport the thumb to the finger: the grab point stays under it', () => {
    render(<Swipe label={LABEL} onConfirm={vi.fn()} />)
    const track = getTrack()

    // Grab the thumb at its right-hand edge (52px in) rather than its centre.
    firePointer('pointerDown', getThumb(), pointerInit(THUMB_REST_LEFT_PX + 52))
    firePointer('pointerMove', track, pointerInit(THUMB_REST_LEFT_PX + 52 + PARTIAL_CLIENT_X))

    // Moved by exactly the finger's travel, not recentred on it.
    expect(thumbOffsetPx()).toBe(PARTIAL_CLIENT_X)
  })

  it('ignores a pointer that is not the primary one', async () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)
    const track = getTrack()

    firePointer('pointerDown', getThumb(), pointerInit(GRAB_CLIENT_X, { isPrimary: false }))
    firePointer('pointerMove', track, pointerInit(COMPLETING_CLIENT_X, { isPrimary: false }))
    firePointer('pointerUp', track, pointerInit(COMPLETING_CLIENT_X, { isPrimary: false }))
    await waitPastSettle()

    expect(thumbOffsetPx()).toBe(0)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('ignores a second pointer while another is dragging', async () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)
    const track = getTrack()
    const otherPointer = { pointerId: POINTER_ID + 1 }

    firePointer('pointerDown', getThumb(), pointerInit(GRAB_CLIENT_X))
    firePointer('pointerMove', track, pointerInit(COMPLETING_CLIENT_X, otherPointer))
    expect(thumbOffsetPx()).toBe(0)

    firePointer('pointerUp', track, pointerInit(COMPLETING_CLIENT_X, otherPointer))
    await waitPastSettle()

    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('Swipe cancelled gesture', () => {
  it('does not fire when the pointer is cancelled past the threshold, and returns the thumb', async () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    firePointer('pointerDown', getThumb(), pointerInit(GRAB_CLIENT_X))
    firePointer('pointerMove', getTrack(), pointerInit(COMPLETING_CLIENT_X))
    expect(thumbOffsetPx()).toBeGreaterThan(MAX_OFFSET_PX * 0.9)
    firePointer('pointerCancel', getTrack(), pointerInit(COMPLETING_CLIENT_X))
    await waitPastSettle()

    expect(onConfirm).not.toHaveBeenCalled()
    expect(thumbOffsetPx()).toBe(0)
  })
})

describe('Swipe re-arming after a soft failure', () => {
  it.each([
    ['resolves', () => vi.fn().mockResolvedValue(undefined)],
    ['rejects', () => vi.fn().mockRejectedValue(new Error('network down'))],
  ])('fires again on a second completed swipe once onConfirm %s and the control is usable again', async (_name, makeConfirm) => {
    // A rejection is logged by the component, not left unhandled.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onConfirm = makeConfirm()
    const { rerender } = render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    dragThumb(COMPLETING_CLIENT_X)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))

    // The parent's lifecycle around a failed attempt: busy while working, then usable again.
    rerender(<Swipe label={LABEL} busy onConfirm={onConfirm} />)
    rerender(<Swipe label={LABEL} onConfirm={onConfirm} />)
    expect(thumbOffsetPx()).toBe(0)

    dragThumb(COMPLETING_CLIENT_X)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
  })

  it('allows Enter to fire again after an attempt has settled', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    fireEvent.keyDown(getTrack(), { key: 'Enter' })
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    // Let the finally block that releases the guard run.
    await act(async () => { await Promise.resolve() })
    fireEvent.keyDown(getTrack(), { key: 'Enter' })

    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('does not dispatch twice for a held key', () => {
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    fireEvent.keyDown(getTrack(), { key: 'Enter' })
    fireEvent.keyDown(getTrack(), { key: 'Enter', repeat: true })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch a second time while the first attempt is still in flight', async () => {
    let finish: () => void = () => {}
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    fireEvent.keyDown(getTrack(), { key: 'Enter' })
    fireEvent.keyDown(getTrack(), { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await act(async () => { finish() })
  })
})

describe('Swipe busy', () => {
  it('parks the thumb at the far end and keeps the label visible and announced', () => {
    render(<Swipe label="Confirming…" busy onConfirm={vi.fn()} />)

    expect(thumbOffsetPx()).toBe(MAX_OFFSET_PX)
    const label = screen.getByText('Confirming…')
    expect(label).toHaveAttribute('aria-live', 'polite')
    expect(label).toHaveStyle({ opacity: '1' })
  })

  it('ignores drags, keys and the assistive button while busy', async () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<Swipe label="Confirming…" busy onConfirm={onConfirm} />)
    const track = screen.getByRole('button', { name: 'Confirming…' })

    firePointer('pointerDown', getThumb(), pointerInit(GRAB_CLIENT_X))
    firePointer('pointerMove', track, pointerInit(PARTIAL_CLIENT_X))
    firePointer('pointerUp', track, pointerInit(PARTIAL_CLIENT_X))
    fireEvent.keyDown(track, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delivery without swiping' }))
    await waitPastSettle()

    expect(onConfirm).not.toHaveBeenCalled()
    expect(thumbOffsetPx()).toBe(MAX_OFFSET_PX)
  })

  it('does not snap to the start when busy begins, unlike disabled', () => {
    const { rerender } = render(<Swipe label={LABEL} onConfirm={vi.fn()} />)
    dragThumb(COMPLETING_CLIENT_X)

    rerender(<Swipe label={LABEL} busy onConfirm={vi.fn()} />)

    expect(thumbOffsetPx()).toBe(MAX_OFFSET_PX)
  })

  it('brings the thumb home when busy ends', async () => {
    vi.useFakeTimers()
    const { rerender } = render(<Swipe label={LABEL} busy onConfirm={vi.fn()} />)
    expect(thumbOffsetPx()).toBe(MAX_OFFSET_PX)

    rerender(<Swipe label={LABEL} onConfirm={vi.fn()} />)
    await waitPastSettle()

    expect(thumbOffsetPx()).toBe(0)
  })
})

describe('Swipe assistive button', () => {
  it('fires onConfirm once, even when pressed twice before the first settles', () => {
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)
    const button = screen.getByRole('button', { name: 'Confirm delivery without swiping' })

    fireEvent.click(button)
    fireEvent.click(button)

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shares the guard with the swipe: a button press inside the settle window is refused', async () => {
    const onConfirm = vi.fn()
    render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    dragThumb(COMPLETING_CLIENT_X)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delivery without swiping' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('is a real button, reachable by Tab', () => {
    render(<Swipe label={LABEL} onConfirm={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Confirm delivery without swiping' })

    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
  })
})

describe('Swipe unmount', () => {
  it('does not confirm a delivery if unmounted inside the settle window', async () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    const { unmount } = render(<Swipe label={LABEL} onConfirm={onConfirm} />)

    dragThumb(COMPLETING_CLIENT_X)
    unmount()
    await waitPastSettle()

    expect(onConfirm).not.toHaveBeenCalled()
  })
})
