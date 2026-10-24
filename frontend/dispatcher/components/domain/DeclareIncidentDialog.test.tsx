import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/lib/context/ToastContext'
import { recordIncidentDeclaration } from '@/lib/api/auditPacks'
import { DeclareIncidentDialog } from './DeclareIncidentDialog'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api/auditPacks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auditPacks')>('@/lib/api/auditPacks')
  return { ...actual, recordIncidentDeclaration: vi.fn() }
})

function renderDialog() {
  const onDeclared = vi.fn()
  render(<ToastProvider><DeclareIncidentDialog tripId="trip-1" open onClose={vi.fn()} onDeclared={onDeclared} /></ToastProvider>)
  return { onDeclared }
}

beforeEach(() => {
  vi.mocked(recordIncidentDeclaration).mockReset()
})

describe('DeclareIncidentDialog', () => {
  it('keeps Save disabled until a fact other than a note is entered', async () => {
    // Arrange
    renderDialog()

    // Act
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'called SAPS')

    // Assert
    expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled()
  })

  it('sends typed times as SAST and blank fields as null', async () => {
    // Arrange
    vi.mocked(recordIncidentDeclaration).mockResolvedValue({} as Awaited<ReturnType<typeof recordIncidentDeclaration>>)
    const { onDeclared } = renderDialog()
    await userEvent.type(screen.getByLabelText('Case (CAS) number'), '123/09/2026')
    await userEvent.type(screen.getByLabelText('Reported to SAPS at'), '2026-09-12T13:40')

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }))

    // Assert
    expect(recordIncidentDeclaration).toHaveBeenCalledWith('trip-1', expect.objectContaining({
      saps_cas_number: '123/09/2026', reported_to_saps_at: '2026-09-12T13:40:00+02:00',
      saps_station: null, client_notified_at: null, exception_id: null,
    }))
    expect(onDeclared).toHaveBeenCalledOnce()
  })
})
