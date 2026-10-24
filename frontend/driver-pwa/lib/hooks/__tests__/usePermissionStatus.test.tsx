import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const cameraCheck = vi.fn()
const geoCheck = vi.fn()
vi.mock('@capacitor/camera', () => ({ Camera: { checkPermissions: () => cameraCheck() } }))
vi.mock('@capacitor/geolocation', () => ({ Geolocation: { checkPermissions: () => geoCheck() } }))

import { usePermissionStatus, type PermissionKind } from '../usePermissionStatus'

function Probe({ kind }: { kind: PermissionKind }) {
  const status = usePermissionStatus(kind)
  return <p>{status ?? 'unknown'}</p>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('usePermissionStatus', () => {
  it('test_reports_granted_location', async () => {
    geoCheck.mockResolvedValue({ location: 'granted', coarseLocation: 'granted' })

    render(<Probe kind="location" />)

    await waitFor(() => expect(screen.getByText('granted')).toBeInTheDocument())
  })

  it('test_folds_prompt_with_rationale_into_ask', async () => {
    cameraCheck.mockResolvedValue({ camera: 'prompt-with-rationale', photos: 'prompt' })

    render(<Probe kind="camera" />)

    await waitFor(() => expect(screen.getByText('ask')).toBeInTheDocument())
  })

  it('test_reports_denied_camera', async () => {
    cameraCheck.mockResolvedValue({ camera: 'denied', photos: 'denied' })

    render(<Probe kind="camera" />)

    await waitFor(() => expect(screen.getByText('denied')).toBeInTheDocument())
  })

  it('test_returns_null_when_the_platform_cannot_say', async () => {
    // e.g. iOS Safari has no Permissions API for the camera: show nothing, never a guess.
    geoCheck.mockRejectedValue(new Error('Permissions API not available in this browser'))

    render(<Probe kind="location" />)

    await waitFor(() => expect(geoCheck).toHaveBeenCalled())
    expect(screen.getByText('unknown')).toBeInTheDocument()
  })

  it('test_rechecks_when_the_driver_comes_back_to_the_app', async () => {
    // The usual fix for "denied" is the phone's Settings app; returning must refresh it.
    geoCheck.mockResolvedValueOnce({ location: 'denied' }).mockResolvedValueOnce({ location: 'granted' })
    render(<Probe kind="location" />)
    await waitFor(() => expect(screen.getByText('denied')).toBeInTheDocument())

    act(() => { document.dispatchEvent(new Event('visibilitychange')) })

    await waitFor(() => expect(screen.getByText('granted')).toBeInTheDocument())
  })
})
