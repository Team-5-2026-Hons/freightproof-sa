import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ToastProvider } from '@/lib/context/ToastContext'
import { CancelTripAction } from './CancelTripAction'
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

function renderAction(status: Trip['status'] = 'active', onCancelled = vi.fn()) {
  render(
    <ToastProvider>
      <CancelTripAction tripId="trip-1" status={status} onCancelled={onCancelled} />
    </ToastProvider>,
  )
  return { onCancelled }
}

beforeEach(() => {
  mockedCancelTrip.mockReset()
})

describe('CancelTripAction — availability', () => {
  it.each(['closed', 'cancelled'] as const)('renders nothing once the trip is %s', (status) => {
    renderAction(status)
    expect(screen.queryByRole('button', { name: 'Cancel trip' })).not.toBeInTheDocument()
  })

  it.each(['created', 'active', 'exception_hold'] as const)('renders the control while the trip is %s', (status) => {
    renderAction(status)
    expect(screen.getByRole('button', { name: 'Cancel trip' })).toBeInTheDocument()
  })
})

describe('CancelTripAction — required note', () => {
  it('keeps the submit control disabled until the note is non-empty', () => {
    renderAction()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel trip' }))

    const submit = screen.getAllByRole('button', { name: 'Cancel trip' })[1]
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: 'Cargo pulled by client' },
    })
    expect(submit).not.toBeDisabled()
  })

  it('submits the trimmed note and reports success', async () => {
    mockedCancelTrip.mockResolvedValue({ id: 'trip-1', status: 'cancelled' } as Trip)
    const { onCancelled } = renderAction()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel trip' }))
    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: '  Cargo pulled by client  ' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel trip' })[1])

    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1))
    expect(mockedCancelTrip).toHaveBeenCalledWith('trip-1', 'Cargo pulled by client')
  })
})
