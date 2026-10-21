// frontend/driver-pwa/lib/context/__tests__/ToastContext.test.tsx
import { act, render, screen } from '@testing-library/react'
import { useContext } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ToastContext, ToastProvider, type ToastState } from '../ToastContext'
import { AUTO_DISMISS_MS } from '@/components/ui/Toast'

let api: ToastState | null = null
function Capture() {
  api = useContext(ToastContext)
  return null
}

function renderProvider() {
  render(<ToastProvider><Capture /></ToastProvider>)
  return api!
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastProvider', () => {
  it('shows an identical message once, however often it is raised', () => {
    const toasts = renderProvider()

    act(() => {
      toasts.notify({ kind: 'error', title: 'Check your connection' })
      toasts.notify({ kind: 'error', title: 'Check your connection' })
      toasts.notify({ kind: 'error', title: 'Check your connection' })
    })

    expect(screen.getAllByText('Check your connection')).toHaveLength(1)
  })

  it('still shows two different messages that share a title', () => {
    const toasts = renderProvider()

    act(() => {
      toasts.notify({ kind: 'error', title: 'Upload failed', body: 'Seal photo' })
      toasts.notify({ kind: 'error', title: 'Upload failed', body: 'POD photo' })
    })

    expect(screen.getAllByText('Upload failed')).toHaveLength(2)
  })

  it('a repeat keeps the message up for another full interval', () => {
    vi.useFakeTimers()
    const toasts = renderProvider()
    act(() => toasts.notify({ kind: 'info', title: 'Saved offline' }))
    act(() => vi.advanceTimersByTime(AUTO_DISMISS_MS - 1_000))

    act(() => toasts.notify({ kind: 'info', title: 'Saved offline' }))
    act(() => vi.advanceTimersByTime(AUTO_DISMISS_MS - 1_000))

    expect(screen.getByText('Saved offline')).toBeInTheDocument()
  })

  it('renders the viewport directly, with no wrapper of its own', () => {
    const { container } = render(<ToastProvider><p>app</p></ToastProvider>)

    expect(container.querySelector('[aria-live="polite"]')?.parentElement).toBe(container)
  })
})
