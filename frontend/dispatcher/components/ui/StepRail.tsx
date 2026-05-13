import { cn } from '@shared/lib/utils/cn'
import { Ic } from './Ic'

interface StepRailProps {
  /** Step labels in order. */
  steps: string[]
  /** 1-indexed currently active step. */
  current: number
  /** Called when user clicks a completed step to navigate back. Optional. */
  onNavigate?: (step: number) => void
}

/**
 * Horizontal step-progress rail. Completed steps show a green check, the
 * active step shows a blue numbered circle with a halo, future steps are muted.
 * Place this in a band between the TopBar and the form content.
 */
export function StepRail({ steps, current, onNavigate }: StepRailProps) {
  return (
    <div className="flex items-start w-full">
      {steps.map((label, i) => {
        const stepNum = i + 1
        const isDone   = stepNum < current
        const isActive = stepNum === current
        const canNav   = isDone && !!onNavigate

        return (
          <div key={label} className="flex items-start flex-1 last:flex-none">
            {/* Step node */}
            <button
              type="button"
              disabled={!canNav}
              onClick={() => canNav && onNavigate!(stepNum)}
              className={cn(
                'flex flex-col items-center gap-2 shrink-0',
                canNav ? 'cursor-pointer' : 'cursor-default',
              )}
            >
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-[700] transition-all duration-200',
                isDone   && 'bg-ok text-white',
                isActive && 'bg-sec text-white ring-4 ring-sec/20',
                !isDone && !isActive && 'bg-surf-high text-on-surf-v border border-outline-v/30',
              )}>
                {isDone
                  ? <Ic n="check" s={13} c="white" />
                  : <span>{stepNum}</span>
                }
              </div>
              <span className={cn(
                'text-[11px] font-[600] tracking-[0.02em] whitespace-nowrap leading-none',
                isDone   && 'text-ok',
                isActive && 'text-sec',
                !isDone && !isActive && 'text-on-surf-v',
              )}>
                {label}
              </span>
            </button>

            {/* Connector line — aligns with circle centre via mt-4 (16px = half of 32px) */}
            {i < steps.length - 1 && (
              <div className="flex-1 h-px mx-3 mt-4 bg-outline-v/30 relative overflow-hidden">
                <div
                  className="absolute inset-0 bg-ok transition-all duration-300"
                  style={{ width: isDone ? '100%' : '0%' }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
