import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, TOAST_AUTO_DISMISS_MS } from '@/lib/context/ToastContext'
import { useToast } from '@/lib/hooks/useToast'
import { toastForEvent, type ToastRequest } from './ranking'
import type { EventSeverity, RealtimeEvent, RealtimeKind } from './types'

afterEach(() => vi.useRealTimers())

function event(kind: RealtimeKind, severity: EventSeverity = 'info'): RealtimeEvent {
  return {
    resource: 'trip',
    id: '11111111-1111-1111-1111-111111111111',
    kind,
    severity,
    ts: '2026-09-03T10:00:00Z',
  }
}

function ToastHarness({ toast }: { toast: ToastRequest }) {
  const { notify } = useToast()
  return createElement('button', { onClick: () => notify(toast) }, 'Show warning')
}

describe('toastForEvent', () => {
  it('stays silent on ordinary progress', () => {
    expect(toastForEvent(event('trip_created'))).toBeNull()
    expect(toastForEvent(event('phase_completed'))).toBeNull()
    expect(toastForEvent(event('trip_closed'))).toBeNull()
  })

  it('does not raise an alert for progress even when it arrives as critical', () => {
    // Severity ranks exceptions; it does not turn a completion into an alarm. Guards
    // against a future emitter setting a band on a lifecycle event and unexpectedly
    // interrupting every dispatcher in the org.
    expect(toastForEvent(event('phase_completed', 'critical'))).toBeNull()
  })

  it('raises a critical alert for a critical exception', () => {
    const toast = toastForEvent(event('exception_raised', 'critical'))

    expect(toast).not.toBeNull()
    expect(toast!.title).toBe('Critical exception')
    expect(toast!.kind).toBe('error')
    expect(toast!.priority).toBe('critical')
  })

  it('raises an ordinary auto-dismissing warning for a warning exception', () => {
    const toast = toastForEvent(event('exception_raised', 'warning'))

    expect(toast!.title).toBe('Exception raised')
    expect(toast!.kind).toBe('warning')
    expect(toast!.priority).toBe('ordinary')
    expect(toast!.body).not.toBe(
      toastForEvent(event('exception_raised', 'critical'))!.body,
    )
  })

  it('ranks a critical exception above a warning one', () => {
    // The regression that motivated splitting severity out of the kind. Before it, a
    // driver's panic button published as an ordinary exception while system-detected
    // seal checks published as loud ones — so a hijacking in progress was quieter on
    // the dispatcher's screen than a parcel-count mismatch. Both now arrive as
    // `exception_raised` and are separated only by the band they carry.
    const panic = toastForEvent(event('exception_raised', 'critical'))
    const countCheck = toastForEvent(event('exception_raised', 'warning'))

    expect(panic!.title).toBe('Critical exception')
    expect(countCheck!.title).toBe('Exception raised')
    expect(panic!.title).not.toBe(countCheck!.title)
    // Wording is not ranking. Priority decides which toast survives a burst.
    expect(panic!.priority).toBe('critical')
    expect(countCheck!.priority).toBe('ordinary')
  })

  it('keeps only critical exception alerts sticky', () => {
    expect(toastForEvent(event('exception_raised', 'critical'))!.kind).toBe('error')
    expect(toastForEvent(event('exception_raised', 'warning'))!.kind).toBe('warning')
  })

  it('auto-dismisses a warning exception on the existing timeout', () => {
    vi.useFakeTimers()
    const toast = toastForEvent(event('exception_raised', 'warning'))
    render(createElement(
      ToastProvider,
      null,
      createElement(ToastHarness, { toast: toast! }),
    ))
    fireEvent.click(screen.getByRole('button', { name: 'Show warning' }))

    // The provider owns the shared timeout; the rendered ToastItem has no timer of its own.
    act(() => vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS - 1))
    expect(screen.getByText('Exception raised')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByText('Exception raised')).not.toBeInTheDocument()
  })

  it('stays silent on an exception review event', () => {
    expect(toastForEvent(event('exception_reviewed'))).toBeNull()
  })

  it('stays silent on an info-severity exception raise', () => {
    expect(toastForEvent(event('exception_raised', 'info'))).toBeNull()
  })

  it('leaks nothing the channel does not carry', () => {
    // POPIA: the stream carries an id and a kind. No driver name, no seal number, no
    // trip reference may appear in copy the dispatcher reads before opening the trip.
    // INFO is excluded because it raises no toast at all — covered above.
    for (const severity of ['critical', 'warning'] as const) {
      const toast = toastForEvent(event('exception_raised', severity))
      const text = `${toast!.title} ${toast!.body ?? ''}`

      expect(text).not.toContain('11111111')
      expect(text).not.toMatch(/seal[- ]?\d/i)
      expect(text).not.toMatch(/\bdriver\b/i)
    }
  })
})
