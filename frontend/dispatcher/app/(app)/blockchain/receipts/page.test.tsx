import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ReceiptLookupPage from './page'

const pageMock = vi.hoisted(() => ({
  canViewForensics: false,
  forensicOn: false,
  toggle: vi.fn(),
  lookupMount: vi.fn(),
}))

vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => pageMock,
}))

vi.mock('@/components/blockchain/ReceiptLookup', () => ({
  ReceiptLookup: () => {
    pageMock.lookupMount()
    return <div>Lookup mounted</div>
  },
}))

beforeEach(() => {
  pageMock.canViewForensics = false
  pageMock.forensicOn = false
  pageMock.toggle.mockReset()
  pageMock.lookupMount.mockReset()
})

describe('ReceiptLookupPage access gate', () => {
  it('shows an access-restricted state without mounting lookup for non-admins', () => {
    render(<ReceiptLookupPage />)

    expect(screen.getByText('Access restricted')).toBeInTheDocument()
    expect(screen.queryByText('Lookup mounted')).not.toBeInTheDocument()
    expect(pageMock.lookupMount).not.toHaveBeenCalled()
  })

  it('prompts an admin to enable forensic mode using the shared toggle', async () => {
    const user = userEvent.setup()
    pageMock.canViewForensics = true
    render(<ReceiptLookupPage />)

    expect(screen.getByRole('heading', { name: 'Enable forensic mode' })).toBeInTheDocument()
    expect(pageMock.lookupMount).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Enable forensic mode' }))
    expect(pageMock.toggle).toHaveBeenCalledOnce()
  })

  it('mounts lookup only for an admin with forensic mode enabled', () => {
    pageMock.canViewForensics = true
    pageMock.forensicOn = true
    render(<ReceiptLookupPage />)

    expect(screen.getByText('Lookup mounted')).toBeInTheDocument()
    expect(pageMock.lookupMount).toHaveBeenCalledOnce()
  })
})
