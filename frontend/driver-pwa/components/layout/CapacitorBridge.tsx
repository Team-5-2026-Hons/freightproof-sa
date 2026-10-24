'use client'

// The native shell's app-level events, wired once for the whole signed-in app.
//
// backButton: Android's hardware/gesture back. Capacitor's default walks the WebView's
// history, which here is full of screens a driver must never land back on (a submitted
// form, a finished phase — see lib/navigation/back-stack.ts), and on the first entry it
// exits the app outright. Instead back does what the screen's own back control does.
//
// appRestoredResult: a camera photo that outlived the WebView (lib/camera/restored-photo.ts).

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { ROUTES } from '@/lib/constants/routes'
import { getEdgeBackHandler } from '@/lib/navigation/edge-back'
import { previousScreen } from '@/lib/navigation/back-stack'
import { markTransition } from '@/lib/navigation/transition-direction'
import { photoDataUrlFrom, receiveRestoredPhoto } from '@/lib/camera/restored-photo'

const CAMERA_PLUGIN_ID = 'Camera'
const GET_PHOTO_METHOD = 'getPhoto'

// Every modal surface in the app (Drawer and the Radix dialogs) closes on Escape, so back
// over an open sheet closes the sheet — the platform's rule — rather than leaving the
// screen underneath it.
const OPEN_MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'

function closeOpenModal(): boolean {
  if (document.querySelector(OPEN_MODAL_SELECTOR) === null) return false
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return true
}

export function CapacitorBridge(): null {
  const router = useRouter()
  const pathname = usePathname()
  // Read at event time; re-registering the native listener on every navigation would
  // leave a window where back fell through to Capacitor's default and closed the app.
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const handleBack = (): void => {
      if (closeOpenModal()) return
      // The screen's own back control (SubpageHeader, StepHeader): the same action the
      // chevron and the edge swipe take, so the three can never disagree.
      const screenBack = getEdgeBackHandler()
      if (screenBack !== null) {
        screenBack()
        return
      }
      const previous = previousScreen()
      if (previous !== null) {
        markTransition('back')
        router.push(previous)
        return
      }
      if (pathnameRef.current !== ROUTES.home) {
        // A tab root: Home is the root of roots, as a tab switch would treat it.
        markTransition('none')
        router.replace(ROUTES.home)
        return
      }
      // Minimise, not exit: an exited app cold-starts, losing the WebView a driver
      // mid-trip expects to come back to.
      App.minimizeApp().catch((err: unknown) => console.warn('Could not minimise the app', err))
    }

    const listeners = [
      App.addListener('backButton', handleBack),
      App.addListener('appRestoredResult', (event) => {
        if (event.pluginId !== CAMERA_PLUGIN_ID || event.methodName !== GET_PHOTO_METHOD || !event.success) return
        const dataUrl = photoDataUrlFrom(event.data)
        if (dataUrl !== null) receiveRestoredPhoto(dataUrl)
      }),
    ]

    return () => {
      for (const listener of listeners) {
        listener.then((handle) => handle.remove()).catch((err: unknown) => console.warn('Could not remove app listener', err))
      }
    }
  }, [router])

  return null
}
