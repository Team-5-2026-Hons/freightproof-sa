// frontend/driver-pwa/lib/camera/__tests__/restored-photo.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PENDING_CAPTURE_MAX_AGE_MS, __resetRestoredPhotoForTests, captureKey, claimRestoredPhoto, clearCapturePending,
  markCapturePending, photoDataUrlFrom, receiveRestoredPhoto, subscribeRestoredPhoto,
} from '../restored-photo'

const PHOTO = 'data:image/jpeg;base64,AAAA'
const KEY = captureKey('/trip/phase/loading/step/2-seal', 'Seal photo')

beforeEach(() => {
  window.localStorage.clear()
  __resetRestoredPhotoForTests()
})

describe('restored camera photo', () => {
  it('hands a restored photo to the control that was waiting on it, once', () => {
    markCapturePending(KEY)

    const accepted = receiveRestoredPhoto(PHOTO)

    expect(accepted).toBe(true)
    expect(claimRestoredPhoto(KEY)).toBe(PHOTO)
    expect(claimRestoredPhoto(KEY)).toBeNull()
  })

  it('keeps the photo from a different control', () => {
    markCapturePending(KEY)
    receiveRestoredPhoto(PHOTO)

    const claimed = claimRestoredPhoto(captureKey('/trip/phase/loading/step/2-seal', 'Another photo'))

    expect(claimed).toBeNull()
    expect(claimRestoredPhoto(KEY)).toBe(PHOTO)
  })

  it('drops a photo nobody was waiting for', () => {
    const accepted = receiveRestoredPhoto(PHOTO)

    expect(accepted).toBe(false)
    expect(claimRestoredPhoto(KEY)).toBeNull()
  })

  it('drops a photo whose capture started too long ago to trust', () => {
    const started = new Date('2026-10-21T08:00:00Z')
    markCapturePending(KEY, started)

    const accepted = receiveRestoredPhoto(PHOTO, new Date(started.getTime() + PENDING_CAPTURE_MAX_AGE_MS + 1))

    expect(accepted).toBe(false)
  })

  it('a capture the camera answered normally leaves nothing to restore', () => {
    markCapturePending(KEY)
    clearCapturePending()

    expect(receiveRestoredPhoto(PHOTO)).toBe(false)
  })

  it('tells a control already on screen that its photo arrived', () => {
    const listener = vi.fn()
    subscribeRestoredPhoto(listener)
    markCapturePending(KEY)

    receiveRestoredPhoto(PHOTO)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('reads a data URL or a base64 photo from the restored result, and nothing else', () => {
    expect(photoDataUrlFrom({ dataUrl: PHOTO })).toBe(PHOTO)
    expect(photoDataUrlFrom({ base64String: 'AAAA', format: 'jpeg' })).toBe(PHOTO)
    expect(photoDataUrlFrom({ dataUrl: 'javascript:alert(1)' })).toBeNull()
    expect(photoDataUrlFrom(null)).toBeNull()
  })
})
