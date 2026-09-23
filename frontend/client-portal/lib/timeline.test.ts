import { describe, expect, it } from 'vitest'
import { buildTimeline } from './timeline'
import { makeCheckpoint, makeException, makeManifest, makePhase } from '@/test/factories'

describe('buildTimeline', () => {
  it('interleaves phases, checkpoints and exceptions in time order', () => {
    // Arrange
    const manifest = makeManifest({
      phases: [makePhase(0, 'trip_creation'), makePhase(3, 'departure'), makePhase(6, 'confirmation')],
      checkpoints: [makeCheckpoint({ recorded_at: '2026-09-12T10:00:00Z' })],
      exceptions: [makeException('panic_button', 'critical', { raised_at: '2026-09-12T11:00:00Z' })],
    })

    // Act
    const kinds = buildTimeline(manifest).map((item) => `${item.kind}:${item.id}`)

    // Assert
    expect(kinds).toEqual([
      'phase:phase-0', 'phase:phase-3', 'checkpoint:cp-1', 'exception:exc-panic_button', 'phase:phase-6',
    ])
  })

  it('keeps pending phases at the end in plan order', () => {
    // Arrange
    const manifest = makeManifest({
      phases: [
        makePhase(5, 'unloading', { status: 'pending', completed_at: null }),
        makePhase(0, 'trip_creation'),
        makePhase(6, 'confirmation', { status: 'pending', completed_at: null }),
      ],
    })

    // Act
    const items = buildTimeline(manifest)

    // Assert
    expect(items.map((i) => i.id)).toEqual(['phase-0', 'phase-5', 'phase-6'])
    expect(items[1].pending).toBe(true)
  })

  it('numbers exceptions E1, E2 in the order the pack lists them', () => {
    // Arrange
    const manifest = makeManifest({
      exceptions: [
        makeException('panic_button', 'critical', { raised_at: '2026-09-12T11:00:00Z' }),
        makeException('route_deviation', 'warning', { raised_at: '2026-09-12T09:00:00Z' }),
      ],
    })

    // Act
    const titles = buildTimeline(manifest).map((i) => i.title)

    // Assert
    expect(titles).toEqual(['E2 · Route deviation', 'E1 · Panic button'])
  })
})
