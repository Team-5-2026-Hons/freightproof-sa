import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api/client'
import type { AssistantAnswer } from '@shared/lib/types/assistant'
import {
  ASSISTANT_STORAGE_KEY,
  MAX_HISTORY_TURNS,
  NO_ANSWER_IN_TIME,
  historyFor,
  loadConversation,
  useAssistant,
  type AssistantMessageItem,
} from './useAssistant'

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(), get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) { super(message) }
  },
}))

const mockedPost = vi.mocked(api.post)
const ANSWER: AssistantAnswer = {
  answer: 'Nothing booked.', kind: 'answer', cards: [], actions: [], tools_used: ['crew_bookings'],
  refs: [{ kind: 'driver', id: 'd-1', label: 'Tim Giltig' }], spend: null,
}

function message(id: number, role: 'user' | 'assistant'): AssistantMessageItem {
  return { id, role, text: `m${id}`, refs: [] }
}

beforeEach(() => {
  mockedPost.mockReset()
  window.sessionStorage.clear()
})

describe('useAssistant', () => {
  it('sends only the last turns, each with its records', () => {
    const messages = Array.from({ length: MAX_HISTORY_TURNS + 4 }, (_, index) => message(index, index % 2 ? 'assistant' : 'user'))

    const history = historyFor(messages)

    expect(history).toHaveLength(MAX_HISTORY_TURNS)
    expect(history[0]).toEqual({ role: 'user', text: 'm4', refs: [] })
  })

  it('keeps the conversation in sessionStorage, so a remount (page change, refresh) brings it back', async () => {
    mockedPost.mockResolvedValue(ANSWER)
    const first = renderHook(() => useAssistant(vi.fn()))

    await act(async () => { await first.result.current.send('Is Tim busy?') })
    first.unmount()
    const second = renderHook(() => useAssistant(vi.fn()))

    expect(second.result.current.messages.map((item) => item.text)).toEqual(['Is Tim busy?', 'Nothing booked.'])
    expect(second.result.current.messages[1].refs).toEqual(ANSWER.refs)
  })

  it('reset forgets the saved conversation', async () => {
    mockedPost.mockResolvedValue(ANSWER)
    const { result } = renderHook(() => useAssistant(vi.fn()))
    await act(async () => { await result.current.send('Is Tim busy?') })

    act(() => result.current.reset())

    await waitFor(() => expect(window.sessionStorage.getItem(ASSISTANT_STORAGE_KEY)).toBeNull())
    expect(result.current.messages).toEqual([])
  })

  it('a 429 re-reads the status', async () => {
    mockedPost.mockRejectedValue(new ApiError(429, 'used up'))
    const onTooMany = vi.fn()
    const { result } = renderHook(() => useAssistant(onTooMany))

    await act(async () => { await result.current.send('Anything?') })

    expect(onTooMany).toHaveBeenCalled()
    expect(result.current.error).toBe('used up')
  })

  it('a timeout shows plain words, keeps the question, and retry resends it with its records', async () => {
    const tim = { kind: 'driver' as const, id: 'd-1', label: 'Tim Giltig' }
    mockedPost.mockRejectedValueOnce(new ApiError(0, 'Request to http://127.0.0.1:8000 timed out after 60000ms'))
    const { result } = renderHook(() => useAssistant(vi.fn()))

    await act(async () => { await result.current.send('I mean Tim Giltig', [tim]) })

    expect(result.current.error).toBe(NO_ANSWER_IN_TIME)
    expect(result.current.failed).toEqual({ question: 'I mean Tim Giltig', refs: [tim] })
    mockedPost.mockResolvedValueOnce(ANSWER)
    await act(async () => { await result.current.retry() })
    expect(mockedPost).toHaveBeenLastCalledWith(
      '/api/v1/assistant/chat', { question: 'I mean Tim Giltig', history: [], refs: [tim] }, { timeoutMs: 60_000 },
    )
    expect(result.current.failed).toBeNull()
  })

  it('a damaged or blocked store gives a fresh chat instead of failing', () => {
    expect(loadConversation({ getItem: () => '{not json' })).toEqual([])
    expect(loadConversation({ getItem: () => { throw new Error('blocked') } })).toEqual([])
    expect(loadConversation(undefined)).toEqual([])
  })
})
