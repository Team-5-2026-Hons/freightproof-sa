import { describe, expect, it, vi } from 'vitest'
import type { TileLayer } from 'leaflet'

import { attachTileFailureTracking } from '../GeofenceMap'
import { TILE_ERROR_FALLBACK_THRESHOLD } from '@/lib/map/tiles'

/**
 * A stand-in for Leaflet's TileLayer that records handlers and lets a test fire them.
 *
 * The point of exporting attachTileFailureTracking is that this logic — a counter, a
 * reset, a threshold and a latch — can be exercised without a real map or a browser.
 * Nothing here touches Leaflet or the DOM.
 */
function fakeLayer() {
  const handlers = new Map<string, Set<() => void>>()

  const layer = {
    on: (event: string, fn: () => void) => {
      const set = handlers.get(event) ?? new Set()
      set.add(fn)
      handlers.set(event, set)
    },
    off: (event: string, fn: () => void) => {
      handlers.get(event)?.delete(fn)
    },
  } as unknown as TileLayer

  return {
    layer,
    fire: (event: 'tileerror' | 'tileload', times = 1) => {
      for (let i = 0; i < times; i++) {
        handlers.get(event)?.forEach((fn) => fn())
      }
    },
    listenerCount: () =>
      (handlers.get('tileerror')?.size ?? 0) + (handlers.get('tileload')?.size ?? 0),
  }
}

describe('attachTileFailureTracking', () => {
  it('stays quiet below the threshold', () => {
    const { layer, fire } = fakeLayer()
    const onExceeded = vi.fn()

    attachTileFailureTracking(layer, onExceeded)
    fire('tileerror', TILE_ERROR_FALLBACK_THRESHOLD - 1)

    expect(onExceeded).not.toHaveBeenCalled()
  })

  it('fires once the threshold is reached', () => {
    const { layer, fire } = fakeLayer()
    const onExceeded = vi.fn()

    attachTileFailureTracking(layer, onExceeded)
    fire('tileerror', TILE_ERROR_FALLBACK_THRESHOLD)

    expect(onExceeded).toHaveBeenCalledTimes(1)
  })

  it('fires only once per failure episode, however many tiles keep failing', () => {
    const { layer, fire } = fakeLayer()
    const onExceeded = vi.fn()

    attachTileFailureTracking(layer, onExceeded)
    fire('tileerror', TILE_ERROR_FALLBACK_THRESHOLD * 5)

    expect(onExceeded).toHaveBeenCalledTimes(1)
  })

  it('a successful tile resets the streak, so scattered 404s never accumulate', () => {
    const { layer, fire } = fakeLayer()
    const onExceeded = vi.fn()

    attachTileFailureTracking(layer, onExceeded)
    // Repeatedly approach the threshold, but never reach it without a success between.
    for (let round = 0; round < 5; round++) {
      fire('tileerror', TILE_ERROR_FALLBACK_THRESHOLD - 1)
      fire('tileload')
    }

    expect(onExceeded).not.toHaveBeenCalled()
  })

  it('reports recovery on the first success after a failure episode', () => {
    const { layer, fire } = fakeLayer()
    const onExceeded = vi.fn()
    const onRecovered = vi.fn()

    attachTileFailureTracking(layer, onExceeded, onRecovered)
    fire('tileerror', TILE_ERROR_FALLBACK_THRESHOLD)
    fire('tileload')

    expect(onRecovered).toHaveBeenCalledTimes(1)
  })

  it('does not report recovery when nothing had failed', () => {
    const { layer, fire } = fakeLayer()
    const onRecovered = vi.fn()

    attachTileFailureTracking(layer, vi.fn(), onRecovered)
    fire('tileload', 3)

    expect(onRecovered).not.toHaveBeenCalled()
  })

  it('can fail again after recovering — the fallback is not one-way', () => {
    const { layer, fire } = fakeLayer()
    const onExceeded = vi.fn()
    const onRecovered = vi.fn()

    attachTileFailureTracking(layer, onExceeded, onRecovered)
    fire('tileerror', TILE_ERROR_FALLBACK_THRESHOLD)
    fire('tileload')
    fire('tileerror', TILE_ERROR_FALLBACK_THRESHOLD)

    expect(onExceeded).toHaveBeenCalledTimes(2)
    expect(onRecovered).toHaveBeenCalledTimes(1)
  })

  it('detaches both listeners on cleanup', () => {
    const { layer, listenerCount } = fakeLayer()

    const detach = attachTileFailureTracking(layer, vi.fn())
    expect(listenerCount()).toBe(2)

    detach()

    expect(listenerCount()).toBe(0)
  })

  it('stops counting after cleanup, so a removed layer cannot trip the fallback', () => {
    const { layer, fire } = fakeLayer()
    const onExceeded = vi.fn()

    const detach = attachTileFailureTracking(layer, onExceeded)
    detach()
    fire('tileerror', TILE_ERROR_FALLBACK_THRESHOLD * 2)

    expect(onExceeded).not.toHaveBeenCalled()
  })
})
