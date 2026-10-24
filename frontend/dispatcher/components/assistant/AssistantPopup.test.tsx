import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import { useAssistant, type Assistant } from '@/lib/hooks/useAssistant'
import type { AssistantAnswer, AssistantSpend, RecordRef } from '@shared/lib/types/assistant'
import { AssistantPopup } from './AssistantPopup'

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(), get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) { super(message) }
  },
}))

const mockedPost = vi.mocked(api.post)
const CHAT_PATH = '/api/v1/assistant/chat'
const SPEND: AssistantSpend = { spent_usd: 0.42, all_chats_spent_usd: 3.1, budget_usd: 20, available: true }
const TIM: RecordRef = { kind: 'driver', id: 'd-1', label: 'Tim Giltig', detail: null, is_active: true }
const TIMOTHY: RecordRef = { kind: 'driver', id: 'd-2', label: 'Timothy Nkosi', detail: null, is_active: true }

const ACTIVE_ANSWER: AssistantAnswer = {
  answer: 'You have 1 active trip, on the road.',
  kind: 'answer',
  cards: [{
    type: 'trip_list', title: 'Active trips', total: 1, on_the_road: 1, booked: 0, on_hold: 0,
    window_start: null, window_end: null, truncated: false, full_list: 'dashboard',
    rows: [{
      trip_id: 't-1', trip_reference: 'FP-20261020-AB12CD34', manifest: null, status: 'active', trip_type: 'loaded',
      origin: 'Epping', destination: 'Linbro', driver_id: 'd-1', driver: 'Tim Giltig', horse_id: 'v-1', horse: 'CA 123-456',
      trailers: [], planned_departure_at: null, planned_arrival_at: '2026-10-22T15:00:00Z', actual_departure_at: null,
      actual_arrival_at: null, current_phase: 'in_transit', current_stop: null, phase_completed: 5, phase_total: 13,
      needs_review: { critical: 0, warning: 0, info: 0 }, overdue: false,
    }],
  }],
  actions: [],
  tools_used: ['trips'],
  refs: [{ kind: 'trip', id: 't-1', label: 'FP-20261020-AB12CD34', detail: 'active', is_active: true }],
  spend: { ...SPEND, spent_usd: 0.45 },
}

const CHOICE_ANSWER: AssistantAnswer = {
  answer: 'Which Tim do you mean?',
  kind: 'follow_up',
  cards: [{ type: 'choose', what: 'driver', typed: 'Tim', options: [TIM, TIMOTHY], more: 0 }],
  actions: [],
  tools_used: ['crew_bookings'],
  refs: [TIM, TIMOTHY],
  spend: SPEND,
}

function Harness({ onMinimise, onNavigate }: { onMinimise: () => void; onNavigate: () => void }) {
  const assistant: Assistant = useAssistant(vi.fn())
  return <AssistantPopup id="popup" assistant={assistant} statusSpend={SPEND} onMinimise={onMinimise} onNavigate={onNavigate} />
}

function renderPopup() {
  const props = { onMinimise: vi.fn(), onNavigate: vi.fn() }
  render(<Harness {...props} />)
  return props
}

function ask(question: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

beforeEach(() => {
  mockedPost.mockReset()
  window.sessionStorage.clear()
})

describe('AssistantPopup', () => {
  it('says it only reads, and sends a starter question', async () => {
    mockedPost.mockResolvedValue(ACTIVE_ANSWER)
    renderPopup()

    expect(screen.getByText('Reads our records only. It never saves or changes anything.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'How many trips are active right now?' }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(
      CHAT_PATH, { question: 'How many trips are active right now?', history: [], refs: [] }, { timeoutMs: 60_000 },
    ))
  })

  it('shows the answer, its trip card with a link, the Checked line and the new spend', async () => {
    mockedPost.mockResolvedValue(ACTIVE_ANSWER)
    renderPopup()

    ask('How many trips are active?')

    const log = screen.getByRole('log')
    expect(await within(log).findByText('You have 1 active trip, on the road.')).toBeInTheDocument()
    expect(within(log).getByText('Active trips · 1')).toBeInTheDocument()
    expect(within(log).getByRole('link', { name: 'FP-20261020-AB12CD34' })).toHaveAttribute('href', '/trips/t-1')
    expect(within(log).getByText('Checked: Trips')).toBeInTheDocument()
    expect(screen.getByText('Assistant this month: $0.45 · both chats: $3.10 of $20.00')).toBeInTheDocument()
  })

  it('following a card link calls onNavigate so the pop-up gets out of the way', async () => {
    mockedPost.mockResolvedValue(ACTIVE_ANSWER)
    const { onNavigate } = renderPopup()
    ask('Active?')

    fireEvent.click(await screen.findByRole('link', { name: 'FP-20261020-AB12CD34' }))

    expect(onNavigate).toHaveBeenCalled()
  })

  it('a choice button asks again with that exact record and the earlier turns', async () => {
    mockedPost.mockResolvedValueOnce(CHOICE_ANSWER).mockResolvedValueOnce(ACTIVE_ANSWER)
    renderPopup()
    ask('Is Tim busy?')

    fireEvent.click(await screen.findByRole('button', { name: /Tim Giltig/ }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(2))
    const [, body] = mockedPost.mock.calls[1]
    expect(body).toEqual({
      question: 'I mean Tim Giltig',
      history: [
        { role: 'user', text: 'Is Tim busy?', refs: [] },
        { role: 'assistant', text: 'Which Tim do you mean?', refs: [TIM, TIMOTHY] },
      ],
      refs: [TIM],
    })
  })

  it('keeps the question and offers Try again when the answer fails', async () => {
    mockedPost.mockRejectedValue(new Error("The AI service didn't answer. Try again."))
    renderPopup()

    ask('What needs attention?')

    expect(await screen.findByRole('alert')).toHaveTextContent("The AI service didn't answer.")
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('What needs attention?')
  })

  it('New chat clears the conversation', async () => {
    mockedPost.mockResolvedValue(ACTIVE_ANSWER)
    renderPopup()
    ask('Active?')
    await screen.findByText('You have 1 active trip, on the road.')

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))

    expect(screen.queryByText('You have 1 active trip, on the road.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Which trips need attention?' })).toBeInTheDocument()
  })

  it('Escape minimises', () => {
    const { onMinimise } = renderPopup()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onMinimise).toHaveBeenCalled()
  })

  it('renders a reply as text, never as HTML', async () => {
    mockedPost.mockResolvedValue({ ...ACTIVE_ANSWER, answer: '<b>bold</b> <img src=x onerror=alert(1)>' })
    renderPopup()

    ask('Anything?')

    expect(await screen.findByText(/<b>bold<\/b>/)).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })
})
