import { beforeEach, describe, expect, test } from 'vitest'
import { SUBSTITUTION_SEEN_KEY, attentionItemIds, markAttentionSeen, unseenAttentionItems } from '../substitution-attention'

beforeEach(() => window.sessionStorage.clear())

describe('attentionItemIds', () => {
  test('keys an arrangement by id and version so a dispatch change counts as new', () => {
    const v1 = attentionItemIds([{ id: 'req', version: 1 }], [], null)
    const v2 = attentionItemIds([{ id: 'req', version: 2 }], [], null)

    expect(v1).not.toEqual(v2)
    expect(unseenAttentionItems(v2)).toEqual(v2)
  })

  test('includes notices and the handed-over trip', () => {
    expect(attentionItemIds([], [{ id: 'n1' }], 'trip-9')).toEqual(['n1', 'handed-over:trip-9'])
  })
})

describe('seen tracking', () => {
  test('everything is unseen in a fresh session; marked items stay seen', () => {
    const ids = ['a', 'b']

    expect(unseenAttentionItems(ids)).toEqual(ids)
    markAttentionSeen(ids)

    expect(unseenAttentionItems([...ids, 'c'])).toEqual(['c'])
  })

  test('garbage in storage is treated as nothing seen', () => {
    window.sessionStorage.setItem(SUBSTITUTION_SEEN_KEY, '{not json')

    expect(unseenAttentionItems(['a'])).toEqual(['a'])
  })

  test('marking nothing writes nothing', () => {
    markAttentionSeen([])

    expect(window.sessionStorage.getItem(SUBSTITUTION_SEEN_KEY)).toBeNull()
  })
})
