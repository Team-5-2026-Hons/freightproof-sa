'use client'

import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'

// Pixel size of the arrow — matches the 14px icons the other small secondary buttons use.
const BACK_ICON_SIZE = 14

interface BackButtonProps {
  /** Where Back goes is each page's own decision (a returnTo, a list, history…), so
   *  the button only reports the click. */
  onClick: () => void
}

/**
 * The one header Back button for the dispatcher, meant for TopBar's `left` slot.
 *
 * Every detail page used to build its own copy, and they drifted: some had the arrow,
 * some didn't, one was a different size. One component makes the look impossible to
 * get wrong on a new page.
 */
export function BackButton({ onClick }: BackButtonProps) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      iconLeft={<Ic n="back" s={BACK_ICON_SIZE} className="text-on-surf" />}
    >
      Back
    </Button>
  )
}
