import { describe, expect, it } from 'vitest'
import { toastForEvent } from './ranking'
import type { EventSeverity, RealtimeEvent, RealtimeKind } from './types'

function event(kind: RealtimeKind, severity: EventSeverity = 'info'): RealtimeEvent {
  return {
    resource: 'trip',
    id: '11111111-1111-1111-1111-111111111111',
    kind,
    severity,
    ts: '2026-09-03T10:00:00Z',
  }
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
  })

  it('raises the ordinary alert for a warning exception', () => {
    const toast = toastForEvent(event('exception_raised', 'warning'))

    expect(toast!.title).toBe('Exception raised')
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
  })

  it('never auto-dismisses an alert', () => {
    // ToastContext exempts `error` from the auto-dismiss timer. A warning nobody was
    // at the desk to see is a warning that did not happen.
    expect(toastForEvent(event('exception_raised', 'critical'))!.kind).toBe('error')
    expect(toastForEvent(event('exception_raised', 'warning'))!.kind).toBe('error')
  })

  it('stays silent on an info-severity exception event', () => {
    // A RESOLUTION, not a new exception: exception_service.resolve_exception publishes
    // exception_raised at INFO so the queue refetches. Ranking on kind alone turned every
    // resolution into a sticky red "Exception raised" on every colleague's screen — an
    // alarm for an incident that had just been closed.
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
