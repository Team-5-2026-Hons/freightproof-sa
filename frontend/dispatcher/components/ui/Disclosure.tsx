'use client'

import { useEffect, useState, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react'
import { Ic } from '@/components/ui/Ic'
import { cn } from '@shared/lib/utils/cn'

const STORAGE_KEY_PREFIX = 'fp.tripInfo.section.'

/** The id of a section's heading, for a wrapper that names itself by it (`aria-labelledby`). */
export function disclosureHeadingId(id: string): string {
  return `disclosure-${id}-heading`
}

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
  }
}

interface DisclosureProps {
  id: string
  title: string
  summary?: ReactNode
  defaultOpen?: boolean
  open?: boolean
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
  const [stored, setStored] = useState<boolean | null>(() => readStoredOpen(id))
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

  function onSummaryClick(event: MouseEvent<HTMLElement>): void {
    event.preventDefault()
    change(!isOpen)
  }

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
