'use client'

import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { hrefForAction } from '@/lib/assistant/links'
import type { AssistantAction } from '@shared/lib/types/assistant'
import { ASSISTANT_COPY } from './assistantCopy'
import { usePendingHref, type NavigateTo } from './navigation'

interface ActionButtonProps {
  action: AssistantAction
  /** The pop-up waits for the page it opens, then gets out of the way (spec D6, B38). */
  onNavigate: NavigateTo
}

/** A button under an answer. It only opens a page; whatever the page does next is the dispatcher's click (spec D2). */
export function ActionButton({ action, onNavigate }: ActionButtonProps) {
  const router = useRouter()
  const href = hrefForAction(action)
  const pending = usePendingHref()
  const opening = pending === href
  return (
    <Button
      type="button"
      size="sm"
      variant={action.kind === 'open_trip_form' ? 'primary' : 'secondary'}
      // While any page is opening, a second click would only start a second navigation.
      disabled={pending !== null}
      aria-busy={opening || undefined}
      onClick={() => {
        router.push(href)
        onNavigate(href)
      }}
    >
      {opening ? <><Spinner size="sm" className="mr-1.5" />{ASSISTANT_COPY.opening}</> : action.label}
    </Button>
  )
}
