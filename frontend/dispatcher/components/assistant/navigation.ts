'use client'

// Which assistant link or button is opening a page right now (Tom's browser test, 22 Oct, B38).
//
// A page can take a few seconds to arrive (in development each page is built on its first visit), and the
// pop-up used to close on the click, so nothing on screen showed the click had worked. Now the clicked
// link shows a spinner and the pop-up stays until the new page is there (AssistantBubble).

import { createContext, useContext } from 'react'

/** Called with the address a link or button is opening. */
export type NavigateTo = (href: string) => void

export const PendingNavigation = createContext<string | null>(null)

/** The address being opened, or null. */
export function usePendingHref(): string | null {
  return useContext(PendingNavigation)
}

/** "/trips/new" from "/trips/new?mode=manifest": what usePathname reports once the page has arrived. */
export function pathOf(href: string): string {
  return href.split(/[?#]/, 1)[0]
}
