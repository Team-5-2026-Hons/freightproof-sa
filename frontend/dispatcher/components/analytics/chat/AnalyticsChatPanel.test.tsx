import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api/client'
import type { ChatAnswer, SpendStatus } from '@shared/lib/types/analytics-chat'
import { AnalyticsChatPanel, MAX_QUESTION_CHARS } from './AnalyticsChatPanel'

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) { super(message) }
  },
}))

const mockedPost = vi.mocked(api.post)
const CHAT_PATH = '/api/v1/analytics/chat'
const SPEND: SpendStatus = { spent_usd: 0.42, budget_usd: 20, available: true }
const ANSWER: ChatAnswer = {
  answer: 'On-time arrivals fell from 81% to 74%.\nOctober is still in progress.',
  kind: 'answer',
  basis: [{ tool: 'on_time', tab: 'on-time', label: 'On time', start: '2025-11-01', end: '2026-10-19', grain: 'month', closed_trip_count: 412 }],
  spend: { spent_usd: 0.45, budget_usd: 20, available: true },
}

function renderPanel(overrides: Partial<Parameters<typeof AnalyticsChatPanel>[0]> = {}) {
  const props = {
    onClose: vi.fn(), statusSpend: SPEND, onRecheckStatus: vi.fn(), onOpenBasis: vi.fn(), ...overrides,
  }
  render(<AnalyticsChatPanel {...props} />)
  return props
}

function input(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement
}

