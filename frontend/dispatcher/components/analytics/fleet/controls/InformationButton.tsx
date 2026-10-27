'use client'

import { Info } from 'lucide-react'
import { useState } from 'react'

import { Modal } from '@/components/ui/Modal'
import { FLEET_COPY } from '../copy'

const COPY = FLEET_COPY.controls

const ICON_SIZE = 16

interface InformationButtonProps {
  notes: readonly string[]
}

/** Sits at the end of the control row and opens the page's notes over a blurred page.
 *  The notes explain how every figure is counted, so they stay one click away rather than
 *  crowding the space above the charts. */
export function InformationButton({ notes }: InformationButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-outline-v/30 bg-surf-low px-4 text-sm font-medium text-on-surf transition-colors duration-150 hover:bg-surf-lowest focus:border-sec focus:outline-none"
      >
        <Info aria-hidden="true" size={ICON_SIZE} className="text-on-surf-v" />
        {COPY.information}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={COPY.informationTitle} backdrop="blur">
        <div className="flex flex-col gap-3">
          {notes.map((note) => <p key={note}>{note}</p>)}
        </div>
      </Modal>
    </>
  )
}
