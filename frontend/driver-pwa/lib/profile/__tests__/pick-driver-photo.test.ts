import { describe, it, expect, vi, beforeEach } from 'vitest'

const isNativePlatform = vi.fn()
const getPhoto = vi.fn()
const compress = vi.fn()

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }))
vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: (opts: unknown) => getPhoto(opts) },
  CameraResultType: { DataUrl: 'dataUrl' },
  CameraSource: { Prompt: 'PROMPT' },
}))
vi.mock('@/lib/utils/image', () => ({
  fileToCompressedJpegDataUrl: (...args: unknown[]) => compress(...args),
}))

import { pickDriverPhoto } from '../pick-driver-photo'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pickDriverPhoto', () => {
  it('test_native_asks_camera_or_library_at_avatar_size', async () => {
    isNativePlatform.mockReturnValue(true)
    getPhoto.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,NATIVE' })

    const result = await pickDriverPhoto()

    expect(result).toBe('data:image/jpeg;base64,NATIVE')
    expect(getPhoto).toHaveBeenCalledWith(expect.objectContaining({ source: 'PROMPT', width: 512 }))
  })

  it('test_native_cancel_returns_null_quietly', async () => {
    isNativePlatform.mockReturnValue(true)
    getPhoto.mockRejectedValue(new Error('User cancelled photos app'))

    const result = await pickDriverPhoto()

    expect(result).toBeNull()
  })

  it('test_native_permission_denied_is_thrown_for_the_caller_to_explain', async () => {
    isNativePlatform.mockReturnValue(true)
    getPhoto.mockRejectedValue(new Error('User denied access to camera'))

    await expect(pickDriverPhoto()).rejects.toThrow(/denied/)
  })

  it('test_web_compresses_the_chosen_file_to_avatar_size', async () => {
    isNativePlatform.mockReturnValue(false)
    compress.mockResolvedValue('data:image/jpeg;base64,WEB')
    const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' })
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { value: [file] })
      this.dispatchEvent(new Event('change'))
    })

    const result = await pickDriverPhoto()

    expect(click).toHaveBeenCalled()
    expect(compress).toHaveBeenCalledWith(file, 512, 80)
    expect(result).toBe('data:image/jpeg;base64,WEB')
  })

  it('test_web_cancel_returns_null', async () => {
    isNativePlatform.mockReturnValue(false)
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event('cancel'))
    })

    const result = await pickDriverPhoto()

    expect(result).toBeNull()
    expect(compress).not.toHaveBeenCalled()
  })
})
