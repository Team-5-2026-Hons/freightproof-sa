import { Check, AlertTriangle } from 'lucide-react'
import { HANDSHAKE_NAMES } from '@shared/lib/constants/handshake-meta'
import type { HandshakeStageState } from '@/lib/utils/handshake-progress'
import { cn } from '@shared/lib/utils/cn'

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

// Horizontal H1-H5 stepper. Scrolls on very narrow viewports rather than
// squeezing labels unreadably small.
export function HandshakeProgressBar({ progress }: HandshakeProgressBarProps) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1">
      <div className="flex min-w-[420px] items-center">
        {STAGE_NUMBERS.map((n, i) => {
          const state = progress[n]
          const isLast = i === STAGE_NUMBERS.length - 1
          return (
            <div key={n} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
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
                    `H${n}`
                  )}
                </div>
                <p className="w-20 text-center text-[10px] font-medium leading-tight text-surface-on-variant">
                  {HANDSHAKE_NAMES[n]}
                </p>
              </div>
              {!isLast && (
                <div className={cn('mx-1 h-0.5 flex-1 rounded-full transition-colors duration-200', CONNECTOR_CLASSES[state])} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
