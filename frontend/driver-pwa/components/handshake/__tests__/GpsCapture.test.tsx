// frontend/driver-pwa/components/handshake/__tests__/GpsCapture.test.tsx
//
// Covers the fix that replaces a bare "Retry GPS" with reason-specific remediation:
// permission_denied must tell the driver retrying won't help until they fix the OS
// permission, while timeout/position_unavailable point them at open sky instead.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GpsCapture } from '../GpsCapture'
import { useLocation } from '@/lib/hooks/useLocation'

vi.mock('@/lib/hooks/useLocation', () => ({
  useLocation: vi.fn(),
}))

// framer-motion's useReducedMotion touches window.matchMedia, which jsdom omits.
beforeEach(() => {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
  }
})

function mockUseLocation(overrides: Partial<ReturnType<typeof useLocation>>) {
  vi.mocked(useLocation).mockReturnValue({
    coords: null,
    status: 'idle',
    errorReason: null,
    capture: vi.fn().mockResolvedValue(null),
    ...overrides,
  })
}

describe('GpsCapture', () => {
  it('renders the capture button when idle', () => {
    mockUseLocation({ status: 'idle' })
    render(<GpsCapture onCapture={vi.fn()} captured={false} />)

    expect(screen.getByRole('button', { name: 'Capture GPS Location' })).toBeInTheDocument()
  })

  it('renders "Location captured" once coords already exist on the draft', () => {
    mockUseLocation({ status: 'idle' })
    render(<GpsCapture onCapture={vi.fn()} captured={true} />)

    expect(screen.getByText('Location captured')).toBeInTheDocument()
  })

  it('permission_denied: tells the driver retrying will not help and to use phone settings', () => {
    mockUseLocation({ status: 'error', errorReason: 'permission_denied' })
    render(<GpsCapture onCapture={vi.fn()} captured={false} />)

    expect(screen.getByText(/Retrying won.t help/)).toBeInTheDocument()
    expect(screen.getByText(/enable Location for this app in.*Settings|Settings/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry GPS' })).toBeInTheDocument()
  })

  it('timeout: suggests moving to open sky and retrying', () => {
    mockUseLocation({ status: 'error', errorReason: 'timeout' })
    render(<GpsCapture onCapture={vi.fn()} captured={false} />)

    expect(screen.getByText(/open sky/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry GPS' })).toBeInTheDocument()
  })

  it('position_unavailable: suggests moving to open sky and retrying', () => {
    mockUseLocation({ status: 'error', errorReason: 'position_unavailable' })
    render(<GpsCapture onCapture={vi.fn()} captured={false} />)

    expect(screen.getByText(/open sky/)).toBeInTheDocument()
  })

  it('unknown reason: falls back to generic retry copy', () => {
    mockUseLocation({ status: 'error', errorReason: 'unknown' })
    render(<GpsCapture onCapture={vi.fn()} captured={false} />)

    expect(screen.getByText('Could not get your location. Try again.')).toBeInTheDocument()
  })

  it('a null errorReason (defensive default) still renders generic copy without throwing', () => {
    mockUseLocation({ status: 'error', errorReason: null })
    render(<GpsCapture onCapture={vi.fn()} captured={false} />)

    expect(screen.getByText('Could not get your location. Try again.')).toBeInTheDocument()
  })

  it('calls onCapture with the resolved coordinates when capture succeeds', async () => {
    const capture = vi.fn().mockResolvedValue({ latitude: -25.75, longitude: 28.19, accuracy: 10 })
    const onCapture = vi.fn()
    mockUseLocation({ status: 'idle', capture })
    render(<GpsCapture onCapture={onCapture} captured={false} />)

    await screen.getByRole('button', { name: 'Capture GPS Location' }).click()

    expect(onCapture).toHaveBeenCalledWith(-25.75, 28.19)
  })
})
