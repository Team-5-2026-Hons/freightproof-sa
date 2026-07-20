// Covers the three UX fixes layered onto HoldButton (plan 2026-07-02 Task 1):
//   1a early-release hint, 1b long-label sizing, 1c tap-to-confirm accessibility mode.
// A prior walkthrough saw testers tap a hold button 20 times believing it was broken —
// these tests lock in the feedback affordance so that regression can't return silently.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { HoldButton } from '../HoldButton'
import { setTapToConfirmPref, PREF_TAP_TO_CONFIRM } from '@/lib/constants/preferences'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const HOLD_MS = 2000
const HINT_MS = 1500
const ARM_MS = 3000
const FLOURISH_MS = 180

describe('HoldButton — early-release hint (1a)', () => {
  it('shows "Keep holding…" when a press ends before the hold completes', () => {
    const onConfirm = vi.fn()
    render(<HoldButton label="Confirm" durationMs={HOLD_MS} onConfirm={onConfirm} />)

    const button = screen.getByRole('button')
    fireEvent.pointerDown(button)
    fireEvent.pointerUp(button)

    expect(screen.getByText('Keep holding…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Press and hold to confirm')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('clears the hint after HINT_DURATION_MS', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<HoldButton label="Confirm" durationMs={HOLD_MS} onConfirm={onConfirm} />)

    const button = screen.getByRole('button')
    fireEvent.pointerDown(button)
    fireEvent.pointerUp(button)

    expect(screen.getByText('Keep holding…')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(HINT_MS)
    })

    expect(screen.queryByText('Keep holding…')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('fires onConfirm when a hold completes (no false hint)', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<HoldButton label="Confirm" durationMs={HOLD_MS} onConfirm={onConfirm} />)

    const button = screen.getByRole('button')
    fireEvent.pointerDown(button)

    // Let the hold progress reach 1 (interval reads mocked Date.now), then release.
    act(() => {
      vi.advanceTimersByTime(HOLD_MS)
    })
    fireEvent.pointerUp(button)

    // Flourish delay before the handoff.
    act(() => {
      vi.advanceTimersByTime(FLOURISH_MS)
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Keep holding…')).not.toBeInTheDocument()
  })
})

describe('HoldButton — long-label sizing (1b)', () => {
  it('uses text-[10px] for labels longer than LONG_LABEL_CHARS', () => {
    const longLabel = 'Submit (flag mismatch)' // 22 chars
    render(<HoldButton label={longLabel} onConfirm={vi.fn()} />)

    expect(screen.getByText(longLabel)).toHaveClass('text-[10px]')
  })

  it('uses text-xs for short labels', () => {
    render(<HoldButton label="Confirm" onConfirm={vi.fn()} />)

    expect(screen.getByText('Confirm')).toHaveClass('text-xs')
  })
})

describe('HoldButton — tap-to-confirm mode (1c)', () => {
  it('fires onConfirm on the second tap when the pref is enabled', () => {
    vi.useFakeTimers()
    setTapToConfirmPref(true)
    expect(window.localStorage.getItem(PREF_TAP_TO_CONFIRM)).toBe('true')

    const onConfirm = vi.fn()
    render(<HoldButton label="Confirm" onConfirm={onConfirm} />)

    const button = screen.getByRole('button')

    fireEvent.pointerDown(button)
    expect(screen.getByText('Tap again to confirm')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.pointerDown(button)
    act(() => {
      vi.advanceTimersByTime(FLOURISH_MS)
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('auto-disarms after ARM_TIMEOUT_MS, requiring re-arming', () => {
    vi.useFakeTimers()
    setTapToConfirmPref(true)

    const onConfirm = vi.fn()
    render(<HoldButton label="Confirm" onConfirm={onConfirm} />)

    const button = screen.getByRole('button')

    fireEvent.pointerDown(button) // arm
    expect(screen.getByText('Tap again to confirm')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(ARM_MS)
    })
    expect(screen.queryByText('Tap again to confirm')).not.toBeInTheDocument()

    // A tap after auto-disarm re-arms rather than confirming.
    fireEvent.pointerDown(button)
    expect(screen.getByText('Tap again to confirm')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.pointerDown(button)
    act(() => {
      vi.advanceTimersByTime(FLOURISH_MS)
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

// Objective 1: onConfirm may now be async (submitAndAdvance uploads photos + calls the
// backend, which can take seconds). Without a visible busy state the driver sees a dead
// button and can trigger duplicate submits by holding again.
describe('HoldButton — busy state for async onConfirm (Objective 1)', () => {
  function completeHold(button: HTMLElement) {
    fireEvent.pointerDown(button)
    act(() => {
      vi.advanceTimersByTime(HOLD_MS)
    })
    fireEvent.pointerUp(button)
    act(() => {
      vi.advanceTimersByTime(FLOURISH_MS)
    })
  }

  it('enters a busy state (disabled + spinner) while the returned promise is pending, and clears it on resolve', async () => {
    vi.useFakeTimers()
    let resolveConfirm!: () => void
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { resolveConfirm = resolve }))
    render(<HoldButton label="Confirm" durationMs={HOLD_MS} onConfirm={onConfirm} />)

    const button = screen.getByRole('button')
    completeHold(button)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    expect(screen.getByText('Submitting…')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    await act(async () => {
      resolveConfirm()
      await Promise.resolve()
    })

    expect(button).not.toBeDisabled()
    expect(screen.queryByText('Submitting…')).not.toBeInTheDocument()
  })

  it('releases the busy state on rejection and surfaces the error instead of swallowing it', async () => {
    vi.useFakeTimers()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejectConfirm!: (err: Error) => void
    const onConfirm = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectConfirm = reject }))
    render(<HoldButton label="Confirm" durationMs={HOLD_MS} onConfirm={onConfirm} />)

    const button = screen.getByRole('button')
    completeHold(button)
    expect(button).toBeDisabled()

    const err = new Error('boom')
    await act(async () => {
      rejectConfirm(err)
      // Allow the rejection handler's microtask to run.
      await Promise.resolve()
    })

    expect(button).not.toBeDisabled()
    expect(consoleErrorSpy).toHaveBeenCalledWith('HoldButton: onConfirm rejected', err)

    consoleErrorSpy.mockRestore()
  })

  it('does not retrigger onConfirm while a prior submit is still in flight', async () => {
    vi.useFakeTimers()
    let resolveConfirm!: () => void
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { resolveConfirm = resolve }))
    render(<HoldButton label="Confirm" durationMs={HOLD_MS} onConfirm={onConfirm} />)

    const button = screen.getByRole('button')
    completeHold(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // The button is disabled, but exercise the internal re-entry guard directly (not just
    // the disabled attribute) — jsdom's fireEvent can still dispatch pointer events at a
    // disabled element.
    completeHold(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveConfirm()
      await Promise.resolve()
    })
  })

  it('a synchronous (non-promise) onConfirm never enters a busy state', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<HoldButton label="Confirm" durationMs={HOLD_MS} onConfirm={onConfirm} />)

    const button = screen.getByRole('button')
    completeHold(button)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(button).not.toBeDisabled()
    expect(screen.queryByText('Submitting…')).not.toBeInTheDocument()
  })
})
