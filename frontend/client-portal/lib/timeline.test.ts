import { describe, expect, it } from 'vitest'
import { buildTimeline, compareInstants, instantMs } from './timeline'
import { makeCheckpoint, makeException, makeManifest, makePhase } from '@/test/factories'

describe('buildTimeline', () => {
  it('interleaves phases, checkpoints and exceptions in time order', () => {
    const manifest = makeManifest({
      phases: [makePhase(0, 'trip_creation'), makePhase(3, 'departure'), makePhase(6, 'confirmation')],
      checkpoints: [makeCheckpoint({ recorded_at: '2026-09-12T10:00:00Z' })],
      exceptions: [makeException('panic_button', 'critical', { raised_at: '2026-09-12T11:00:00Z' })],
    })

    const kinds = buildTimeline(manifest).map((item) => `${item.kind}:${item.id}`)

    expect(kinds).toEqual([
      'phase:phase-0', 'phase:phase-3', 'checkpoint:cp-1', 'exception:exc-panic_button', 'phase:phase-6',
    ])
  })

  it('keeps pending phases at the end in plan order', () => {
    const manifest = makeManifest({
      phases: [
        makePhase(5, 'unloading', { status: 'pending', completed_at: null }),
        makePhase(0, 'trip_creation'),
        makePhase(6, 'confirmation', { status: 'pending', completed_at: null }),
      ],
    })

    const items = buildTimeline(manifest)

    expect(items.map((i) => i.id)).toEqual(['phase-0', 'phase-5', 'phase-6'])
    expect(items[1].pending).toBe(true)
  })

  it('numbers exceptions E1, E2 in the order the pack lists them', () => {
    const manifest = makeManifest({
      exceptions: [
        makeException('panic_button', 'critical', { raised_at: '2026-09-12T11:00:00Z' }),
        makeException('route_deviation', 'warning', { raised_at: '2026-09-12T09:00:00Z' }),
      ],
    })

    const titles = buildTimeline(manifest).map((i) => i.title)

    expect(titles).toEqual(['E2 · Route deviation', 'E1 · Panic button'])
  })
})

describe('buildTimeline — chronology', () => {
  it('orders a fractional second after the whole second it follows, which string order gets wrong', () => {
    const manifest = makeManifest({
      checkpoints: [
        makeCheckpoint({ checkpoint_id: 'later', recorded_at: '2026-09-12T10:00:00.25Z' }),
        makeCheckpoint({ checkpoint_id: 'earlier', recorded_at: '2026-09-12T10:00:00Z' }),
      ],
    })

    const ids = buildTimeline(manifest).map((i) => i.id)

    expect(ids).toEqual(['earlier', 'later'])
  })

  it('compares instants, not clock text, when offsets differ', () => {
    const manifest = makeManifest({
      checkpoints: [
        makeCheckpoint({ checkpoint_id: 'utc-11', recorded_at: '2026-09-12T11:00:00Z' }),
        makeCheckpoint({ checkpoint_id: 'sast-12', recorded_at: '2026-09-12T12:00:00+02:00' }),
      ],
    })

    const ids = buildTimeline(manifest).map((i) => i.id)

    expect(ids).toEqual(['sast-12', 'utc-11'])
  })

  it('puts an unparsable time last instead of corrupting the order', () => {
    const manifest = makeManifest({
      checkpoints: [
        makeCheckpoint({ checkpoint_id: 'broken', recorded_at: 'garbage' }),
        makeCheckpoint({ checkpoint_id: 'ok-2', recorded_at: '2026-09-12T10:00:00Z' }),
        makeCheckpoint({ checkpoint_id: 'ok-1', recorded_at: '2026-09-12T09:00:00Z' }),
      ],
    })

    expect(buildTimeline(manifest).map((i) => i.id)).toEqual(['ok-1', 'ok-2', 'broken'])
  })
})

describe('instant helpers', () => {
  it('reads the offset and the fraction', () => {
    expect(instantMs('2026-09-12T12:00:00+02:00')).toBe(instantMs('2026-09-12T10:00:00Z'))
    expect(instantMs('2026-09-12T10:00:00.25Z') - instantMs('2026-09-12T10:00:00Z')).toBe(250)
  })

  it('sorts missing and unparsable times last, equal to each other', () => {
    expect(compareInstants(null, '2026-09-12T10:00:00Z')).toBe(1)
    expect(compareInstants('nope', undefined)).toBe(0)
  })
})

describe('buildTimeline — anchor mismatch', () => {
  it('withholds the Anchored tier from a phase whose anchored field differs from Hedera', () => {
    const manifest = makeManifest({
      phases: [makePhase(3, 'departure', {
        tier: 'anchored',
        anchored_fields: [
          { name: 'seal_number', value: 'SEAL-001', matches_anchor: true },
          { name: 'parcel_count_origin', value: 12, matches_anchor: false },
        ],
      })],
    })

    const [item] = buildTimeline(manifest)

    expect(item.tier).toBe('recorded')
    expect(item.anchorWarning).toBe(true)
  })

  it('keeps the tier and raises no warning when every anchored field matches', () => {
    const manifest = makeManifest({
      phases: [makePhase(3, 'departure', {
        tier: 'anchored', anchored_fields: [{ name: 'seal_number', value: 'SEAL-001', matches_anchor: true }],
      })],
    })

    const [item] = buildTimeline(manifest)

    expect(item.tier).toBe('anchored')
    expect(item.anchorWarning).toBe(false)
  })
})
