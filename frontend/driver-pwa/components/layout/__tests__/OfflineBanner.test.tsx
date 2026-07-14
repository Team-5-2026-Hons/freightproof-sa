import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { OfflineBanner } from '../OfflineBanner'

// jsdom defaults navigator.onLine to true; each test overrides the getter so the
// component's useSyncExternalStore snapshot reads the state we want.
function setOnline(online: boolean) {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OfflineBanner', () => {
  it('renders nothing while online', () => {
    setOnline(true)

    const { container } = render(<OfflineBanner />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the offline status message while offline', () => {
    setOnline(false)

    render(<OfflineBanner />)

    expect(screen.getByRole('status')).toHaveTextContent(
      /offline — evidence you capture is saved on this device/i,
    )
  })

  it('appears when the browser fires an offline event', () => {
    setOnline(true)
    render(<OfflineBanner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    setOnline(false)
    fireEvent(window, new Event('offline'))

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('disappears when connectivity comes back', () => {
    setOnline(false)
    render(<OfflineBanner />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    setOnline(true)
    fireEvent(window, new Event('online'))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
