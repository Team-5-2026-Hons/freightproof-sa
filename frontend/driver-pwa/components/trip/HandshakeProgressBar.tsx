import { Check, AlertTriangle } from 'lucide-react'
import { HANDSHAKE_NAMES } from '@shared/lib/constants/handshake-meta'
import type { HandshakeStageState } from '@/lib/utils/handshake-progress'
import { cn } from '@/lib/utils'

interface HandshakeProgressBarProps {
  progress: Record<1 | 2 | 3 | 4 | 5, HandshakeStageState>
}

const STAGE_NUMBERS = [1, 2, 3, 4, 5] as const

const DOT_CLASSES: Record<HandshakeStageState, string> = {
  completed: 'bg-primary border-primary text-primary-on',
  current:   'bg-secondary border-secondary text-secondary-on',
  exception: 'bg-error border-error text-error-on',
  upcoming:  'bg-surface-container-lowest border-outline-variant text-surface-on-variant',
}

const CONNECTOR_CLASSES: Record<HandshakeStageState, string> = {
  completed: 'bg-primary',
  current:   'bg-outline-variant/40',
  exception: 'bg-outline-variant/40',
  upcoming:  'bg-outline-variant/40',
}

// Horizontal 5-step stepper. Every step is an equal-width flex-1 cell so all five
// always fit the viewport (down to 320px) with no horizontal scroll — labels wrap
// instead of clipping. Circles show the plain step number, never internal "H1-H5"
// codes, which are dispatcher-internal and confuse drivers.
export function HandshakeProgressBar({ progress }: HandshakeProgressBarProps) {
  return (
    <div className="flex items-start">
      {STAGE_NUMBERS.map((n, i) => {
        const state = progress[n]
        const isFirst = i === 0
        const isLast = i === STAGE_NUMBERS.length - 1
        // A connector segment's colour reflects the step it flows out of: the left
        // half of cell n and the right half of cell n-1 both track progress[n-1],
        // so adjacent halves always match.
        const leftConnectorState = isFirst ? undefined : progress[STAGE_NUMBERS[i - 1]]
        return (
          <div key={n} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full items-center">
              <div
                className={cn(
                  'h-0.5 flex-1 rounded-full transition-colors duration-200',
                  isFirst ? 'invisible' : CONNECTOR_CLASSES[leftConnectorState!],
                )}
              />
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors duration-200',
                  DOT_CLASSES[state],
                )}
              >
                {state === 'completed' ? (
                  <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                ) : state === 'exception' ? (
                  <AlertTriangle className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                ) : (
                  n
                )}
              </div>
              <div
                className={cn(
                  'h-0.5 flex-1 rounded-full transition-colors duration-200',
                  isLast ? 'invisible' : CONNECTOR_CLASSES[state],
                )}
              />
            </div>
            <p className="w-full break-words text-center text-[10px] font-medium leading-tight text-surface-on-variant">
              {HANDSHAKE_NAMES[n]}
            </p>
          </div>
        )
      })}
    </div>
  )
}
