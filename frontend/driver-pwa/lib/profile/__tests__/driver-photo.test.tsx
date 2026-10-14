import { act, render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { clearDriverPhoto, getDriverPhoto, setDriverPhoto, useDriverPhoto } from '../driver-photo'

const PHOTO = 'data:image/jpeg;base64,AAAA'

function Probe({ driverId }: { driverId: string | null }) {
  const photo = useDriverPhoto(driverId)
  return <p>{photo ?? 'none'}</p>
}

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('driver photo store', () => {
  it('test_round_trips_a_photo_for_one_driver', () => {
    const saved = setDriverPhoto('drv-1', PHOTO)

    expect(saved).toBe(true)
    expect(getDriverPhoto('drv-1')).toBe(PHOTO)
  })

  it('test_keeps_each_driver_photo_separate_on_a_shared_phone', () => {
    setDriverPhoto('drv-1', PHOTO)

    expect(getDriverPhoto('drv-2')).toBeNull()
  })

  it('test_clear_removes_only_that_driver_photo', () => {
    setDriverPhoto('drv-1', PHOTO)
    setDriverPhoto('drv-2', PHOTO)

    clearDriverPhoto('drv-1')

    expect(getDriverPhoto('drv-1')).toBeNull()
    expect(getDriverPhoto('drv-2')).toBe(PHOTO)
  })

  it('test_reports_failure_when_storage_is_full_instead_of_throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const saved = setDriverPhoto('drv-1', PHOTO)

    expect(saved).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('test_hook_updates_when_the_photo_changes', () => {
    render(<Probe driverId="drv-1" />)
    expect(screen.getByText('none')).toBeInTheDocument()

    act(() => { setDriverPhoto('drv-1', PHOTO) })

    expect(screen.getByText(PHOTO)).toBeInTheDocument()
  })

  it('test_hook_returns_null_without_a_driver', () => {
    render(<Probe driverId={null} />)

    expect(screen.getByText('none')).toBeInTheDocument()
  })
})
