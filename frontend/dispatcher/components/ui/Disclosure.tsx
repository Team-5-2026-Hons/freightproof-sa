'use client'

import { useEffect, useState, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react'
import { Ic } from '@/components/ui/Ic'
import { cn } from '@shared/lib/utils/cn'

// Scoped to the trip Info panel, the only place sections are remembered today.
const STORAGE_KEY_PREFIX = 'fp.tripInfo.section.'

/** The id of a section's heading, for a wrapper that names itself by it (`aria-labelledby`). */
export function disclosureHeadingId(id: string): string {
  return `disclosure-${id}-heading`
}

// Storage can be unavailable (private window, blocked site data, a quota error), and the page
// must still work: a section just starts from its default each visit.
function readStoredOpen(id: string): boolean | null {
  try {
    const value = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${id}`)
    return value === '1' ? true : value === '0' ? false : null
  } catch {
    return null
  }
}

function writeStoredOpen(id: string, open: boolean): void {
  try {
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${id}`, open ? '1' : '0')
  } catch {
    // Nothing to recover: the choice simply is not remembered.
  }
}

interface DisclosureProps {
  /** Stable: names the heading and the stored open/closed choice. */
  id: string
  title: string
  /** One line shown beside the title, open or closed. */
  summary?: ReactNode
  defaultOpen?: boolean
  /** Controlled mode, for a caller that must force a state (a deep link that lands on this section).
   *  Left undefined, the section keeps and remembers its own state. */
  open?: boolean
  /** Opens the section once for each new non-null value (a deep link that lands here), then leaves
   *  it to the reader, who can fold it away as usual. Unlike `open`, it never holds the section. */
  forceOpenKey?: string | number | null
  /** Called with the new state whenever the reader (or a forced open) changes it. */
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

/**
 * A titled section the reader can fold away, on native <details>/<summary> so keyboard,
 * screen-reader and find-in-page behaviour come with the platform. Never put a control inside
 * the summary: an action belongs at the top of the body. Stack sections in a parent with
 * `divide-y divide-outline-v` so the rules fall between them and never above the first.
 */
export function Disclosure({ id, title, summary, defaultOpen = false, open: controlledOpen, forceOpenKey = null, onOpenChange, children }: DisclosureProps): React.JSX.Element {
  // null until the reader chooses: until then `defaultOpen` stays live, so a section that
  // should open once its data arrives (an incident appears) does open.
  const [stored, setStored] = useState<boolean | null>(() => readStoredOpen(id))
  // Adjusted during render, not in an effect, so a section a link lands on is already open when
  // its parent measures it. The key is remembered: a re-render never forces it open again.
  const [appliedKey, setAppliedKey] = useState<string | number | null>(null)
  if (forceOpenKey !== null && forceOpenKey !== appliedKey) {
    setAppliedKey(forceOpenKey)
    setStored(true)
  }
  useEffect(() => {
    if (forceOpenKey !== null) writeStoredOpen(id, true)
  }, [forceOpenKey, id])
  const controlled = controlledOpen !== undefined
  const isOpen = controlled ? controlledOpen : (stored ?? defaultOpen)

  function change(next: boolean): void {
    if (next === isOpen) return
    if (!controlled) {
      setStored(next)
      writeStoredOpen(id, next)
    }
    onOpenChange?.(next)
  }

  // Our own state drives `open`, so the browser's built-in toggle is cancelled.
  function onSummaryClick(event: MouseEvent<HTMLElement>): void {
    event.preventDefault()
    change(!isOpen)
  }

  // The browser can still open the section itself (find-in-page reveals matching text inside it);
  // a toggle that disagrees with our state is that, so follow it.
  function onToggle(event: SyntheticEvent<HTMLDetailsElement>): void {
    change(event.currentTarget.open)
  }

  return (
    <details open={isOpen} onToggle={onToggle}>
      <summary
        onClick={onSummaryClick}
        className="flex cursor-pointer list-none items-center gap-3 rounded-md py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec [&::-webkit-details-marker]:hidden"
      >
        <h3 id={disclosureHeadingId(id)} className="shrink-0 text-sm font-bold text-on-surf">{title}</h3>
        {summary && <span className="min-w-0 flex-1 truncate text-xs text-on-surf-v">{summary}</span>}
        <Ic n="chev" s={14} className={cn('ml-auto shrink-0 text-on-surf-v transition-transform duration-150 motion-reduce:transition-none', isOpen && 'rotate-90')} />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  )
}
