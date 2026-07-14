'use client'

import { useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'

// navigator.onLine via useSyncExternalStore: SSR-safe (server snapshot = online)
// and updates on the browser's online/offline events without manual listeners in effects.
function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  if (online) return null
  return (
    <div role="status" className="flex items-center gap-2 bg-tertiary-container px-4 py-2 text-xs font-medium text-tertiary-on-container">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      You&rsquo;re offline — evidence you capture is saved on this device.
    </div>
  )
}
