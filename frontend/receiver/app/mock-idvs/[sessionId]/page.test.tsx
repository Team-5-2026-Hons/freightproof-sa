// app/mock-idvs/[sessionId]/page.test.tsx
//
// The simulated vendor page says "Simulated · not a real identity check". It must exist in
// development and must not exist on a production receiver domain unless someone has turned
// it on deliberately.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stashIdentity } from '@/lib/identity-stash'
import MockIdvsPage from './page'

const TOKEN = 'tok123'

// What next/navigation's notFound() throws; matched on the digest so the test doesn't
// depend on Next's internal error class.
const NOT_FOUND_DIGEST = 'NEXT_HTTP_ERROR_FALLBACK;404'

function renderQuietly(): void {
  // React logs a boundary-less throw to console.error; the throw is what is being asserted.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<MockIdvsPage />)
}

describe('MockIdvsPage gating', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('renders outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')

    render(<MockIdvsPage />)

    expect(screen.getByRole('heading', { name: 'Identity verification' })).toBeInTheDocument()
  })

  it('is not found in production by default', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_ENABLE_MOCK_IDVS', '')

    expect(renderQuietly).toThrow(expect.objectContaining({ digest: NOT_FOUND_DIGEST }))
  })

  it.each(['false', 'TRUE', '1', 'yes'])('is not found in production when the flag is %s', (flag) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_ENABLE_MOCK_IDVS', flag)

    expect(renderQuietly).toThrow(expect.objectContaining({ digest: NOT_FOUND_DIGEST }))
  })

  it('renders in production when explicitly enabled', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_ENABLE_MOCK_IDVS', 'true')

    render(<MockIdvsPage />)

    expect(screen.getByText(/simulated · not a real identity check/i)).toBeInTheDocument()
  })
})

describe('MockIdvsPage return path', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('links back to the delivery named in the shared stash', () => {
    stashIdentity({ name: 'Thandi Nkosi', idNumber: '9202204720082', token: TOKEN })

    render(<MockIdvsPage />)

    expect(screen.getByRole('link', { name: /return to the delivery/i })).toHaveAttribute('href', `/h/${TOKEN}`)
  })

  it('says there is nothing to return to when opened directly', () => {
    render(<MockIdvsPage />)

    expect(screen.getByText(/no handover to return to/i)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
