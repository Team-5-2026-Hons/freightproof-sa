import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api/client'
import type { AssistantStatus } from '@shared/lib/types/assistant'
import { AssistantBubble, BOTTOM_OFFSET_VAR, RIGHT_OFFSET_VAR } from './AssistantBubble'

const navigation = vi.hoisted(() => ({ pathname: '/' }))

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(), get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) { super(message) }
  },
}))

const mockedGet = vi.mocked(api.get)
const mockedPost = vi.mocked(api.post)
const ON: AssistantStatus = { enabled: true, spend: null }

function rootVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name)
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedPost.mockReset()
  navigation.pathname = '/'
  window.sessionStorage.clear()
})

describe('AssistantBubble', () => {
  it('stays hidden while the assistant is off', async () => {
    mockedGet.mockResolvedValue({ enabled: false, spend: null })

    render(<AssistantBubble />)

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/api/v1/assistant/status'))
    expect(screen.queryByRole('button', { name: 'Ask FreightProof' })).not.toBeInTheDocument()
  })

  it('stays hidden on Analytics, which has its own chat', async () => {
    mockedGet.mockResolvedValue(ON)
    navigation.pathname = '/analytics'

    render(<AssistantBubble />)

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Ask FreightProof' })).not.toBeInTheDocument()
  })

  it('shows on other pages, opens the pop-up, and moves the toasts out of the way', async () => {
    mockedGet.mockResolvedValue(ON)
    navigation.pathname = '/trips'

    render(<AssistantBubble />)
    const bubble = await screen.findByRole('button', { name: 'Ask FreightProof' })
    expect(rootVar(BOTTOM_OFFSET_VAR)).toBe('72px')
    fireEvent.click(bubble)

    expect(screen.getByRole('dialog', { name: 'Ask FreightProof' })).toBeInTheDocument()
    expect(bubble).toHaveAttribute('aria-expanded', 'true')
    expect(rootVar(RIGHT_OFFSET_VAR)).toBe('424px')
  })

  it('a question that fails while minimised is back in the box on reopen, and Try again resends it', async () => {
    mockedGet.mockResolvedValue(ON)
    let fail: (error: Error) => void = () => {}
    mockedPost.mockReturnValueOnce(new Promise((_, reject) => { fail = reject }) as never)
    render(<AssistantBubble />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask FreightProof' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: 'Whats finishing today?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Minimise' })[0])

    await act(async () => { fail(new ApiError(0, 'Request to http://127.0.0.1:8000/api/v1/assistant/chat timed out after 60000ms')) })
    fireEvent.click(screen.getByRole('button', { name: 'Ask FreightProof' }))

    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('Whats finishing today?')
    expect(screen.getByRole('alert')).toHaveTextContent("The answer didn't arrive in time. Try again.")
    expect(screen.getByRole('alert')).not.toHaveTextContent('127.0.0.1')
    mockedPost.mockResolvedValueOnce({ answer: 'None today.', kind: 'answer', cards: [], actions: [], tools_used: ['trips'], refs: [], spend: null })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('None today.')).toBeInTheDocument()
    expect(mockedPost).toHaveBeenLastCalledWith(
      '/api/v1/assistant/chat', { question: 'Whats finishing today?', history: [], refs: [] }, { timeoutMs: 60_000 },
    )
  })

  it('minimising returns focus to the bubble and frees the toasts', async () => {
    mockedGet.mockResolvedValue(ON)
    render(<AssistantBubble />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask FreightProof' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Minimise' })[0])

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask FreightProof' })).toHaveFocus()
    expect(rootVar(RIGHT_OFFSET_VAR)).toBe('')
  })

  it('keeps the pop-up open with "Opening…" until the new page arrives, then minimises', async () => {
    mockedGet.mockResolvedValue(ON)
    mockedPost.mockResolvedValueOnce({
      answer: 'Use the button below.', kind: 'answer', cards: [], tools_used: ['open_page'], refs: [], spend: null,
      actions: [{ kind: 'open_page', label: 'Open driver page', page: 'driver', record_id: 'd-1', filters: {} }],
    })
    const { rerender } = render(<AssistantBubble />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask FreightProof' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: 'Open his page' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Open driver page' }))

    expect(screen.getByRole('dialog', { name: 'Ask FreightProof' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Opening…/ })).toBeDisabled()

    navigation.pathname = '/fleet/drivers/d-1'
    rerender(<AssistantBubble />)

    expect(screen.queryByRole('dialog', { name: 'Ask FreightProof' })).not.toBeInTheDocument()
  })
})
