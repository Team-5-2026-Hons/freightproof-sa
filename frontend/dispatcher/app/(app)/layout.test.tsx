import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppLayout from './layout'
import { ToastProvider } from '@/lib/context/ToastContext'
import { useToast } from '@/lib/hooks/useToast'
import { ROUTES } from '@/lib/constants/routes'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

const auth = vi.hoisted(() => ({
  state: { user: { id: 'me' } as { id: string } | null, isLoading: false },
}))
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => auth.state }))

const replace = vi.fn()
const router = { replace }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

vi.mock('@/components/layout/DispatcherShell', () => ({
  DispatcherShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/lib/realtime/RealtimeProvider', () => ({
  RealtimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/assistant/AssistantBubble', () => ({ AssistantBubble: () => null }))

/** Raises one sticky error toast, standing in for a page whose fetch failed. */
function RaiseError() {
  const { notify } = useToast()
  return <button onClick={() => notify({ kind: 'error', title: 'Failed to load trips' })}>raise</button>
}

function tree() {
  return (
    <ToastProvider>
      <AppLayout><RaiseError /></AppLayout>
    </ToastProvider>
  )
}

function mount() {
  const view = render(tree())
  return { rerender: () => view.rerender(tree()) }
}

beforeEach(() => {
  replace.mockReset()
  auth.state = { user: { id: 'me' }, isLoading: false }
})

describe('AppLayout — session loss', () => {
  it('clears error toasts and redirects to login when the user becomes null', () => {
    const view = mount()
    act(() => screen.getByRole('button', { name: 'raise' }).click())
    expect(screen.getByText('Failed to load trips')).toBeInTheDocument()

    auth.state = { user: null, isLoading: false }
    view.rerender()

    expect(screen.queryByText('Failed to load trips')).not.toBeInTheDocument()
    expect(replace).toHaveBeenCalledWith(ROUTES.login)
  })
})
