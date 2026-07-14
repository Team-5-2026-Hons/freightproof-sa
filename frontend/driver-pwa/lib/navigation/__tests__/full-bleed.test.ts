// frontend/driver-pwa/app/(app)/__tests__/layout.test.tsx
import { describe, it, expect } from 'vitest'
import { isFullBleedRoute } from '@/lib/navigation/full-bleed'

// Regression test for the double sticky header bug: isFullBleedRoute must exempt every
// route whose page renders its own components/layout/SubpageHeader (or, for panic, no
// shell chrome at all) from AppShell — otherwise AppShell's sticky top bar stacks with
// the page's own sticky header, producing two stacked bars and pushing content down.
describe('isFullBleedRoute', () => {
  it('exempts the in-transit hub, checkpoint, and exception screens (all render SubpageHeader)', () => {
    expect(isFullBleedRoute('/trip/in-transit')).toBe(true)
    expect(isFullBleedRoute('/trip/in-transit/checkpoint')).toBe(true)
    expect(isFullBleedRoute('/trip/in-transit/exception')).toBe(true)
  })

  it('exempts the active trip detail and mock trip detail screens (both render SubpageHeader)', () => {
    expect(isFullBleedRoute('/trips/active')).toBe(true)
    expect(isFullBleedRoute('/trips/2c9f1e0a-0000-4000-8000-000000000001')).toBe(true)
  })

  it('still exempts panic (bare full-bleed) and handshake steps (own StepHeader)', () => {
    expect(isFullBleedRoute('/trip/panic')).toBe(true)
    expect(isFullBleedRoute('/trip/panic/submitted')).toBe(true)
    expect(isFullBleedRoute('/trip/handshake/1/step/1-approach-gate')).toBe(true)
  })

  it('does NOT exempt the bare trips list — it has no SubpageHeader and keeps AppShell', () => {
    expect(isFullBleedRoute('/trips')).toBe(false)
  })

  it('does not exempt unrelated top-level routes', () => {
    expect(isFullBleedRoute('/')).toBe(false)
    expect(isFullBleedRoute('/settings')).toBe(false)
    expect(isFullBleedRoute('/login')).toBe(false)
  })
})