function ask(question: string): void {
  fireEvent.change(input(), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

beforeEach(() => {
  mockedPost.mockReset()
})

describe('AnalyticsChatPanel', () => {
  it('offers three starter questions and sends one when clicked', async () => {
    mockedPost.mockResolvedValue(ANSWER)
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'How did delays change over the past year?' }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(
      CHAT_PATH, { question: 'How did delays change over the past year?', history: [] }, { timeoutMs: 60_000 },
    ))
  })

  it('shows the waiting line, then the answer with its Based on line and the new spend', async () => {
    let resolve: (answer: ChatAnswer) => void = () => {}
    mockedPost.mockReturnValue(new Promise<ChatAnswer>((done) => { resolve = done }) as never)
    const { onOpenBasis } = renderPanel()

    ask('How did delays change?')

    expect(await screen.findByRole('status')).toHaveTextContent('Looking up the figures…')
    resolve(ANSWER)
    const log = screen.getByRole('log')
    expect(await within(log).findByText(/On-time arrivals fell/)).toBeInTheDocument()
    expect(within(log).getByText(/1 Nov 2025 – 19 Oct 2026 · by month · 412 trips/)).toBeInTheDocument()
    expect(screen.getByText('AI spend this month: $0.45 of $20.00')).toBeInTheDocument()
    expect(input().value).toBe('')
    fireEvent.click(within(log).getByRole('button', { name: 'Open On time with these dates' }))
    expect(onOpenBasis).toHaveBeenCalledWith(ANSWER.basis[0])
  })

  it('shows an answer\'s "- " lines as a real list, and its Based on lines as chips', async () => {
    mockedPost.mockResolvedValue({
      ...ANSWER, answer: 'From the headline figures:\n- There are 4 live trips.\n- 1 critical problem is waiting.',
    })
    renderPanel()

    ask('Any live trips?')

    const log = screen.getByRole('log')
    const items = await within(log).findAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['There are 4 live trips.', '1 critical problem is waiting.'])
    expect(within(log).queryByText(/^- /)).not.toBeInTheDocument()
    expect(within(log).getByText('Based on:')).toBeInTheDocument()
    expect(within(log).getByRole('button', { name: 'Open On time with these dates' }).parentElement).toHaveClass('rounded-md', 'border')
  })

  it('shows three pulsing dots while an answer is worked out, still for reduced motion', async () => {
    mockedPost.mockReturnValue(new Promise<ChatAnswer>(() => {}) as never)
    renderPanel()

    ask('How late were we?')

    const status = await screen.findByRole('status')
    const dots = within(status).getAllByTestId('thinking-dot')
    expect(dots).toHaveLength(3)
    expect(dots[0]).toHaveClass('motion-safe:animate-pulse')
    expect(dots.map((dot) => dot.style.animationDelay)).toEqual(['0ms', '150ms', '300ms'])
  })

  it('scrolls a new answer to its start, not its end, within the conversation only', async () => {
    // The conversation's top edge is at 100 px; the new answer arrives with its top at 700 px.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      if (this.getAttribute('role') === 'log') return { top: 100 } as DOMRect
      return { top: this.textContent?.includes('On-time arrivals fell') ? 700 : 0 } as DOMRect
    })
    let resolve: (answer: ChatAnswer) => void = () => {}
    mockedPost.mockReturnValue(new Promise<ChatAnswer>((done) => { resolve = done }) as never)
    renderPanel()
    const log = screen.getByRole('log')
    let scrollTop = 0
    Object.defineProperty(log, 'scrollTop', { get: () => scrollTop, set: (value: number) => { scrollTop = value } })
    Object.defineProperty(log, 'scrollHeight', { get: () => 1500 })

    ask('How did delays change?')
    await screen.findByRole('status')
    // While waiting: the question and the dots, at the bottom.
    expect(scrollTop).toBe(1500)

    scrollTop = 1500
    resolve(ANSWER)
    await within(log).findByText(/On-time arrivals fell/)

    // Moved up by the answer's distance below the top edge, less the 8 px gap: 1500 + 600 - 8.
    await waitFor(() => expect(scrollTop).toBe(1500 + (700 - 100) - 8))
    vi.restoreAllMocks()
  })

  it('draws a full-strength line under the header, where the conversation starts', () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: 'Ask about these figures' }).closest('header')).toHaveClass('border-b', 'border-outline-v')
  })

  it('clears the box the moment a question is asked, before the answer arrives', async () => {
    mockedPost.mockReturnValue(new Promise<ChatAnswer>(() => {}) as never)
    renderPanel()

    ask('How many issues in the last year?')

    expect(input().value).toBe('')
    expect(await screen.findByRole('status')).toHaveTextContent('Looking up the figures…')
  })

  it('counts the characters typed against the limit, quietly in the corner of the box', () => {
    renderPanel()
    const counter = screen.getByTestId('question-char-count')

    expect(counter).toHaveTextContent('0/500')
    fireEvent.change(input(), { target: { value: 'How late were we?' } })

    expect(counter).toHaveTextContent('17/500')
    expect(counter).toHaveClass('text-on-surf-v/60')
    expect(input()).toHaveAccessibleDescription('17 of 500 characters')
    expect(input()).toHaveAttribute('maxLength', String(MAX_QUESTION_CHARS))
  })

  it('turns the counter the warning colour once the box is full', () => {
    renderPanel()

    fireEvent.change(input(), { target: { value: 'x'.repeat(MAX_QUESTION_CHARS) } })

    const counter = screen.getByTestId('question-char-count')
    expect(counter).toHaveTextContent('500/500')
    expect(counter).toHaveClass('text-warn')
  })

  it('resets the counter when a question is asked and the box clears', async () => {
    mockedPost.mockReturnValue(new Promise<ChatAnswer>(() => {}) as never)
    renderPanel()

    ask('How late were we?')

    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.getByTestId('question-char-count')).toHaveTextContent('0/500')
  })

  it('underlines the Ask button text in white on hover', () => {
    renderPanel()

    expect(screen.getByRole('button', { name: 'Ask' })).toHaveClass('hover:underline', 'hover:decoration-white')
  })

  it('marks a follow-up question as using no figures', async () => {
    mockedPost.mockResolvedValue({ answer: 'For which period?', kind: 'follow_up', basis: [], spend: SPEND })
    renderPanel()

    ask('Which lane costs the most?')

    expect(await screen.findByText('For which period?')).toBeInTheDocument()
    expect(screen.getByText('No figures used')).toBeInTheDocument()
  })

  it('sends the conversation so far with a follow-up, and at most the last 10 messages', async () => {
    mockedPost.mockImplementation((_path: string, body: unknown) => {
      const { question } = body as { question: string }
      return Promise.resolve({ answer: `Answer to ${question}`, kind: 'declined', basis: [], spend: SPEND }) as never
    })
    renderPanel()

    for (let index = 1; index <= 6; index += 1) {
      ask(`Question ${index}`)
      await screen.findByText(`Answer to Question ${index}`)
    }

    const [, body] = mockedPost.mock.calls[5]
    const { history } = body as { history: { role: string; text: string }[] }
    expect(history).toHaveLength(10)
    expect(history[0]).toEqual({ role: 'user', text: 'Question 1' })
    expect(history[9]).toEqual({ role: 'assistant', text: 'Answer to Question 5' })
  })

  it('keeps the question and offers Try again when the answer fails', async () => {
    mockedPost.mockRejectedValueOnce(new ApiError(502, "The AI service didn't answer. Try again."))
    renderPanel()

    ask('How late were we?')

    expect(await screen.findByRole('alert')).toHaveTextContent("The AI service didn't answer. Try again.")
    expect(input().value).toBe('How late were we?')
    mockedPost.mockResolvedValueOnce(ANSWER)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/On-time arrivals fell/)).toBeInTheDocument()
  })

  it('re-reads the status after a 429, so a spent budget can be told from the rate limit', async () => {
    mockedPost.mockRejectedValue(new ApiError(429, 'The AI budget for this month is used up.'))
    const { onRecheckStatus } = renderPanel()

    ask('How late were we?')

    await waitFor(() => expect(onRecheckStatus).toHaveBeenCalledTimes(1))
  })

  it('stops asking once the budget is used up', () => {
    renderPanel({ statusSpend: { spent_usd: 20, budget_usd: 20, available: false } })

    expect(screen.getByRole('alert')).toHaveTextContent('The AI budget for this month is used up. It resets on the 1st.')
    expect(input()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'How did delays change over the past year?' })).toBeDisabled()
  })

  it('shows answer text as text, never as HTML', async () => {
    mockedPost.mockResolvedValue({ ...ANSWER, answer: '<b>bold</b><img src=x onerror=alert(1)>' })
    renderPanel()

    ask('Anything?')

    expect(await screen.findByText('<b>bold</b><img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('sends on Enter and adds a new line on Shift+Enter', async () => {
    mockedPost.mockResolvedValue(ANSWER)
    renderPanel()
    fireEvent.change(input(), { target: { value: 'How late?' } })

    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    expect(mockedPost).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'Enter' })

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1))
  })

  it('closes on Escape and on the close button', () => {
    const { onClose } = renderPanel()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('starts with a carried question in the box, and sends nothing until Ask', () => {
    renderPanel({ initialQuestion: "What's our on-time rate this month?" })

    expect(input()).toHaveValue("What's our on-time rate this month?")
    expect(mockedPost).not.toHaveBeenCalled()
  })
})
