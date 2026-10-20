import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import type { ChatAnswer } from '@shared/lib/types/analytics-chat'
import {
  CHAT_PATH,
  CHAT_STATUS_PATH,
  CHAT_TIMEOUT_MS,
  historyFor,
  useAnalyticsChat,
  useChatStatus,
  type ChatMessageItem,
} from './useAnalyticsChat'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) { super(message) }
  },
}))

const mockedGet = vi.mocked(api.get)
const mockedPost = vi.mocked(api.post)
const ANSWER: ChatAnswer = { answer: '42 trips.', kind: 'answer', basis: [], spend: { spent_usd: 0.1, budget_usd: 20, available: true } }

beforeEach(() => {
  mockedGet.mockReset()
  mockedPost.mockReset()
})

describe('useChatStatus', () => {
  it('reads the status once and reports it', async () => {
    mockedGet.mockResolvedValue({ enabled: true, spend: ANSWER.spend })

    const { result } = renderHook(() => useChatStatus())

    await waitFor(() => expect(result.current.enabled).toBe(true))
    expect(result.current.spend).toEqual(ANSWER.spend)
    expect(mockedGet).toHaveBeenCalledWith(CHAT_STATUS_PATH)
  })

  it('reads a failed status as switched off', async () => {
    mockedGet.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useChatStatus())

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
    expect(result.current.enabled).toBe(false)
  })
})

describe('useAnalyticsChat', () => {
  it('posts the trimmed question with the history and a long timeout, then keeps both turns', async () => {
    mockedPost.mockResolvedValue(ANSWER)
    const { result } = renderHook(() => useAnalyticsChat(vi.fn()))

    let ok = false
    await act(async () => { ok = await result.current.send('  How many trips?  ') })

    expect(ok).toBe(true)
    expect(mockedPost).toHaveBeenCalledWith(CHAT_PATH, { question: 'How many trips?', history: [] }, { timeoutMs: CHAT_TIMEOUT_MS })
    expect(result.current.messages.map(({ role, text }) => [role, text])).toEqual([['user', 'How many trips?'], ['assistant', '42 trips.']])
    expect(result.current.spend).toEqual(ANSWER.spend)
  })

  it('sends nothing for a blank question', async () => {
    const { result } = renderHook(() => useAnalyticsChat(vi.fn()))

    await act(async () => { await result.current.send('   ') })

    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('keeps no turn and reports the error when the answer fails', async () => {
    mockedPost.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useAnalyticsChat(vi.fn()))

    let ok = true
    await act(async () => { ok = await result.current.send('How many trips?') })

    expect(ok).toBe(false)
    expect(result.current.messages).toEqual([])
    expect(result.current.error).toBe('boom')
  })
})

describe('historyFor', () => {
  it('keeps only the last 10 messages, as role and text', () => {
    const messages: ChatMessageItem[] = Array.from({ length: 12 }, (_, index) => ({
      id: index, role: index % 2 === 0 ? 'user' : 'assistant', text: `m${index}`, basis: [],
    }))

    const history = historyFor(messages)

    expect(history).toHaveLength(10)
    expect(history[0]).toEqual({ role: 'user', text: 'm2' })
  })
})
