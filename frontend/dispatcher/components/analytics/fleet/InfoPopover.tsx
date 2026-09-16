'use client'

import { Info } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { FLEET_COPY } from './copy'

const ICON_SIZE = 14

interface InfoPopoverProps {
  /** The chart's title, for the button's accessible name. */
  title: string
  /** The question the chart answers, e.g. "Are we getting busier?". */
  question: string
  /** What the chart rests on, e.g. "Closed trips, by the day they first departed · 16 trips". */
  basis?: string
  /** How to read the chart, e.g. "Top-right = busy and risky". A description; a warning
   *  belongs on the card face instead. */
  note?: string
  /** The popover's last line, e.g. what faded buckets mean. */
  footnote?: string
}

/** The small "i" beside a chart title. Keeps the card face clean and holds the chart's
 *  question and basis. Non-modal: closes on a second click, Escape or an outside click. */
export function InfoPopover({ title, question, basis, note, footnote }: InfoPopoverProps) {
  const [open, setOpen] = useState(false)
  const popoverId = useId()
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const label = FLEET_COPY.chart.aboutChart(title)

  useEffect(() => {
    // Listen only while open, so a page of closed popovers (one per chart) adds no listeners.
    if (!open) return

    function onPointerDown(event: MouseEvent): void {
      if (event.target instanceof Node && wrapperRef.current?.contains(event.target)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span ref={wrapperRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((isOpen) => !isOpen)}
        className="flex h-6 w-6 items-center justify-center rounded-full text-on-surf-v transition-colors duration-150 hover:text-on-surf focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sec"
      >
        <Info aria-hidden="true" size={ICON_SIZE} />
      </button>
      {open && (
        <div
          id={popoverId}
          role="region"
          aria-label={label}
          className="absolute left-0 top-full z-[10] mt-1 w-max max-w-[280px] rounded-lg bg-surf-lowest p-3 shadow-level-5"
        >
          <p className="text-[13px] font-[600] text-on-surf">{question}</p>
          {basis !== undefined && <p className="mt-1 text-[12px] text-on-surf-v">{basis}</p>}
          {note !== undefined && <p className="mt-2 text-[12px] text-on-surf-v">{note}</p>}
          {footnote !== undefined && <p className="mt-2 text-[12px] text-on-surf-v">{footnote}</p>}
        </div>
      )}
    </span>
  )
}
