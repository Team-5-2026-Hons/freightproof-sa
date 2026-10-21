// The PointerEvent polyfill must carry what Swipe.tsx reads off a real pointer event.
import { describe, expect, it } from 'vitest'

describe('PointerEvent polyfill', () => {
  it('keeps isPrimary, defaulting to false like the real constructor', () => {
    expect(new PointerEvent('pointerdown', { isPrimary: true }).isPrimary).toBe(true)
    expect(new PointerEvent('pointerdown').isPrimary).toBe(false)
  })
})
