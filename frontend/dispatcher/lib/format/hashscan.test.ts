import { describe, expect, it } from 'vitest'

import { isAnchoredTopic } from './hashscan'

describe('isAnchoredTopic', () => {
  it('accepts a real Hedera topic id', () => {
    expect(isAnchoredTopic('0.0.123')).toBe(true)
  })

  it.each([['the "None" placeholder', 'None'], ['an empty string', ''], ['null', null], ['undefined', undefined]])(
    'rejects %s',
    (_name, topic) => {
      expect(isAnchoredTopic(topic)).toBe(false)
    },
  )
})
