import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ToastProvider } from '@/lib/context/ToastContext'
import { CancelTripDialog } from './CancelTripAction'
import { cancelTrip } from '@/lib/api/client'
import type { Trip } from '@shared/lib/types/trip'

// client.ts (even mocked below via importActual, which re-evaluates the real module)
// imports the Supabase client at module scope, which throws without real env vars in
// the test environment — mock it the same way lib/api/client.test.ts does.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// Isolate the component from the real HTTP layer — client.ts's own request/retry
// logic is covered by lib/api/client.test.ts.
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')
  return { ...actual, cancelTrip: vi.fn() }
})

const mockedCancelTrip = vi.mocked(cancelTrip)

interface RenderOptions {
  status?: Trip['status']
  open?: boolean
  onClose?: () => void
  onCancelled?: () => void
}

function renderDialog({ status = 'active', open = true, onClose = vi.fn(), onCancelled = vi.fn() }: RenderOptions = {}) {
  const utils = render(
    <ToastProvider>
      <CancelTripDialog tripId="trip-1" status={status} open={open} onClose={onClose} onCancelled={onCancelled} />
    </ToastProvider>,
  )
  return { onClose, onCancelled, rerender: utils.rerender }
}

beforeEach(() => {
  mockedCancelTrip.mockReset()
})

describe('CancelTripDialog — availability', () => {
  it.each(['closed', 'cancelled'] as const)('renders nothing while open and the trip is already %s', (status) => {
    const onClose = vi.fn()
    renderDialog({ status, open: true, onClose })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['closed', 'cancelled'] as const)('calls onClose once when open and status becomes %s', (status) => {
    // A background refetch can show someone else already closed/cancelled the trip while
    // this dialog is open — the parent's `cancelOpen` state must not go stale.
    const onClose = vi.fn()
    const { rerender } = renderDialog({ status: 'active', open: true, onClose })

    rerender(
      <ToastProvider>
        <CancelTripDialog tripId="trip-1" status={status} open onClose={onClose} onCancelled={vi.fn()} />
      </ToastProvider>,
    )

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each(['created', 'active', 'exception_hold'] as const)('renders the dialog while the trip is %s', (status) => {
    renderDialog({ status, open: true })
    expect(screen.getByRole('dialog', { name: 'Cancel this trip?' })).toBeInTheDocument()
  })
})

describe('CancelTripDialog — required note', () => {
  it('keeps the submit control disabled until the note is non-empty', () => {
    renderDialog()

    const submit = screen.getByRole('button', { name: 'Cancel trip' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: 'Cargo pulled by client' },
    })
    expect(submit).not.toBeDisabled()
  })

  it('submits the trimmed note and reports success', async () => {
    mockedCancelTrip.mockResolvedValue({ id: 'trip-1', status: 'cancelled' } as Trip)
    const { onCancelled } = renderDialog()

    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: '  Cargo pulled by client  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel trip' }))

    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1))
    expect(mockedCancelTrip).toHaveBeenCalledWith('trip-1', 'Cargo pulled by client')
    expect(mockedCancelTrip).toHaveBeenCalledTimes(1)
  })

  it('ignores a second click while the first submission is in flight', async () => {
    let resolveCall: (value: Trip) => void = () => {}
    mockedCancelTrip.mockImplementation(() => new Promise(resolve => { resolveCall = resolve }))
    const { onCancelled } = renderDialog()

    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: 'Cargo pulled by client' },
    })
    const submit = screen.getByRole('button', { name: /Cancel trip|Cancelling…/ })
    fireEvent.click(submit)
    fireEvent.click(submit)

    resolveCall({ id: 'trip-1', status: 'cancelled' } as Trip)
    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1))
    expect(mockedCancelTrip).toHaveBeenCalledTimes(1)
  })

  it('surfaces the backend message as the toast title on a 409 conflict', async () => {
    const { ApiError } = await import('@/lib/api/client')
    mockedCancelTrip.mockRejectedValue(new ApiError(409, 'Trip already cancelled'))
    renderDialog()

    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: 'Cargo pulled by client' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel trip' }))

    expect(await screen.findByText('Trip already cancelled')).toBeInTheDocument()
  })
})

describe('CancelTripDialog — dismissal', () => {
  it('closes via "Keep trip active" without calling the API, and resets the note on reopen', () => {
    const onClose = vi.fn()
    const { rerender } = renderDialog({ onClose })

    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: 'Cargo pulled by client' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Keep trip active' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockedCancelTrip).not.toHaveBeenCalled()

    // Simulate the parent closing and reopening the dialog.
    rerender(
      <ToastProvider>
        <CancelTripDialog tripId="trip-1" status="active" open={false} onClose={onClose} onCancelled={vi.fn()} />
      </ToastProvider>,
    )
    rerender(
      <ToastProvider>
        <CancelTripDialog tripId="trip-1" status="active" open onClose={onClose} onCancelled={vi.fn()} />
      </ToastProvider>,
    )

    expect(screen.getByLabelText('Reason for cancellation')).toHaveValue('')
  })
})
