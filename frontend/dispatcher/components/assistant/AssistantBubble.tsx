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

/** CSS variables the toasts read (components/ui/Toast.tsx), so they sit above the bubble and beside the
 *  open pop-up instead of under them (spec D6). Set on <html> because toasts render outside this tree. */
export const BOTTOM_OFFSET_VAR = '--fp-assistant-bottom'
export const RIGHT_OFFSET_VAR = '--fp-assistant-right'
// The bubble (56 px) and its gap above the toasts' own 24 px margin.
const BUBBLE_CLEARANCE = '72px'
// If a page never arrives (an error, a link to an address that redirects), the pop-up still gets out of the way.
export const NAVIGATION_FALLBACK_MS = 10_000
// The pop-up's width (400 px) and the gap beside it.
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
  // The address an answer's link or button is opening. The pop-up stays, with a spinner on what was clicked,
  // until the new page is there: closing on the click left a few seconds with no sign anything happened (B38).
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [shownPath, setShownPath] = useState(pathname)
  if (pathname !== shownPath) {
    // Adjusted during render, not in an effect (the react-hooks rule): the new page has arrived.
    setShownPath(pathname)
    if (pendingHref !== null) {
      setPendingHref(null)
      setOpen(false)
    }
  }
  const onNavigate = useCallback((href: string) => {
    // Already on that page (only its query changes): there's nothing to wait for.
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
          // Below md the open pop-up fills the screen and has its own minimise button.
          open ? 'hidden md:flex' : 'flex',
        )}
      >
        {open ? <ChevronDown size={22} aria-hidden /> : <MessageCircle size={22} aria-hidden />}
      </button>
    </>
  )
}
