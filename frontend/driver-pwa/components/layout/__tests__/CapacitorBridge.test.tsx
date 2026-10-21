// frontend/driver-pwa/components/layout/__tests__/CapacitorBridge.test.tsx
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { native, appListeners, minimizeApp, mockPush, mockReplace, path } = vi.hoisted(() => ({
  native: { value: true },
  appListeners: new Map<string, (event: unknown) => void>(),
  minimizeApp: vi.fn(),
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  path: { value: '/' },
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }))
vi.mock('@capacitor/app', () => ({
  App: {
    minimizeApp,
    addListener: vi.fn((event: string, handler: (payload: unknown) => void) => {
      appListeners.set(event, handler)
      return Promise.resolve({ remove: vi.fn().mockResolvedValue(undefined) })
    }),
  },
}))
vi.mock('next/navigation', () => ({
  usePathname: () => path.value,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))

import { App } from '@capacitor/app'
import { CapacitorBridge } from '../CapacitorBridge'
import { useEdgeBackHandler } from '@/lib/navigation/edge-back'
import { recordScreen, resetBackStack } from '@/lib/navigation/back-stack'
import { __resetRestoredPhotoForTests, captureKey, claimRestoredPhoto, markCapturePending } from '@/lib/camera/restored-photo'

function ScreenWithBack({ onBack }: { onBack: () => void }) {
  useEdgeBackHandler(onBack)
  return null
}

function pressBack(): void {
  appListeners.get('backButton')!({ canGoBack: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  appListeners.clear()
  native.value = true
  path.value = '/'
  minimizeApp.mockResolvedValue(undefined)
  resetBackStack()
  __resetRestoredPhotoForTests()
  window.localStorage.clear()
})

describe('CapacitorBridge hardware back', () => {
  it('takes the screen\'s own back action when it has one', () => {
    const onBack = vi.fn()
    render(<><CapacitorBridge /><ScreenWithBack onBack={onBack} /></>)

    pressBack()

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('closes an open sheet before leaving the screen', () => {
    const onBack = vi.fn()
    const onEscape = vi.fn()
    document.addEventListener('keydown', onEscape)
    render(<><CapacitorBridge /><ScreenWithBack onBack={onBack} /><div role="dialog" aria-modal="true" /></>)

    pressBack()

    expect(onEscape).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }))
    expect(onBack).not.toHaveBeenCalled()
    document.removeEventListener('keydown', onEscape)
  })

  it('pops the app\'s back stack on a screen with no back control', () => {
    path.value = '/panic'
    recordScreen('/trips', '/trips', 'none')
    recordScreen('/panic', '/panic', 'forward')
    render(<CapacitorBridge />)

    pressBack()

    expect(mockPush).toHaveBeenCalledWith('/trips')
  })

  it('goes Home from another tab root', () => {
    path.value = '/trips'
    recordScreen('/trips', '/trips', 'none')
    render(<CapacitorBridge />)

    pressBack()

    expect(mockReplace).toHaveBeenCalledWith('/')
    expect(minimizeApp).not.toHaveBeenCalled()
  })

  it('minimises rather than exits on Home', () => {
    recordScreen('/', '/', 'none')
    render(<CapacitorBridge />)

    pressBack()

    expect(minimizeApp).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('registers nothing in a browser', () => {
    native.value = false

    render(<CapacitorBridge />)

    expect(App.addListener).not.toHaveBeenCalled()
  })
})

describe('CapacitorBridge restored camera result', () => {
  const KEY = captureKey('/trip/phase/loading/step/2-seal', 'Seal photo')
  const PHOTO = 'data:image/jpeg;base64,AAAA'

  it('parks a restored getPhoto result for the control that started it', () => {
    markCapturePending(KEY)
    render(<CapacitorBridge />)

    appListeners.get('appRestoredResult')!({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: { dataUrl: PHOTO } })

    expect(claimRestoredPhoto(KEY)).toBe(PHOTO)
  })

  it('ignores another plugin\'s result and a failed capture', () => {
    markCapturePending(KEY)
    render(<CapacitorBridge />)

    appListeners.get('appRestoredResult')!({ pluginId: 'DocumentScanner', methodName: 'scanDocument', success: true, data: { dataUrl: PHOTO } })
    appListeners.get('appRestoredResult')!({ pluginId: 'Camera', methodName: 'getPhoto', success: false, error: { message: 'User cancelled photos app' } })

    expect(claimRestoredPhoto(KEY)).toBeNull()
  })
})
