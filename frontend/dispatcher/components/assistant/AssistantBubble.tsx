'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronDown, MessageCircle } from 'lucide-react'

import { ROUTES } from '@/lib/constants/routes'
import { useAssistant, useAssistantStatus } from '@/lib/hooks/useAssistant'
import { cn } from '@shared/lib/utils/cn'
import { AssistantPopup } from './AssistantPopup'
import { ASSISTANT_COPY } from './assistantCopy'
import { PendingNavigation, pathOf } from './navigation'

export const BOTTOM_OFFSET_VAR = '--fp-assistant-bottom'
export const RIGHT_OFFSET_VAR = '--fp-assistant-right'
const BUBBLE_CLEARANCE = '72px'
export const NAVIGATION_FALLBACK_MS = 10_000
const POPUP_CLEARANCE = '424px'

/** The round helper button, bottom-right on every dispatcher page except Analytics (which has its own
 *  chat), and its pop-up. Shown only when the server says the assistant is on. The conversation lives
 *  here, in the always-mounted bubble, so minimising never drops a question being answered. */
export function AssistantBubble() {
  const pathname = usePathname()
  const status = useAssistantStatus()
  const assistant = useAssistant(status.refetch)
  const [open, setOpen] = useState(false)
  const bubbleRef = useRef<HTMLButtonElement>(null)
  const popupId = useId()
  const hidden = !status.enabled || (pathname ?? '').startsWith(ROUTES.analytics)

  useEffect(() => {
    const root = document.documentElement.style
    if (hidden) {
      root.removeProperty(BOTTOM_OFFSET_VAR)
      root.removeProperty(RIGHT_OFFSET_VAR)
      return
    }
    root.setProperty(BOTTOM_OFFSET_VAR, BUBBLE_CLEARANCE)
    if (open) root.setProperty(RIGHT_OFFSET_VAR, POPUP_CLEARANCE)
    else root.removeProperty(RIGHT_OFFSET_VAR)
    return () => {
      root.removeProperty(BOTTOM_OFFSET_VAR)
      root.removeProperty(RIGHT_OFFSET_VAR)
    }
  }, [hidden, open])

  const minimise = useCallback(() => {
    setOpen(false)
    bubbleRef.current?.focus()
  }, [])
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [shownPath, setShownPath] = useState(pathname)
  if (pathname !== shownPath) {
    setShownPath(pathname)
    if (pendingHref !== null) {
      setPendingHref(null)
      setOpen(false)
    }
  }
  const onNavigate = useCallback((href: string) => {
    if (pathOf(href) === pathname) {
      setOpen(false)
      return
    }
    setPendingHref(href)
  }, [pathname])
  useEffect(() => {
    if (pendingHref === null) return
    const fallback = window.setTimeout(() => {
      setPendingHref(null)
      setOpen(false)
    }, NAVIGATION_FALLBACK_MS)
    return () => window.clearTimeout(fallback)
  }, [pendingHref])

  if (hidden) return null

  return (
    <>
      {open && (
        <PendingNavigation.Provider value={pendingHref}>
          <AssistantPopup
            id={popupId}
            assistant={assistant}
            statusSpend={status.spend}
            onMinimise={minimise}
            onNavigate={onNavigate}
          />
        </PendingNavigation.Provider>
      )}
      <button
        ref={bubbleRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-label={open ? ASSISTANT_COPY.minimise : ASSISTANT_COPY.open}
        className={cn(
          'fixed bottom-6 right-6 z-[36] h-14 w-14 items-center justify-center rounded-full bg-primary text-white',
          'shadow-level-6 transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2',
          'focus-visible:outline-offset-2 focus-visible:outline-sec motion-reduce:transition-none',
          open ? 'hidden md:flex' : 'flex',
        )}
      >
        {open ? <ChevronDown size={22} aria-hidden /> : <MessageCircle size={22} aria-hidden />}
      </button>
    </>
  )
}
